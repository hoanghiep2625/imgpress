 const API_BASE = window.API_URL || 'http://localhost:3000'
 
  let items   = []   // { id: string, file: File, originalSize: number }[]
  let results = {}   // id → result
  let fmt = 'webp'
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
    items.forEach(({ id, file }) => compressOne(id, file))
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
      // originalSize is always file.size — the true source-file size, never changes
      const item = { id, file, originalSize: file.size }
      items.unshift(item)               // prepend to state array
      prependCard(item)                 // prepend to DOM
      compressOne(id, file)             // kick off compression
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
 
    // Prepend: newest on top
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
 
  async function compressOne(id, file) {
    const form = new FormData()
    form.append('file', file)
 
    try {
      const res = await fetch(
        `${API_BASE}/compress/one?format=${fmt}&quality=${qRange.value}&width=${widthSel.value}`,
        { method: 'POST', body: form }
      )
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const r = await res.json()
 
      // Always store originalSize from the source file, not from server response
      // (server sees the file as-is; if user re-compresses an already-compressed file
      //  the server's originalSize would be wrong for display purposes)
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
      // Already optimised — size would increase, skip download
      return `
        <span class="badge badge-error">Already optimised</span>
        <span style="font-size:0.65rem;color:var(--muted);line-height:1.4">Ảnh đã được tối ưu từ trước,<br>không thể nén thêm.</span>`
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
 
    const form = new FormData()
    // Only include files that actually got smaller
    const compressible = items.filter(it => {
      const r = results[it.id]
      if (!r || r.error) return false
      return Math.round((1 - r.compressedSize / r.originalSize) * 100) > 0
    })
    if (!compressible.length) { alert('Không có ảnh nào cần tải về.'); dlZipBtn.disabled = false; updateSummary(); return }
    compressible.forEach(it => form.append('files', it.file))
 
    try {
      const res = await fetch(
        `${API_BASE}/compress/zip?format=${fmt}&quality=${qRange.value}&width=${widthSel.value}`,
        { method: 'POST', body: form }
      )
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const blob = await res.blob()
      const cd = res.headers.get('Content-Disposition') || ''
      const match = cd.match(/filename="([^"]+)"/)
      triggerDownload(URL.createObjectURL(blob), match ? match[1] : `imgpress-${Date.now()}.zip`)
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
    fileList.innerHTML = ''
    summary.style.display = 'none'
    recompressBtn.style.display = 'none'
    settingsDirty = false
  })