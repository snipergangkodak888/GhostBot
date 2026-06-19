"use client"

import { useEffect, useRef, useState } from "react"
import { useGame } from "@/contexts/game-context"

interface AnimatedIconProps {
  src: string
  className?: string
  style?: React.CSSProperties
  /** Play animation on mount (default: false — shows static first frame) */
  autoPlay?: boolean
  /** Increment to replay. Each new value triggers one play cycle. */
  playCount?: number
}

const isAnimated = (s: string) => /\.(webp|gif)$/i.test(s.split("?")[0])

/* ── Module-level caches shared across every <AnimatedIcon> instance ─── */
const _blobP    = new Map<string, Promise<Blob>>()   // src → fetch promise
const _poster   = new Map<string, string>()           // src → data-URL of frame 0
const _duration = new Map<string, number>()           // src → total animation duration in ms

function fetchBlob(src: string): Promise<Blob> {
  let p = _blobP.get(src)
  if (!p) { p = fetch(src).then(r => r.blob()); _blobP.set(src, p) }
  return p
}

/**
 * Measure the exact total duration of an animated image using ImageDecoder.
 * Returns duration in ms, or a fallback if ImageDecoder isn't available.
 */
async function measureDuration(blob: Blob, src: string): Promise<number> {
  if (_duration.has(src)) return _duration.get(src)!

  // ImageDecoder API — available in Chromium 94+ (Telegram WebView)
  if (typeof ImageDecoder === 'function') {
    try {
      const decoder = new ImageDecoder({ type: blob.type, data: await blob.arrayBuffer() })
      await decoder.tracks.ready
      const count = decoder.tracks.selectedTrack?.frameCount ?? 0
      let total = 0
      for (let i = 0; i < count; i++) {
        const { image } = await decoder.decode({ frameIndex: i })
        total += (image.duration ?? 0) / 1000  // duration is in microseconds → ms
        image.close()
      }
      decoder.close()
      if (total > 0) {
        _duration.set(src, total)
        return total
      }
    } catch { /* fall through */ }
  }

  // Fallback: estimate based on file size (most icons are 60fps, ~1-2s)
  const fallback = Math.max(1000, Math.min(blob.size / 500, 5000))
  _duration.set(src, fallback)
  return fallback
}

/**
 * Extract frame 0 as a static PNG data-URL.
 * Uses createImageBitmap which captures the *default* frame of an animated
 * image — reliable across browsers and never races with animation playback.
 */
async function buildPoster(blob: Blob): Promise<string> {
  const bmp = await createImageBitmap(blob)
  const c = document.createElement("canvas")
  c.width = bmp.width; c.height = bmp.height
  c.getContext("2d")!.drawImage(bmp, 0, 0)
  bmp.close()
  return c.toDataURL("image/png")
}

/**
 * Renders an animated WebP/GIF icon (or a static image).
 *
 * **Why blob URLs?**
 * Browsers cache decoded image frames keyed by URL.  Changing a React `key`
 * remounts the DOM node but doesn't bust that cache, so the animation never
 * replays.  Each `URL.createObjectURL(blob)` produces a *unique* URL which
 * forces the browser to decode from frame 0 every time.
 *
 * Static sources (.png / .svg / …) are rendered as a plain `<img>`.
 * During gameplay (`isPlaying`) nothing is rendered to save GPU.
 */
export default function AnimatedIcon({
  src, className, style, autoPlay = false, playCount = 0,
}: AnimatedIconProps) {
  const { isPlaying: inGame } = useGame()
  const clean  = src.split("?")[0]
  const anim   = isAnimated(src)

  const [poster, setPoster]   = useState<string | null>(_poster.get(clean) ?? null)
  const [liveUrl, setLiveUrl] = useState<string | null>(null)   // blob URL while animating
  const liveRef  = useRef<string | null>(null)
  const blobRef  = useRef<Blob | null>(null)
  const lastPC   = useRef(playCount)
  const timer    = useRef<ReturnType<typeof setTimeout>>()
  const didMount = useRef(false)
  const autoPlayRef = useRef(autoPlay)
  autoPlayRef.current = autoPlay

  /* ── kick off a fresh blob-URL animation ──────────────────────────── */
  const durationRef = useRef(2000) // will be updated with real measured value
  const playRef = useRef<(blob: Blob, loop?: boolean) => void>()
  playRef.current = (blob: Blob, loop = false) => {
    if (liveRef.current) URL.revokeObjectURL(liveRef.current)
    const u = URL.createObjectURL(blob)         // unique ⇒ full re-decode
    liveRef.current = u
    setLiveUrl(u)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      if (loop && autoPlayRef.current && blobRef.current) {
        // Loop: revoke old URL and create a fresh one to replay from frame 0
        playRef.current?.(blobRef.current, true)
      } else {
        setLiveUrl(null)
        if (liveRef.current) { URL.revokeObjectURL(liveRef.current); liveRef.current = null }
      }
    }, durationRef.current)
  }

  const play = (blob: Blob, loop = false) => playRef.current?.(blob, loop)

  /* ── fetch blob + build poster (once per unique src) ─────────────── */
  useEffect(() => {
    if (!anim) return
    let dead = false

    fetchBlob(clean).then(async (blob) => {
      if (dead) return
      blobRef.current = blob

      // Measure real animation duration (cached after first call)
      const dur = await measureDuration(blob, clean)
      if (dead) return
      durationRef.current = dur

      // Build poster if not already cached
      if (!_poster.has(clean)) {
        try {
          const d = await buildPoster(blob)
          if (dead) return
          _poster.set(clean, d)
          setPoster(d)
        } catch { /* canvas security — fall back gracefully */ }
      } else if (!poster) {
        setPoster(_poster.get(clean)!)
      }

      // autoPlay on first mount — use ref so closure always has latest
      if (autoPlayRef.current && !didMount.current) {
        // Small delay to let React commit the poster first, then animate
        setTimeout(() => {
          if (blobRef.current) playRef.current?.(blobRef.current, true)
        }, 50)
      }
      didMount.current = true
    }).catch(() => {})

    return () => { dead = true }
  }, [clean, anim])              // eslint-disable-line react-hooks/exhaustive-deps

  /* ── react to external playCount bumps ────────────────────────────── */
  useEffect(() => {
    if (!anim || playCount === lastPC.current) return
    lastPC.current = playCount
    if (blobRef.current) play(blobRef.current)
  }, [playCount])                // eslint-disable-line react-hooks/exhaustive-deps

  /* ── cleanup ──────────────────────────────────────────────────────── */
  useEffect(() => () => {
    clearTimeout(timer.current)
    if (liveRef.current) URL.revokeObjectURL(liveRef.current)
  }, [])

  /* ── render ───────────────────────────────────────────────────────── */
  if (inGame) return null

  if (!anim) {
    return <img src={src} alt="" draggable={false} className={className} style={style} />
  }

  const imgSrc = liveUrl || poster
  if (imgSrc) {
    return <img src={imgSrc} alt="" draggable={false} className={className} style={style} />
  }

  // Poster not extracted yet — invisible placeholder to prevent layout shift
  return <div className={className} style={style} />
}
