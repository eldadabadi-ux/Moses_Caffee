/**
 * mergeGroups — pure helpers for the supplier-merge screen, extracted so the
 * payload the client sends can be unit-tested (the server side is covered by the
 * live E2E). Keeping this out of the component is what lets us PROVE that
 * unticking a spelling removes it from BOTH the aliases and the stored list.
 */

/** Every spelling in a cluster (canonical members + review band). */
export const clusterSpellings = (c) => [...(c.members || []), ...(c.review || [])]

/**
 * Default selection: pre-check EVERY spelling, review band included. The task is
 * de-duplicating OCR spellings of one supplier, and the clusters are almost
 * always genuinely the same supplier, so "merge them all" is the useful default;
 * the user unticks anything that doesn't belong. (Leaving the review band
 * unchecked was why a plain "אשר איחוד" merged nothing the user cared about.)
 * @returns {{ [canonical]: { canonical, picked: Set<string> } }}
 */
export function initialChoices(clusters = []) {
  const init = {}
  for (const c of clusters) {
    init[c.canonical] = { canonical: c.canonical, picked: new Set(clusterSpellings(c).map(m => m.name)) }
  }
  return init
}

/**
 * Build the POST payload from the user's current selections. aliases AND stored
 * are both derived from the PICKED spellings only — so an unticked spelling is
 * excluded from relinking receipts and from folding its supplier row, keeping
 * the two steps consistent.
 *
 * choices and accepted are keyed by the cluster's ORIGINAL canonical name (that
 * is how the screen stores them); the output `canonical` is the possibly-renamed
 * value from the choice.
 *
 * @param {Array}  clusters  preview clusters (junk ones are skipped)
 * @param {object} choices   { [originalCanonical]: { canonical, picked: Set } }
 * @param {object} accepted  { [originalCanonical]: supplierId }  accepted "possible supplier" links
 * @returns {Array<{canonical, supplier_id?, aliases:string[], stored:string[]}>}
 */
export function buildMergeGroups(clusters = [], choices = {}, accepted = {}) {
  const groups = []
  for (const c of clusters) {
    if (c.junk) continue
    const key = c.canonical
    const picked = choices[key]?.picked || new Set()
    if (picked.size === 0) continue
    const pickedRows = clusterSpellings(c).filter(m => picked.has(m.name))
    groups.push({
      canonical: choices[key]?.canonical ?? c.canonical,
      supplier_id: c.existing_supplier?.id || accepted[key] || undefined,
      aliases: pickedRows.map(m => m.name),
      stored: [...new Set(pickedRows.flatMap(m => (m.stored && m.stored.length ? m.stored : [m.name])))],
    })
  }
  return groups
}
