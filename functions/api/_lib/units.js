/**
 * units — SSOT for units of measure and price-per-base-unit (audit R3,
 * client request #12).
 *
 * The scan already reads a unit off each line, but it stores it exactly as
 * printed, so the live data holds ק"ג / קילו / קג as three different units,
 * ליטר / ל' as two, גרם / גר' as two — and 35% of lines carry no unit at all.
 * Comparing "₪ per יח'" between a supplier who sells a 1-litre carton and one who
 * sells a 12-pack is meaningless, and that comparison is exactly what the
 * insights and supplier reports are built on.
 *
 * So every unit folds to a canonical one, every canonical unit belongs to a
 * dimension (mass / volume / count), and each dimension has ONE base unit:
 *   mass → kg   ·   volume → l   ·   count → unit
 * Pack sizes hiding inside product names ("חלב טרי בקרטון 1 ליטר",
 * "(12 יח' בקרטון)", "סלט … 4 קג") are pulled out so a packaged item can be
 * priced per kilo or per litre like anything else.
 *
 * Pure functions — no I/O — so the scan pipeline, the dashboard and the bot's
 * comparison tools all price identically.
 */

export const BASE_BY_DIMENSION = { mass: 'kg', volume: 'l', count: 'unit' }

/**
 * Canonical units. `toBase` converts one of THIS unit into the dimension's base.
 * `packLike` marks a container whose real size usually lives in the item name.
 */
const UNITS = {
  kg:    { dimension: 'mass',   toBase: 1,      label: 'ק"ג' },
  g:     { dimension: 'mass',   toBase: 0.001,  label: 'גרם' },
  l:     { dimension: 'volume', toBase: 1,      label: 'ליטר' },
  ml:    { dimension: 'volume', toBase: 0.001,  label: 'מ"ל' },
  unit:  { dimension: 'count',  toBase: 1,      label: "יח'" },
  pack:  { dimension: 'count',  toBase: 1,      label: 'מארז',  packLike: true },
  tray:  { dimension: 'count',  toBase: 1,      label: 'מגש',   packLike: true },
  case:  { dimension: 'count',  toBase: 1,      label: 'קרטון', packLike: true },
  kwh:   { dimension: 'energy', toBase: 1,      label: 'קוט"ש' },
}

/**
 * Every spelling seen in the wild → its canonical unit. Keys are matched after
 * the same normalization applied to the input (quotes and dots stripped).
 */
const ALIASES = {
  // mass
  'קג': 'kg', 'קילו': 'kg', 'קילוגרם': 'kg', 'קילוגרמים': 'kg', 'kg': 'kg', 'kilo': 'kg',
  'גרם': 'g', 'גר': 'g', 'גרמים': 'g', 'g': 'g', 'gr': 'g', 'gram': 'g',
  // volume
  'ליטר': 'l', 'ל': 'l', 'ליט': 'l', 'l': 'l', 'lt': 'l', 'liter': 'l', 'litre': 'l',
  'מל': 'ml', 'מיליליטר': 'ml', 'ml': 'ml',
  // count
  'יח': 'unit', 'יחידה': 'unit', 'יחידות': 'unit', 'יחי': 'unit',
  'unit': 'unit', 'units': 'unit', 'pcs': 'unit', 'pc': 'unit', 'ea': 'unit',
  'מארז': 'pack', 'מארזים': 'pack', 'קופסה': 'pack', 'קופסא': 'pack', 'קופסאות': 'pack',
  'חבילה': 'pack', 'חבילות': 'pack', 'שקית': 'pack', 'pack': 'pack', 'box': 'pack',
  'מגש': 'tray', 'מגשים': 'tray', 'tray': 'tray',
  'קרטון': 'case', 'ארגז': 'case', 'ארגזים': 'case', 'גוש': 'case', 'case': 'case',
  // energy (utility bills)
  'קוטש': 'kwh', 'קווטש': 'kwh', 'kwh': 'kwh',
}

/** Strip quotes/dots/whitespace so "ק\"ג", "ק'ג" and "קג" are one key. */
function unitKey(raw) {
  return String(raw || '')
    .normalize('NFC')
    .replace(/["'`׳״’]/g, '')
    .replace(/[.\s]/g, '')
    .toLowerCase()
}

/**
 * Fold a printed unit to its canonical form.
 * @returns {{unit:string,dimension:string,base:string,toBase:number,label:string,packLike:boolean}|null}
 */
export function normalizeUnit(raw) {
  const key = unitKey(raw)
  if (!key) return null
  const canonical = UNITS[key] ? key : ALIASES[key]
  if (!canonical || !UNITS[canonical]) return null
  const u = UNITS[canonical]
  return {
    unit: canonical,
    dimension: u.dimension,
    base: BASE_BY_DIMENSION[u.dimension] || canonical,
    toBase: u.toBase,
    label: u.label,
    packLike: !!u.packLike,
  }
}

/** Human label for a canonical unit ("kg" → 'ק"ג'). */
export const unitLabel = (canonical) => UNITS[canonical]?.label || canonical || ''

// A number followed by a unit word, anywhere in a product name:
//   "חלב טרי בקרטון 1 ליטר 3%"      → 1 l
//   "חלב קרטון 3% (12 יח' בקרטון)"  → 12 unit
//   "סלט טבולה … 4 קג"              → 4 kg
//   "קמח 500 גרם"                   → 500 g
// NOTE: no \b terminator — JS word boundaries are defined over [A-Za-z0-9_], so
// \b never matches after a Hebrew letter and the whole pattern silently fails.
// A negative lookahead for "another Hebrew or Latin letter" is the real boundary.
const SIZE_RE = /(\d+(?:[.,]\d+)?)\s*(ק"?ג|קילוגרם|קילו|גרם|גר['׳]?|ליטר|ליט['׳]?|ל['׳]|מ"?ל|יחידות|יחידה|יח['׳]?|מארז|קופסה|קופסא|מגש|kg|gr|g|ml|lt|l|pcs|pc|units|unit)(?![\u0590-\u05FFa-z])/gi

/**
 * Pull a pack size out of a product name.
 * Returns the LAST plausible match — trailing sizes ("… 1 ליטר") beat a number
 * that happens to appear earlier in the name (a fat percentage, a brand number).
 *
 * @returns {{quantity:number,unit:string,dimension:string,toBase:number}|null}
 */
export function parsePackSize(itemName) {
  const name = String(itemName || '')
  if (!name) return null
  let found = null
  for (const m of name.matchAll(SIZE_RE)) {
    const qty = parseFloat(String(m[1]).replace(',', '.'))
    const u = normalizeUnit(m[2])
    // A percentage ("3%") must never read as a size, and a pack-like container
    // is not a measurement of anything.
    if (!qty || !u || u.packLike) continue
    if (name[m.index + m[0].length] === '%') continue
    found = { quantity: qty, unit: u.unit, dimension: u.dimension, toBase: u.toBase }
  }
  return found
}

/**
 * Price per base unit for one receipt line — ₪/kg, ₪/l or ₪/unit.
 *
 * Resolution order:
 *   1. an explicit measurable unit on the line (ק"ג, ליטר, גרם…)
 *   2. a pack size parsed out of the product name, when the line is counted in
 *      containers ("2 קרטון" × "1 ליטר" each → 2 l)
 *   3. plain count — ₪ per piece
 *
 * @param {object} item { item_name, quantity, unit, unit_price, price, pack_size? }
 * @returns {{value:number,base:string,quantity_base:number,source:string}|null}
 *          null when there is nothing to divide by (no price or no quantity).
 */
export function pricePerBaseUnit(item) {
  if (!item) return null
  const price = Number(item.price)
  const qty = Number(item.quantity)
  const quantity = Number.isFinite(qty) && qty > 0 ? qty : 1
  const total = Number.isFinite(price) && price > 0
    ? price
    : (Number(item.unit_price) > 0 ? Number(item.unit_price) * quantity : 0)
  if (!(total > 0)) return null

  const lineUnit = normalizeUnit(item.unit)
  // An explicit pack_size read off the document beats one inferred from the
  // product name; fall back to the name when the field is absent or unusable.
  const pack = parsePackSize(item.pack_size) || parsePackSize(item.item_name)

  // 1. The line is already measured in mass/volume (or an explicit count).
  if (lineUnit && !lineUnit.packLike) {
    const qBase = quantity * lineUnit.toBase
    if (!(qBase > 0)) return null
    return {
      value: round2(total / qBase),
      base: lineUnit.base,
      quantity_base: round4(qBase),
      source: 'unit',
    }
  }

  // 2. Counted in containers — the real size is in the product name.
  if (pack) {
    const qBase = quantity * pack.quantity * pack.toBase
    if (!(qBase > 0)) return null
    return {
      value: round2(total / qBase),
      base: BASE_BY_DIMENSION[pack.dimension] || pack.unit,
      quantity_base: round4(qBase),
      source: lineUnit ? 'pack_size' : 'name_size',
    }
  }

  // 3. Nothing measurable — price per piece, and say so.
  return {
    value: round2(total / quantity),
    base: 'unit',
    quantity_base: round4(quantity),
    source: lineUnit ? 'count' : 'assumed_count',
  }
}

/**
 * Annotate a line item with its canonical unit and price per base unit.
 * Stored on the item at scan time so every later consumer — comparisons,
 * insights, supplier reports — reads one pre-computed, consistent figure.
 */
export function withUnitPricing(item) {
  if (!item) return item
  const u = normalizeUnit(item.unit)
  const p = pricePerBaseUnit(item)
  return {
    ...item,
    unit_canonical: u?.unit || null,
    unit_dimension: u?.dimension || null,
    price_per_base_unit: p?.value ?? null,
    base_unit: p?.base || null,
    base_quantity: p?.quantity_base ?? null,
    unit_confidence: p?.source || null,
  }
}

/** Are two items priced in the same base unit, so comparing them is valid? */
export const comparablePricing = (a, b) =>
  !!(a?.base_unit && b?.base_unit && a.base_unit === b.base_unit)

const round2 = (n) => Math.round(n * 100) / 100
const round4 = (n) => Math.round(n * 10000) / 10000
