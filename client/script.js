const API_BASE = window.location.origin || 'http://localhost:3000'

  // Pre-load fflate ngay khi trang tải để Download All không bị delay
  let _zipSync = null
  import('https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js')
    .then(m => { _zipSync = m.zipSync })
    .catch(() => {})
 
  let items   = []   // { id: string, file: File, originalSize: number }[]
  let results = {}   // id → result
  let fmt = 'auto'
  let settingsDirty = false
 
  const fileList      = document.getElementById('file-list')
  const qRange        = document.getElementById('q-range')
  const qVal          = document.getElementById('quality-val')
  const summary       = document.getElementById('summary')
  const widthSel      = document.getElementById('width-sel')
  const dlZipBtn      = document.getElementById('dl-zip-btn')
  const dlLabel       = document.getElementById('dl-label')
  const clearLink     = document.getElementById('clear-link')
  const recompressBtn = document.getElementById('recompress-btn')
  const dropZone      = document.getElementById('drop-zone')
  const fileInput     = document.getElementById('file-input')
 
  const uid = () => Math.random().toString(36).slice(2, 10)

  // ── Concurrency queue ─────────────────────────────────────────────────────────

  const CONCURRENCY = 1   // sequential: 1 file at a time to avoid request timeout
  let activeCount = 0
  const queue = []

  function enqueue(id, file) {
    queue.push({ id, file })
    drain()
  }

  function drain() {
    while (activeCount < CONCURRENCY && queue.length) {
      const { id, file } = queue.shift()
      activeCount++
      compressOne(id, file).finally(() => {
        activeCount--
        drain()
      })
    }
  }
 
  // ── Controls ─────────────────────────────────────────────────────────────────
 
  qRange.addEventListener('input', () => { qVal.textContent = qRange.value; markDirty() })
  widthSel.addEventListener('change', markDirty)
 
  function markDirty() {
    if (!items.length) return
    settingsDirty = true
    recompressBtn.style.display = 'block'
  }
 
  function setPill(btn) {
    document.querySelectorAll('.pill').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    fmt = btn.dataset.val
    markDirty()
  }
 
  function recompress() {
    settingsDirty = false
    recompressBtn.style.display = 'none'
    results = {}
    queue.length = 0
    // Reset every card UI without touching DOM order
    items.forEach(({ id }) => {
      const pb = document.getElementById('pb-' + id)
      const st = document.getElementById('st-' + id)
      const dl = document.getElementById('dl-' + id)
      if (pb) pb.style.display = 'block'
      if (st) st.innerHTML = '<span class="badge badge-working">Optimising…</span>'
      if (dl) dl.disabled = true
    })
    summary.style.display = 'none'
    items.forEach(({ id, file }) => enqueue(id, file))
  }
 
  // ── Drop / pick ──────────────────────────────────────────────────────────────
 
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over') })
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'))
  dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('drag-over'); handleFiles([...e.dataTransfer.files]) })
  fileInput.addEventListener('change', () => { handleFiles([...fileInput.files]); fileInput.value = '' })
 
  function handleFiles(newFiles) {
    const imgs = newFiles.filter(f => f.type.startsWith('image/')).slice(0, 20 - items.length)
    if (!imgs.length) return
 
    imgs.forEach(file => {
      const id = uid()
      const item = { id, file, originalSize: file.size }
      items.unshift(item)
      prependCard(item)
      enqueue(id, file)
    })
  }
 
  // ── Card DOM ──────────────────────────────────────────────────────────────────
 
  function prependCard({ id, file, originalSize }) {
    const card = document.createElement('div')
    card.className = 'file-card'
    card.id = 'card-' + id
 
    const thumb = document.createElement('img')
    thumb.className = 'file-thumb'
    thumb.src = URL.createObjectURL(file)
    thumb.alt = ''
 
    const info = document.createElement('div')
    info.className = 'file-info'
    info.innerHTML = `
      <div class="file-name">${file.name}</div>
      <div class="file-size">${fmtBytes(originalSize)}</div>
      <div class="progress-bar" id="pb-${id}" style="display:block">
        <div class="progress-fill"></div>
      </div>
      <div class="file-status" id="st-${id}">
        <span class="badge badge-working">Optimising…</span>
      </div>`
 
    const actions = document.createElement('div')
    actions.className = 'card-actions'
 
    const dlBtn = document.createElement('button')
    dlBtn.className = 'icon-btn dl'
    dlBtn.id = 'dl-' + id
    dlBtn.title = 'Download'
    dlBtn.innerHTML = '↓'
    dlBtn.disabled = true
    dlBtn.addEventListener('click', () => downloadSingle(id))
 
    const rmBtn = document.createElement('button')
    rmBtn.className = 'icon-btn rm'
    rmBtn.title = 'Remove'
    rmBtn.innerHTML = '×'
    rmBtn.addEventListener('click', () => removeCard(id))
 
    actions.append(dlBtn, rmBtn)
    card.append(thumb, info, actions)
 
    fileList.prepend(card)
  }
 
  function removeCard(id) {
    const card = document.getElementById('card-' + id)
    if (card) card.remove()
    items = items.filter(it => it.id !== id)
    delete results[id]
    items.length ? updateSummary() : (summary.style.display = 'none', recompressBtn.style.display = 'none')
  }
 
  // ── Compress one file ─────────────────────────────────────────────────────────

  const FETCH_TIMEOUT_MS = 5 * 60 * 1000

  async function fetchCompress(file, attempt = 0) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(
        `${API_BASE}/compress/one?format=${fmt}&quality=${qRange.value}&width=${widthSel.value}`,
        { method: 'POST', body: form, signal: controller.signal }
      )
      clearTimeout(timer)
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return await res.json()
    } catch (err) {
      clearTimeout(timer)
      if (attempt === 0 && (err.name === 'AbortError' || err.message.startsWith('HTTP 5'))) {
        await new Promise(r => setTimeout(r, 1500))
        return fetchCompress(file, 1)
      }
      throw err
    }
  }

  async function compressOne(id, file) {
    try {
      const r = await fetchCompress(file)
 
      const item = items.find(it => it.id === id)
      r.originalSize = item ? item.originalSize : r.originalSize
 
      results[id] = r
 
      const pb = document.getElementById('pb-' + id)
      const st = document.getElementById('st-' + id)
      const dl = document.getElementById('dl-' + id)
      if (pb) pb.style.display = 'none'
      if (st) st.innerHTML = statusHtml(r)
      const pct = Math.round((1 - r.compressedSize / r.originalSize) * 100)
      if (dl && !r.error && pct > 0) dl.disabled = false
 
    } catch (err) {
      const pb = document.getElementById('pb-' + id)
      const st = document.getElementById('st-' + id)
      if (pb) pb.style.display = 'none'
      if (st) st.innerHTML = `<span class="badge badge-error">Server offline — ${err.message}</span>`
    }
 
    updateSummary()
  }
 
  // ── Helpers ───────────────────────────────────────────────────────────────────
 
  function fmtBytes(b) {
    if (b < 1024) return b + ' B'
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB'
    return (b / 1048576).toFixed(2) + ' MB'
  }
 
  function statusHtml(r) {
    if (r.error) return `<span class="badge badge-error">Failed: ${r.message || 'unknown'}</span>`
    const pct = Math.round((1 - r.compressedSize / r.originalSize) * 100)
    if (pct <= 0) {
      return `
        <span class="badge badge-error">Already optimised</span>
        <span style="font-size:0.65rem;color:var(--muted);line-height:1.4">Images are already optimized.</span>`
    }
    return `
      <span class="badge badge-success">−${pct}%</span>
      <span style="font-size:0.68rem;color:var(--muted)">${fmtBytes(r.originalSize)} → ${fmtBytes(r.compressedSize)}</span>`
  }
 
  function updateSummary() {
    const valid = Object.values(results).filter(r => {
      if (!r || r.error) return false
      const pct = Math.round((1 - r.compressedSize / r.originalSize) * 100)
      return pct > 0
    })
    if (!valid.length) { summary.style.display = 'none'; return }
 
    const totalOrig = valid.reduce((s, r) => s + r.originalSize, 0)
    const totalComp = valid.reduce((s, r) => s + r.compressedSize, 0)
    const pct = Math.round((1 - totalComp / totalOrig) * 100)
 
    document.getElementById('s-orig').textContent  = fmtBytes(totalOrig)
    document.getElementById('s-comp').textContent  = fmtBytes(totalComp)
    document.getElementById('s-ratio').textContent = (pct >= 0 ? '−' : '+') + Math.abs(pct) + '%'
    dlLabel.textContent = valid.length === 1 ? 'Download' : `Download all`
    summary.style.display = 'block'
  }
 
  // ── Download single ───────────────────────────────────────────────────────────
 
  function downloadSingle(id) {
    const r = results[id]
    if (!r || r.error || !r.data) return
    const item = items.find(it => it.id === id)
    const mime = r.mime || 'image/webp'
    const ext  = mime.split('/')[1] || fmt
    const base = (item?.file.name || 'image').replace(/\.[^.]+$/, '')
 
    const byteStr = atob(r.data)
    const arr = new Uint8Array(byteStr.length)
    for (let j = 0; j < byteStr.length; j++) arr[j] = byteStr.charCodeAt(j)
    triggerDownload(URL.createObjectURL(new Blob([arr], { type: mime })), `${base}.${ext}`)
  }
 
  // ── Download all ZIP ──────────────────────────────────────────────────────────

  dlZipBtn.addEventListener('click', async () => {
    dlZipBtn.disabled = true
    dlLabel.innerHTML = '<span class="spin"></span> Preparing…'

    const compressible = items.filter(it => {
      const r = results[it.id]
      if (!r || r.error) return false
      return Math.round((1 - r.compressedSize / r.originalSize) * 100) > 0
    })
    if (!compressible.length) {
      alert('No images to download.')
      dlZipBtn.disabled = false
      updateSummary()
      return
    }

    try {
      const zipSync = _zipSync || (await import('https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js')).zipSync

      const fileMap = {}
      for (const it of compressible) {
        const r = results[it.id]
        const mime = r.mime || 'image/webp'
        const ext  = mime.split('/')[1] || fmt
        const base = it.file.name.replace(/\.[^.]+$/, '')
        const byteStr = atob(r.data)
        const arr = new Uint8Array(byteStr.length)
        for (let j = 0; j < byteStr.length; j++) arr[j] = byteStr.charCodeAt(j)
        fileMap[`${base}.${ext}`] = [arr, { level: 0 }]
      }

      const zipped = zipSync(fileMap)
      const blob = new Blob([zipped], { type: 'application/zip' })
      triggerDownload(URL.createObjectURL(blob), `imgpress-${Date.now()}.zip`)
    } catch (err) {
      alert('Download failed: ' + err.message)
    }

    dlZipBtn.disabled = false
    updateSummary()
  })
 
  function triggerDownload(url, filename) {
    const a = document.createElement('a')
    a.href = url; a.download = filename
    document.body.appendChild(a); a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
 
  // ── Clear all ─────────────────────────────────────────────────────────────────

  clearLink.addEventListener('click', () => {
    items = []; results = {}
    queue.length = 0
    fileList.innerHTML = ''
    summary.style.display = 'none'
    recompressBtn.style.display = 'none'
    settingsDirty = false
  })

  // ── Event listeners for pill buttons and recompress ──────────────────────────

  document.querySelectorAll('.pill').forEach(btn => {
    btn.addEventListener('click', () => setPill(btn))
  })

  recompressBtn.addEventListener('click', recompress)