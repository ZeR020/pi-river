# pi-river

[River.ai](https://river.ai) inference provider for [Pi](https://pi.dev). Discover account-accessible models and use Pi's normal model picker, thinking controls, streaming, tools, and usage accounting.

The extension uses River's public inference API at `https://api.river.ai/v1` and Pi's native `openai-completions` implementation. It adds no runtime dependencies beyond the host-provided Pi SDK.

## Requirements

- Pi 1.1.0 or newer; verified with Pi 1.3.0.
- A River API key with inference access.
- Git access to this repository. If access is restricted, authenticate Git before installing.

## Install

```bash
pi install git:github.com/ZeR020/pi-river
```

Restart Pi or run `/reload` after installation. SSH is also supported:

```bash
pi install git:git@github.com:ZeR020/pi-river
```

Review extension code before loading it: Pi extensions run inside the agent process.

## Authenticate and select a model

1. Run `/login river` and enter your River API key, or set `RIVER_API_KEY` before starting Pi.
2. Open `/model` and select a model under `river`.
3. Use `/thinking` to choose one of that model's supported settings.

Pi stores credentials entered through `/login`; stored credentials take precedence over the environment variable. Catalog requests require a resolved key and time out after five seconds. Inference requests send conversation content to River; use River's policies to assess data handling.

## Model discovery and metadata

**Model IDs are discovered automatically; specifications are not.** The extension fetches `GET /v1/models` and registers every valid returned ID. The endpoint currently returns only `id`, `object`, and `owned_by`, not capabilities, limits, reasoning controls, or prices.

A built-in metadata table supplies verified specifications for these exact IDs:

| Model ID | Context (input + output) | Maximum output | Thinking settings |
| --- | ---: | ---: | --- |
| `deepseek-ai/DeepSeek-V4.1-Flash` | 1,048,576 | 384,000 | Off / High / Max |
| `deepseek-ai/DeepSeek-V4.1-Flash-1017` | 1,048,576 | 384,000 | Off / High / Max |
| `zai-org/GLM-5.3-Flash` | 1,048,576 | 128,000 | Low / High / Max |
| `nvidia/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B-NVFP4` | 1,048,576 | 128,000 | Automatic only |

These models support text and image input. River documents GLM/Nemotron output as `128K`; the extension conservatively uses 128,000 tokens. Reasoning and the final answer share the output budget. DeepSeek Off sends `reasoning_effort: "none"`. Nemotron exposes one High slot in Pi, labeled automatic reasoning in the model name; it sends no effort parameter and does not offer an Off control.

- Metadata is not an availability allowlist: `/v1/models` alone determines membership.
- New, unverified IDs remain selectable, labeled `unverified metadata; estimated pricing`, with text-only input, no advertised thinking controls, and conservative 16,384 context / 4,096 output placeholders. These are not verified model limits.
- Verified models use River's published per-million-token prices, including separate cached-input rates. Unknown-model prices are estimates, not verified prices or upper bounds.
- Prices are maintained in source, not fetched automatically. River publishes current rates at its [public pricing endpoint](https://console.river.ai/api/public/pricing). Pi's cost display is an estimate, not an invoice.
- Adding complete support for a new release requires checking the official sources and updating its exact-ID metadata. See [Contributing](CONTRIBUTING.md#model-metadata-changes).

### Sources

- [Model capabilities and limits](https://docs.river.ai/guides/inference-models/)
- [Reasoning and API controls](https://docs.river.ai/guides/inference-controls/)
- [Current inference prices](https://console.river.ai/api/public/pricing)

## Offline use and caching

- `pi --offline` or `PI_OFFLINE=1` skips startup catalog networking; `true` and `yes` are also accepted environment values. This does not make remote inference available offline.
- Validated, deduplicated catalogs are persisted through Pi's model cache. Invalid responses and failed refreshes retain cached availability while reporting errors.
- A valid empty catalog (`data: []`) intentionally clears membership.
- Catalog errors do not log response bodies or credentials.

If a new model shows placeholder limits or no thinking controls, it was discovered without verified metadata. Updating the extension and running `/reload` loads metadata fixes; it cannot obtain missing specifications from the ID-only catalog.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for the source layout, sandbox test prerequisites, model-verification workflow, and pull-request expectations.

## Distribution and license

Git installation is supported. `private: true` in `package.json` prevents accidental npm publication; it does not control GitHub repository visibility or Git-based installation.

An open-source license has not been selected. Documentation is written for prospective public contributors, but source availability alone does not grant an open-source license. License selection and any public release remain separate maintainer decisions.
