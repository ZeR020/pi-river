# Changelog

## [0.1.1] - 2026-11-03

- Added Nemotron's `medium` thinking level (Off / Medium / High; default on/high), matching River's updated reasoning-controls table.
- Updated maximum output limits from River's current model documentation: DeepSeek-V4.1-Flash and DeepSeek-V4.1-Flash-1017 to 393,216 tokens; Kimi-K3 and Nemotron to 1,048,575 tokens. Pi may still send a smaller output budget to reserve context headroom.
