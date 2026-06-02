function correlationId() {
  try { return crypto.randomUUID().split('-')[0] } catch { return Math.random().toString(16).slice(2, 14) }
}

export function errorResponse(message, status = 500, options = {}) {
  const { code, err, headers } = options
  const cid = correlationId()
  const body = { error: code || (status >= 500 ? 'server_error' : 'request_error'), message, correlation_id: cid }
  if (err) console.error(`[${cid}] ${code || 'error'} (${status}):`, err?.stack || err?.message || err)
  return Response.json(body, { status, headers })
}

export function jsonResponse(payload, status = 200, headers = undefined) {
  return Response.json(payload, { status, headers })
}
