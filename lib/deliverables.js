// The paperwork a film needs once it is shot.
//
// A rendered MP4 is not a deliverable. An editor wants the shot list, a
// distributor wants subtitles as SRT, a poster is needed for the listing, and
// the cast list has to match the voices actually used. All of it can be derived
// from the movie record, so none of these cost a model call.

const { speakerOf } = require('./voices');

/** Speakers that actually appear in the cut, with the shots they speak in. */
function castOf(scenes) {
  const seen = new Map();
  (Array.isArray(scenes) ? scenes : []).forEach((s, i) => {
    const text = s && (s.narration || s.narrationText);
    if (!text) return;
    const { speaker } = speakerOf(text);
    if (!speaker) return;
    const key = speaker.toLowerCase();
    const row = seen.get(key) || { speaker, lines: 0, shots: [] };
    row.lines += 1;
    row.shots.push(String((s && (s.id || s.shot_id)) || 's' + (i + 1)));
    seen.set(key, row);
  });
  return Array.from(seen.values());
}

/** WEBVTT -> SRT. The cue indexes are already in the VTT, only the comma differs. */
function vttToSrt(vtt) {
  const body = String(vtt || '')
    .replace(/\r/g, '')
    .replace(/^WEBVTT[^\n]*\n+/, '')
    .trim();
  if (!body) return '';
  return body.replace(/(\d{2}:\d{2}:\d{2})\.(\d{3})/g, '$1,$2') + '\n';
}

/** One row per shot: what is on screen, who speaks, and whether it rendered. */
function scriptRows(movie) {
  const scenes = Array.isArray(movie && movie.scenes) ? movie.scenes : [];
  return scenes.map((s, i) => {
    const { speaker, line } = speakerOf(s.narration || s.narrationText || '');
    const state = s.clipError ? 'clip failed' : (s.clipUrl ? 'shot' : 'still only');
    return {
      shot: i + 1,
      id: String(s.id || 's' + (i + 1)),
      framing: s.shot || '',
      seconds: s.duration || null,
      speaker: speaker || 'narrator',
      line: line || '',
      visualPrompt: s.visualPrompt || '',
      state
    };
  });
}

function csvCell(v) {
  const s = String(v === null || v === undefined ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function scriptCsv(movie) {
  const head = ['shot', 'id', 'framing', 'seconds', 'speaker', 'line', 'visualPrompt', 'state'];
  const rows = scriptRows(movie).map((r) => [r.shot, r.id, r.framing, r.seconds, r.speaker, r.line, r.visualPrompt, r.state]);
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

/** A reading script: title, cast, then each shot with its spoken line. */
function scriptMarkdown(movie) {
  const rows = scriptRows(movie);
  const cast = castOf(movie && movie.scenes);
  const out = [];
  out.push('# ' + String((movie && movie.title) || 'Untitled'));
  out.push('');
  const meta = [];
  if (movie && movie.language) meta.push('Language: ' + movie.language);
  if (movie && movie.aspect) meta.push('Frame: ' + movie.aspect);
  if (rows.length) meta.push('Shots: ' + rows.length);
  if (meta.length) { out.push('_' + meta.join(' · ') + '_'); out.push(''); }
  if (cast.length) {
    out.push('## Cast');
    cast.forEach((c) => out.push('- **' + c.speaker + '** — ' + c.lines + (c.lines === 1 ? ' line' : ' lines') + ' (shots ' + c.shots.join(', ') + ')'));
    out.push('');
  }
  out.push('## Shots');
  rows.forEach((r) => {
    out.push('**' + r.shot + '. ' + (r.framing || 'shot') + '** (' + (r.seconds || '?') + 's · ' + r.state + ')');
    if (r.state === 'shot' || r.state === 'still only') {
      out.push(r.speaker === 'narrator' ? r.line : '> ' + r.speaker.toUpperCase() + ': ' + r.line);
    }
    out.push('');
  });
  return out.join('\n').trim() + '\n';
}

/** One JSON that describes the whole delivery, so a client need not assemble it. */
function packageFor(movie, base, posterExists) {
  const rows = scriptRows(movie);
  const basePath = (base || '') + '/v1/movie/' + (movie && movie.id);
  return {
    id: movie && movie.id,
    title: movie && movie.title,
    status: movie && movie.status,
    language: (movie && movie.language) || null,
    aspectRatio: (movie && movie.aspect) || null,
    style: (movie && movie.style) || null,
    narratorVoice: (movie && movie.narratorVoice) || null,
    shots: rows.length,
    runtime: (movie && movie.duration) || null,
    cast: castOf(movie && movie.scenes),
    script: rows,
    deliverables: {
      video: basePath + '/file',
      subtitlesVtt: basePath + '/subtitles',
      subtitlesSrt: basePath + '/subtitles?format=srt',
      scriptMarkdown: basePath + '/script',
      scriptCsv: basePath + '/script?format=csv',
      poster: posterExists ? basePath + '/poster' : null,
      posterAction: posterExists ? null : 'POST ' + basePath + '/poster'
    }
  };
}

module.exports = { castOf, vttToSrt, scriptRows, scriptCsv, scriptMarkdown, packageFor };
