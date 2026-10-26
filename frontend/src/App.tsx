import { lazy, Suspense, useState, useRef, useEffect, useCallback } from 'react'
import type { ChangeEvent } from 'react'
import YouTube from 'react-youtube'
import type { YouTubeProps } from 'react-youtube'
import './App.css'
import type { MindMapHandle } from './components/MindMap'
import { normalizeTree, type MapNode } from './lib/mindmapTree'

// markmap + d3 are heavy; load them after the player shell is interactive.
const MindMap = lazy(() => import('./components/MindMap'))

interface TranscriptEntry {
  start: number
  duration: number
  text: string
}

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8001'
const DEFAULT_TITLE = 'Lecture Mind Map'
const AUTO_UPDATE_SECONDS = 15

function App() {
  const [url, setUrl] = useState('')
  const [videoId, setVideoId] = useState<string | null>(null)
  const [player, setPlayer] = useState<any>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [autoUpdate, setAutoUpdate] = useState(true)
  const [focusRecent, setFocusRecent] = useState(false)
  const [status, setStatus] = useState('Ready')
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [sessionId, setSessionId] = useState('')
  const [isUpdating, setIsUpdating] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const mindmapRef = useRef<MindMapHandle>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const nodesRef = useRef<MapNode[]>([])
  const titleRef = useRef(DEFAULT_TITLE)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const lastTriggerRef = useRef(0)
  const isUpdatingRef = useRef(false)
  const currentTimeRef = useRef(0)
  const urlRef = useRef('')
  const isRecreatingRef = useRef(false)
  const sessionIdRef = useRef('')
  const loadTokenRef = useRef(0)

  useEffect(() => {
    urlRef.current = url
  }, [url])

  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  const extractVideoId = (value: string): string | null => {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/
    const match = value.match(regExp)
    if (match && match[2].length === 11) {
      return match[2]
    }
    return null
  }

  const fetchTranscript = async (payload: Record<string, unknown>) => {
    const response = await fetch(`${API_BASE}/transcript`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.detail || 'Failed')
    return data
  }

  const applyLoadResult = (data: any, fallbackId: string | null, label: string) => {
    const vid = fallbackId || data.video_id || null
    if (vid) setVideoId(vid)
    setTranscript(data.transcript || [])
    if (data.session_id) {
      sessionIdRef.current = data.session_id
      setSessionId(data.session_id)
    }

    lastTriggerRef.current = Number(data.consumed_until || 0)

    const title = vid || 'Transcript'
    titleRef.current = title
    nodesRef.current = normalizeTree(data.nodes)
    mindmapRef.current?.updateTree(titleRef.current, nodesRef.current, { focusNew: false })

    const suffix = data.cached ? ' — restored from cache' : ''
    setStatus(`${label}${suffix} (${data.transcript?.length || 0} entries)`)
  }

  const handleLoadVideo = async () => {
    const id = extractVideoId(url)
    if (!id) {
      alert('Invalid YouTube URL')
      return
    }
    const token = ++loadTokenRef.current
    setIsLoading(true)
    setStatus('Loading transcript...')
    try {
      const data = await fetchTranscript({ url })
      if (token !== loadTokenRef.current) return
      applyLoadResult(data, id, 'Transcript loaded')
    } catch (e: any) {
      if (token === loadTokenRef.current) {
        setStatus(`Error: ${e.message} (no captions? try uploading a .srt/.vtt)`)
      }
    } finally {
      if (token === loadTokenRef.current) setIsLoading(false)
    }
  }

  const handleTranscriptUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    const id = extractVideoId(url)
    if (!id) {
      alert('Enter the YouTube URL first, then upload its subtitle file.')
      return
    }
    if (!/\.(srt|vtt)$/i.test(file.name)) {
      alert('Please upload a .srt or .vtt subtitle file.')
      return
    }

    const token = ++loadTokenRef.current
    setIsLoading(true)
    setStatus(`Reading ${file.name}...`)
    try {
      const fileContent = await file.text()
      const data = await fetchTranscript({ url, file_content: fileContent })
      if (token !== loadTokenRef.current) return
      applyLoadResult(data, id, `Subtitle loaded from ${file.name}`)
    } catch (e: any) {
      if (token === loadTokenRef.current) {
        setStatus(`Upload error: ${e.message}`)
      }
    } finally {
      if (token === loadTokenRef.current) setIsLoading(false)
    }
  }

  const recreateSession = useCallback(async () => {
    const currentUrl = urlRef.current
    if (!currentUrl || isRecreatingRef.current) return
    isRecreatingRef.current = true
    setStatus('Session lost — restoring...')
    try {
      const data = await fetchTranscript({
        url: currentUrl,
        initial_nodes: nodesRef.current,
        resume_at: currentTimeRef.current
      })
      setTranscript(data.transcript || [])
      if (data.session_id) {
        sessionIdRef.current = data.session_id
        setSessionId(data.session_id)
      }
      lastTriggerRef.current = currentTimeRef.current
      setStatus('Session restored')
    } catch (e: any) {
      setStatus(`Restore failed: ${e.message}`)
    } finally {
      isRecreatingRef.current = false
    }
  }, [])

  const requestUpdate = async (atTime?: number) => {
    if (!videoId || isUpdatingRef.current) return
    const time = atTime ?? currentTimeRef.current
    const callSession = sessionIdRef.current
    isUpdatingRef.current = true
    setIsUpdating(true)

    try {
      setStatus('Updating mind map...')
      const response = await fetch(`${API_BASE}/update-map`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_id: videoId,
          last_time: time,
          session_id: callSession
        })
      })
      const data = await response.json()
      if (sessionIdRef.current !== callSession) return
      if (!response.ok) {
        setStatus(`Update failed: ${data.detail || 'error'}`)
        return
      }
      if (data.session_lost) {
        await recreateSession()
        return
      }
      lastTriggerRef.current = time
      if (data.should_update) {
        setStatus('Updated')
      } else if (data.reason === 'seek_backward') {
        setStatus('Seeked back — map resumes after the last processed point')
      } else if (data.reason === 'ai_error') {
        setStatus('AI busy or unavailable — will retry automatically')
      } else {
        setStatus('No new content')
      }
    } catch (e: any) {
      if (sessionIdRef.current === callSession) {
        setStatus(`Update error: ${e.message}`)
      }
    } finally {
      isUpdatingRef.current = false
      setIsUpdating(false)
    }
  }

  const requestUpdateRef = useRef(requestUpdate)
  useEffect(() => {
    requestUpdateRef.current = requestUpdate
  })

  const onPlayerReady: YouTubeProps['onReady'] = (event) => {
    setPlayer(event.target)
    setStatus('Player ready')
  }

  const handleSeek = useCallback((seconds: number) => {
    if (!player || typeof player.seekTo !== 'function') return
    player.seekTo(seconds, true)
    currentTimeRef.current = seconds
    setCurrentTime(seconds)
    setStatus(`Jumped to ${Math.floor(seconds)}s`)
  }, [player])

  // The map is lazy-loaded, so a transcript can arrive before it exists.
  const handleMindMapReady = useCallback(() => {
    mindmapRef.current?.updateTree(titleRef.current, nodesRef.current, { focusNew: false })
  }, [])

  const onPlayerStateChange: YouTubeProps['onStateChange'] = (event: any) => {
    const YT = (window as any).YT
    if (event.data === YT.PlayerState.PLAYING) {
      setIsPlaying(true)
      setStatus('Playing')
    } else if (event.data === YT.PlayerState.PAUSED) {
      setIsPlaying(false)
      setStatus('Paused')
    }
  }

  useEffect(() => {
    if (!player || !isPlaying) return

    const interval = setInterval(() => {
      const time = player.getCurrentTime()
      currentTimeRef.current = time
      setCurrentTime(time)
      if (autoUpdate && videoId && transcript.length > 0 && !isUpdatingRef.current) {
        if (time - lastTriggerRef.current >= AUTO_UPDATE_SECONDS) {
          lastTriggerRef.current = time
          requestUpdateRef.current(time)
        }
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [player, isPlaying, autoUpdate, videoId, transcript.length])

  useEffect(() => {
    eventSourceRef.current?.close()
    if (!sessionId) return

    const es = new EventSource(`${API_BASE}/stream/${sessionId}`)
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data?.type === 'session_lost') {
          es.close()
          recreateSession()
          return
        }
        if (data && Array.isArray(data.nodes) && mindmapRef.current) {
          // The server sends the whole tree, so a missed event cannot leave
          // the client with a partially applied map.
          nodesRef.current = normalizeTree(data.nodes)
          mindmapRef.current.updateTree(titleRef.current, nodesRef.current)
          setStatus('Mind map updated')
        }
      } catch (e) {
        console.error(e)
      }
    }
    es.onerror = () => {}
    eventSourceRef.current = es

    return () => {
      es.close()
    }
  }, [sessionId, recreateSession])

  const opts: YouTubeProps['opts'] = {
    height: '100%',
    width: '100%',
    playerVars: {
      autoplay: 0,
    },
  }

  return (
    <div className="app-container">
      <header className="header">
        <input
          type="text"
          placeholder="Enter YouTube URL..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleLoadVideo()}
        />
        <button onClick={handleLoadVideo} disabled={isLoading}>
          {isLoading ? 'Loading...' : 'Load Video'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".srt,.vtt"
          style={{ display: 'none' }}
          onChange={handleTranscriptUpload}
        />
        <button onClick={() => fileInputRef.current?.click()} disabled={isLoading}>
          Upload .srt / .vtt
        </button>
      </header>

      <div className="main-content">
        <div className="video-section">
          {videoId ? (
            <div className="video-wrapper" style={{ height: '70vh' }}>
              <YouTube
                videoId={videoId}
                opts={opts}
                onReady={onPlayerReady}
                onStateChange={onPlayerStateChange}
                style={{ height: '100%', width: '100%' }}
              />
            </div>
          ) : (
            <div style={{ color: '#666' }}>
              Enter a YouTube URL to start
            </div>
          )}
        </div>

        <div className="mindmap-section">
          <div className="controls">
            <label>
              <input
                type="checkbox"
                checked={autoUpdate}
                onChange={(e) => setAutoUpdate(e.target.checked)}
              />
              Auto Update (every ~15s)
            </label>
            <label>
              <input
                type="checkbox"
                checked={focusRecent}
                onChange={(e) => setFocusRecent(e.target.checked)}
              />
              Focus recent
            </label>
            <button onClick={() => requestUpdate()} disabled={!videoId || isUpdating || isLoading}>
              {isUpdating ? 'Updating...' : 'Update Now'}
            </button>
            <span
              className={`status${isUpdating || isLoading ? ' status-busy' : ''}`}
              role="status"
              aria-live="polite"
            >
              Status: {status} | Time: {currentTime.toFixed(1)}s | Entries: {transcript.length}
            </span>
          </div>
          <div className="mindmap-container">
            <Suspense fallback={<div className="mindmap-loading">Loading mind map...</div>}>
              <MindMap
                ref={mindmapRef}
                onSeek={handleSeek}
                collapseOld={focusRecent}
                onReady={handleMindMapReady}
              />
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
