// Models hand back JSON wrapped in prose, code fences, trailing commas, or cut
// short. A greedy /\{[\s\S]*\}/ match turns any of that into a hard failure, so
// the braces are matched properly and the common damage is repaired.

function stripFences(text) {
  return String(text || '')
    .replace(/^\s*```(?:json|JSON)?\s*/m, '')
    .replace(/```\s*$/m, '')
    .trim();
}

function balancedSlice(text) {
  const s = String(text || '');
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null; // truncated
}

function repair(text) {
  return String(text || '')
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,\s*([}\]])/g, '$1');
}

/** Best effort: a parsed object, or null. Never throws. */
function parseLooseJson(text) {
  const cleaned = stripFences(text);
  const tries = [cleaned, balancedSlice(cleaned), repair(cleaned), repair(balancedSlice(cleaned) || '')];
  for (const t of tries) {
    if (!t) continue;
    try { return JSON.parse(t); } catch (e) { /* next */ }
  }
  return null;
}

module.exports = { parseLooseJson, balancedSlice, stripFences };
