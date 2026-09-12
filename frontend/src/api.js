const API_BASE = '/api'

async function json(res) {
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`Unexpected response (${res.status})`)
  }
  if (!res.ok) {
    const msg = (data && data.detail) ? (Array.isArray(data.detail) ? data.detail.map(d => d.msg).join(', ') : data.detail) : `Request failed (${res.status})`
    throw new Error(msg)
  }
  return data
}

export async function searchPorts(q) {
  const res = await fetch(`${API_BASE}/ports?q=${encodeURIComponent(q)}`)
  return json(res)
}

export async function geocode(lat, lon) {
  const res = await fetch(`${API_BASE}/geocode?lat=${lat}&lon=${lon}`)
  return json(res)
}

export async function computeRoute(waypoints, speedKnots, departureTimeUTC, optimizeFor) {
  const res = await fetch(`${API_BASE}/route`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ waypoints, speedKnots, departureTimeUTC, optimizeFor }),
  })
  return json(res)
}

export async function fetchEcas() {
  const res = await fetch(`${API_BASE}/ecas`)
  return json(res)
}

export async function fetchChokepoints() {
  const res = await fetch(`${API_BASE}/chokepoints`)
  return json(res)
}