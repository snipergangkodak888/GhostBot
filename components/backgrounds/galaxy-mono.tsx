"use client"

import { useEffect, useRef } from 'react'
import { Renderer, Program, Mesh, Triangle } from 'ogl'

const vertexShader = `
attribute vec2 uv;
attribute vec2 position;

varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position, 0, 1);
}
`

// Simplified shader for monochrome (white/black) stars
const fragmentShader = `
precision highp float;

uniform float uTime;
uniform vec3 uResolution;
uniform float uDensity;
uniform float uSpeed;
uniform float uGlowIntensity;

varying vec2 vUv;

#define NUM_LAYER 2.0
#define MAT45 mat2(0.7071, -0.7071, 0.7071, 0.7071)

float Hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float Star(vec2 uv, float flare) {
  float d = length(uv);
  float m = (0.03 * uGlowIntensity) / d;
  float rays = smoothstep(0.0, 1.0, 1.0 - abs(uv.x * uv.y * 1000.0));
  m += rays * flare * uGlowIntensity * 0.5;
  uv *= MAT45;
  rays = smoothstep(0.0, 1.0, 1.0 - abs(uv.x * uv.y * 1000.0));
  m += rays * 0.2 * flare * uGlowIntensity;
  m *= smoothstep(1.0, 0.2, d);
  return m;
}

vec3 StarLayer(vec2 uv, float layerDepth) {
  vec3 col = vec3(0.0);

  vec2 gv = fract(uv) - 0.5; 
  vec2 id = floor(uv);

  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 offset = vec2(float(x), float(y));
      vec2 si = id + offset;
      float seed = Hash21(si);
      float size = fract(seed * 345.32);
      
      // Twinkle effect
      float twinkle = sin(uTime * (seed * 2.0 + 1.0)) * 0.5 + 0.5;
      float brightness = mix(0.4, 1.0, twinkle);
      
      float flareSize = smoothstep(0.85, 1.0, size) * brightness;

      vec2 n = vec2(seed, fract(seed * 34.0)) - 0.5;
      vec2 p = gv - offset - n;
      float star = Star(p, flareSize);

      // White/gray color only
      float gray = 0.8 + 0.2 * seed;
      col += star * size * vec3(gray) * brightness;
    }
  }

  return col;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution.xy) / uResolution.y;
  float t = uTime * uSpeed * 0.02;

  vec3 col = vec3(0.0);

  // Fewer layers for less density
  for (float i = 0.0; i < NUM_LAYER; i++) {
    float depth = fract(i / NUM_LAYER + t);
    float scale = mix(15.0 * uDensity, 0.5, depth);
    float fade = depth * smoothstep(1.0, 0.9, depth);
    col += StarLayer(uv * scale + i * 453.2, depth) * fade;
  }

  // Subtle vignette
  float vignette = 1.0 - length(vUv - 0.5) * 0.5;
  col *= vignette;

  // Keep it subtle
  col = clamp(col, 0.0, 1.0);

  gl_FragColor = vec4(col, 1.0);
}
`

export interface GalaxyMonoProps {
  density?: number
  glowIntensity?: number
  speed?: number
  transparent?: boolean
  className?: string
  [key: string]: unknown
}

export default function GalaxyMono({
  density = 0.8,
  glowIntensity = 0.3,
  speed = 0.3,
  transparent = true,
  className = '',
  ...rest
}: GalaxyMonoProps) {
  const ctnDom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const ctn = ctnDom.current
    if (!ctn) return

    const renderer = new Renderer({ alpha: transparent, antialias: true })
    const gl = renderer.gl
    const canvas = gl.canvas as HTMLCanvasElement
    gl.clearColor(0, 0, 0, transparent ? 0 : 1)
    canvas.style.position = 'absolute'
    canvas.style.top = '0'
    canvas.style.left = '0'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    ctn.appendChild(canvas)

    let program: Program

    function resize() {
      const width = ctn!.clientWidth
      const height = ctn!.clientHeight
      renderer.setSize(width, height)
      if (program) {
        program.uniforms.uResolution.value = [width, height, width / height]
      }
    }

    window.addEventListener('resize', resize)
    resize()

    const geometry = new Triangle(gl)
    program = new Program(gl, {
      vertex: vertexShader,
      fragment: fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uResolution: {
          value: [canvas.width, canvas.height, canvas.width / canvas.height]
        },
        uDensity: { value: density },
        uSpeed: { value: speed },
        uGlowIntensity: { value: glowIntensity },
      },
    })

    const mesh = new Mesh(gl, { geometry, program })

    let animateId: number
    let startTime = performance.now()

    function animate() {
      animateId = requestAnimationFrame(animate)
      const elapsed = (performance.now() - startTime) / 1000
      program.uniforms.uTime.value = elapsed
      renderer.render({ scene: mesh })
    }

    animate()

    return () => {
      cancelAnimationFrame(animateId)
      window.removeEventListener('resize', resize)
      ctn.removeChild(canvas)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }, [density, speed, glowIntensity, transparent])

  return <div ref={ctnDom} className={`w-full h-full relative ${className}`} {...rest} />
}
