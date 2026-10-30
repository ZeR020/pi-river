# Contributing

Bug reports and focused pull requests are welcome. Describe the problem you are solving, keep the change small, and include tests and documentation where behavior changes.

## Source layout

- `extensions/river.ts` — provider registration, API-key resolution, catalog validation/persistence, and exact-ID metadata. Streaming delegates to Pi rather than a custom adapter.
- `extensions/river.test.ts` — native Pi integration and request-payload regression tests with fake HTTP responses and credentials.
- `test.sh` — offline Bubblewrap test runner and strict TypeScript check.
- `tsconfig.json` — SDK/Node type resolution for the sandbox and local editor tooling.
- `package.json` — Pi extension manifest; the SDK is supplied by the host, not bundled.

## Development setup

Clone the repository into your own source checkout. Work there rather than patching a Pi-managed installation.

The test runner requires Linux (including WSL), Bash, Bubblewrap (`bwrap`), and Node 22.19 or newer. Install the development dependencies and run the suite:

```bash
npm ci
npm test
```

`npm test` resolves the Pi SDK and TypeScript compiler from `node_modules`; the runner installs nothing by itself. A globally installed Pi also works: `bash test.sh` uses the `pi` on your `PATH` and, without a local compiler, falls back to a compiler under `PI_RIVER_TYPESCRIPT_DIR` (a package directory containing `lib/tsc.js`) or `~/.pi-lens/tools/node_modules/typescript`.

The runner mounts source and installed packages read-only, hides the host home, clears the environment, and isolates networking and processes. Tests use fake credentials and responses; fixtures are written only inside the sandbox. No River account or live inference is needed. Running TypeScript directly outside the sandbox may require adjusting local SDK/type-resolution paths.

To try the source in Pi without registering a persistent installation:

```bash
pi -e ./extensions/river.ts
```

Use a separate test session and avoid loading another copy of this provider in the same session. Source loading normally contacts River's catalog when credentials are available; `PI_OFFLINE=1` suppresses that startup request. A live model prompt is billed inference, unlike the offline suite.

## Model metadata changes

1. Confirm the exact model ID in River's authenticated `/v1/models` catalog. Membership is dynamic; do not introduce a static availability list.
2. Check River's [model specifications](https://docs.river.ai/guides/inference-models/), [reasoning controls](https://docs.river.ai/guides/inference-controls/), and [inference prices](https://console.river.ai/api/public/pricing). If River's overview omits model-intrinsic controls, consult the exact model's official author guide/card; River's deployment limits and prices remain authoritative. Include source links in the change description. Never infer capabilities from a model-family substring or silently copy another provider's deployment limits.
3. Add a regression case that reproduces the incorrect limit, price, thinking choice, or outgoing request before changing metadata. Check both the selectable Pi levels and the actual `reasoning_effort` payload; a visible selector alone does not prove the control works.
4. Update the exact-ID metadata and relevant README information. Preserve unknown-model discovery and its explicit unverified/estimated labels.
5. Test cached fallback upgrades as well as fresh discovery. Run the complete offline suite, not only the new case.
6. If server acceptance is unclear, obtain explicit approval before using credentials or making billed smoke-test requests. Keep requests small and bounded. Report what was actually verified: a tiny successful request does not validate full context capacity or every tool/image variant.

Prices may be verified before capabilities or limits. Keep pricing-only models explicitly labeled unverified for capabilities/limits and retain their conservative defaults; do not mark their prices estimated. Documented or explicitly live-verified default reasoning without verified effort values uses the single automatic setting and sends no effort parameter.

Reasoning tokens share the output budget and count as output usage. Prices are USD per million tokens; cached input is charged at its own rate instead of the ordinary input rate. Do not represent unknown prices as free or as guaranteed upper bounds.

## Change and pull-request checklist

- Keep the single-file provider and reuse Pi's native streaming, tools, cancellation, usage parsing, and hooks. Avoid new dependencies or abstractions without a concrete need.
- Keep credentials, account data, session histories, local paths, and maintainer-only operational notes out of tracked source, fixtures, screenshots, and documentation.
- Use fake credentials in tests. Do not log authorization headers or raw provider response bodies in error paths.
- Run `bash test.sh` (with `PI_RIVER_TYPESCRIPT_DIR` if needed) and `git diff --check`; include the results and tested Pi/Node versions in the pull request.
- Describe the user-visible change, evidence, compatibility considerations, and anything not checked. Keep documentation consistent with behavior; do not describe ID-only discovery as automatic specification discovery.
- Do not change repository visibility, choose or replace a license, publish packages, or create releases as an incidental part of another change.

## Releases

Publishing is maintainer-only. Bump `version` in `package.json`, commit, and tag `v<version>` (for example `v0.1.0`) on `main`. Pushing the tag runs the release workflow: it re-runs the offline suite, verifies the tag matches `package.json`, publishes to npm with provenance using the `NPM_TOKEN` repository secret, and finally creates the GitHub Release with generated notes. The tag stays the trigger so a failed publish never leaves a dangling public Release.

The token is a granular npm access token (publish permission, 2FA bypass enabled) and expires after at most 90 days; rotate it in npm account settings and update the repository secret before expiry. The very first release may instead be published manually with `npm publish` after `npm login`; subsequent releases use the workflow.

## Reporting problems

For ordinary bugs, provide the Pi/Node versions, exact River model ID, selected thinking setting, expected behavior, and a minimal reproduction. Remove credentials and conversation/account data from any logs.

Do not put secrets or vulnerability details in public issues. Use a private reporting channel agreed with the maintainer before sharing sensitive evidence. If a key was exposed, revoke it through River; deleting a comment or commit does not invalidate the key.
