import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactorProvider,
  ReactorView,
  useReactor,
  useReactorMessage,
  useStats,
} from '@reactor-team/js-sdk'
import './App.css'

const DEFAULT_PROMPT =
  'A faithful image-to-video shot of the uploaded reference image. Preserve the subject, composition, colors, and camera framing while adding subtle cinematic motion, gentle parallax, soft environmental movement, and smooth temporal consistency.'
const REACTOR_API_URL = 'https://api.reactor.inc'
const STORAGE_KEYS = {
  reactorApiKey: 'helios-snap.reactor-api-key',
}

function readStoredApiKey() {
  if (typeof window === 'undefined') return ''
  return window.localStorage.getItem(STORAGE_KEYS.reactorApiKey) || ''
}

async function readErrorMessage(response, fallbackMessage) {
  const contentType = response.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    const payload = await response.json().catch(() => null)
    if (payload?.error) return payload.error
  }

  const text = await response.text().catch(() => '')
  return text || fallbackMessage
}

async function fetchReactorJwt(apiKey) {
  const response = await fetch(`${REACTOR_API_URL}/tokens`, {
    method: 'POST',
    headers: {
      'Reactor-API-Key': apiKey,
    },
  })

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, `Token request failed (${response.status})`)
    )
  }

  const data = await response.json()
  if (!data?.jwt) {
    throw new Error('Token response did not include a jwt.')
  }

  return data.jwt
}

function captureFrameAsBlob(video) {
  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Could not prepare the camera snapshot.')
  }

  context.drawImage(video, 0, 0, canvas.width, canvas.height)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Snapshot capture failed.'))
          return
        }
        resolve(blob)
      },
      'image/jpeg',
      0.92
    )
  })
}

function summarize(value) {
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    return text.length > 220 ? `${text.slice(0, 220)}…` : text
  } catch {
    return 'Unavailable'
  }
}

function formatBlobInfo(blob) {
  if (!blob) return 'No prepared image yet'
  return `${blob.type || 'image/*'} • ${Math.round(blob.size / 1024)} KB`
}

function formatFileRefInfo(fileRef) {
  if (!fileRef) return 'No upload yet'
  return `${fileRef.name || 'upload'} • ${Math.round((fileRef.size || 0) / 1024)} KB`
}

function HeliosStudio({ snapshot, onProgress, onError }) {
  const { status, tracks, connect, disconnect, sendCommand, uploadFile, lastError } = useReactor(
    (state) => ({
      status: state.status,
      tracks: state.tracks,
      connect: state.connect,
      disconnect: state.disconnect,
      sendCommand: state.sendCommand,
      uploadFile: state.uploadFile,
      lastError: state.lastError,
    })
  )
  const stats = useStats()
  const videoShellRef = useRef(null)
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [flowStep, setFlowStep] = useState('Waiting for an image')
  const [modelState, setModelState] = useState(null)
  const [lastEvent, setLastEvent] = useState('No model events yet')
  const [lastMessage, setLastMessage] = useState('No model messages yet')
  const [lastPreparedImage, setLastPreparedImage] = useState(null)
  const [lastUpload, setLastUpload] = useState(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isWorking, setIsWorking] = useState(false)
  const pendingEventResolversRef = useRef([])

  useReactorMessage((message) => {
    setLastMessage(summarize(message))

    if (message?.type === 'state') {
      setModelState(message.data)
    }

    if (message?.type === 'event') {
      setLastEvent(summarize(message.data))

      const resolvers = pendingEventResolversRef.current
      if (resolvers.length) {
        pendingEventResolversRef.current = resolvers.filter((entry) => {
          if (entry.predicate(message.data)) {
            entry.resolve(message.data)
            return false
          }

          return true
        })
      }
    }
  })

  const waitForModelEvent = useCallback((predicate, timeoutMs = 10000) => {
    return new Promise((resolve, reject) => {
      const entry = {
        predicate,
        resolve,
      }

      pendingEventResolversRef.current.push(entry)

      window.setTimeout(() => {
        const stillPending = pendingEventResolversRef.current.includes(entry)
        if (!stillPending) return

        pendingEventResolversRef.current = pendingEventResolversRef.current.filter(
          (candidate) => candidate !== entry
        )
        reject(new Error('Timed out waiting for Helios to confirm the reference image.'))
      }, timeoutMs)
    })
  }, [])

  useEffect(() => {
    if (!snapshot) return
    setFlowStep('Image ready')
  }, [snapshot])

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [])

  const trackSummary = useMemo(() => {
    const trackNames = Object.keys(tracks || {})
    return trackNames.length ? trackNames.join(', ') : 'No tracks yet'
  }, [tracks])

  const runHelios = useCallback(async () => {
    if (!snapshot?.blob) {
      onError('Capture or upload an image first.')
      setFlowStep('Waiting for an image')
      return
    }

    if (!prompt.trim()) {
      onError('Add a prompt before starting Helios.')
      return
    }

    if (status === 'disconnected') {
      onProgress('Connecting to Helios...')
      onError('')
      setFlowStep('Connecting')
      try {
        await connect()
      } catch (error) {
        onError(error?.message || 'Failed to reconnect to Helios.')
        setFlowStep('Connection failed')
      }
      return
    }

    if (status !== 'ready') {
      onProgress('Waiting for Helios to become ready...')
      setFlowStep('Waiting for ready')
      return
    }

    setIsWorking(true)
    onError('')

    try {
      setFlowStep('Resetting model')
      onProgress('Resetting Helios...')
      await sendCommand('reset', {})

      setFlowStep('Preparing image')
      onProgress('Preparing the reference image for Helios...')
      const preparedBlob = snapshot.blob
      setLastPreparedImage(preparedBlob)

      setFlowStep('Uploading image')
      onProgress('Uploading the reference image to Reactor...')
      const imageRef = await uploadFile(preparedBlob, {
        name: snapshot.name || 'helios-reference',
      })
      setLastUpload(imageRef)

      setFlowStep('Setting image')
      onProgress('Sending the reference image to Helios...')
      await sendCommand('set_image', { image: imageRef, transition: 'cut' })

      setFlowStep('Confirming image')
      onProgress('Waiting for Helios to confirm the reference image...')
      await waitForModelEvent((event) => event?.event === 'image_set')

      setFlowStep('Scheduling prompt')
      onProgress('Scheduling the prompt for chunk 0...')
      await sendCommand('schedule_prompt', { prompt: prompt.trim(), chunk: 0 })

      setFlowStep('Starting stream')
      await sendCommand('start', {})
      setFlowStep('Streaming')
      onProgress('Helios is streaming.')
    } catch (error) {
      setFlowStep('Action failed')
      onError(error?.message || 'Failed to start Helios.')
    } finally {
      setIsWorking(false)
    }
  }, [connect, onError, onProgress, prompt, sendCommand, snapshot, status, uploadFile, waitForModelEvent])

  const pauseGeneration = useCallback(async () => {
    try {
      setFlowStep('Pausing')
      await sendCommand('pause', {})
      onProgress('Generation paused.')
    } catch (error) {
      onError(error?.message || 'Failed to pause Helios.')
    }
  }, [onError, onProgress, sendCommand])

  const resumeGeneration = useCallback(async () => {
    try {
      setFlowStep('Resuming')
      await sendCommand('resume', {})
      onProgress('Generation resumed.')
    } catch (error) {
      onError(error?.message || 'Failed to resume Helios.')
    }
  }, [onError, onProgress, sendCommand])

  const resetGeneration = useCallback(async () => {
    try {
      setFlowStep('Resetting model')
      await sendCommand('reset', {})
      onProgress('Helios reset.')
    } catch (error) {
      onError(error?.message || 'Failed to reset Helios.')
    }
  }, [onError, onProgress, sendCommand])

  const clearReferenceImage = useCallback(async () => {
    try {
      setFlowStep('Clearing image')
      await sendCommand('clear_image', {})
      onProgress('Reference image cleared.')
    } catch (error) {
      onError(error?.message || 'Failed to clear the image.')
    }
  }, [onError, onProgress, sendCommand])

  const toggleFullscreen = useCallback(async () => {
    const shell = videoShellRef.current
    if (!shell) return

    if (document.fullscreenElement) {
      await document.exitFullscreen()
      return
    }

    await shell.requestFullscreen()
  }, [])

  const modelStateSummary = modelState
    ? `running=${modelState.running} • paused=${modelState.paused} • chunk=${modelState.current_chunk} • frame=${modelState.current_frame}`
    : 'Waiting for model state'

  const statsSummary = stats
    ? `fps ${stats.framesPerSecond ?? 'n/a'} • rtt ${stats.rtt ?? 'n/a'} • candidate ${stats.candidateType ?? 'n/a'}`
    : 'Waiting for WebRTC stats'

  return (
    <div className="studio-shell">
      <div className="studio-meta">
        <div className="status-pill">
          <span className={`status-dot status-${status}`} />
          <span>{status}</span>
        </div>
        <div className="status-pill subtle">Flow: {flowStep}</div>
        <div className="status-pill subtle">Tracks: {trackSummary}</div>
      </div>

      <div className="studio-grid">
        <div className="stream-card">
          <div className="panel-header">
            <div>
              <h2>Helios Stream</h2>
              <p>Built on the documented Reactor `2.9.0` React flow.</p>
            </div>
            <button className="btn ghost compact" onClick={toggleFullscreen}>
              {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            </button>
          </div>

          <div className={`video-shell ${isFullscreen ? 'fullscreen' : ''}`} ref={videoShellRef}>
            <ReactorView className="video" videoObjectFit="cover" muted />
            {!snapshot ? (
              <div className="camera-empty overlay-copy">
                Upload or capture an image, then start Helios.
              </div>
            ) : null}
          </div>
        </div>

        <div className="controls-card">
          <div className="panel-header">
            <div>
              <h2>Prompt + Controls</h2>
              <p>Upload the image, send the prompt, then start generation.</p>
            </div>
          </div>

          <label className="field">
            <span className="label">Prompt</span>
            <textarea
              className="text-area"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={6}
              placeholder="Describe the motion you want Helios to create."
            />
          </label>

          <div className="button-row">
            <button className="btn primary" onClick={() => void runHelios()} disabled={isWorking || !snapshot}>
              {isWorking ? 'Working...' : 'Start From Snapshot'}
            </button>
            <button className="btn ghost" onClick={() => void pauseGeneration()} disabled={status !== 'ready' || !modelState?.running || modelState?.paused}>
              Pause
            </button>
            <button className="btn ghost" onClick={() => void resumeGeneration()} disabled={status !== 'ready' || !modelState?.paused}>
              Resume
            </button>
          </div>

          <div className="button-row">
            <button className="btn ghost" onClick={() => void resetGeneration()} disabled={status !== 'ready'}>
              Reset
            </button>
            <button className="btn ghost" onClick={() => void clearReferenceImage()} disabled={status !== 'ready'}>
              Clear Image
            </button>
            <button className="btn ghost" onClick={() => void disconnect()} disabled={status === 'disconnected'}>
              Disconnect
            </button>
            <button className="btn ghost" onClick={() => void connect()} disabled={status !== 'disconnected'}>
              Reconnect
            </button>
          </div>

          <div className="meta-grid">
            <div className="meta-card">
              <strong>Model State</strong>
              <span>{modelStateSummary}</span>
            </div>
            <div className="meta-card">
              <strong>Prepared Image</strong>
              <span>{formatBlobInfo(lastPreparedImage)}</span>
            </div>
            <div className="meta-card">
              <strong>Last Upload</strong>
              <span>{formatFileRefInfo(lastUpload)}</span>
            </div>
            <div className="meta-card">
              <strong>Stats</strong>
              <span>{statsSummary}</span>
            </div>
            <div className="meta-card">
              <strong>Last Event</strong>
              <span>{lastEvent}</span>
            </div>
            <div className="meta-card wide">
              <strong>Last Message</strong>
              <span>{lastMessage}</span>
            </div>
            {lastError ? (
              <div className="meta-card wide danger">
                <strong>SDK Error</strong>
                <span>
                  {lastError.code}: {lastError.message}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function App() {
  const envApiKey = import.meta.env.VITE_REACTOR_API_KEY || ''
  const storedApiKey = readStoredApiKey()
  const initialApiKey = storedApiKey || envApiKey
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [activeApiKey, setActiveApiKey] = useState(initialApiKey)
  const [jwtToken, setJwtToken] = useState('')
  const [isFetchingToken, setIsFetchingToken] = useState(Boolean(initialApiKey))
  const [tokenError, setTokenError] = useState('')
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [snapshot, setSnapshot] = useState(null)
  const [cameraOn, setCameraOn] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [showApiKeyInput, setShowApiKeyInput] = useState(!initialApiKey)
  const [tokenRequestNonce, setTokenRequestNonce] = useState(0)
  const cameraVideoRef = useRef(null)
  const cameraStreamRef = useRef(null)

  useEffect(() => {
    if (!activeApiKey) return

    let cancelled = false

    fetchReactorJwt(activeApiKey)
      .then((jwt) => {
        if (cancelled) return
        setJwtToken(jwt)
        setTokenError('')
      })
      .catch((fetchError) => {
        if (cancelled) return
        setTokenError(fetchError?.message || 'Failed to fetch a Reactor session token.')
      })
      .finally(() => {
        if (!cancelled) {
          setIsFetchingToken(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [activeApiKey, tokenRequestNonce])

  useEffect(() => {
    return () => {
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach((track) => track.stop())
      }

      if (snapshot?.url) {
        URL.revokeObjectURL(snapshot.url)
      }
    }
  }, [snapshot])

  const replaceSnapshot = useCallback((blob, name, label) => {
    setSnapshot((current) => {
      if (current?.url) {
        URL.revokeObjectURL(current.url)
      }

      return {
        blob,
        name,
        label,
        url: URL.createObjectURL(blob),
      }
    })
    setProgress('Snapshot ready. Start Helios when you are ready.')
    setError('')
  }, [])

  const handleApiKeySubmit = useCallback(
    (event) => {
      event.preventDefault()
      const trimmedKey = apiKeyDraft.trim()

      if (!trimmedKey) {
        setError('Paste a Reactor API key or keep using the env key.')
        return
      }

      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEYS.reactorApiKey, trimmedKey)
      }

      setProgress('Refreshing the Reactor session token...')
      setError('')
      setJwtToken('')
      setTokenError('')
      setIsFetchingToken(true)
      setActiveApiKey(trimmedKey)
      setTokenRequestNonce((current) => current + 1)
      setShowApiKeyInput(false)
      setApiKeyDraft('')
    },
    [apiKeyDraft]
  )

  const clearBrowserKey = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(STORAGE_KEYS.reactorApiKey)
    }

    setApiKeyDraft('')
    setJwtToken('')
    setTokenError('')
    setError('')
    setProgress(envApiKey ? 'Switched back to the env key.' : '')
    setActiveApiKey(envApiKey)
    setIsFetchingToken(Boolean(envApiKey))
    setTokenRequestNonce((current) => current + 1)
    setShowApiKeyInput(!envApiKey)
  }, [envApiKey])

  const startCamera = useCallback(async () => {
    setCameraError('')

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
        },
        audio: false,
      })

      cameraStreamRef.current = stream

      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = stream
        await cameraVideoRef.current.play()
      }

      setCameraOn(true)
    } catch (cameraIssue) {
      setCameraOn(false)
      setCameraError(cameraIssue?.message || 'Camera access was blocked.')
    }
  }, [])

  const stopCamera = useCallback(() => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((track) => track.stop())
      cameraStreamRef.current = null
    }

    if (cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = null
    }

    setCameraOn(false)
  }, [])

  const captureFromCamera = useCallback(async () => {
    if (!cameraVideoRef.current || !cameraOn) return

    const video = cameraVideoRef.current
    if (!video.videoWidth || !video.videoHeight) {
      setCameraError('Camera is still waking up. Try again in a moment.')
      return
    }

    try {
      const blob = await captureFrameAsBlob(video)
      replaceSnapshot(blob, `camera-snapshot-${Date.now()}.jpg`, 'Live camera snapshot')
    } catch (captureError) {
      setCameraError(captureError?.message || 'Failed to capture the snapshot.')
    }
  }, [cameraOn, replaceSnapshot])

  const handleFileChange = useCallback(
    (event) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return

      replaceSnapshot(file, file.name || `upload-${Date.now()}.jpg`, 'Uploaded image')
    },
    [replaceSnapshot]
  )

  const tokenReady = Boolean(jwtToken)
  const hasBrowserOverride = Boolean(activeApiKey) && activeApiKey !== envApiKey
  const keyStatus = activeApiKey
    ? hasBrowserOverride
      ? 'Using the browser override key.'
      : 'Using VITE_REACTOR_API_KEY from .env.local.'
    : 'No key loaded yet.'

  return (
    <div className="app">
      <div className="background-glow glow-one" />
      <div className="background-glow glow-two" />

      <header className="hero">
        <div className="hero-badge">Rebuilt For Reactor JS SDK 2.9.0</div>
        <h1>Helios Snap</h1>
        <p>
          A clean-from-scratch Helios playground that follows the documented React SDK flow:
          connect, upload a file, set the reference image, send the prompt, and start the stream.
        </p>
      </header>

      <section className="panel auth-panel">
        <div className="panel-header">
          <div>
            <h2>Session Setup</h2>
            <p>Use the env key from `.env.local`, or temporarily override it in the browser.</p>
          </div>
          <div className="status-pill subtle">{keyStatus}</div>
        </div>

        <div className="status-strip">
          <span className="status-pill subtle">
            {activeApiKey
              ? isFetchingToken
                ? 'Minting a Reactor session token...'
                : tokenReady
                  ? 'Session token ready.'
                  : 'Waiting for a valid token.'
              : 'Add a Reactor key to begin.'}
          </span>
          <span className="status-pill subtle">API URL: {REACTOR_API_URL}</span>
        </div>

        {showApiKeyInput ? (
          <form className="api-key-form" onSubmit={handleApiKeySubmit}>
            <label className="field">
              <span className="label">Reactor API Key</span>
              <input
                className="text-input"
                type="password"
                value={apiKeyDraft}
                onChange={(event) => setApiKeyDraft(event.target.value)}
                placeholder="rk_your_api_key"
                autoComplete="off"
                spellCheck="false"
              />
            </label>

            <div className="button-row">
              <button className="btn primary" type="submit">
                Use Browser Key
              </button>
              <button
                className="btn ghost"
                type="button"
                onClick={() => setShowApiKeyInput(false)}
                disabled={!envApiKey && !hasBrowserOverride}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="button-row">
            <button className="btn ghost" onClick={() => setShowApiKeyInput(true)}>
              {activeApiKey ? 'Override Key' : 'Add Key'}
            </button>
            <button className="btn ghost" onClick={clearBrowserKey} disabled={!hasBrowserOverride && !envApiKey}>
              Reset Key Source
            </button>
          </div>
        )}

        {tokenError ? <div className="error-card">{tokenError}</div> : null}
        {progress ? <div className="status-line">{progress}</div> : null}
        {error ? <div className="error-card">{error}</div> : null}
      </section>

      <section className="capture-grid">
        <div className="panel capture-panel">
          <div className="panel-header">
            <div>
              <h2>Capture</h2>
              <p>Use the camera or upload a file for Helios image-to-video.</p>
            </div>
            <div className="status-pill subtle">{cameraOn ? 'Camera live' : 'Camera off'}</div>
          </div>

          <div className="camera-shell">
            <video ref={cameraVideoRef} className="camera-feed" muted playsInline />
            {!cameraOn ? (
              <div className="camera-empty">
                <div>
                  <strong>Ready for a new image</strong>
                  <span>Open the camera or upload a still image.</span>
                </div>
              </div>
            ) : null}
            <div className="viewfinder" />
          </div>

          <div className="button-row">
            <button className="btn ghost" onClick={cameraOn ? stopCamera : startCamera}>
              {cameraOn ? 'Stop Camera' : 'Open Camera'}
            </button>
            <button className="btn primary" onClick={() => void captureFromCamera()} disabled={!cameraOn}>
              Capture Snapshot
            </button>
          </div>

          <label className="field">
            <span className="label">Upload Image</span>
            <input className="file-input" type="file" accept="image/*" onChange={handleFileChange} />
          </label>

          {cameraError ? <div className="error-card">{cameraError}</div> : null}
        </div>

        <div className="panel preview-panel">
          <div className="panel-header">
            <div>
              <h2>Preview</h2>
              <p>{snapshot?.label || 'No image selected yet'}</p>
            </div>
            <div className="status-pill subtle">
              {snapshot ? snapshot.name : 'Waiting for a snapshot'}
            </div>
          </div>

          {snapshot ? (
            <div className="snapshot-frame">
              <img src={snapshot.url} alt={snapshot.label} />
            </div>
          ) : (
            <div className="empty-state">
              <strong>No snapshot yet</strong>
              <span>The selected image will show up here before you send it to Helios.</span>
            </div>
          )}
        </div>
      </section>

      <section className="panel stream-shell">
        {tokenReady ? (
          <ReactorProvider
            key={jwtToken}
            apiUrl={REACTOR_API_URL}
            modelName="helios"
            jwtToken={jwtToken}
            connectOptions={{ autoConnect: true }}
          >
            <HeliosStudio
              snapshot={snapshot}
              onProgress={(message) => setProgress(message || '')}
              onError={(message) => setError(message || '')}
            />
          </ReactorProvider>
        ) : (
          <div className="empty-state large">
            <strong>Helios is waiting for a token</strong>
            <span>Load a Reactor key, wait for the session token, then start the stream.</span>
          </div>
        )}
      </section>
    </div>
  )
}

export default App
