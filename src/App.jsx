import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ReactorProvider,
  ReactorView,
  useReactor,
  useReactorMessage,
} from '@reactor-team/js-sdk'
import './App.css'

const ANIMATE_PROMPT = 'animate it'
const GEMINI_MODEL = 'gemini-2.5-flash-image'

function compressCanvasToJpeg(canvas, maxBytes = 64 * 1024) {
  let quality = 0.9
  let dataUrl = canvas.toDataURL('image/jpeg', quality)
  let byteSize = Math.ceil((dataUrl.length * 3) / 4)

  while (byteSize > maxBytes && quality > 0.4) {
    quality -= 0.1
    dataUrl = canvas.toDataURL('image/jpeg', quality)
    byteSize = Math.ceil((dataUrl.length * 3) / 4)
  }

  if (byteSize > maxBytes) {
    const scale = Math.sqrt(maxBytes / byteSize)
    const nextCanvas = document.createElement('canvas')
    nextCanvas.width = Math.max(1, Math.round(canvas.width * scale))
    nextCanvas.height = Math.max(1, Math.round(canvas.height * scale))
    const ctx = nextCanvas.getContext('2d')
    if (!ctx) return { dataUrl, byteSize, width: canvas.width, height: canvas.height }
    ctx.drawImage(canvas, 0, 0, nextCanvas.width, nextCanvas.height)
    quality = 0.8
    dataUrl = nextCanvas.toDataURL('image/jpeg', quality)
    byteSize = Math.ceil((dataUrl.length * 3) / 4)
    return {
      dataUrl,
      byteSize,
      width: nextCanvas.width,
      height: nextCanvas.height,
    }
  }

  return { dataUrl, byteSize, width: canvas.width, height: canvas.height }
}

async function dataUrlToImage(dataUrl) {
  const img = new Image()
  img.src = dataUrl
  await new Promise((resolve, reject) => {
    img.onload = resolve
    img.onerror = reject
  })
  return img
}

async function dataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl)
  return response.blob()
}

function HeliosSnap({ jwtToken, heliosImageFile, onProgress, onError }) {
  const { status, connect, disconnect, sendCommand, uploadFile, lastError } = useReactor(
    (state) => ({
      status: state.status,
      connect: state.connect,
      disconnect: state.disconnect,
      sendCommand: state.sendCommand,
      uploadFile: state.uploadFile,
      lastError: state.lastError,
    })
  )

  const videoShellRef = useRef(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const lastAnimatedRef = useRef(null)
  const disconnectTimerRef = useRef(null)
  const pendingImageRef = useRef(null)
  const inFlightRef = useRef(false)
  const waitForImageSetRef = useRef(null)

  useReactorMessage((msg) => {
    if (!msg || typeof msg !== 'object') return
    if (msg.type === 'event' && msg.data?.event === 'image_set') {
      if (waitForImageSetRef.current) {
        waitForImageSetRef.current()
        waitForImageSetRef.current = null
      }
    }
  })
  const [recorder, setRecorder] = useState(null)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingError, setRecordingError] = useState('')
  const [downloadUrl, setDownloadUrl] = useState('')

  const handleConnect = async () => {
    if (!jwtToken) return
    await connect(jwtToken)
  }

  const clearDisconnectTimer = () => {
    if (disconnectTimerRef.current) {
      window.clearTimeout(disconnectTimerRef.current)
      disconnectTimerRef.current = null
    }
  }

  const handleAnimate = useCallback(async () => {
    if (!pendingImageRef.current) {
      onError?.('Upload an image first.')
      return
    }
    if (status !== 'ready') {
      onError?.('Connect Helios and wait for Ready.')
      return
    }
    if (inFlightRef.current) return
    inFlightRef.current = true
    onError?.('')
    onProgress?.('Preparing stream...')
    try {
      await sendCommand('reset')
      await sendCommand('schedule_prompt', { prompt: ANIMATE_PROMPT, chunk: 0 })
      const imageRef = await uploadFile(pendingImageRef.current, { name: 'helios-frame.jpg' })
      await sendCommand('set_image', {
        image: imageRef,
        transition: 'cut',
      })
      await new Promise((resolve) => {
        waitForImageSetRef.current = resolve
        window.setTimeout(() => {
          if (waitForImageSetRef.current === resolve) {
            waitForImageSetRef.current = null
            resolve()
          }
        }, 1500)
      })
      onProgress?.('Starting stream...')
      await sendCommand('start')
      // Re-apply image shortly after start to reinforce conditioning.
      window.setTimeout(() => {
        if (pendingImageRef.current && status === 'ready') {
          sendCommand('set_image', {
            image: imageRef,
            transition: 'cut',
          })
        }
      }, 1200)
      onProgress?.('Streaming (60s)...')
      clearDisconnectTimer()
      disconnectTimerRef.current = window.setTimeout(() => {
        disconnect()
        onProgress?.('Disconnected.')
      }, 60000)
    } catch (err) {
      onError?.(err?.message || 'Failed to animate.')
    } finally {
      inFlightRef.current = false
    }
  }, [disconnect, onError, onProgress, sendCommand, status, uploadFile])

  useEffect(() => {
    if (!heliosImageFile) return
    if (lastAnimatedRef.current === heliosImageFile) return
    lastAnimatedRef.current = heliosImageFile
    pendingImageRef.current = heliosImageFile
    if (status === 'ready') {
      handleAnimate()
    }
  }, [handleAnimate, heliosImageFile, status])

  useEffect(() => {
    if (status === 'ready' && pendingImageRef.current) {
      handleAnimate()
    }
  }, [handleAnimate, status])

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [])

  useEffect(() => {
    if (status === 'disconnected') {
      clearDisconnectTimer()
    }
  }, [status])

  useEffect(() => {
    return () => {
      clearDisconnectTimer()
    }
  }, [])

  useEffect(() => {
    return () => {
      if (downloadUrl) URL.revokeObjectURL(downloadUrl)
    }
  }, [downloadUrl])

  const toggleFullscreen = async () => {
    const shell = videoShellRef.current
    if (!shell) return
    if (document.fullscreenElement) {
      await document.exitFullscreen()
      return
    }
    if (shell.requestFullscreen) {
      await shell.requestFullscreen()
    } else if (shell.webkitRequestFullscreen) {
      shell.webkitRequestFullscreen()
    }
  }

  const getVideoElement = () => {
    if (!videoShellRef.current) return null
    return videoShellRef.current.querySelector('video')
  }

  const startRecording = () => {
    setRecordingError('')
    const videoElement = getVideoElement()
    if (!videoElement) {
      setRecordingError('Video stream not ready.')
      return
    }
    const stream = videoElement.captureStream?.() || videoElement.mozCaptureStream?.()
    if (!stream) {
      setRecordingError('Recording not supported in this browser.')
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
        if (event.data && event.data.size > 0) chunks.push(event.data)
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
    } catch (err) {
      setRecordingError(err?.message || 'Failed to start recording.')
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

  return (
    <div className="stream-panel">
      <div className="stream-header">
        <div className={`status-dot status-${status}`} />
        <span className="status-text">{status}</span>
      </div>
      <div
        className={`video-shell ${isFullscreen ? 'fullscreen' : ''}`}
        ref={videoShellRef}
      >
        <ReactorView className="video" videoObjectFit="cover" muted />
        <div className="visualizer">
          {Array.from({ length: 22 }).map((_, index) => (
            <span
              key={index}
              className="bar"
              style={{ animationDelay: `${index * 0.08}s` }}
            />
          ))}
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
        <button className="btn ghost" onClick={toggleFullscreen}>
          {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
        </button>
      </div>
      <div className="record-row">
        <button
          className={`btn ${isRecording ? 'danger' : ''}`}
          onClick={isRecording ? stopRecording : startRecording}
          disabled={status === 'disconnected'}
        >
          {isRecording ? 'Stop Recording' : 'Record'}
        </button>
        <button className="btn ghost" onClick={downloadRecording} disabled={!downloadUrl}>
          Save
        </button>
        <span className="muted">{isRecording ? 'Recording...' : 'Ready to record.'}</span>
      </div>
      {recordingError ? <div className="error-card">{recordingError}</div> : null}
      {lastError ? (
        <div className="error-card">
          {lastError.code}: {lastError.message}
        </div>
      ) : null}
    </div>
  )
}

function App() {
  const envApiKey = import.meta.env.VITE_REACTOR_API_KEY
  const geminiKey = import.meta.env.VITE_GEMINI_API_KEY
  const isDev = import.meta.env.DEV
  const [jwtToken, setJwtToken] = useState(null)
  const [tokenError, setTokenError] = useState('')
  const [ghibliPreview, setGhibliPreview] = useState('')
  const [heliosImageFile, setHeliosImageFile] = useState(null)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [cameraOn, setCameraOn] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const cameraVideoRef = useRef(null)
  const cameraStreamRef = useRef(null)

  const missingLocalReactorKey = isDev && !envApiKey

  useEffect(() => {
    const useClientKey = isDev && envApiKey
    if (missingLocalReactorKey) {
      return
    }
    let cancelled = false
    const endpoint = useClientKey ? '/reactor/tokens' : '/api/token'
    const headers = useClientKey ? { 'Reactor-API-Key': envApiKey } : undefined
    fetch(endpoint, {
      method: 'POST',
      headers,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Token request failed (${response.status})`)
        }
        const data = await response.json()
        if (!data?.jwt) {
          throw new Error('Token response missing jwt')
        }
        if (!cancelled) {
          setTokenError('')
          setJwtToken(data.jwt)
        }
      })
      .catch((fetchError) => {
        if (!cancelled) setTokenError(fetchError?.message || 'Failed to fetch token')
      })
    return () => {
      cancelled = true
    }
  }, [envApiKey, isDev, missingLocalReactorKey])

  const generateGhibli = useCallback(
    async (imageDataUrl) => {
      if (!geminiKey) {
        setError('Add your Gemini API key to generate the Ghibli frame.')
        return
      }

      setError('')
      setProgress('Generating Ghibli frame...')

      const base64 = imageDataUrl.replace(/^data:image\/[^;]+;base64,/, '')
      const mimeTypeMatch = imageDataUrl.match(/^data:(image\/[^;]+);base64,/) || []
      const mimeType = mimeTypeMatch[1] || 'image/jpeg'

      const prompt =
        'Transform this image into a Studio Ghibli-inspired illustration. Soft pastel colors, hand-painted look, gentle lighting, clean line work, whimsical but faithful to the subject. Return a single full-frame image.'

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': geminiKey,
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: prompt },
                  {
                    inline_data: {
                      mime_type: mimeType,
                      data: base64,
                    },
                  },
                ],
              },
            ],
            generationConfig: {
              imageConfig: {
                aspectRatio: '4:3',
                imageSize: '1K',
              },
            },
          }),
        }
      )

      if (!response.ok) {
        throw new Error(`Gemini error (${response.status})`)
      }

      const data = await response.json()
      const parts =
        data?.candidates?.[0]?.content?.parts ||
        data?.candidates?.[0]?.content?.parts ||
        []
      const imagePart = parts.find((part) => part.inline_data || part.inlineData)
      const inlineData = imagePart?.inline_data || imagePart?.inlineData

      if (!inlineData?.data) {
        throw new Error('No image returned from Gemini.')
      }

      const ghibliDataUrl = `data:${inlineData.mime_type || 'image/png'};base64,${inlineData.data}`
      setGhibliPreview(ghibliDataUrl)

      const img = await dataUrlToImage(ghibliDataUrl)
      const maxWidth = 640
      const maxHeight = 384
      const scale = Math.min(1, maxWidth / img.width, maxHeight / img.height)
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.width * scale))
      canvas.height = Math.max(1, Math.round(img.height * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Failed to prepare image for Helios.')
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

      const { dataUrl: heliosDataUrl } = compressCanvasToJpeg(canvas)
      const heliosBlob = await dataUrlToBlob(heliosDataUrl)
      setHeliosImageFile(heliosBlob)
      setProgress('Ghibli frame ready.')
    },
    [geminiKey]
  )

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    setGhibliPreview('')
    setHeliosImageFile(null)
    try {
      const fileDataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = reject
        reader.readAsDataURL(file)
      })

      if (typeof fileDataUrl !== 'string') {
        setError('Failed to read image file.')
        setProgress('')
        return
      }

      await generateGhibli(fileDataUrl)
    } catch (err) {
      setError(err?.message || 'Failed to generate Ghibli frame.')
      setProgress('')
    }
  }

  useEffect(() => {
    return () => {
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach((track) => track.stop())
      }
    }
  }, [])

  const startCamera = async () => {
    setCameraError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      })
      cameraStreamRef.current = stream
      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = stream
        await cameraVideoRef.current.play()
      }
      setCameraOn(true)
    } catch (err) {
      setCameraError(err?.message || 'Unable to access camera.')
      setCameraOn(false)
    }
  }

  const stopCamera = () => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((track) => track.stop())
      cameraStreamRef.current = null
    }
    if (cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = null
    }
    setCameraOn(false)
  }

  const captureFromCamera = async () => {
    if (!cameraVideoRef.current) return
    const video = cameraVideoRef.current
    if (video.videoWidth === 0 || video.videoHeight === 0) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
    setGhibliPreview('')
    setHeliosImageFile(null)
    await generateGhibli(dataUrl)
  }

  return (
    <div className="app">
      <header className="hero">
        <h1>Helios Snap</h1>
      </header>

      <section className="panel inputs">
        <div className="steps">
          <h2>Steps</h2>
          <ol>
            <li>Upload or capture a photo.</li>
            <li>Connect Helios and wait for ready.</li>
            <li>Watch the 25s animation or record it.</li>
          </ol>
        </div>
        {missingLocalReactorKey ? (
          <div className="error-card">Missing VITE_REACTOR_API_KEY.</div>
        ) : null}
        {!geminiKey ? (
          <div className="error-card">Missing VITE_GEMINI_API_KEY.</div>
        ) : null}
        {tokenError ? <div className="error-card">{tokenError}</div> : null}
        {progress ? <div className="status-line">{progress}</div> : null}
        {error ? <div className="error-card">{error}</div> : null}
      </section>

      <div className="stage">
        <section className="panel capture-panel">
          <div className="upload">
            <input className="file" type="file" accept="image/*" onChange={handleFileChange} />
          </div>
          <div className="camera-shell">
            <video ref={cameraVideoRef} className="camera-feed" muted playsInline />
            {!cameraOn ? <div className="camera-empty">Camera off</div> : null}
          </div>
          <div className="button-row">
            <button className="btn ghost" onClick={cameraOn ? stopCamera : startCamera}>
              {cameraOn ? 'Stop Camera' : 'Use Camera'}
            </button>
            <button className="btn primary" onClick={captureFromCamera} disabled={!cameraOn}>
              Capture
            </button>
          </div>
          {cameraError ? <div className="error-card">{cameraError}</div> : null}
        </section>

        <section className="panel ghibli-panel">
          {ghibliPreview ? (
            <img src={ghibliPreview} alt="Ghibli" />
          ) : (
            <div className="empty">Ghibli frame</div>
          )}
        </section>
      </div>

      <section className="panel stream-panel large">
        {!jwtToken ? (
          <div className="muted">Fetching Reactor token...</div>
        ) : (
          <ReactorProvider
            modelName="helios"
            apiUrl="/reactor"
            jwtToken={jwtToken}
            connectOptions={{ autoConnect: true }}
          >
            <HeliosSnap
              jwtToken={jwtToken}
              heliosImageFile={heliosImageFile}
              onProgress={(msg) => setProgress(msg || '')}
              onError={(msg) => setError(msg || '')}
            />
          </ReactorProvider>
        )}
      </section>
    </div>
  )
}

export default App
