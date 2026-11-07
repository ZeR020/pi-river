# Changelog

## [0.1.2] - 2026-11-07

- Added moonshotai/Kimi-K3.1-Pro from River's current documentation: 1,048,576 context, 1,048,575 maximum output, image input, and Off / Low / High / Max thinking levels (default Max; Off is a documented River extension). Priced at $2.00 input / $0.20 cached input / $10.00 output per million tokens.
- Kimi-K3 gains Low and High thinking levels (now Off / Low / High / Max), matching River's updated reasoning-controls table, which now agrees with the model author's guide.

## [0.1.1] - 2026-11-03

- Added Nemotron's `medium` thinking level (Off / Medium / High; default on/high), matching River's updated reasoning-controls table.
- Updated maximum output limits from River's current model documentation: DeepSeek-V4.1-Flash and DeepSeek-V4.1-Flash-1017 to 393,216 tokens; Kimi-K3 and Nemotron to 1,048,575 tokens. Pi may still send a smaller output budget to reserve context headroom.
- Removed the OpenAI SDK's `X-Stainless-*` platform headers (OS, architecture, runtime, retry counts) and the detailed OS/architecture user agent from all River requests; requests now identify only as `pi`. The extension itself never sends telemetry, analytics, or device fingerprints.
- Catalog now unions River's live model list with the extension's docs-verified models: River's `/v1/models` can omit models the API still serves for a key (verified 2026-11-03 — all five unlisted docs-listed models returned completions), so omissions no longer hide working models. Live-only new models still appear with unverified labeling; pinned models like `river/deepseek-ai/DeepSeek-V4.1-Flash-1017` and `river/GLM-5.3` select normally again.
