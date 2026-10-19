# Studio API

AI content creation service — image generation, video rendering (Ken Burns style MP4), and content scaffolding (shorts scripts, lessons, social posts). Companion to the Ilm API.

## Endpoints

| Method | Path | Auth | What it does |
|---|---|---|---|
| POST | /v1/developers/signup | none | `{email}` -> API key |
| GET | /v1/health | key | service status |
| POST | /v1/image/generate | key | `{prompt, width, height}` -> image URL (free provider) |
| POST | /v1/video/render | key | `{scenes:[{image?, text?, duration?}], width}` -> job id |
| GET | /v1/video/status/:id | key | render progress |
| GET | /v1/video/file/:id | key | download finished MP4 |
| POST | /v1/content/generate | key | `{type, topic}` -> shorts script / lesson outline / social posts |

All /v1 routes (except signup) need header: `x-api-key: <key>`

## Video example

1. `POST /v1/image/generate {"prompt":"sunrise over a mosque in West Africa","width":1080,"height":1920}` -> `{"url": "..."}`

2. `POST /v1/video/render {"scenes":[{"image":"<url>","text":"Assalamu alaikum","duration":4},{"image":"<url2>","text":"Point one","duration":5}]}` -> `{"job_id": "..."}`

3. Poll `GET /v1/video/status/:job_id` until `status: "done"`

4. Download `GET /v1/video/file/:job_id`

## Deploy (Render, Docker)

1. Push this repo to GitHub
2. Render -> New -> Web Service -> pick repo
3. Runtime: *Docker*
4. Environment variables (optional but recommended):
   - `DATABASE_URL` — your Supabase Postgres connection string (persists developer keys; without it, keys are memory-only and reset on restart)
   - `JWT_SECRET` — not used by this service; skip it
   - `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` — enables Cloudflare Workers AI image generation (recommended; Pollinations fallback is free but rate-limited and unreliable). Create the token at dash.cloudflare.com with the *Workers AI: Read* permission.
   - `CLOUDFLARE_IMAGE_MODEL` — optional; defaults to `@cf/black-forest-labs/flux-1-schnell`
   - `PUBLIC_BASE_URL` — public base URL of this service (recommended, e.g. https://studio-api-nqpm.onrender.com); used for image URLs when set
5. Free tier works. Note: free tier sleeps after 15 min idle; first request wakes it (~30-60s).

## Notes

- Image generation uses Pollinations (free, no API key, no cost)
- Videos are stored in `/data` (container disk). On free Render tier, disk is ephemeral — download videos promptly or wire Supabase Storage later.
- Developer keys match the Ilm API signup pattern, but keys are per-service (studio_... vs ilm_...)

## AI Movie orchestrator

`POST /v1/movie/create` chains the API's own capabilities into one pipeline:
script (Groq LLM) → scene images (Pollinations) → animation (real image-to-video
via Replicate/fal, with a Ken Burns fallback) → narration (edge-tts) → subtitles
(WebVTT, timed to narration) → ffmpeg assembly into one MP4 with a soft
subtitle track.

```json
{
  "title": "The Scribe of Timbuktu",
  "story": "A scribe protects ancient manuscripts...",
  "style": "warm golden hour, cinematic",
  "scenes": null,
  "narratorVoice": "en-US-GuyNeural",
  "language": "English",
  "aspectRatio": "9:16",
  "webhook": "https://example.com/movie-done"
}
```

| Field | Notes |
|---|---|
| `title` | required |
| `story` | required unless `scenes` is given; auto-split into scenes by the LLM |
| `scenes` | optional array of `{id?, visualPrompt?, narrationText?, image?}` — skips the script step |
| `style` | global visual style appended to every scene prompt |
| `narratorVoice` | edge-tts voice id (e.g. `ar-SA-HamedNeural`); derived from `language` if omitted |
| `language` | narration language for the LLM (and subtitle track tag) |
| `aspectRatio` | `9:16` (default, Shorts) or `16:9` |
| `musicMood` | `ambient` \| `nasheed` \| `dramatic` \| `calm` \| `upbeat` \| `none`; plays a bundled royalty-free bed from `assets/music/<mood>.mp3` (synthesized on first use — drop any royalty-free file with the same name to replace it), ducked under narration |
| `musicUrl` | optional; https audio file looped as a music bed, automatically ducked under narration (`musicVolume` 0.05-1, default 0.3). Overrides `musicMood` |
| `crossfade` | default `true`; 0.5s crossfades between scenes (video and audio), subtitle timings adjust automatically |
| `titleCard` | optional; adds a 2.5s opening card with the movie title |
| `burnSubtitles` | optional; burns captions into the picture for players that ignore soft subtitle tracks (WhatsApp). Latin scripts only — use soft subs + VTT for Arabic |
| `webhook` | optional; POSTs `movie.completed` / `movie.failed` with the final payload |

Responses: `202 {movie_id, status_url, ...}` — poll `GET /v1/movie/:id` until
`status: "done"`, then `GET /v1/movie/:id/file`. When done the poll returns
`{videoUrl, duration, scenes:[{id, imageUrl, clipUrl, narration, narrationUrl,
visualPrompt, clipSource, duration, contentGuard}]}`.

Other routes: `GET /v1/movie/status/:jobId` (spec-shaped job status:
`{jobId, state: queued|rendering|done|failed, progress: {currentScene,
totalScenes, step: script|images|animate|narration|subtitles|assembly}, videoUrl,
scenes, error}`), `GET /v1/movie/list`, `GET /v1/movie/:id/subtitles` (WebVTT),
`GET /v1/movie/:id/scenes/:idx/{image|clip|narration}` (per-scene assets,
preserved even if assembly fails — status becomes `partial` with the error),
`POST /v1/movie/script` (storyboard preview, 1 use — review/edit the LLM's
scenes before paying for the full 20-use render),
`POST /v1/movie/:id/assemble` (re-assemble a partial/failed/done movie from its
preserved assets with new options — music, title card, burned subs — no
regeneration, 1 use), `DELETE /v1/movie/:id` (frees the persistent disk), and
`POST /v1/movie/:id/dub` — re-narrate a finished movie in another language
(Arabic, French, Spanish, German, Swahili, English; 10 uses): narration is
translated by the LLM (or pass explicit `scenes:[{narrationText}]` lines to
skip it), re-spoken with a language-appropriate edge-tts voice, and re-assembled
with subtitles in the new language. Dubs reuse the source movie's scene clips
(no re-generation), keep its music bed, and appear as a new owned movie.
Dubs share the 3/day creation limit; `DUB_USAGE_COST` env (default 10)
controls the charge.

Durability: every generated asset (scene image, clip, narration, final.mp4,
subtitles.vtt) is mirrored into Postgres (`movie_assets` table, capped by
`MOVIE_ASSET_MAX_BYTES`, default 64MB/asset) and transparently restored to
disk on demand — GET /file, /subtitles, /scenes/:i/:asset, assembly retries
and boot resume all serve from the mirror after a restart, even without a
persistent disk (free tiers). Deleting a movie removes its mirrored assets.

Pipeline guarantees: movies render one at a time through a sequential background
worker (the rest queue); scene images retry 3 times (5s apart, honoring
Pollinations retry-after); a fixed character/setting block is extracted from the
story and prepended to every scene prompt with a matching fixed seed for visual
consistency; narration is capped at 120 words per scene and 12 scenes per movie;
job state persists to the database at every step and unfinished movies are
re-queued on boot (already-generated scene assets are reused, never
re-generated).

Rules:

- `x-api-key` required (401 otherwise); movies are owned by the creating key,
  other keys get a uniform 404
- the call counts as **20 uses** against the monthly free limit
- **3 movie creations per key per day** (429 over)
- scenes process in sequence; each step retries on failure (Pollinations
  rate-limit retry-after is honored, up to 4 tries)
- content guard: prompts depicting prophets, companions, angels, God or other
  sacred figures are refused and replaced with silhouette visuals
- if ffmpeg assembly fails, per-scene assets are kept and returned with the error

New optional env vars: `MOVIE_USAGE_COST` (default 20), `MOVIE_DAILY_LIMIT`
(default 3), `MOVIE_MAX_SCENES` (default 12). Reuses existing `GROQ_API_KEY`
(script step; not needed when `scenes` is supplied) and `REPLICATE_API_TOKEN` /
`FAL_KEY` (true-motion clips; without them the pipeline falls back to Ken Burns
motion rendered locally with ffmpeg).

Render notes: ffmpeg is already in the Docker image. Mount a **persistent disk
at `/data`** (the `WORK_DIR`) so finished movies and scene assets survive
deploys and restarts. Subtitles are muxed as a soft `mov_text` track (no libass
needed); the same subtitles are downloadable as WebVTT. Assembly uses
memory-lean encode flags and is safe on the free 512MB tier.
