/**
 * fxRate — fetches the OFFICIAL representative exchange rate (שער יציג) from the
 * Bank of Israel (the only official source for Israeli representative rates).
 * Returns ILS per 1 unit of the given currency, plus the publish date.
 *
 * Endpoint: https://boi.org.il/PublicApi/GetExchangeRates
 *   → { exchangeRates: [ { key:'USD', currentExchangeRate:2.935, unit:1, lastUpdate:'…' }, … ] }
 */

const BOI_URL = 'https://boi.org.il/PublicApi/GetExchangeRates'

// Map common currency symbols → ISO 4217 codes (the AI may return a symbol).
const SYMBOL_TO_CODE = { '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₪': 'ILS', '₣': 'CHF', '₩': 'KRW', '₽': 'RUB', '₺': 'TRY', '₹': 'INR' }

export function normalizeCurrency(cur) {
  let c = String(cur || '').trim().toUpperCase()
  if (!c) return 'ILS'
  if (SYMBOL_TO_CODE[c]) return SYMBOL_TO_CODE[c]
  if (c === 'NIS' || c === 'SHEKEL' || c === 'שקל' || c === 'ש"ח' || c === '₪') return 'ILS'
  if (c.includes('USD') || c === 'DOLLAR' || c === 'דולר') return 'USD'
  if (c.includes('EUR') || c === 'EURO' || c === 'יורו' || c === 'אירו') return 'EUR'
  if (c.includes('GBP') || c === 'POUND') return 'GBP'
  return c.slice(0, 3)
}

/**
 * @returns {Promise<{ rate:number, date:string, source:string, currency:string } | null>}
 *   rate = ILS for 1 unit of `currency`. null for ILS or on any failure.
 */
export async function getIlsRate(currency) {
  const cur = normalizeCurrency(currency)
  if (!cur || cur === 'ILS') return null
  try {
    const res = await fetch(BOI_URL, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'MosesCaffee-Receipts/1.0' },
      cf: { cacheTtl: 3600, cacheEverything: true },   // BOI updates ~daily — cache 1h
    })
    if (!res.ok) return null
    const data = await res.json()
    const list = Array.isArray(data?.exchangeRates) ? data.exchangeRates : []
    const row = list.find(r => String(r.key || '').toUpperCase() === cur)
    if (!row || !(row.currentExchangeRate > 0)) return null
    const unit = row.unit > 0 ? row.unit : 1
    return {
      rate: row.currentExchangeRate / unit,            // ILS per 1 foreign unit
      date: String(row.lastUpdate || '').slice(0, 10),
      source: 'בנק ישראל',
      currency: cur,
    }
  } catch {
    return null
  }
}
