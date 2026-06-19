// Type declarations for modules without types

declare module 'ogl' {
  export class Renderer {
    constructor(options?: {
      dpr?: number
      alpha?: boolean
      premultipliedAlpha?: boolean
      antialias?: boolean
      depth?: boolean
      stencil?: boolean
      preserveDrawingBuffer?: boolean
      powerPreference?: string
      width?: number
      height?: number
    })
    gl: WebGLRenderingContext
    setSize(width: number, height: number): void
    render(options: { scene: any }): void
  }

  export class Program {
    constructor(
      gl: WebGLRenderingContext,
      options: {
        vertex: string
        fragment: string
        uniforms?: Record<string, { value: any }>
      }
    )
    uniforms: Record<string, { value: any }>
  }

  export class Mesh {
    constructor(
      gl: WebGLRenderingContext,
      options: {
        geometry: any
        program: Program
      }
    )
  }

  export class Color {
    constructor(color?: string | number | number[])
    r: number
    g: number
    b: number
  }

  export class Triangle {
    constructor(gl: WebGLRenderingContext, options?: Record<string, any>)
  }
}
