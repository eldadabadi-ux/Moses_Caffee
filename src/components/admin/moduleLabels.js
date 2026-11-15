/** Hebrew labels for the sellable modules — shared by the admin consoles
 *  (flags matrix + client manager). Keys mirror functions/api/_lib/flags.js. */
export const MODULE_LABELS = {
  bot_tools: 'עוזר חכם',
  events_book: 'ספר אירועים',
  reconciliation: 'התאמות',
  product_compare: 'השוואת מוצרים',
  insights: 'תובנות',
  price_alerts: 'התראות מחיר',
  mail_ingest: 'קליטת מייל',
}
export const moduleLabel = (key) => MODULE_LABELS[key] || key
