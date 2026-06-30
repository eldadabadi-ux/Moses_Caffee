/**
 * moses-mail-scan — a tiny scheduled Worker. Every 30 minutes it pings the
 * Pages function /api/mail/cron (with the shared CRON_SECRET), which does the
 * real work of scanning all connected mailboxes. Keeping the heavy logic in the
 * Pages function means ONE runtime + ONE set of secrets (no duplication here).
 */
async function ping(env) {
  const url = env.CRON_TARGET || 'https://moses-caffee.pages.dev/api/mail/cron'
  try {
    const res = await fetch(url, { headers: { 'x-cron-secret': env.CRON_SECRET || '' } })
    return `cron ${res.status}: ${(await res.text()).slice(0, 200)}`
  } catch (e) {
    return `cron error: ${e?.message || e}`
  }
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(ping(env))
  },
  // Manual trigger for testing: GET /?run=1
  async fetch(req, env) {
    if (new URL(req.url).searchParams.get('run') === '1') return new Response(await ping(env))
    return new Response('moses-mail-scan worker — scheduled pinger', { status: 200 })
  },
}
