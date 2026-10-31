'use strict';

// Works out what the service can actually do right now. Providers fail down
// silently by design (Cloudflare -> Pollinations, Replicate/fal -> Ken Burns,
// missing DB -> memory), so this is the only way to verify a deploy without
// spending a paid generation call. Never include key values, only readiness.

function buildReadiness(cfg) {
  const c = cfg || {};
  const imageReady = !!c.imageReady;
  const replicateReady = !!c.replicateReady;
  const falReady = !!c.falReady;
  const llmReady = !!c.llmReady;
  const dbReady = !!c.dbReady;
  const publicBaseUrl = c.publicBaseUrl || null;

  const imageToVideo = [];
  if (replicateReady) imageToVideo.push('replicate');
  if (falReady) imageToVideo.push('fal');

  const degraded = [];
  if (!imageReady) degraded.push('image: Cloudflare Workers AI not configured, using the rate-limited Pollinations fallback');
  if (!imageToVideo.length) degraded.push('image_to_video: no Replicate/fal key, scene animation falls back to Ken Burns');
  if (!llmReady) degraded.push('llm: content generation and the movie orchestrator return 503');
  if (!dbReady) degraded.push('database: developer keys are memory-only and movie assets are not mirrored');
  if (!publicBaseUrl) degraded.push('public_base_url: media links are derived from the request host');

  const imageProvider = imageReady ? 'cloudflare' : (replicateReady ? 'replicate' : 'pollinations');
  return {
    image: imageProvider,
    image_fallback: imageReady && replicateReady ? 'replicate' : null,
    image_model: imageReady ? (c.imageModel || null) : null,
    image_to_video: imageToVideo,
    llm: llmReady,
    database: dbReady,
    public_base_url: publicBaseUrl,
    degraded,
  };
}

module.exports = { buildReadiness };
