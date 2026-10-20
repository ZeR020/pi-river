# pi-river

River.ai provider for Pi. A single-file Pi extension that registers a `river` provider against `https://api.river.ai/v1` and reuses Pi's native `openai-completions` stream, so streaming, tools, usage parsing, cancellation, and request hooks stay native.

Model discovery is live: the extension fetches `GET /v1/models` and registers every account-accessible model ID. No static model catalog ships with the package; a small built-in metadata table only attaches pricing, context, output, and reasoning details to documented model IDs.

## Install (private repo)

```bash
pi install git:git@github.com:ZeR020/pi-river
```

This repository is private, so install requires authenticated Git/SSH access to `github.com:ZeR020/pi-river`. A repo-only read-only deploy key is the suggested setup for a VM. Authentication is a prerequisite you provide; this repo does not set it up.

After installing, restart sessions or run `/reload` to load the extension.

## Authentication

Set `RIVER_API_KEY` in the environment, or run `/login river` and enter your `rv_...` key (stored by Pi). Stored credentials take precedence over the environment. Catalog requests need a resolved key and time out after 5 seconds.

## Models

Model selection uses Pi's normal model picker under the `river` provider.

- Documented IDs (for example `deepseek-ai/DeepSeek-V4.1-Flash`, `deepseek-ai/DeepSeek-V4.1-Flash-1017`, `zai-org/GLM-5.3-Flash`, `nvidia/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B-NVFP4`) get River's documented pricing and context: 1,048,576 context; 384,000 output for DeepSeek, 128,000 for GLM and Nemotron. Reasoning controls: GLM Low/High/Max, DeepSeek Off/High/Max (Off sent as `none`), Nemotron automatic only (no effort parameter, always-on).
- Unknown IDs are still registered, labeled `unverified metadata; estimated pricing`, text-only, with conservative 16,384 context / 4,096 output placeholders.
- Metadata is not an allowlist; `/v1/models` alone decides which IDs exist.
- Discovery automates membership, not specifications: River's `/v1/models` currently returns only `id`, `object`, and `owned_by`. Limits/capabilities/effort settings need verified metadata updates; prices are published separately at https://console.river.ai/api/public/pricing and are not fetched by this extension. Unknown models are not assumed to share a family's specifications.

## Offline and caching

- `PI_OFFLINE=1` (also `true`/`yes`) skips the startup catalog fetch; Pi sets this for `pi --offline`.
- Validated, deduplicated catalogs are cached through Pi's model persistence. A failed network call, HTTP error, or invalid response rejects the refresh and keeps the cached catalog; a valid empty catalog (`data: []`) intentionally empties the cache.
- Cached models stay usable while refreshes fail. Response bodies and credentials are never logged.

## Requirements

- Pi 1.1.0 or newer. Tested against the installed host (check with `pi --version`; currently 1.3.0).
- No npm dependencies. The Pi SDK is a peer dependency supplied by the host.

## Testing

```bash
bash test.sh
```

Runs strict TypeScript checking followed by the full `node:test` suite inside a Bubblewrap sandbox. Requires existing tooling; it installs nothing:

- Node 24 and an installed Pi binary (source and installed packages mount read-only)
- Bubblewrap (`bwrap`)
- A TypeScript compiler at `~/.pi-lens/tools/node_modules/typescript`, or set `PI_RIVER_TYPESCRIPT_DIR` to an existing compiler

All credentials and HTTP responses in tests are fake. The strict check resolves SDK types from the installed Pi inside the active Node prefix; update the hardcoded Node v24 path in `tsconfig.json` if your runtime moves.

The package is marked `private: true` and is not published to npm.
