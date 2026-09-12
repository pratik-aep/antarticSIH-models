export function flagEmoji(countryCode = '') {
  if (!countryCode || countryCode.length !== 2) return '🌐'
  const cc = countryCode.toUpperCase()
  if (!/^[A-Z]{2}$/.test(cc)) return '🌐'
  const OFFSET = 127397
  return String.fromCodePoint(...[...cc].map(c => OFFSET + c.charCodeAt(0)))
}

const CTYPE = {
  sox: { value: 0.06, order: 0 },
  'sox, nox': { value: 0.03, order: 1 },
}

export function chipClass(t) {
  const k = (t || '').toLowerCase()
  return CTYPE[k] ? (CTYPE[k].value) : 1
}

// Parse "62°05'S 74°12'E", "62.1S 74.2E", "62.1, 74.2", "-62.1 74.2", etc.
export function parseCoordLabel(text) {
  const s = (text || '').trim()
  if (!s) return null

  const dms = /(-?\d+(?:\.\d+)?)\s*°?\s*(\d+(?:\.\d+)?)?\s*(?:'|′)?\s*(\d+(?:\.\d+)?)?\s*(?:''|″)?\s*([NSEW])?\s*[,;\s]+\s*(-?\d+(?:\.\d+)?)\s*°?\s*(\d+(?:\.\d+)?)?\s*(?:'|′)?\s*(\d+(?:\.\d+)?)?\s*(?:''|″)?\s*([NSEW])?/i.exec(s)
  if (dms) {
    const [, la, lam, las, laH, lo, lom, los, loH] = dms
    let lat = Number(la) + (Number(lam) || 0) / 60 + (Number(las) || 0) / 3600
    let lon = Number(lo) + (Number(lom) || 0) / 60 + (Number(los) || 0) / 3600
    if (laH && /[SW]/i.test(laH)) lat = -lat
    if (laH && /[NE]/i.test(laH)) lat = Math.abs(lat)
    if (loH && /[SW]/i.test(loH)) lon = -lon
    if (loH && /[NE]/i.test(loH)) lon = Math.abs(lon)
    if (!isNaN(lat) && !isNaN(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon }
  }

  const pair = /^([S±\-]?\s?\d+(?:\.\d+)?)\s*[,;\s]\s*([EW±\-]?\s?-?\d+(?:\.\d+)?)$/i.exec(s)
  if (pair) {
    let lat = parseFloat(pair[1].replace(/[SEWN±\s]/gi, ''))
    let lon = parseFloat(pair[2].replace(/[SEWN±\s]/gi, ''))
    if (/S/i.test(pair[1])) lat = -Math.abs(lat)
    if (/W/i.test(pair[2])) lon = -Math.abs(lon)
    if (!isNaN(lat) && !isNaN(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon }
  }
  return null
}

export function formatCoord(lat, lon) {
  const ns = lat >= 0 ? 'N' : 'S'
  const ew = lon >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(2)}°${ns} ${Math.abs(lon).toFixed(2)}°${ew}`
}

export function fmtHours(hours) {
  const h = Math.floor(hours)
  const days = Math.floor(h / 24)
  const mins = Math.round((hours - Math.floor(hours)) * 60)
  if (days > 0) return `${days}d ${h % 24}h ${mins}m`
  if (h > 0) return `${h}h ${mins}m`
  return `${mins}m`
}