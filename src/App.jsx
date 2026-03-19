import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactorProvider,
  ReactorView,
  fetchInsecureJwtToken,
  useReactor,
  useReactorMessage,
} from '@reactor-team/js-sdk'
import './App.css'

const DEFAULT_PROMPT =
  'A serene mountain landscape at sunrise, soft golden light, drifting fog, cinematic wide shot, gentle wind through pine trees.'

function HeliosConsole({ jwtToken }) {
  const { status, connect, disconnect, sendCommand, lastError } = useReactor(
    (state) => ({
      status: state.status,
      connect: state.connect,
      disconnect: state.disconnect,
      sendCommand: state.sendCommand,
      lastError: state.lastError,
    })
  )

  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [scheduledPrompt, setScheduledPrompt] = useState(
    'The light warms, revealing a distant lake shimmering under morning sun, slow camera push-in.'
  )
  const [scheduleChunk, setScheduleChunk] = useState('5')
  const [seed, setSeed] = useState('42')
  const [modelState, setModelState] = useState(null)
  const [events, setEvents] = useState([])
  const [imageB64, setImageB64] = useState('')
  const [imagePreview, setImagePreview] = useState('')
  const [imageTransition, setImageTransition] = useState('cut')
  const [lastCommandStatus, setLastCommandStatus] = useState('')
  const [lastCommandError, setLastCommandError] = useState('')
  const videoShellRef = useRef(null)
  const [recorder, setRecorder] = useState(null)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingError, setRecordingError] = useState('')
  const [downloadUrl, setDownloadUrl] = useState('')

  const statusLabel = useMemo(() => {
    if (status === 'disconnected') return 'Disconnected'
    if (status === 'connecting') return 'Connecting'
    if (status === 'waiting') return 'Waiting for GPU'
    if (status === 'ready') return 'Ready'
    return status
  }, [status])

  useReactorMessage((msg) => {
    if (!msg || typeof msg !== 'object') return
    if (msg.type === 'state') {
      setModelState(msg.data)
      return
    }
    if (msg.type === 'event') {
      setEvents((prev) => {
        const next = [
          {
            id: crypto.randomUUID(),
            event: msg.data?.event || 'event',
            payload: msg.data || {},
            timestamp: new Date().toLocaleTimeString(),
          },
          ...prev,
        ]
        return next.slice(0, 30)
      })
    }
  })

  useEffect(() => {
    return () => {
      if (downloadUrl) URL.revokeObjectURL(downloadUrl)
    }
  }, [downloadUrl])

  const handleConnect = async () => {
    if (!jwtToken) return
    await connect(jwtToken)
  }

  const handleCommand = async (command, data = {}) => {
    setLastCommandError('')
    setLastCommandStatus(`Sending ${command}...`)
    try {
      await sendCommand(command, data)
      setLastCommandStatus(`${command} sent`)
    } catch (error) {
      setLastCommandError(error?.message || 'Command failed')
      setLastCommandStatus('')
    }
  }

  const handleImageUpload = (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') return
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.drawImage(img, 0, 0)
        const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.95)
        setImagePreview(jpegDataUrl)
        const stripped = jpegDataUrl.replace(/^data:image\/[^;]+;base64,/, '')
        setImageB64(stripped)
      }
      img.src = result
    }
    reader.readAsDataURL(file)
  }

  const getVideoElement = () => {
    if (!videoShellRef.current) return null
    return videoShellRef.current.querySelector('video')
  }

  const startRecording = () => {
    setRecordingError('')
    const videoElement = getVideoElement()
    if (!videoElement) {
      setRecordingError('Video element not ready yet.')
      return
    }
    const stream =
      videoElement.captureStream?.() || videoElement.mozCaptureStream?.()
    if (!stream) {
      setRecordingError('Recording is not supported in this browser.')
      return
    }

    try {
      const options = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? { mimeType: 'video/webm;codecs=vp9' }
        : MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
          ? { mimeType: 'video/webm;codecs=vp8' }
          : { mimeType: 'video/webm' }

      const mediaRecorder = new MediaRecorder(stream, options)
      const chunks = []
      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data)
        }
      }
      mediaRecorder.onstop = () => {
        if (downloadUrl) URL.revokeObjectURL(downloadUrl)
        const blob = new Blob(chunks, { type: 'video/webm' })
        const url = URL.createObjectURL(blob)
        setDownloadUrl(url)
      }
      mediaRecorder.start(1000)
      setRecorder(mediaRecorder)
      setIsRecording(true)
    } catch (error) {
      setRecordingError(error?.message || 'Failed to start recording.')
    }
  }

  const stopRecording = () => {
    if (!recorder) return
    if (recorder.state !== 'inactive') recorder.stop()
    setIsRecording(false)
  }

  const downloadRecording = () => {
    if (!downloadUrl) return
    const link = document.createElement('a')
    link.href = downloadUrl
    link.download = `helios-recording-${Date.now()}.webm`
    link.click()
  }

  const renderState = () => {
    if (!modelState) return 'No state yet.'
    return `running: ${modelState.running} | paused: ${modelState.paused} | frame: ${modelState.current_frame} | chunk: ${modelState.current_chunk}`
  }

  return (
    <div className="layout">
      <section className="panel control-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Session</p>
            <h2>Helios Control</h2>
          </div>
          <div className={`status-chip status-${status}`}>
            <span className="dot" />
            {statusLabel}
          </div>
        </div>

        <div className="button-row">
          <button
            className="btn primary"
            onClick={handleConnect}
            disabled={status !== 'disconnected' || !jwtToken}
          >
            Connect
          </button>
          <button
            className="btn ghost"
            onClick={() => disconnect()}
            disabled={status === 'disconnected'}
          >
            Disconnect
          </button>
        </div>

        <div className="section">
          <label className="label">Prompt</label>
          <textarea
            className="input textarea"
            rows={4}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
          <div className="button-row">
            <button
              className="btn"
              onClick={() => handleCommand('set_prompt', { prompt })}
              disabled={!prompt.trim() || status === 'disconnected'}
            >
              Set Prompt
            </button>
            <button
              className="btn"
              onClick={() => handleCommand('start')}
              disabled={status !== 'ready'}
            >
              Start
            </button>
            <button
              className="btn"
              onClick={() => handleCommand('pause')}
              disabled={status !== 'ready'}
            >
              Pause
            </button>
            <button
              className="btn"
              onClick={() => handleCommand('resume')}
              disabled={status !== 'ready'}
            >
              Resume
            </button>
            <button
              className="btn danger"
              onClick={() => handleCommand('reset')}
              disabled={status === 'disconnected'}
            >
              Reset
            </button>
          </div>
        </div>

        <div className="section grid">
          <div>
            <label className="label">Seed</label>
            <input
              className="input"
              value={seed}
              onChange={(event) => setSeed(event.target.value)}
              placeholder="42"
            />
            <button
              className="btn subtle"
              onClick={() =>
                handleCommand('set_seed', { seed: Number(seed) || 0 })
              }
              disabled={status === 'disconnected'}
            >
              Set Seed
            </button>
          </div>
          <div>
            <label className="label">Reference Image</label>
            <input
              className="input"
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
            />
            {imagePreview ? (
              <div className="image-preview">
                <img src={imagePreview} alt="Reference preview" />
              </div>
            ) : (
              <p className="muted">No image selected.</p>
            )}
            <div className="button-row">
              <select
                className="input"
                value={imageTransition}
                onChange={(event) => setImageTransition(event.target.value)}
              >
                <option value="cut">cut</option>
                <option value="blend">blend</option>
              </select>
              <button
                className="btn subtle"
                onClick={() =>
                  handleCommand('set_image', {
                    image_b64: imageB64,
                    transition: imageTransition,
                  })
                }
                disabled={!imageB64 || status !== 'ready'}
              >
                Set Image
              </button>
              <button
                className="btn ghost"
                onClick={() => handleCommand('clear_image', {})}
                disabled={status !== 'ready'}
              >
                Clear Image
              </button>
            </div>
            {status !== 'ready' ? (
              <p className="muted">Connect first — image commands need Ready.</p>
            ) : null}
            {lastCommandStatus ? (
              <p className="muted">{lastCommandStatus}</p>
            ) : null}
            {lastCommandError ? (
              <div className="error-card">{lastCommandError}</div>
            ) : null}
          </div>
          <div>
            <label className="label">Schedule Prompt</label>
            <input
              className="input"
              value={scheduleChunk}
              onChange={(event) => setScheduleChunk(event.target.value)}
              placeholder="Chunk index"
            />
            <textarea
              className="input textarea"
              rows={3}
              value={scheduledPrompt}
              onChange={(event) => setScheduledPrompt(event.target.value)}
            />
            <button
              className="btn subtle"
              onClick={() =>
                handleCommand('schedule_prompt', {
                  prompt: scheduledPrompt,
                  chunk: Number(scheduleChunk) || 0,
                })
              }
              disabled={!scheduledPrompt.trim() || status === 'disconnected'}
            >
              Schedule Prompt
            </button>
          </div>
        </div>

        <div className="section">
          <label className="label">State</label>
          <div className="state-card">{renderState()}</div>
          {lastError ? (
            <div className="error-card">
              {lastError.code}: {lastError.message}
            </div>
          ) : null}
        </div>

        <div className="section">
          <div className="panel-header">
            <label className="label">Recent Events</label>
            <button className="btn ghost" onClick={() => setEvents([])}>
              Clear
            </button>
          </div>
          <div className="event-list">
            {events.length === 0 ? (
              <p className="muted">No events yet.</p>
            ) : (
              events.map((evt) => (
                <div className="event" key={evt.id}>
                  <div>
                    <strong>{evt.event}</strong>
                    <span className="timestamp">{evt.timestamp}</span>
                  </div>
                  <code>{JSON.stringify(evt.payload)}</code>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="panel video-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Output</p>
            <h2>Live Stream</h2>
          </div>
          <p className="muted">Helios outputs 33-frame chunks.</p>
        </div>
        <div className="video-shell" ref={videoShellRef}>
          <ReactorView className="video" videoObjectFit="cover" muted />
        </div>
        <div className="record-row">
          <button
            className={`btn ${isRecording ? 'danger' : ''}`}
            onClick={isRecording ? stopRecording : startRecording}
            disabled={status === 'disconnected'}
          >
            {isRecording ? 'Stop Recording' : 'Record'}
          </button>
          <button
            className="btn ghost"
            onClick={downloadRecording}
            disabled={!downloadUrl}
          >
            Save Recording
          </button>
          <span className="muted">
            {isRecording ? 'Recording…' : 'Ready to record.'}
          </span>
        </div>
        {recordingError ? (
          <div className="error-card">{recordingError}</div>
        ) : null}
        <div className="hint">
          Prompt changes apply at the next chunk boundary. Expect a short delay.
        </div>
      </section>
    </div>
  )
}

function App() {
  const envApiKey = import.meta.env.VITE_REACTOR_API_KEY
  const [manualKey, setManualKey] = useState('')
  const [saveLocal, setSaveLocal] = useState(true)
  const [jwtToken, setJwtToken] = useState(null)
  const [tokenError, setTokenError] = useState('')

  const apiKey = manualKey || envApiKey

  useEffect(() => {
    const saved = localStorage.getItem('reactorApiKey')
    if (saved) setManualKey(saved)
  }, [])

  useEffect(() => {
    if (saveLocal && manualKey) {
      localStorage.setItem('reactorApiKey', manualKey)
    }
  }, [manualKey, saveLocal])

  useEffect(() => {
    if (!apiKey) return
    let cancelled = false
    fetchInsecureJwtToken(apiKey)
      .then((token) => {
        if (!cancelled) setJwtToken(token)
      })
      .catch((error) => {
        if (!cancelled) setTokenError(error?.message || 'Failed to fetch token')
      })
    return () => {
      cancelled = true
    }
  }, [apiKey])

  return (
    <div className="app">
      <header className="hero">
        <div>
          <p className="eyebrow">Reactor Helios</p>
          <h1>Realtime Video Generation Console</h1>
          <p className="lead">
            Stream cinematic video in real time, control prompts on chunk
            boundaries, and orchestrate long-form generation from your browser.
          </p>
        </div>
        <div className="hero-card">
          <h3>Local Setup</h3>
          <ol>
            <li>Add your key to <code>.env.local</code>.</li>
            <li>Restart the dev server.</li>
            <li>Connect and start generation.</li>
          </ol>
          <div className="code-line">
            <code>VITE_REACTOR_API_KEY=rk_your_api_key_here</code>
          </div>
        </div>
      </header>

      {!apiKey ? (
        <section className="panel warning">
          <h2>API key missing</h2>
          <p>
            Paste your API key below (stored locally in your browser), or add it
            to <code>.env.local</code> as <code>VITE_REACTOR_API_KEY</code> and
            restart the dev server.
          </p>
          <div className="section">
            <label className="label">Paste API Key</label>
            <input
              className="input"
              type="password"
              placeholder="rk_..."
              value={manualKey}
              onChange={(event) => setManualKey(event.target.value)}
            />
            <label className="checkbox">
              <input
                type="checkbox"
                checked={saveLocal}
                onChange={(event) => setSaveLocal(event.target.checked)}
              />
              Remember this key in localStorage
            </label>
          </div>
        </section>
      ) : tokenError ? (
        <section className="panel warning">
          <h2>Authentication error</h2>
          <p>{tokenError}</p>
        </section>
      ) : !jwtToken ? (
        <section className="panel loading">
          <h2>Authenticating…</h2>
          <p>Fetching a JWT token from Reactor.</p>
        </section>
      ) : (
        <ReactorProvider
          modelName="helios"
          jwtToken={jwtToken}
          connectOptions={{ autoConnect: true }}
        >
          <HeliosConsole jwtToken={jwtToken} />
        </ReactorProvider>
      )}
    </div>
  )
}

export default App
