# Director mode: prompt -> shot list -> film

Spec for the two endpoints behind the studio's prompt box, plus the suggestion
loop. Written against the contracts in `server.js` as of commit `0f2790b`.

The point is not "type words, receive video". It is: the caller states an idea,
the service returns a **shot list a human can fix**, and only an approved shot
list is allowed to spend provider credits. Today `POST /v1/movie/create` will
happily take a bare `story` and render it sight unseen; on a free Render
instance that is a five minute wait and a real Replicate bill per attempt.

---

## 1. `POST /v1/movie/draft` — idea to shot list

Costs 1 use. Does **not** touch Replicate, Cloudflare or TTS. Never counted
against `MOVIE_DAILY_LIMIT` (that limit protects render capacity, and a draft
renders nothing); it has its own `MOVIE_DRAFT_DAILY_LIMIT`, default 30.

### Request

```json
{
  "prompt": "A boy in Mombasa finds an old brass compass that points at the truth",
  "style": "warm 35mm, dusty gold light, shallow depth of field",
  "language": "English",
  "aspectRatio": "16:9",
  "scenes": 5,
  "duration": 5,
  "character": "Zanj, a 12 year old boy, short cropped hair, faded green kanzu",
  "tone": "adventure"
}
```

`prompt` is the only required field, 1..2000 chars. `scenes` is clamped to
4..`MOVIE_MAX_SCENES` (12). `duration` is per scene, 3..10s, default 5.

### Response

```json
{
  "draft_id": "drf_7c9e...",
  "expires_at": "2026-11-06T09:00:00Z",
  "title": "The Compass of Zanj",
  "logline": "One sentence the poster can use.",
  "style_bible": "Village of pale coral rag, monsoon haze, brass instruments. Zanj wears a faded green kanzu in every shot.",
  "scenes": [
    {
      "id": "s1",
      "visualPrompt": "...",
      "narrationText": "...",
      "duration": 5,
      "shot": "wide establishing",
      "imagePrompt": "optional still prompt for a locked look",
      "image": null
    }
  ],
  "suggested": {
    "aspectRatio": "16:9",
    "narratorVoice": "en-GB-RyanNeural",
    "musicMood": "dramatic",
    "titleCard": true,
    "burnSubtitles": true,
    "crossfade": true,
    "continuity": "chained",
    "narrationRate": "+0%"
  },
  "notes": ["scene 4 narration runs long for a 5s shot"]
}
```

Same JSON-scene shape `POST /v1/movie/create` already accepts, so approval is a
pass-through: `create` takes `draft_id` **or** `scenes`.

### Implementation

Reuse `groqMovieScenes()` (same `GROQ_API_KEY`, same `openai/gpt-oss-120b`,
same no-top-level-system-param rule) with a second stage:

1. **Cast + bible.** One call: extract `title`, `logline`, `style_bible` and a
   character description that will be repeated verbatim inside every
   `visualPrompt`. This is what stops the drift between shots.
2. **Shots.** Existing scene call, but pass the bible and ask for `shot`
   (wide/medium/close) and a narration word budget derived from `duration`
   (about 2.4 words per second at `+0%`).
3. **Voice/music.** Reuse `movieDefaultVoice(language)` and pick `musicMood`
   from `MOVIE_MOODS` only.

Keep the existing sacred-figure rule verbatim in both prompts. Keep the
JSON-mode-then-plain-completion retry, and validate on the way out: 4..12
scenes, every scene has `visualPrompt`, narration under the word budget by more
than 30% goes into `notes` rather than being silently trimmed.

### Storage

New table, so `movies` stays a render log:

```sql
CREATE TABLE movie_drafts (
  id text PRIMARY KEY,
  api_key text NOT NULL,
  prompt text NOT NULL,
  draft jsonb NOT NULL,
  created_at timestamptz DEFAULT NOW()
);
```

Delete on a successful `create` that consumed it. Sweep anything older than
seven days in `resumeUnfinishedMovies()` (already runs at boot).

---

## 2. `POST /v1/movie/create` — accept the approved draft

Two additions only, everything else unchanged:

- `draft_id`: loads the draft, uses its `scenes`, `style_bible` as `style`, and
  `suggested` for any option the caller left out. A draft owned by another key
  is a 404, not a 403.
- `lockedLook: true`: download each scene's `image` and skip still generation
  entirely. Already supported per scene; this just says "all of them".

Unchanged: 3 creates/day/key, `MOVIE_DAILY_LIMIT`, per-scene `imageError`
survival, resume-safe `render` options, chained continuity.

---

## 3. `GET /v1/movie/:id/suggestions` — what to fix next

Free, rule-based, computed from the movie record and the files on disk. No LLM
unless `?llm=1` (then 1 use, and it may only reword the rule output).

| Signal (already recorded) | Condition | Suggestion | Action |
|---|---|---|---|
| `scenes[i].clipError` | non-null | "Scene i never animated: `<msg>`" | `re-shoot` |
| `scenes[i].imageError` | non-null | scene was dropped from the cut | `re-shoot` |
| `scenes[i].startsFrom` | `null` while `continuity === 'chained'` | shot did not inherit the previous frame | `re-shoot` |
| narration duration | over `scenes[i].duration` by >0.4s | "narration overruns the shot" | `narrationRate` down, or `duration` up |
| `musicNote`, `crossfadeError` | present | film shipped plainer than ordered | retry `assemble` |
| `status === 'partial'` | always | "N of M scenes made it" | `assemble` if clips exist, else `re-shoot` |

```json
{
  "movie_id": "mov_...",
  "status": "partial",
  "suggestions": [
    {
      "id": "sug_1",
      "kind": "re-shoot",
      "scene": 4,
      "severity": "high",
      "message": "Scene 4 has no clip (image failed: Cloudflare rejected /seed).",
      "action": { "method": "POST", "path": "/v1/movie/mov_.../re-shoot", "body": { "scene": 4 } }
    }
  ]
}
```

Every `action` must be a real endpoint. A suggestion the caller cannot act on
in one call is noise.

---

## 3a. `POST /v1/movie/:id/re-shoot { scene, visualPrompt?, narrationText? }`

Needed because every suggestion has to be one call away. Costs 1 use and one
provider clip; does not count as a new movie.

- Refuses unless `movie.scenes[scene-1]` exists and the movie is not
  `queued`/`scripting`/`processing`/`assembling` (same guard as `assemble`).
- Deletes `scene<N>.jpg`, `scene<N>.mp4`, `narr<N>.mp3` and the mirrored DB
  copies for that scene only, then runs the existing per-scene block: still
  (or `image` if locked), TTS, animation.
- `continuity === 'chained'` and `scene > 1`: reuse the last frame of the
  previous scene's clip as this shot's start, exactly like the pipeline does.
- Leaves `movie.status` alone. Assembly is a separate call, so a re-shoot never
  silently re-renders a film somebody is watching.

## 4. Front end (tasveer-studio)

1. Prompt box, style chips, aspect toggle.
2. Draft card: shot list rows with an editable `visualPrompt` and narration,
   plus `notes` shown as a warning strip.
3. **Render** is the only thing that spends; it is disabled until a draft
   exists.
4. Progress from `GET /v1/movie/:id` (`step` + `progress` already exist).
5. After the film: stills strip, suggestions as chips that call their `action`.

## 5. Deliberately out of scope

Series bible across episodes, 9:16 re-cut of a finished film, translation of
narration, per-shot model choice. All useful, none of them needed to make the
prompt box honest. Per-shot model choice in particular invites comparisons that
cost the user money for a difference they will not see.
