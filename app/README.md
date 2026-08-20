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

### The model weights are not deployed

`src/separation/model.ts` fetches the weights from `/model/ggml-model-htdemucs-4s-f16.bin`
on the deploy origin. That file is ~80 MB, gitignored, and over Cloudflare's
25 MiB per-asset limit — it will never ship in `dist`. Serving it needs a
separate host (R2 bucket, or the upstream Hugging Face copy) and `MODEL_URL`
pointed at it; until then a deployed build reaches the download popup and
fails there.
