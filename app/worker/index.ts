/**
 * Everything but the model weights is a static asset, served by the asset
 * router without ever invoking this Worker (`run_worker_first` in
 * wrangler.jsonc scopes us to /model/*). The weights are the exception: at
 * ~80 MB they're an order of magnitude over Cloudflare's 25 MiB per-asset
 * limit, so they live in R2 and are proxied here.
 *
 * Proxying rather than pointing MODEL_URL at a public bucket URL keeps the
 * fetch same-origin — no CORS preflight, and no dependence on the r2.dev
 * subdomain, which Cloudflare rate-limits and doesn't intend for production.
 */

const MODEL_PREFIX = '/model/';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(MODEL_PREFIX)) {
      return env.ASSETS.fetch(request);
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
    }

    const key = url.pathname.slice(MODEL_PREFIX.length);
    const object = await env.MODEL_BUCKET.get(key, { onlyIf: request.headers });
    if (object === null) {
      return new Response('Not Found', { status: 404 });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    // The client pins these bytes by SHA-256 (separation/model.ts), so the
    // name can never come to mean different bytes — a new model ships under
    // a new key, and this one is safe to cache forever.
    headers.set('cache-control', 'public, max-age=31536000, immutable');

    // R2 returns a bodyless R2Object when the request's preconditions fail.
    if (!('body' in object)) {
      return new Response(null, { status: 304, headers });
    }

    // Set explicitly so the download's truncation check has a total to
    // compare against, and so the progress bar isn't indeterminate.
    headers.set('content-length', String(object.size));
    return new Response(request.method === 'HEAD' ? null : object.body, { headers });
  },
} satisfies ExportedHandler<Env>;
