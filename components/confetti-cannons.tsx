"use client"

import { useEffect, useRef, useCallback } from "react"
import confetti from "canvas-confetti"

interface ConfettiCannonsProps {
  trigger: number
  colors?: string[]
  particleCount?: number
  duration?: number
}

export default function ConfettiCannons({
  trigger,
  colors = ["#C3D82E", "#044F4D"],
  particleCount = 48,
  duration = 1600,
}: ConfettiCannonsProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const instanceRef = useRef<ReturnType<typeof confetti.create> | null>(null)
  const lastTrigger = useRef(0)
  const timerRef = useRef<number | null>(null)

  const fire = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    if (!instanceRef.current) {
      instanceRef.current = confetti.create(canvas, {
        resize: true,
        useWorker: false,
      })
    }

    const fireInstance = instanceRef.current
    const launchY = 0.58
    const endTime = Date.now() + duration

    const shoot = () => {
      fireInstance({
        particleCount: Math.max(6, Math.floor(particleCount / 14)),
        angle: 58,
        spread: 45,
        startVelocity: 45,
        gravity: 1,
        ticks: 160,
        scalar: 0.95,
        origin: { x: 0, y: launchY },
        colors,
      })

      fireInstance({
        particleCount: Math.max(6, Math.floor(particleCount / 14)),
        angle: 122,
        spread: 45,
        startVelocity: 45,
        gravity: 1,
        ticks: 160,
        scalar: 0.95,
        origin: { x: 1, y: launchY },
        colors,
      })

      if (Date.now() < endTime) {
        timerRef.current = window.setTimeout(shoot, 120)
      }
    }

    if (timerRef.current) window.clearTimeout(timerRef.current)
    shoot()
  }, [colors, particleCount, duration])

  useEffect(() => {
    if (trigger > 0 && trigger !== lastTrigger.current) {
      lastTrigger.current = trigger
      fire()
    }
  }, [trigger, fire])

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
      instanceRef.current?.reset()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-[40]"
      style={{ width: "100%", height: "100%", pointerEvents: "none" }}
    />
  )
}
