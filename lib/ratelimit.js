'use strict';

// Sliding-window rate limiter used to brake unauthenticated key minting.
// In memory on purpose: this is an abuse brake, not a billing quota, so losing
// the counters on restart is acceptable.

function clientAddress(req) {
  const fwd = String((req && req.headers && req.headers['x-forwarded-for']) || '').split(',')[0].trim();
  return fwd || (req && req.ip) || 'unknown';
}

function createSlidingWindowLimiter(opts) {
  const options = opts || {};
  const limit = parseInt(options.limit) || 1;
  const windowMs = parseInt(options.windowMs) || 60000;
  const maxKeys = parseInt(options.maxKeys) || 5000;
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const hits = new Map();

  function prune(t) {
    for (const [key, stamps] of hits) {
      if (!stamps.some((ts) => t - ts < windowMs)) hits.delete(key);
    }
  }

  function isLimited(key) {
    const t = now();
    const recent = (hits.get(key) || []).filter((ts) => t - ts < windowMs);
    if (recent.length >= limit) {
      hits.set(key, recent);
      return true;
    }
    recent.push(t);
    hits.set(key, recent);
    if (hits.size > maxKeys) prune(t);
    return false;
  }

  function count(key) {
    const t = now();
    return (hits.get(key) || []).filter((ts) => t - ts < windowMs).length;
  }

  return { isLimited, count, size: () => hits.size, reset: () => hits.clear() };
}

module.exports = { clientAddress, createSlidingWindowLimiter };
