// A series dies the first time the hero's face changes between shots. One merged
// paragraph of "all characters" in every prompt is why: a lone hero shot still
// describes the boy standing next to him, and the next episode invents both again.
// A cast entry is one person, one description, reused verbatim wherever that person
// is on screen, and carried in the series bible so episode two starts from it.

function esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Names that actually speak or appear in a film, in first-seen order. */
function castNames(scenes) {
  const seen = [];
  for (const sc of Array.isArray(scenes) ? scenes : []) {
    const line = String((sc && sc.narrationText) || '');
    const m = line.match(/^\s*([^:\n]{2,40}):/);
    if (m) {
      const name = m[1].trim().replace(/[.,!?]+$/, '');
      if (name && name.split(/\s+/).length <= 4 && !seen.some((n) => n.toLowerCase() === name.toLowerCase())) seen.push(name);
    }
  }
  return seen;
}

function normalizeCast(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const c of list) {
    if (!c) continue;
    const name = String(c.name || c.character || '').trim().slice(0, 40);
    const description = String(c.description || c.look || c.visual || '').trim().replace(/\s+/g, ' ').slice(0, 220);
    if (!description) continue;
    if (name && out.some((x) => x.name.toLowerCase() === name.toLowerCase())) continue;
    out.push({ name, description });
  }
  return out.slice(0, 6);
}

function mentions(text, name) {
  if (!name) return false;
  return new RegExp('\\b' + esc(name) + '\\b', 'i').test(String(text || ''));
}

/**
 * Put each person's own description on the shots they are actually in, and only
 * those. A shot with nobody named falls back to a single-character cast, because
 * then there is no ambiguity about who is on screen.
 */
function applyCast(scenes, cast) {
  const list = normalizeCast(cast);
  if (!list.length) return Array.isArray(scenes) ? scenes : [];
  return (Array.isArray(scenes) ? scenes : []).map((sc) => {
    const prompt = String((sc && sc.visualPrompt) || '');
    if (!prompt) return sc;
    const where = prompt + ' ' + String((sc && sc.narrationText) || '');
    let present = list.filter((c) => c.name && mentions(where, c.name));
    if (!present.length) present = list.length === 1 ? list : list.filter((c) => !c.name);
    if (!present.length) return sc;
    const head = present.map((c) => c.description).join('; ');
    const already = present.every((c) => prompt.toLowerCase().includes(c.description.slice(0, 40).toLowerCase()));
    if (already) return sc;
    return { ...sc, visualPrompt: (head + ', ' + prompt).slice(0, 900) };
  });
}

/** The bible line that lets the next episode start from the same faces. */
function castToBible(cast) {
  const list = normalizeCast(cast);
  if (!list.length) return '';
  return 'CAST: ' + list.map((c) => (c.name ? c.name + ' — ' : '') + c.description).join(' | ');
}

function castFromBible(bible) {
  const m = String(bible || '').match(/CAST:\s*([^\n]+)/i);
  if (!m) return [];
  return normalizeCast(m[1].split('|').map((part) => {
    const p = part.split('—');
    return p.length > 1 ? { name: p[0], description: p.slice(1).join('—') } : { description: p[0] };
  }));
}

module.exports = { castNames, normalizeCast, applyCast, castToBible, castFromBible, mentions };
