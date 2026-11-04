// The end card: what a shop owner types in, and what gets printed.

const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeBrand, localNumber, brandCardFilters, ACCENT_DEFAULT } = require('../lib/brand');

test('a number is printed the way a local reads it', () => {
  assert.strictEqual(localNumber('233541821537'), '054 182 1537');
  assert.strictEqual(localNumber('0541821537'), '054 182 1537');
  assert.strictEqual(localNumber('541821537'), '541 821 537');
});

test('a brand kit needs a name and nothing else', () => {
  const b = normalizeBrand({ name: '  Al-Haqq Digital ' });
  assert.strictEqual(b.name, 'Al-Haqq Digital');
  assert.strictEqual(b.phone, '');
  assert.strictEqual(b.waLink, null);
  assert.strictEqual(b.accent, ACCENT_DEFAULT);
  assert.ok(b.seconds >= 1.5 && b.seconds <= 6, 'the card stays a beat, not an ad break');
  assert.strictEqual(normalizeBrand({}), null);
  assert.strictEqual(normalizeBrand(null), null);
  assert.strictEqual(normalizeBrand('Al-Haqq'), null, 'a bare string is not a kit');
});

test('a whatsapp number becomes a dialable link', () => {
  const b = normalizeBrand({ name: 'Al-Haqq Digital', whatsapp: '+233 54 182 1537' });
  assert.strictEqual(b.phone, '233541821537');
  assert.strictEqual(b.phoneDisplay, '054 182 1537');
  assert.strictEqual(b.waLink, 'wa.me/233541821537');
});

test('a number too short to dial is dropped, not printed', () => {
  const b = normalizeBrand({ name: 'Shop', whatsapp: '12345' });
  assert.strictEqual(b.phone, '');
  assert.strictEqual(b.phoneDisplay, '');
});

test('the accent falls back to gold when the hex is nonsense', () => {
  assert.strictEqual(normalizeBrand({ name: 'S', accent: 'gold' }).accent, ACCENT_DEFAULT);
  assert.strictEqual(normalizeBrand({ name: 'S', accent: '#0E2A2B' }).accent, '#0E2A2B');
});

test('the card filters blur the last frame and print name, rule and number', () => {
  const b = normalizeBrand({ name: "Al-Haqq Digital", whatsapp: '0541821537', tagline: 'Tech services  ·  Mobile money' });
  const f = brandCardFilters(b, 1080, 1920).join(',');
  assert.ok(/gblur=sigma=\d+/.test(f), 'the film frame is pushed back');
  assert.ok(f.includes('Al-Haqq Digital'), 'the shop is named');
  assert.ok(f.includes('WhatsApp 054 182 1537'), 'the line is dialable on screen');
  assert.ok(f.includes('drawbox'), 'the gold rule is drawn');
  assert.ok(f.includes('#D4AF37'), 'in the brand accent');
  assert.ok(f.includes('Mobile money'), 'the tagline rides along');
  const portrait = brandCardFilters(b, 1080, 1920).join(',');
  const landscape = brandCardFilters(b, 1280, 720).join(',');
  assert.notStrictEqual(portrait, landscape, 'sizes follow the frame');
});

test('an apostrophe does not break the ffmpeg filter', () => {
  const b = normalizeBrand({ name: "Rahim's Shop" });
  const f = brandCardFilters(b, 1080, 1920).join(',');
  assert.ok(!/text='Rahim's/.test(f), 'the quote is neutralised');
  assert.ok(f.includes('Rahim'));
});
