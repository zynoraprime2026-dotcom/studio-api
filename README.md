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
5. Free tier works. Note: free tier sleeps after 15 min idle; first request wakes it (~30-60s).

## Notes

- Image generation uses Pollinations (free, no API key, no cost)
- Videos are stored in `/data` (container disk). On free Render tier, disk is ephemeral — download videos promptly or wire Supabase Storage later.
- Developer keys match the Ilm API signup pattern, but keys are per-service (studio_... vs ilm_...)
