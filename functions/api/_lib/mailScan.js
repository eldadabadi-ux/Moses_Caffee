/**
 * mailScan — dispatch a mailbox scan to the right provider scanner.
 */
import { scanGmail } from './gmailScan.js'
import { scanGraph } from './graphScan.js'

export async function scanConnection(conn, env, opts = {}) {
  return conn.provider === 'outlook' ? scanGraph(conn, env, opts) : scanGmail(conn, env, opts)
}
