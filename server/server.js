import express from 'express'
import multer from 'multer'
import sharp from 'sharp'
import { Readable } from 'stream'
import { createRequire } from 'module'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const { ZipArchive } = require('archiver')

const app = express()

const upload = multer({
  limits: { fileSize: 50 * 1024 * 1024, files: 20 }
})

sharp.cache(false)
sharp.concurrency(4)

function parseNumber(value, fallback) {
  const n = Number(value)
  return Number.isNaN(n) ? fallback : n
}

async function analyzeImage(buffer) {
  const meta = await sharp(buffer, { failOn: 'none' }).metadata()
  return {
    width: meta.width ?? 0,
    channels: meta.channels ?? 3,
    hasAlpha: meta.hasAlpha ?? false,
    isAnimated: (meta.pages ?? 1) > 1,
    space: meta.space ?? 'srgb'
  }
}

function smartQuality(requestedQuality, info) {
  const base = Math.min(Math.max(requestedQuality, 1), 100)
  if (info.channels >= 3 && !info.hasAlpha) return Math.min(base, 85)
  return Math.min(base, 90)
}

async function compressImage(buffer, options = {}) {
  const { format = 'webp', quality = 80, width = 1600 } = options
  const info = await analyzeImage(buffer)
  const q = smartQuality(quality, info)

  let pipeline = sharp(buffer, { failOn: 'none', animated: info.isAnimated })
    .withMetadata()

  if (info.width > width) {
    pipeline = pipeline.resize({ width, withoutEnlargement: true, kernel: sharp.kernel.lanczos3 })
  }

  if (info.space !== 'srgb') pipeline = pipeline.toColorspace('srgb')

  let mime
  if (format === 'jpeg' || format === 'jpg') {
    pipeline = pipeline.jpeg({ quality: q, mozjpeg: true, progressive: true, optimiseCoding: true, trellisQuantisation: true, overshootDeringing: true, optimiseScans: true })
    mime = 'image/jpeg'
  } else if (format === 'png') {
    pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true, palette: true, quality: q, effort: 10, dither: 1.0 })
    mime = 'image/png'
  } else if (format === 'avif') {
    pipeline = pipeline.avif({ quality: Math.min(q, 70), effort: 6, chromaSubsampling: '4:2:0', lossless: false })
    mime = 'image/avif'
  } else if (format === 'gif') {
    pipeline = pipeline.gif({ effort: 10, dither: 1.0, interFrameMaxError: 8 })
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
  res.sendFile(path.join(__dirname, '../index.html'))
})

app.use(express.static(path.join(__dirname, '..')))


app.post('/compress/one', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file required' })
    const format   = String(req.query.format  || 'webp')
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

// ─── Batch → ZIP download ─────────────────────────────────────────────────────

app.post('/compress/zip', upload.any(), async (req, res) => {
  try {
    if (!req.files?.length) return res.status(400).json({ error: 'files required' })
    const format  = String(req.query.format  || 'webp')
    const quality = parseNumber(req.query.quality, 80)
    const width   = parseNumber(req.query.width, 1600)

    const results = await Promise.all(
      req.files.map(async (file) => {
        try {
          const { buffer, mime } = await compressImage(file.buffer, { format, quality, width })
          const ext = mime.split('/')[1] || format
          const baseName = file.originalname.replace(/\.[^.]+$/, '')
          return { name: `${baseName}.${ext}`, buffer, ok: true }
        } catch (err) {
          return { name: file.originalname, ok: false, error: err.message }
        }
      })
    )

    const successful = results.filter(r => r.ok)
    if (!successful.length) {
      return res.status(422).json({ error: 'all files failed to compress' })
    }

    if (req.files.length === 1 && successful.length === 1) {
      const r = successful[0]
      const mime = `image/${r.name.split('.').pop()}`
      res.setHeader('Content-Type', mime)
      res.setHeader('Content-Disposition', `attachment; filename="${r.name}"`)
      return res.send(r.buffer)
    }

    const zipName = `imgpress-${Date.now()}.zip`
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`)

    const archive = new ZipArchive({ zlib: { level: 0 } })
    archive.on('error', err => { console.error('archiver error', err) })
    archive.pipe(res)

    for (const r of successful) {
      archive.append(Readable.from(r.buffer), { name: r.name })
    }

    await archive.finalize()
  } catch (err) {
    console.error(err)
    if (!res.headersSent) res.status(500).json({ error: 'zip failed' })
  }
})

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000
app.listen(PORT, '0.0.0.0', () => {
  console.log(`image service running on :${PORT}`)
})