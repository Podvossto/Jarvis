# Third-party notices

Roamies is licensed under [AGPL-3.0](LICENSE). It builds on the components below, each under its own license.

| Component | How it's used | License |
| --------- | ------------- | ------- |
| [Tauri](https://tauri.app) 2 (`tauri`, `tauri-build`) and plugins `tauri-plugin-single-instance`, `tauri-plugin-updater` | desktop shell, see `showcase/tauri/src-tauri/Cargo.toml` | MIT OR Apache-2.0 |
| [Node.js](https://nodejs.org) v24.22.2 | bundled runtime for the sidecar (version in `showcase/tauri/sidecar/fetch-node.sh`) | MIT |
| [@kenkaiiii/gg-agent](https://github.com/KenKaiii/gg-framework), gg-ai, gg-core 5.95.0 | agent framework in the sidecar | AGPL-3.0-only |
| [zod](https://zod.dev) 4.6.7 | schema validation in the sidecar | MIT |
| [@anthropic-ai/claude-agent-sdk](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) 0.3.318 | Claude sign-in support in the sidecar | Proprietary: "© Anthropic PBC. All rights reserved. Use is subject to the Legal Agreements outlined here: https://code.claude.com/docs/en/legal-and-compliance." (not open source) |
| Claude Code | downloaded at sign-in with Claude, not bundled | Anthropic's terms |
| [Doto](https://github.com/oliverlalan/Doto) and [Martian Mono](https://github.com/evilmartians/mono) fonts | text in the app | SIL Open Font License 1.1, texts in `showcase/onboarding/fonts/` |
| [Natural Earth](https://www.naturalearthdata.com) 1:110m countries | country outlines for map cards (`showcase/roamies/world.js`) and their names (`showcase/tauri/sidecar/countries.mjs`) | Public domain |
| [MapLibre GL JS](https://maplibre.org) 5.24.1 | draws road-map cards in the overlay; a sidecar devDependency that `showcase/tauri/build.sh` copies into the app with its licence text (`roamies/vendor/maplibre-gl.LICENSE.txt`) | BSD-3-Clause |
| [OpenFreeMap](https://openfreemap.org) vector tiles, style, fonts and icons ([OpenMapTiles](https://openmaptiles.org) schema, [OpenStreetMap](https://www.openstreetmap.org/copyright) data) | road-map cards, loaded from tiles.openfreemap.org when one is shown, not bundled; credited on every road map | Map data © OpenStreetMap contributors, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/); © OpenMapTiles ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) design); OpenFreeMap's terms |
| [geoBoundaries](https://www.geoboundaries.org) gbOpen THA ADM1 (OpenStreetMap, Wambacher), simplified | Thai province outlines and names for road-map cards (`showcase/tauri/sidecar/provinces.mjs`, a derived database) | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/), © OpenStreetMap contributors; credited on the card when a province is shaded |
| [Nominatim](https://nominatim.org) (nominatim.openstreetmap.org) | looks up place names for road-map cards, one request a second at most, each answer kept; not bundled | [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/); data © OpenStreetMap contributors, ODbL 1.0 |
| [NVIDIA Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3), [ONNX export by istupakov](https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx) | Windows speech model, downloaded at setup, not bundled | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| [parakeet-rs](https://github.com/altunenes/parakeet-rs) 0.4.3 | runs the speech model in the Windows voice helper | MIT OR Apache-2.0 |
| [Typhoon ASR Real-time](https://huggingface.co/typhoon-ai/typhoon-asr-realtime) by SCB 10X, [ONNX export by wannaphong](https://huggingface.co/wannaphong/typhoon-asr-realtime-onnx) | Thai speech model on Windows and Linux, downloaded when Thai is picked, not bundled | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| [openWakeWord](https://github.com/dscripka/openWakeWord) pretrained models (melspectrogram, embedding, hey_jarvis v0.1) | the "Hey Jarvis" wake word on Windows, downloaded when it's turned on, not bundled | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/): non-commercial use only |
| [Wayu-Paxa-TTS-Edge](https://huggingface.co/wayu-ai/wayu-paxa-tts-edge) by Wayu AI | optional local Thai voice (`tools/paxa-tts`), downloaded by that server, not bundled | [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/): non-commercial use only |

## Full dependency list

These are the main components. To see every dependency, including indirect ones:

```bash
cd showcase/tauri/sidecar && npm ls --all
cd showcase/tauri/src-tauri && cargo tree
cd showcase/tauri/src-tauri/voice-win && cargo tree
```
