/**
 * inbound.test — pure helpers for the self-service email channel (Phase 7,
 * client issue #7). The endpoint and Worker do I/O; these are the parts worth
 * pinning down: address→alias mapping, attachment filtering, alias minting.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aliasFromAddress, isValidAlias, pickAttachments, genAlias, inboundAddress } from '../../functions/api/_lib/inbound.js'

test('aliasFromAddress lower-cases, strips the +tag and the domain', () => {
  assert.equal(aliasFromAddress('Moses-ab12@receipts-inbox.com'), 'moses-ab12')
  assert.equal(aliasFromAddress('inbox+anything@d.com'), 'inbox')
  assert.equal(aliasFromAddress('INBOX@D.COM'), 'inbox')
})

test('aliasFromAddress rejects malformed locals', () => {
  for (const bad of ['', null, 'has space@d.com', 'weird!char@d.com', '@d.com']) {
    assert.equal(aliasFromAddress(bad), '', String(bad))
  }
})

test('pickAttachments keeps only OCR-able types, normalized', () => {
  const out = pickAttachments([
    { filename: 'a.pdf', mimeType: 'application/pdf', contentBase64: 'AAAA' },
    { filename: 'b.jpg', contentType: 'image/jpeg; name=b', content: 'BBBB' },
    { filename: 'sig.txt', mimeType: 'text/plain', contentBase64: 'CCCC' },     // dropped
    { filename: 'cal.ics', mimeType: 'text/calendar', contentBase64: 'DDDD' },  // dropped
    { filename: 'empty.png', mimeType: 'image/png', contentBase64: '' },        // dropped (no bytes)
  ])
  assert.equal(out.length, 2)
  assert.deepEqual(out.map(a => a.mimeType), ['application/pdf', 'image/jpeg'])
})

test('pickAttachments drops oversized files', () => {
  const big = 'A'.repeat(15 * 1024 * 1024)   // ~11MB decoded, over the 10MB cap
  assert.equal(pickAttachments([{ filename: 'big.pdf', mimeType: 'application/pdf', contentBase64: big }]).length, 0)
})

test('genAlias yields a valid alias; Hebrew names fall back to inbox', () => {
  let n = 0
  const rand = () => ['abc123', 'def456'][n++]
  assert.equal(genAlias('Moses Cafe', rand), 'moses-cafe-abc123')
  assert.equal(genAlias('בית קפה השכונה', rand), 'inbox-def456')   // Hebrew slugs to nothing → inbox
  assert.ok(isValidAlias(genAlias('x', () => 'q1w2e3')))
})

test('inboundAddress joins alias and domain, empty when either is missing', () => {
  assert.equal(inboundAddress('moses-ab12', 'receipts-inbox.com'), 'moses-ab12@receipts-inbox.com')
  assert.equal(inboundAddress('moses-ab12', null), '')
  assert.equal(inboundAddress('', 'd.com'), '')
})
