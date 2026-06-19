function randomHex(length: number) {
  const bytes = new Uint8Array(Math.ceil(length / 2))
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, length)
}

export class ObjectId {
  private readonly value: string

  constructor(value?: string | ObjectId) {
    const raw = value instanceof ObjectId ? value.toString() : value
    if (raw && !ObjectId.isValid(raw)) {
      throw new Error(`Invalid ObjectId: ${raw}`)
    }
    this.value = raw || randomHex(24)
  }

  static isValid(value: unknown) {
    if (value instanceof ObjectId) return true
    return typeof value === "string" && /^[a-fA-F0-9]{24}$/.test(value)
  }

  toString() {
    return this.value
  }

  toHexString() {
    return this.value
  }

  toJSON() {
    return this.value
  }

  equals(other: unknown) {
    return String(other) === this.value
  }
}

export type Db = unknown
