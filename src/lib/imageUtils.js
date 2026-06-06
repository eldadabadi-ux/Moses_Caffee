/**
 * imageUtils — shared image helpers (used by receipt scanning + logo upload).
 */

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/**
 * Compress + convert any image to a JPEG no larger than maxDim px.
 * Returns { dataUrl, mimeType }. Falls back to the raw file on any failure.
 */
export async function compressImage(file, maxDim = 2400, quality = 0.95) {
  const fallback = () => fileToBase64(file).then(dataUrl => ({ dataUrl, mimeType: file.type || 'image/jpeg' }))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      fileToBase64(file).then(dataUrl => resolve({ dataUrl, mimeType: file.type || 'image/jpeg' })).catch(reject)
    }, 12000)
    const done = r => { clearTimeout(timer); resolve(r) }
    const fail = () => { clearTimeout(timer); fallback().then(resolve).catch(reject) }
    try {
      const url = URL.createObjectURL(file)
      const img = new window.Image()
      img.onload = () => {
        URL.revokeObjectURL(url)
        try {
          let { width, height } = img
          if (width > maxDim || height > maxDim) {
            const r = Math.min(maxDim / width, maxDim / height)
            width = Math.round(width * r); height = Math.round(height * r)
          }
          const canvas = document.createElement('canvas')
          canvas.width = width; canvas.height = height
          canvas.getContext('2d').drawImage(img, 0, 0, width, height)
          canvas.toBlob(blob => {
            if (!blob) { fail(); return }
            const reader = new FileReader()
            reader.onload  = () => done({ dataUrl: reader.result, mimeType: 'image/jpeg' })
            reader.onerror = fail
            reader.readAsDataURL(blob)
          }, 'image/jpeg', quality)
        } catch { fail() }
      }
      img.onerror = () => { URL.revokeObjectURL(url); fail() }
      img.src = url
    } catch { fail() }
  })
}

/**
 * Downscale a dataURL before uploading to the scan API.
 * Real phone photos are 3-4000px → multi-MB base64 → slow upload → timeouts.
 */
export async function downscaleForUpload(dataUrl, maxDim = 2000, quality = 0.9) {
  return new Promise((resolve) => {
    try {
      const img = new window.Image()
      img.onload = () => {
        let { width, height } = img
        if (width <= maxDim && height <= maxDim) { resolve(dataUrl); return }
        const r = Math.min(maxDim / width, maxDim / height)
        width = Math.round(width * r); height = Math.round(height * r)
        const c = document.createElement('canvas')
        c.width = width; c.height = height
        c.getContext('2d').drawImage(img, 0, 0, width, height)
        resolve(c.toDataURL('image/jpeg', quality))
      }
      img.onerror = () => resolve(dataUrl)
      img.src = dataUrl
    } catch { resolve(dataUrl) }
  })
}

/**
 * Square-crop + downscale an image File to a logo data URL (center crop).
 * Returns a base64 JPEG/PNG data URL no larger than `size`px square.
 */
export async function fileToSquareLogo(file, size = 400, quality = 0.92) {
  return new Promise((resolve, reject) => {
    try {
      const url = URL.createObjectURL(file)
      const img = new window.Image()
      img.onload = () => {
        URL.revokeObjectURL(url)
        try {
          const side = Math.min(img.width, img.height)
          const sx = Math.round((img.width  - side) / 2)
          const sy = Math.round((img.height - side) / 2)
          const canvas = document.createElement('canvas')
          canvas.width = size; canvas.height = size
          const ctx = canvas.getContext('2d')
          ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size)
          // Keep PNG transparency if the source was PNG, else JPEG.
          const isPng = (file.type || '').includes('png')
          resolve(canvas.toDataURL(isPng ? 'image/png' : 'image/jpeg', quality))
        } catch (e) { reject(e) }
      }
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image load failed')) }
      img.src = url
    } catch (e) { reject(e) }
  })
}
