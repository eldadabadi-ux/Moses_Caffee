/**
 * Zero-dependency .env.test loader — so `node --test` works without a bundler
 * or dotenv. Reads repo-root `.env.test` (or this folder's) if present and copies
 * any keys it defines into process.env (without overriding already-set vars).
 * A missing file is fine — vars may come from the real environment / CI instead.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
for (const p of [resolve(here, '../../.env.test'), resolve(here, '.env.test')]) {
  let txt
  try { txt = readFileSync(p, 'utf8') } catch { continue }   // no file here — try next
  for (const line of txt.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line)
    if (!m || line.trim().startsWith('#')) continue
    const key = m[1]
    const val = m[2].trim().replace(/^["']|["']$/g, '')
    if (!(key in process.env)) process.env[key] = val
  }
  break
}
