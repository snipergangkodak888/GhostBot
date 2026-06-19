"use client"

import { useEffect, useState } from "react"
import { getCachedTgs, preloadTgs } from "@/lib/tgs-cache"
import { DotLottieReact } from "@lottiefiles/dotlottie-react"

interface TgsPlayerProps {
  path: string
  className?: string
  playToken?: number
  invertToWhite?: boolean
  continuous?: boolean
}

export default function TgsPlayer({
  path,
  className,
  playToken = 0,
  invertToWhite = false,
  continuous = false,
}: TgsPlayerProps) {
  const [src, setSrc] = useState<any | null>(() => getCachedTgs(path))

  useEffect(() => {
    let cancelled = false

    preloadTgs(path)
      .then((json) => {
        if (!cancelled) setSrc(json)
      })
      .catch(() => {
        const absoluteUrl = new URL(path, window.location.origin).toString()
        if (!cancelled) {
          setSrc(`/api/proxy/nft-image?url=${encodeURIComponent(absoluteUrl)}`)
        }
      })

    return () => {
      cancelled = true
    }
  }, [path])

  if (!src) {
    return <div className={className} />
  }

  // Determine if src is a string (url) or JSON object (data)
  const isUrl = typeof src === "string"

  return (
    <div className={className} style={invertToWhite ? { filter: "brightness(0) invert(1)" } : undefined}>
      <DotLottieReact
        key={`${path}-${continuous ? "continuous" : playToken}`}
        src={isUrl ? src : undefined}
        data={!isUrl ? (src as Record<string, unknown>) : undefined}
        autoplay={continuous || playToken > 0}
        loop={continuous}
        className="w-full h-full"
      />
    </div>
  )
}

