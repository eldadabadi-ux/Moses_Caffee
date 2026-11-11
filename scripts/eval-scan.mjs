/**
 * eval-scan — score the receipt-extraction pipeline against the synthetic corpus
 * (client request #9: "בדוק אם יש מודל טוב יותר").
 *
 *   npm run eval:scan                          # score the current default model
 *   npm run eval:scan -- --model=gemini-3-pro  # score a candidate
 *   npm run eval:scan -- --compare=gemini-3-pro
 *                                              # run both and diff them field by field
 *   npm run eval:scan -- --render-only         # just write the images, call nothing
 *
 * Needs GEMINI_API_KEY (put it in .env.test) and `npx playwright install chromium`
 * once, for rendering. Costs one model call per fixture per model.
 *
 * The corpus is generated, not real receipts: ground truth is exact by
 * construction and no customer data is involved (see tests/eval/fixtures.mjs).
 *
 * A candidate is an upgrade only when it scores higher AND breaks nothing. The
 * comparison reports regressions separately for that reason — a higher total
 * that loses a capability is a trade, not a win.
 */
import { mkdir, writeFile, readFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { FIXTURES } from '../tests/eval/fixtures.mjs'
import { receiptHtml, degradeCss } from '../tests/eval/receiptTemplate.mjs'
import { scoreOne, summarize, compareRuns } from '../tests/eval/score.mjs'
import { extractReceipt } from '../functions/api/_lib/extractReceipt.js'

const arg = (name) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`))
  return hit ? hit.split('=').slice(1).join('=') : null
}
const HAS = (name) => process.argv.includes(`--${name}`)
const OUT = join('tests', 'eval', '.images')          // gitignored
const c = { g: s => `\x1b[32m${s}\x1b[0m`, r: s => `\x1b[31m${s}\x1b[0m`,
            y: s => `\x1b[33m${s}\x1b[0m`, b: s => `\x1b[1m${s}\x1b[0m`, d: s => `\x1b[2m${s}\x1b[0m` }

// ── render ───────────────────────────────────────────────────────────────────
async function renderAll() {
  let chromium
  try { ({ chromium } = await import('playwright')) } catch {
    console.error(c.r('\nplaywright is not installed. Run:  npm i -D playwright && npx playwright install chromium\n'))
    process.exit(1)
  }
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch()
  try {
    for (const fx of FIXTURES) {
      const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 2 })
      const extra = degradeCss(fx.render)
      await page.setContent(receiptHtml(fx) + (extra ? `<style>${extra}</style>` : ''))
      // Clip to the document itself — a page of blank paper below it teaches the
      // model nothing and costs tokens on every run. The viewport must first be
      // grown to the document height: a clip taller than the viewport silently
      // captures only the visible part, which cut every receipt taller than
      // 600px mid-table (long-item-list lost its last rows AND its totals block,
      // and every model was blamed for the missing lines).
      const box = await page.locator('body').boundingBox()
      await page.setViewportSize({ width: 800, height: Math.ceil(box.height) + 16 })
      await page.screenshot({
        path: join(OUT, `${fx.id}.png`),
        clip: { x: 0, y: 0, width: Math.ceil(box.width), height: Math.ceil(box.height) + 8 },
      })
      await page.close()
      process.stdout.write(`  rendered ${fx.id}\n`)
    }
  } finally { await browser.close() }
}

async function ensureImages() {
  try {
    for (const fx of FIXTURES) await access(join(OUT, `${fx.id}.png`))
  } catch { await renderAll() }
}

// ── run one model over the corpus ────────────────────────────────────────────
async function runModel(model) {
  const env = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    ...(model ? { GEMINI_MODEL: model, GEMINI_FALLBACK_MODEL: model } : {}),
  }
  const results = []
  for (const fx of FIXTURES) {
    const b64 = (await readFile(join(OUT, `${fx.id}.png`))).toString('base64')
    let got = {}
    try {
      got = await extractReceipt({ images: [b64], mimeType: 'image/png', env, userId: 'eval', vatRate: 18 })
    } catch (err) {
      got = { _error: err?.message || String(err) }
    }
    const r = scoreOne(fx, got)
    results.push(r)
    const pct = Math.round((r.score / r.max) * 100)
    const mark = r.score === r.max ? c.g('✓') : pct >= 70 ? c.y('~') : c.r('✗')
    console.log(`  ${mark} ${fx.id.padEnd(24)} ${String(pct).padStart(3)}%  ${r.failures.map(f => f.name).join(', ')}`)
    if (got._error) console.log(c.r(`      error: ${got._error}`))
    await new Promise(r => setTimeout(r, 1200))     // stay under the free-tier rate limit
  }
  return results
}

function printSummary(label, s) {
  console.log(`\n${c.b(label)}  ${s.pct}%  (${s.score}/${s.max})   perfect: ${s.perfect}/${s.total}`)
  for (const f of s.byField) {
    const pct = Math.round((f.pass / f.total) * 100)
    const bar = '█'.repeat(Math.round(pct / 5)).padEnd(20, '░')
    const col = pct === 100 ? c.g : pct >= 70 ? c.y : c.r
    console.log(`    ${f.name.padEnd(18)} ${col(bar)} ${String(pct).padStart(3)}%  (${f.pass}/${f.total})`)
  }
}

// ── main ─────────────────────────────────────────────────────────────────────
if (HAS('render-only')) { await renderAll(); console.log(c.g(`\nimages written to ${OUT}\n`)); process.exit(0) }

if (!process.env.GEMINI_API_KEY) {
  console.error(c.r('\nGEMINI_API_KEY is not set. Add it to .env.test and run with --env-file=.env.test\n'))
  process.exit(1)
}

await ensureImages()

const compare = arg('compare')
const model = arg('model')

console.log(c.b(`\nScan evaluation — ${FIXTURES.length} synthetic receipts\n`))
console.log(c.b(model ? `Model: ${model}` : 'Model: (repo default)'))
const baseResults = await runModel(model)
const baseSummary = summarize(baseResults)
printSummary(model || 'default', baseSummary)

if (compare) {
  console.log(c.b(`\nCandidate: ${compare}`))
  const candResults = await runModel(compare)
  printSummary(compare, summarize(candResults))

  const cmp = compareRuns(baseResults, candResults)
  console.log(`\n${c.b('Verdict')}: ${cmp.verdict === 'upgrade' ? c.g(cmp.verdict) : cmp.verdict === 'no change' ? c.y(cmp.verdict) : c.r(cmp.verdict)}`
    + `   (${cmp.delta >= 0 ? '+' : ''}${cmp.delta} points)`)
  if (cmp.fixes.length) {
    console.log(c.g(`\n  fixed (${cmp.fixes.length}):`))
    for (const f of cmp.fixes) console.log(`    ${f.id} · ${f.field}`)
  }
  if (cmp.regressions.length) {
    console.log(c.r(`\n  REGRESSIONS (${cmp.regressions.length}) — do not ship this model:`))
    for (const r of cmp.regressions) console.log(`    ${r.id} · ${r.field}  ${c.d(r.detail || '')}`)
  }
  console.log()
  process.exit(cmp.regressions.length ? 1 : 0)
}

// A field that is failing across the whole corpus is a prompt problem, not luck.
const weak = baseSummary.byField.filter(f => f.pass < f.total)
if (weak.length) {
  console.log(c.y('\nFields not at 100% — each is a concrete thing to fix in the prompt:'))
  for (const f of weak) console.log(`    ${f.name}  ${f.pass}/${f.total}`)
}
console.log()
