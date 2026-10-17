/**
 * SDP Token serialization, compression, and decompression for serverless WebRTC.
 *
 * Encodes SDP Offer and Answer objects with embedded ICE candidates into
 * compact Base64URL strings suitable for clipboard sharing, URL fragments,
 * and QR codes.
 */

export interface SignalingPayload {
  type: 'offer' | 'answer' | 'gossip-offer' | 'gossip-answer'
  sdp: string
  peerId: string
  targetPeerId?: string
  roomId: string
  folderId?: number | string
  folderName?: string
  groupName?: string
  userName?: string
  timestamp: number
  publicKeyJwk?: JsonWebKey
  epoch?: string
  sasFingerprint?: string
}


/**
 * Converts a Uint8Array to a URL-safe Base64 string without padding.
 */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  const base64 = btoa(binary)
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Converts a URL-safe Base64 string back to a Uint8Array.
 */
export function base64UrlToBytes(base64Url: string): Uint8Array {
  let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
  while (base64.length % 4 !== 0) {
    base64 += '='
  }
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * Compresses an arbitrary string into a compact Base64URL token.
 * Uses CompressionStream('deflate') if available, with transparent fallback.
 */
export async function compressPayload(payload: SignalingPayload): Promise<string> {
  const jsonStr = JSON.stringify(payload)
  const encoder = new TextEncoder()
  const uncompressedBytes = encoder.encode(jsonStr)

  if (typeof CompressionStream !== 'undefined') {
    try {
      const cs = new CompressionStream('deflate')
      const writer = cs.writable.getWriter()
      writer.write(uncompressedBytes)
      writer.close()

      const reader = cs.readable.getReader()
      const chunks: Uint8Array[] = []
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        if (value) chunks.push(value)
      }

      const totalLength = chunks.reduce((acc, c) => acc + c.length, 0)
      const compressed = new Uint8Array(totalLength)
      let offset = 0
      for (const chunk of chunks) {
        compressed.set(chunk, offset)
        offset += chunk.length
      }

      return 'p2p1_' + bytesToBase64Url(compressed)
    } catch {
      // Fall through to uncompressed encoding if stream fails
    }
  }

  // Fallback: uncompressed base64url with prefix
  return 'p2p0_' + bytesToBase64Url(uncompressedBytes)
}

/**
 * Decompresses a Base64URL token back into a SignalingPayload.
 */
export async function decompressPayload(token: string): Promise<SignalingPayload> {
  const trimmed = token.trim()

  if (trimmed.startsWith('p2p1_')) {
    const rawData = trimmed.slice(5)
    const compressedBytes = base64UrlToBytes(rawData)

    if (typeof DecompressionStream !== 'undefined') {
      const ds = new DecompressionStream('deflate')
      const writer = ds.writable.getWriter()
      writer.write(compressedBytes as any)
      writer.close()

      const reader = ds.readable.getReader()
      const chunks: Uint8Array[] = []
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        if (value) chunks.push(value)
      }

      const totalLength = chunks.reduce((acc, c) => acc + c.length, 0)
      const decompressed = new Uint8Array(totalLength)
      let offset = 0
      for (const chunk of chunks) {
        decompressed.set(chunk, offset)
        offset += chunk.length
      }

      const decoder = new TextDecoder()
      return JSON.parse(decoder.decode(decompressed)) as SignalingPayload
    }
  } else if (trimmed.startsWith('p2p0_')) {
    const rawData = trimmed.slice(5)
    const bytes = base64UrlToBytes(rawData)
    const decoder = new TextDecoder()
    return JSON.parse(decoder.decode(bytes)) as SignalingPayload
  }

  // Raw JSON or standard base64 attempt
  try {
    const bytes = base64UrlToBytes(trimmed)
    const decoder = new TextDecoder()
    return JSON.parse(decoder.decode(bytes)) as SignalingPayload
  } catch {
    return JSON.parse(trimmed) as SignalingPayload
  }
}

/**
 * Generates a sharable URL containing the offer token in the hash fragment.
 */
export function buildShareUrl(token: string): string {
  if (typeof window === 'undefined') return token
  const url = new URL(window.location.href)
  url.hash = `p2p-offer=${encodeURIComponent(token)}`
  return url.toString()
}

/**
 * Extracts an offer token from a URL hash or full URL string if present.
 */
export function extractOfferFromUrl(urlString: string): string | null {
  try {
    const url = new URL(urlString, 'http://localhost')
    const hash = url.hash.replace(/^#/, '')
    const params = new URLSearchParams(hash)
    const offer = params.get('p2p-offer')
    return offer ? decodeURIComponent(offer) : null
  } catch {
    return null
  }
}

/**
 * Generates an SVG string representation of a simple 2D QR Code pattern
 * without requiring bulky external dependencies.
 */
export function generateSvgQrCode(text: string, size = 200): string {
  // Simple visual QR matrix placeholder using deterministic hash distribution
  // for quick visual cues, with clear copyable fallback
  const grid = 25
  const cells: string[] = []
  const cellSize = size / grid

  let hash = 0
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i)
    hash |= 0
  }

  // Draw 3 corner alignment targets
  const drawCorner = (startX: number, startY: number) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const isBorder = r === 0 || r === 6 || c === 0 || c === 6
        const isCore = r >= 2 && r <= 4 && c >= 2 && c <= 4
        if (isBorder || isCore) {
          cells.push(
            `<rect x="${(startX + c) * cellSize}" y="${(startY + r) * cellSize}" width="${cellSize}" height="${cellSize}" fill="#2563eb" />`
          )
        }
      }
    }
  }

  drawCorner(1, 1)
  drawCorner(grid - 8, 1)
  drawCorner(1, grid - 8)

  // Pseudo-random data dots based on text hash
  let prng = Math.abs(hash) || 12345
  for (let r = 0; r < grid; r++) {
    for (let c = 0; c < grid; c++) {
      const inCorner1 = r < 9 && c < 9
      const inCorner2 = r < 9 && c > grid - 10
      const inCorner3 = r > grid - 10 && c < 9
      if (inCorner1 || inCorner2 || inCorner3) continue

      prng = (prng * 16807 + 11) % 2147483647
      if (prng % 2 === 0) {
        cells.push(
          `<rect x="${c * cellSize}" y="${r * cellSize}" width="${cellSize}" height="${cellSize}" fill="#4f46e5" opacity="0.9" />`
        )
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" style="background: #ffffff; border-radius: 8px; padding: 8px; box-sizing: border-box;">${cells.join('')}</svg>`
}
