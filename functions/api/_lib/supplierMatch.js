/**
 * supplierMatch — SSOT for deciding whether two vendor strings are the SAME
 * supplier. Pure functions only (no I/O), so the scan pipeline, the client UI
 * and the merge tooling all reason identically.
 *
 * The problem it solves (audit R1): `receipts.vendor_name` is free text written
 * by the OCR model on every scan, so one supplier arrives under many spellings —
 * "קטיף ירקות קצוצים בע\"מ" / "קתוף ירקות קצוצים בע\"מ",
 * "מיזן" / "מייזן" / "מזון", "י.י. אגס בע\"מ" / "אגס בע\"מ".
 *
 * Two representations per name:
 *   normalizeVendor()  conservative — punctuation, legal suffixes, initials.
 *                      Two names with the same normal form ARE the same supplier.
 *   vendorSkeleton()   phonetic — folds the Hebrew letters that OCR and human
 *                      spelling confuse: matres lectionis (א ה ו י ע) carry no
 *                      consonant, ט/ת and כ/ק/ח are homophones in modern Hebrew,
 *                      and final forms are the same letter. "מתוקיה",
 *                      "מוטיקיה" and "מתווקיה" all reduce to "מתק".
 *
 * `matchVendor()` returns a decision, never a silent guess: high confidence
 * links automatically, middling confidence is handed to the user as a question
 * (client request #3), low confidence creates a new supplier.
 */

// ── tunables ─────────────────────────────────────────────────────────────────
export const AUTO_THRESHOLD = 0.92   // at or above → link without asking
export const ASK_THRESHOLD  = 0.60   // between the two → ask the user
const MAX_LEN = 120                  // guard the O(n·m) distance

// Legal-form tokens that carry no identity. Matched as WHOLE tokens after
// punctuation has been stripped, so "בע\"מ" has already become "בעמ".
const LEGAL_TOKENS = new Set([
  'בעמ', 'בעם', 'בהמ', 'ממ', 'חפ',
  'שותפות', 'מוגבלת', 'מורשה', 'עוסק', 'פטור',
  'ltd', 'limited', 'inc', 'llc', 'plc', 'corp', 'gmbh', 'pbc', 'sa', 'srl', 'bv', 'nv',
])

// Final (sofit) letters → their base form.
const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' }
// Homophones in modern Hebrew — people and OCR swap them freely. Deliberately
// short: ש/ס and ח/כ are only sometimes homophonic, and folding them merges
// unrelated suppliers.
const HOMOPHONES = { 'ט': 'ת', 'כ': 'ק' }
// Weak letters: silent or vowel-carrying, the main source of spelling variance
// ("מיזן" vs "מייזן", "קטיף" vs "קתוף").
const WEAK = new Set(['א', 'ה', 'ו', 'י', 'ע'])

/**
 * Conservative normal form. Same normal form ⇒ same supplier.
 * Strips quotes, punctuation, legal-form tokens and leading initials.
 */
export function normalizeVendor(name) {
  let s = String(name || '').normalize('NFC')
    .replace(/[֑-ׇ]/g, '')          // niqqud / cantillation
    .replace(/["'`׳״‘’“”]/g, '')  // quotes, geresh, gershayim
    .replace(/[.,\-–—_/\\|()\[\]{}+*:;!?@#$%^~=<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
  if (!s) return ''

  let tokens = s.split(' ').filter(Boolean).filter(t => !LEGAL_TOKENS.has(t))
  // Drop standalone single Hebrew letters — they are initials ("י.י. אגס" →
  // "י י אגס" → "אגס"). Only when something survives, and never for a name that
  // is a single letter to begin with.
  if (tokens.length > 1) {
    const kept = tokens.filter(t => !(t.length === 1 && /[֐-׿]/.test(t)))
    if (kept.length) tokens = kept
  }
  // A name reduced to nothing but legal forms keeps its original words.
  if (!tokens.length) tokens = s.split(' ').filter(Boolean)
  return tokens.join(' ')
}

/** Phonetic skeleton — folds the letters OCR and spelling confuse. */
export function vendorSkeleton(name) {
  const norm = normalizeVendor(name)
  if (!norm) return ''
  return norm.split(' ').map(tok => {
    let out = ''
    for (const ch of tok) {
      const base = FINALS[ch] || ch
      if (WEAK.has(base)) continue
      const folded = HOMOPHONES[base] || base
      if (out[out.length - 1] !== folded) out += folded   // collapse doubles
    }
    return out || tok.slice(0, 1)   // never let a token vanish entirely
  }).filter(Boolean).join(' ')
}

// ── Levenshtein (iterative, two rows) ────────────────────────────────────────
export function levenshtein(a, b) {
  a = String(a || '').slice(0, MAX_LEN)
  b = String(b || '').slice(0, MAX_LEN)
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  const cur = new Array(b.length + 1)
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    prev = cur.slice()
  }
  return prev[b.length]
}

const ratio = (a, b) => {
  const max = Math.max(a.length, b.length)
  return max ? 1 - levenshtein(a, b) / max : 0
}

/** Jaccard overlap of the two names' skeleton tokens. */
function tokenOverlap(sa, sb) {
  const A = new Set(sa.split(' ').filter(Boolean))
  const B = new Set(sb.split(' ').filter(Boolean))
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  return inter / (A.size + B.size - inter)
}

/**
 * Is the shorter name wholly contained in the longer one?
 * "מייזן" inside "מייזן סחר ושיווק מזון איכותי" — likely the same supplier,
 * but short enough that a human should confirm it once.
 */
function containment(sa, sb) {
  const A = sa.split(' ').filter(Boolean)
  const B = sb.split(' ').filter(Boolean)
  if (!A.length || !B.length) return 0
  const [short, long] = A.length <= B.length ? [A, B] : [B, A]
  const set = new Set(long)
  if (!short.every(t => set.has(t))) return 0
  return 0.84 + 0.1 * (short.length / long.length)
}

/**
 * Similarity of two vendor strings, 0..1.
 * 1 = identical normal form; ≥0.92 = safe to link automatically.
 */
export function vendorSimilarity(a, b) {
  const na = normalizeVendor(a), nb = normalizeVendor(b)
  if (!na || !nb) return 0
  if (na === nb) return 1

  const sa = vendorSkeleton(a), sb = vendorSkeleton(b)
  if (sa && sa === sb) return 0.97

  return Math.max(
    ratio(na, nb),
    ratio(sa, sb) * 0.98,          // skeleton agreement is slightly weaker evidence
    tokenOverlap(sa, sb) * 0.95,
    containment(sa, sb),
  )
}

/**
 * Match a scanned vendor name against known suppliers.
 *
 * @param {string} candidate raw vendor_name as the OCR read it
 * @param {Array}  suppliers [{ id, name, aliases?: string[] }]
 * @returns {{ decision:'auto'|'ask'|'new', supplier:object|null, score:number,
 *             alternatives:Array<{supplier:object,score:number}> }}
 */
export function matchVendor(candidate, suppliers = []) {
  const empty = { decision: 'new', supplier: null, score: 0, alternatives: [] }
  if (!normalizeVendor(candidate)) return empty

  const scored = []
  for (const s of suppliers) {
    // A supplier is represented by its canonical name AND every confirmed alias;
    // the best of them is the supplier's score.
    const names = [s.name, ...(Array.isArray(s.aliases) ? s.aliases : [])].filter(Boolean)
    let best = 0
    for (const n of names) {
      const v = vendorSimilarity(candidate, n)
      if (v > best) best = v
      if (best === 1) break
    }
    if (best > 0) scored.push({ supplier: s, score: Math.round(best * 1000) / 1000 })
  }
  if (!scored.length) return empty

  scored.sort((x, y) => y.score - x.score)
  const top = scored[0]
  const decision = top.score >= AUTO_THRESHOLD ? 'auto'
                 : top.score >= ASK_THRESHOLD  ? 'ask'
                 : 'new'
  return {
    decision,
    supplier: decision === 'new' ? null : top.supplier,
    score: top.score,
    alternatives: scored.slice(0, 4).filter(x => x.score >= ASK_THRESHOLD),
  }
}

/**
 * The "no vendor was read" sentinels the pipeline writes when a scan has no
 * usable supplier name. These are NOT a business and must never anchor a merge
 * cluster — otherwise real suppliers get folded INTO "ספק לא ידוע" (observed on
 * the live café data: an "unknown" row with 43 receipts pulling others in).
 * Compared on the normalized form, so spacing/quote variants are caught too.
 */
const UNKNOWN_VENDOR_NORMS = new Set(
  ['ספק לא ידוע', 'לא ידוע', 'ללא ספק', 'unknown', 'unknown supplier', 'n/a', 'na'].map(normalizeVendor)
)

/**
 * A vendor string that carries no identity — an OCR failure ("- ₪", "|||") or an
 * explicit "unknown supplier" sentinel. These must never become or merge into a
 * supplier; they are surfaced for manual correction instead.
 */
export function isJunkVendor(name) {
  const n = normalizeVendor(name)
  if (!n) return true
  if (UNKNOWN_VENDOR_NORMS.has(n)) return true
  const letters = n.replace(/[^֐-׿a-z]/g, '')
  return letters.length < 2
}

/**
 * Group a flat list of raw vendor names into clusters that are probably the
 * same supplier. Used by the one-off merge screen and the migration preview.
 *
 * Members are split by confidence so the approval UI can pre-select only what is
 * safe: `members` are at or above AUTO_THRESHOLD (near-certain), `review` are in
 * the ask band and need a human. Nothing is merged silently.
 *
 * The canonical name is the most-seen member, and on a tie the most complete one
 * — so a truncated OCR fragment ("מזון") never becomes the supplier's name.
 *
 * @param {Array<{name:string,count?:number,total?:number}>} rows
 * @returns {Array<{canonical:string,members:Array,review:Array,junk:boolean}>}
 */
export function clusterVendors(rows = []) {
  const items = rows
    .filter(r => normalizeVendor(r.name))
    .map(r => ({ ...r, count: r.count || 1 }))
    // Most-seen first, then the longest spelling — this is what becomes the
    // cluster's canonical name, so completeness breaks ties.
    .sort((a, b) => b.count - a.count || normalizeVendor(b.name).length - normalizeVendor(a.name).length)

  const clusters = []
  for (const it of items) {
    const itJunk = isJunkVendor(it.name)
    let placed = null, bestScore = 0
    for (const c of clusters) {
      // Never attach across a junk boundary: a real supplier must not fold into an
      // "unknown supplier"/garbage canonical, and junk must not join a real one.
      // (Junk still forms its own cluster below, shown for manual correction.)
      if (itJunk !== isJunkVendor(c.canonical)) continue
      // Compare against the cluster's canonical member only — chaining through
      // weak links is how unrelated suppliers get merged together.
      const v = vendorSimilarity(it.name, c.canonical)
      if (v >= ASK_THRESHOLD && v > bestScore) { placed = c; bestScore = v }
    }
    const entry = { ...it, score: placed ? Math.round(bestScore * 1000) / 1000 : 1 }
    if (placed) (bestScore >= AUTO_THRESHOLD ? placed.members : placed.review).push(entry)
    else clusters.push({ canonical: it.name, members: [entry], review: [] })
  }

  const bySize = (a, b) => b.count - a.count
  return clusters
    .map(c => ({
      canonical: c.canonical,
      junk: isJunkVendor(c.canonical),
      members: c.members.sort(bySize),
      review: c.review.sort((a, b) => b.score - a.score),
    }))
    .sort((a, b) =>
      (b.members.length + b.review.length) - (a.members.length + a.review.length) ||
      b.members[0].count - a.members[0].count)
}
