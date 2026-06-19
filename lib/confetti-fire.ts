/**
 * Singleton confetti module — completely outside React.
 * The canvas is appended to document.body once and never touched again.
 * No React re-renders can kill it.
 */
import confetti from "canvas-confetti"

let _canvas: HTMLCanvasElement | null = null
let _instance: ReturnType<typeof confetti.create> | null = null
let _timer: ReturnType<typeof setTimeout> | null = null

function getInstance(): ReturnType<typeof confetti.create> {
  if (!_canvas) {
    _canvas = document.createElement("canvas")
    _canvas.style.cssText =
      "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999"
    document.body.appendChild(_canvas)
  }
  if (!_instance) {
    _instance = confetti.create(_canvas, { resize: true, useWorker: true })
  }
  return _instance
}

export function fireConfetti(type: "normal" | "max" = "normal") {
  if (typeof window === "undefined") return

  const fire = getInstance()
  const colors =
    type === "max"
      ? ["#C3D82E", "#044F4D", "#ffffff", "#C3D82E", "#C3D82E"]
      : ["#C3D82E", "#044F4D"]
  const particleCount = type === "max" ? 96 : 48
  const duration = type === "max" ? 2400 : 1600

  if (_timer) clearTimeout(_timer)

  const endTime = Date.now() + duration

  const shoot = () => {
    fire({
      particleCount: Math.max(6, Math.floor(particleCount / 14)),
      angle: 58,
      spread: 45,
      startVelocity: 45,
      gravity: 1,
      ticks: 160,
      scalar: 0.95,
      origin: { x: 0, y: 0.58 },
      colors,
    })
    fire({
      particleCount: Math.max(6, Math.floor(particleCount / 14)),
      angle: 122,
      spread: 45,
      startVelocity: 45,
      gravity: 1,
      ticks: 160,
      scalar: 0.95,
      origin: { x: 1, y: 0.58 },
      colors,
    })
    if (Date.now() < endTime) {
      _timer = setTimeout(shoot, 120)
    }
  }

  shoot()
}
