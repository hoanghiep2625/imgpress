import dotenv from 'dotenv'
import http from 'http'
import express from 'express'
import multer from 'multer'
import sharp from 'sharp'
import path from 'path'
import { fileURLToPath } from 'url'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const config = {
  PORT: parseInt(process.env.PORT || '3000'),
  SERVER_TIMEOUT_MS: parseInt(process.env.SERVER_TIMEOUT_MS || '300000'),
  KEEP_ALIVE_TIMEOUT_MS: parseInt(process.env.KEEP_ALIVE_TIMEOUT_MS || '360000'),
  HEADERS_TIMEOUT_MS: parseInt(process.env.HEADERS_TIMEOUT_MS || '361000'),
  MAX_IMAGE_SIDE_PX: parseInt(process.env.MAX_IMAGE_SIDE_PX || '20000'),
  MAX_IMAGE_MEGAPIXELS: parseInt(process.env.MAX_IMAGE_MEGAPIXELS || '200'),
  MAX_FILE_SIZE_MB: parseInt(process.env.MAX_FILE_SIZE_MB || '50'),
  MAX_FILES: parseInt(process.env.MAX_FILES || '20'),
  COMPRESS_TIMEOUT_MS: parseInt(process.env.COMPRESS_TIMEOUT_MS || '300000'),
  DEFAULT_QUALITY: parseInt(process.env.DEFAULT_QUALITY || '80'),
  DEFAULT_WIDTH: parseInt(process.env.DEFAULT_WIDTH || '1600'),
  MAX_QUALITY_NO_ALPHA: parseInt(process.env.MAX_QUALITY_NO_ALPHA || '85'),
  MAX_QUALITY_WITH_ALPHA: parseInt(process.env.MAX_QUALITY_WITH_ALPHA || '90'),
  DITHER_MAX: parseFloat(process.env.DITHER_MAX || '0.7'),
  DITHER_MIN: parseFloat(process.env.DITHER_MIN || '0.3'),
  SHARP_CONCURRENCY: parseInt(process.env.SHARP_CONCURRENCY || '0'),
}

const app = express()

const upload = multer({
  limits: {
    fileSize: (config.MAX_FILE_SIZE_MB) * 1024 * 1024,
    files: config.MAX_FILES
  }
})

sharp.cache(false)
sharp.concurrency(config.SHARP_CONCURRENCY)

const MAX_SIDE_PX = config.MAX_IMAGE_SIDE_PX
const MAX_MEGAPIXELS = config.MAX_IMAGE_MEGAPIXELS

const MIME_TO_FORMAT = {
  'image/jpeg': 'jpeg', 'image/jpg': 'jpeg',
  'image/png':  'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif':  'gif',
  'image/tiff': 'jpeg', 'image/bmp': 'jpeg',
  'image/heic': 'jpeg', 'image/heif': 'jpeg',
}

const COMPRESS_TIMEOUT_MS = config.COMPRESS_TIMEOUT_MS

function compressTimeout(req, res, next) {
  res.setTimeout(COMPRESS_TIMEOUT_MS, () => {
    if (!res.headersSent) {
      res.status(503).json({ error: 'Processing timeout — server is busy, please retry.' })
    }
  })
  next()
}

function parseNumber(value, fallback) {
  const n = Number(value)
  return Number.isNaN(n) ? fallback : n
}

async function analyzeImage(buffer) {
  const meta = await sharp(buffer, { failOn: 'none' }).metadata()

  const w = meta.width  ?? 0
  const h = meta.height ?? 0

  if (w > MAX_SIDE_PX || h > MAX_SIDE_PX) {
    throw new Error(`Image too large: ${w}×${h}px (max ${MAX_SIDE_PX}px per side)`)
  }
  if (w * h > MAX_MEGAPIXELS * 1_000_000) {
    throw new Error(`Image too large: ${(w * h / 1_000_000).toFixed(0)}MP (max ${MAX_MEGAPIXELS}MP)`)
  }

  return {
    width: w,
    channels: meta.channels ?? 3,
    hasAlpha: meta.hasAlpha ?? false,
    isAnimated: (meta.pages ?? 1) > 1,
    space: meta.space ?? 'srgb'
  }
}

function smartQuality(requestedQuality, info) {
  const base = Math.min(Math.max(requestedQuality, 1), 100)
  const maxQualityNoAlpha = config.MAX_QUALITY_NO_ALPHA
  const maxQualityWithAlpha = config.MAX_QUALITY_WITH_ALPHA
  if (info.channels >= 3 && !info.hasAlpha) return Math.min(base, maxQualityNoAlpha)
  return Math.min(base, maxQualityWithAlpha)
}

function smartDither(q) {
  const ditherMax = config.DITHER_MAX
  const ditherMin = config.DITHER_MIN
  const raw = ditherMax - (q / 100) * (ditherMax - ditherMin)
  return parseFloat(Math.max(ditherMin, Math.min(ditherMax, raw)).toFixed(2))
}
async function compressImage(buffer, options = {}) {
  const defaultQuality = config.DEFAULT_QUALITY
  const defaultWidth = config.DEFAULT_WIDTH
  const { format = 'webp', quality = defaultQuality, width = defaultWidth } = options
  const info = await analyzeImage(buffer)
  const q = smartQuality(quality, info)

  let pipeline = sharp(buffer, { failOn: 'none', animated: info.isAnimated })
    .withMetadata({ exif: {} })

  if (info.width > width) {
    pipeline = pipeline.resize({ width, withoutEnlargement: true, kernel: sharp.kernel.lanczos3 })
  }

  if (info.space !== 'srgb') pipeline = pipeline.toColorspace('srgb')

  let mime
  if (format === 'jpeg' || format === 'jpg') {
    pipeline = pipeline.jpeg({ quality: q, mozjpeg: true, progressive: true, optimiseCoding: true, trellisQuantisation: true, overshootDeringing: true, optimiseScans: true })
    mime = 'image/jpeg'
  } else if (format === 'png') {
    pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true, palette: true, quality: q, effort: 10, dither: smartDither(q) })
    mime = 'image/png'
  } else if (format === 'avif') {
    pipeline = pipeline.avif({ quality: Math.min(q, 70), effort: 6, chromaSubsampling: '4:2:0', lossless: false })
    mime = 'image/avif'
  } else if (format === 'gif') {
    pipeline = pipeline.gif({ effort: 10, dither: smartDither(q), interFrameMaxError: 8 })
    mime = 'image/gif'
  } else {
    pipeline = pipeline.webp({ quality: q, alphaQuality: Math.min(q + 5, 100), smartSubsample: true, effort: 6, lossless: false, nearLossless: false, preset: 'photo' })
    mime = 'image/webp'
  }

  const output = await pipeline.toBuffer({ resolveWithObject: true })
  return { buffer: output.data, info: output.info, mime }
}

// ─── CORS ─────────────────────────────────────────────────────────────────────

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})


app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'))
})

app.use(express.static(path.join(__dirname, '../client')))


app.post('/compress/one', compressTimeout, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file required' })

    const rawFormat = String(req.query.format || 'webp')
    const format   = rawFormat === 'auto'
      ? (MIME_TO_FORMAT[req.file.mimetype] ?? 'webp')
      : rawFormat
    const quality  = parseNumber(req.query.quality, 80)
    const width    = parseNumber(req.query.width, 1600)
    const origSize = req.file.buffer.length

    try {
      const { buffer, mime } = await compressImage(req.file.buffer, { format, quality, width })
      return res.json({
        name: req.file.originalname,
        mime,
        originalSize: origSize,
        compressedSize: buffer.length,
        savedBytes: origSize - buffer.length,
        ratio: Number(((1 - buffer.length / origSize) * 100).toFixed(1)),
        data: buffer.toString('base64'),
        error: false
      })
    } catch (err) {
      return res.json({ name: req.file.originalname, originalSize: origSize, error: true, message: err.message })
    }
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'compress failed' })
  }
})

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = config.PORT
const serverTimeout = config.SERVER_TIMEOUT_MS
const keepAliveTimeout = config.KEEP_ALIVE_TIMEOUT_MS
const headersTimeout = config.HEADERS_TIMEOUT_MS

const server = http.createServer(app)

server.timeout          = serverTimeout
server.keepAliveTimeout = keepAliveTimeout
server.headersTimeout   = headersTimeout

server.listen(PORT, '0.0.0.0', () => {
  console.log(`image service running on :${PORT} (request timeout: ${server.timeout / 1000}s)`)
})