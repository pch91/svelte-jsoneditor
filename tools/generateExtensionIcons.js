import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import zlib from 'zlib'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const iconsDir = path.join(__dirname, '..', 'extension', 'icons')

if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true })
}

// Function to generate a simple RGBA PNG buffer with an embedded blue/cyan pattern
function createSimplePng(width, height) {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  // IHDR chunk
  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(width, 0)
  ihdrData.writeUInt32BE(height, 4)
  ihdrData.writeUInt8(8, 8) // bit depth: 8
  ihdrData.writeUInt8(6, 9) // color type: 6 (RGBA)
  ihdrData.writeUInt8(0, 10) // compression
  ihdrData.writeUInt8(0, 11) // filter
  ihdrData.writeUInt8(0, 12) // interlace
  const ihdr = makeChunk('IHDR', ihdrData)

  // Image scanlines
  const rowStride = width * 4
  const rawData = Buffer.alloc(height * (rowStride + 1))
  let offset = 0
  for (let y = 0; y < height; y++) {
    rawData.writeUInt8(0, offset++) // Filter type 0 (None)
    for (let x = 0; x < width; x++) {
      // Blue (#3883fa) with white dot
      const isCenter = Math.hypot(x - width / 2, y - height / 2) < width * 0.35
      const r = isCenter ? 255 : 56
      const g = isCenter ? 255 : 131
      const b = isCenter ? 255 : 250
      const a = 255

      rawData.writeUInt8(r, offset++)
      rawData.writeUInt8(g, offset++)
      rawData.writeUInt8(b, offset++)
      rawData.writeUInt8(a, offset++)
    }
  }

  const compressedData = zlib.deflateSync(rawData)
  const idat = makeChunk('IDAT', compressedData)
  const iend = makeChunk('IEND', Buffer.alloc(0))

  return Buffer.concat([signature, ihdr, idat, iend])
}

function makeChunk(type, data) {
  const len = data.length
  const buf = Buffer.alloc(8 + len + 4)
  buf.writeUInt32BE(len, 0)
  buf.write(type, 4, 4, 'ascii')
  data.copy(buf, 8)

  const crc = crc32(buf.subarray(4, 8 + len))
  buf.writeUInt32BE(crc, 8 + len)
  return buf
}

// CRC32 table
const crcTable = []
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  crcTable[n] = c >>> 0
}

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

for (const size of [16, 48, 128]) {
  const png = createSimplePng(size, size)
  fs.writeFileSync(path.join(iconsDir, `icon-${size}.png`), png)
  console.log(`Generated icon-${size}.png`)
}
