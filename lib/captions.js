// Caption text: spoken lines are written as "Name: what they say" so the caster
// knows who talks, but on screen the name is noise.

function captionText(t) {
  return String(t || '').replace(/^\s*[A-Z][\w'\-]*(?:\s+[A-Z][\w'\-]*){0,2}\s*:\s*/, '').trim();
}

module.exports = { captionText };
