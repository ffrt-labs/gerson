# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

## Deploying to Cloudflare

The app deploys as an assets-only Worker (`wrangler.jsonc`), served from
`app/dist`. `not_found_handling: "single-page-application"` hands unknown
paths to `index.html` so react-router deep links and reloads resolve.

Cloudflare build settings:

| Setting | Value |
| --- | --- |
| Root directory | `app` |
| Build command | `pnpm install --frozen-lockfile && pnpm build` |
| Deploy command | `npx wrangler deploy` |

Build variables:

| Variable | Value |
| --- | --- |
| `PNPM_VERSION` | `10.33.0` |
| `NODE_VERSION` | `22` |

`PNPM_VERSION` is not optional. The build image ships an older pnpm that
rejects `pnpm-workspace.yaml` outright ("packages field missing or empty")
and cannot read the v9 lockfile.

### The model weights live in R2

`src/separation/model.ts` fetches the weights from `/model/ggml-model-htdemucs-4s-f16.bin`.
That file is ~80 MB — well over Cloudflare's 25 MiB per-asset limit, so it can
never ship in `dist`. It lives in an R2 bucket instead, proxied by
`worker/index.ts` so the fetch stays same-origin and no CORS is involved.
`run_worker_first` in `wrangler.jsonc` is what stops the SPA fallback from
answering `/model/*` with `index.html`.

R2's free tier covers this: 10 GB-month of storage, 10 million Class B (read)
operations, and no egress charges. One 80 MB object and one GET per user's
first separation is not close to any of those. Cloudflare does require a
payment method on the account before R2 can be enabled.

One-time setup, from `app/`:

```sh
# The bucket name must match r2_buckets[0].bucket_name in wrangler.jsonc.
npx wrangler r2 bucket create gerson-model

# See wasm/README.md, "Producing the model weights", for where this comes
# from and how to verify its SHA-256 before uploading.
npx wrangler r2 object put \
  gerson-model/ggml-model-htdemucs-4s-f16.bin \
  --file public/model/ggml-model-htdemucs-4s-f16.bin \
  --content-type application/octet-stream \
  --remote
```

The client verifies the SHA-256 of whatever it downloads against
`wasm/dist/model-sha256.ts` before committing it to OPFS, so a wrong or
truncated upload surfaces as a hash-mismatch error rather than a broken
separation.

### Regenerating binding types

`worker-configuration.d.ts` is generated from `wrangler.jsonc` and committed so
CI can typecheck without running wrangler. After changing bindings, run
`pnpm cf-typegen`.
