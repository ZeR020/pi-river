# pi-river

Use [River.ai](https://river.ai) models in [Pi](https://pi.dev), including DeepSeek, GLM, Nemotron, Qwen, and Kimi. The extension adds River to Pi's model picker with model discovery, thinking controls, image input, tool calling, and token/cost tracking.

## Quick start

You need **Pi 1.1.0 or newer** and a **River inference API key** from the [River console](https://console.river.ai). The extension has been tested with Pi 1.4.0.

### 1. Install

Run this in your terminal:

```bash
pi install pi-river
```


To install the current development source instead of the published package, run `pi install git:github.com/ZeR020/pi-river`.
Then start Pi. If Pi is already running, enter `/reload` to load the extension.

### 2. Connect your River account

In Pi, enter:

```text
/login river
```

Paste your River API key when prompted. Pi saves it for future sessions.

Alternatively, set the `RIVER_API_KEY` environment variable before starting Pi. If both are configured, the saved key takes precedence.

### 3. Choose a model

Enter `/model`, search for `river`, and select a model. Enter `/thinking` to choose its reasoning setting. You can now use it for normal Pi conversations and coding tasks.

Requests use your River account and are billed by River. Your conversation content is sent to River when you use one of its models.

## Models and thinking settings

The extension has verified configuration for the following models. Context and output limits are in tokens; context includes both input and output.

| Model | Context | Maximum output | Thinking settings |
| --- | ---: | ---: | --- |
| DeepSeek-V4.1-Flash | 1,048,576 | 384,000 | Off / Low / High / Max |
| DeepSeek-V4.1-Flash-1017 | 1,048,576 | 384,000 | Off / Low / High / Max |
| GLM-5.3-Flash | 1,048,576 | 128,000 | Low / High / Max |
| GLM-5.3 | 1,048,576 | 128,000 | Low / High / Max |
| Nemotron-3.5-Super-VL-120B-A12B-NVFP4 | 1,048,576 | 128,000 | Off / High |
| Qwen3.8-27B-FP8 | 262,144 | 262,143 | Off / Low / Medium / XHigh |
| Kimi-K3 | 1,048,576 | 32,768 | Off / Max |

These models accept text and images, except the full GLM-5.3, which is text only. Reasoning tokens and the final answer share the output limit. River lists GLM and Nemotron output as `128K`; the extension conservatively uses 128,000.
Pi may send a smaller output budget to leave room for your input and its context safety margin.

GLM-5.3-Flash and the full GLM-5.3 cannot turn reasoning off. Every other listed model can, through its Off setting. River sets each model's default: maximum effort for GLM and Kimi, XHigh for Qwen, on for Nemotron, and off for DeepSeek.

Specifications are based on River's [model documentation](https://docs.river.ai/guides/inference-models/), [reasoning controls](https://docs.river.ai/guides/inference-controls/). Where River and a model author's guide differ (Kimi-K3), River's deployment table is used.

### What model discovery does

The extension fetches the models available to your River account, so newly released models can appear without adding their IDs by hand.

**Discovery does not automatically configure a new model's specifications.** River's model-list API returns IDs but no context limits, thinking settings, capabilities, or prices. Those details are verified and maintained in the extension separately.

An unrecognized model is labeled **unverified metadata; estimated pricing**. It uses text-only input, no selectable thinking controls, and placeholder limits of 16,384 context / 4,096 output tokens. These are conservative defaults, not the model's actual specifications. An extension update is needed to add verified support.

## Usage and costs

Pi tracks token usage and estimates cost using the extension's model pricing, including discounted cached input. Rates are maintained in the extension; they are not fetched automatically. Check [River's current prices](https://console.river.ai/api/public/pricing) for billing rates. Prices labeled estimated are placeholders, not guaranteed upper bounds; Pi's display is not an invoice.

## Troubleshooting

- **No River models appear:** check your API key with `/login river`, confirm it has inference access, and reopen `/model`. Catalog requests time out after five seconds.
- **A model has no thinking options or unexpectedly small limits:** check whether its name says `unverified`. Update the extension and run `/reload`; if it is still unverified, its specifications have not been added yet.
- **The model list cannot refresh:** cached models remain available after failed refreshes. `pi --offline` skips the startup model-list request, but River inference still needs an internet connection.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, tests, and how to add verified model support. The extension reuses Pi's built-in streaming and tool handling rather than maintaining a separate implementation.

## License

MIT © 2026 ZeR020 — see [LICENSE](LICENSE).
