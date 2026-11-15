/**
 * md2docx — zero-dependency Markdown → .docx for Hebrew/RTL reports.
 * Supports: # ## ### headings, paragraphs, **bold**, `code`, - lists,
 * > blockquotes, GFM tables, --- rules. Headings map to real Word
 * Heading1/2/3 styles (navigation pane / ראשי פרקים work).
 *
 *   node md2docx.mjs <in.md> <out.docx> "<document title>"
 */
import { readFileSync, writeFileSync } from 'node:fs'

// ── minimal ZIP writer (STORE) ───────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
const crc32 = (buf) => {
  let c = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}
function zip(entries) {
  const locals = [], centrals = []
  let offset = 0
  for (const [name, text] of entries) {
    const nameB = Buffer.from(name, 'utf8')
    const data = Buffer.from(text, 'utf8')
    const crc = crc32(data)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6)
    lh.writeUInt16LE(0, 8); lh.writeUInt32LE(0, 10)
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22)
    lh.writeUInt16LE(nameB.length, 26); lh.writeUInt16LE(0, 28)
    locals.push(lh, nameB, data)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6)
    ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10); ch.writeUInt32LE(0, 12)
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24)
    ch.writeUInt16LE(nameB.length, 28)
    ch.writeUInt32LE(offset, 42)
    centrals.push(Buffer.concat([ch, nameB]))
    offset += 30 + nameB.length + data.length
  }
  const central = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, central, end])
}

// ── OOXML helpers ────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

// Inline: **bold** and `code` → runs (all runs carry w:rtl for Hebrew flow).
function runs(text, extra = '') {
  const out = []
  const parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean)
  for (const p of parts) {
    let t = p, b = '', mono = ''
    if (p.startsWith('**') && p.endsWith('**')) { t = p.slice(2, -2); b = '<w:b/>' }
    else if (p.startsWith('`') && p.endsWith('`')) { t = p.slice(1, -1); mono = '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="18"/><w:szCs w:val="18"/>' }
    out.push(`<w:r><w:rPr>${mono}${b}${b ? '<w:bCs/>' : ''}${extra}<w:rtl/></w:rPr><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`)
  }
  return out.join('') || '<w:r><w:t/></w:r>'
}
const para = (text, { style, bullet, quote } = {}) => {
  const pPr = ['<w:pPr>']
  if (style) pPr.push(`<w:pStyle w:val="${style}"/>`)
  if (quote) pPr.push('<w:pStyle w:val="Quote9"/>')
  pPr.push('<w:bidi/>')
  if (bullet) pPr.push('<w:ind w:start="360"/>')
  pPr.push('</w:pPr>')
  const lead = bullet ? '<w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve">• </w:t></w:r>' : ''
  return `<w:p>${pPr.join('')}${lead}${runs(text)}</w:p>`
}
function table(rows) {
  const width = rows[0]?.length || 1
  const cell = (text, head) =>
    `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/>${head ? '<w:shd w:val="clear" w:fill="EEF1EE"/>' : ''}</w:tcPr>` +
    `<w:p><w:pPr><w:bidi/><w:spacing w:before="40" w:after="40"/></w:pPr>${runs(text, head ? '<w:b/><w:bCs/>' : '')}</w:p></w:tc>`
  const tr = (cells, head) => `<w:tr>${cells.map(c => cell(c, head)).join('')}</w:tr>`
  const borders = '<w:tblBorders>' + ['top','start','bottom','end','insideH','insideV']
    .map(s => `<w:${s} w:val="single" w:sz="4" w:color="C9D2CC"/>`).join('') + '</w:tblBorders>'
  return `<w:tbl><w:tblPr><w:bidiVisual/><w:tblW w:w="5000" w:type="pct"/>${borders}</w:tblPr>` +
    `<w:tblGrid>${'<w:gridCol/>'.repeat(width)}</w:tblGrid>` +
    tr(rows[0], true) + rows.slice(1).map(r => tr(r, false)).join('') + '</w:tbl>'
}

// ── Markdown (subset) → body XML ────────────────────────────────────────────
function mdToBody(md) {
  const lines = md.split(/\r?\n/)
  const out = []
  let i = 0
  const splitRow = (l) => l.replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim())
  while (i < lines.length) {
    const line = lines[i]
    if (/^\s*$/.test(line)) { i++; continue }
    if (/^---+\s*$/.test(line)) { i++; continue }
    const h = /^(#{1,3})\s+(.*)$/.exec(line)
    if (h) { out.push(para(h[2], { style: 'Heading' + h[1].length })); i++; continue }
    if (/^\|/.test(line) && /^\|?[\s:|-]+\|/.test(lines[i + 1] || '')) {
      const rows = [splitRow(line)]
      i += 2
      while (i < lines.length && /^\|/.test(lines[i])) { rows.push(splitRow(lines[i])); i++ }
      out.push(table(rows)); out.push('<w:p><w:pPr><w:bidi/></w:pPr></w:p>')
      continue
    }
    if (/^\s*[-*]\s+/.test(line)) { out.push(para(line.replace(/^\s*[-*]\s+/, ''), { bullet: true })); i++; continue }
    if (/^>\s?/.test(line)) {
      let q = line.replace(/^>\s?/, '')
      while (i + 1 < lines.length && /^>\s?/.test(lines[i + 1])) { i++; q += ' ' + lines[i].replace(/^>\s?/, '') }
      out.push(para(q, { quote: true })); i++; continue
    }
    // paragraph — join soft-wrapped lines
    let text = line
    while (i + 1 < lines.length && !/^\s*$/.test(lines[i + 1]) &&
           !/^(#{1,3})\s|^[-*]\s|^\||^>|^---+\s*$/.test(lines[i + 1])) { i++; text += ' ' + lines[i].trim() }
    out.push(para(text)); i++
  }
  return out.join('\n')
}

// ── parts ────────────────────────────────────────────────────────────────────
const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`
const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`
const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
const heading = (id, size, color) =>
  `<w:style w:type="paragraph" w:styleId="Heading${id}"><w:name w:val="heading ${id}"/><w:basedOn w:val="Normal"/>` +
  `<w:pPr><w:keepNext/><w:spacing w:before="${id === 1 ? 0 : 320}" w:after="120"/><w:outlineLvl w:val="${id - 1}"/><w:bidi/></w:pPr>` +
  `<w:rPr><w:b/><w:bCs/><w:color w:val="${color}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr>
<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Arial"/>
<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="he-IL" w:bidi="he-IL"/>
</w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:bidi/><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
${heading(1, 40, '0F5F54')}${heading(2, 30, '0F5F54')}${heading(3, 25, '1A2420')}
<w:style w:type="paragraph" w:styleId="Quote9"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/>
<w:pPr><w:bidi/><w:ind w:start="280"/><w:pBdr><w:start w:val="single" w:sz="18" w:color="0F5F54"/></w:pBdr></w:pPr>
<w:rPr><w:color w:val="4A5550"/></w:rPr></w:style>
</w:styles>`
const core = (title) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>${esc(title)}</dc:title><dc:language>he-IL</dc:language></cp:coreProperties>`
const document = (body) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
${body}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/><w:bidi/></w:sectPr>
</w:body></w:document>`

// ── main ─────────────────────────────────────────────────────────────────────
const [src, dst, title] = process.argv.slice(2)
if (!src || !dst) { console.error('usage: node md2docx.mjs <in.md> <out.docx> [title]'); process.exit(1) }
const body = mdToBody(readFileSync(src, 'utf8'))
const buf = zip([
  ['[Content_Types].xml', CONTENT_TYPES],
  ['_rels/.rels', RELS],
  ['docProps/core.xml', core(title || 'Report')],
  ['word/_rels/document.xml.rels', DOC_RELS],
  ['word/styles.xml', STYLES],
  ['word/document.xml', document(body)],
])
writeFileSync(dst, buf)
console.log(`written: ${dst} (${Math.round(buf.length / 1024)} KB)`)
