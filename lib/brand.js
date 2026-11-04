// Brand kit: the shop's name, WhatsApp line and tagline, kept once and stamped
// onto the end of every film. A reel that ends on a stranger's logo is a reel
// that ends on nothing, so the card is part of the render, not an afterthought.

const ACCENT_DEFAULT = '#D4AF37'; // gold, the Al-Haqq tone
const CARD_SECONDS_DEFAULT = 2.6;

function digitsOnly(v) {
  return String(v == null ? '' : v).replace(/\D/g, '');
}

/** 233541821537 -> 054 182 1537, so the card reads like a local number. */
function localNumber(digits) {
  let d = String(digits || '');
  if (d.length === 12 && d.indexOf('233') === 0) d = '0' + d.slice(3);
  if (d.length === 10 && d[0] === '0') return d.slice(0, 3) + ' ' + d.slice(3, 6) + ' ' + d.slice(6);
  if (d.length === 9) return d.slice(0, 3) + ' ' + d.slice(3, 6) + ' ' + d.slice(6);
  return d;
}

/**
 * Accepts what a shop owner would type and returns one clean card definition,
 * or null when there is not even a business name to print.
 */
function normalizeBrand(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const name = String(input.name || input.businessName || input.business || '').trim().slice(0, 42);
  if (!name) return null;
  const digits = digitsOnly(input.whatsapp || input.phone || input.number || '');
  const phone = digits.length >= 9 ? digits : '';
  const tagline = String(input.tagline || input.footer || input.line || '').trim().slice(0, 90);
  const accent = /^#[0-9a-fA-F]{6}$/.test(String(input.accent || '')) ? String(input.accent) : ACCENT_DEFAULT;
  let seconds = Number(input.seconds);
  if (!isFinite(seconds) || seconds <= 0) seconds = CARD_SECONDS_DEFAULT;
  seconds = Math.min(6, Math.max(1.5, Math.round(seconds * 10) / 10));
  return {
    name,
    phone,
    phoneDisplay: phone ? localNumber(phone) : '',
    waLink: phone ? 'wa.me/' + phone : null,
    tagline,
    accent,
    seconds
  };
}

function escDrawtext(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, '\u2019')
    .replace(/%/g, '\\%')
    .replace(/[\r\n]+/g, ' ');
}

/**
 * The visual recipe for the card: the film's own last frame, pushed back into a
 * dark ground, with the name, a gold rule and the number on top.
 */
function brandCardFilters(brand, W, H) {
  const w = Math.round(W), h = Math.round(H);
  const nameSize = Math.max(28, Math.round(w / 14));
  const phoneSize = Math.max(24, Math.round(w / 21));
  const tagSize = Math.max(16, Math.round(w / 32));
  const ruleW = Math.round(w * 0.34);
  const accent = brand.accent || ACCENT_DEFAULT;

  const parts = [
    'scale=' + w + ':' + h + ':force_original_aspect_ratio=increase',
    'crop=' + w + ':' + h,
    'gblur=sigma=' + Math.max(8, Math.round(w / 45)),
    'eq=brightness=-0.30:saturation=0.55'
  ];

  const nameY = Math.round(h * 0.40);
  parts.push('drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf:text=\'' + escDrawtext(brand.name) +
    '\':fontcolor=white:fontsize=' + nameSize + ':x=(w-text_w)/2:y=' + nameY);

  const ruleY = nameY + Math.round(nameSize * 1.5);
  parts.push('drawbox=x=' + Math.round((w - ruleW) / 2) + ':y=' + ruleY + ':w=' + ruleW + ':h=' + Math.max(2, Math.round(h / 640)) +
    ':color=' + accent + '@0.95:t=fill');

  let y = ruleY + Math.round(h / 48);
  if (brand.phoneDisplay) {
    parts.push('drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text=\'' +
      escDrawtext('WhatsApp ' + brand.phoneDisplay) + '\':fontcolor=' + accent +
      ':fontsize=' + phoneSize + ':x=(w-text_w)/2:y=' + y);
    y += Math.round(phoneSize * 1.6);
  }
  if (brand.tagline) {
    parts.push('drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text=\'' + escDrawtext(brand.tagline) +
      '\':fontcolor=#EDEDED:fontsize=' + tagSize + ':x=(w-text_w)/2:y=' + y);
  }
  return parts;
}

module.exports = { ACCENT_DEFAULT, CARD_SECONDS_DEFAULT, normalizeBrand, localNumber, brandCardFilters, escDrawtext };
