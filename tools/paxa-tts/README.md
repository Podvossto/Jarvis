# Local Thai voice (Wayu-Paxa-TTS-Edge)

A small server that gives Roamies a Thai-English voice running on this computer. It answers the same local
protocol as the VoiceStudio app, so in Roamies you pick **VoiceStudio** on the Speaking page and choose one of the
12 voices.

The voice model is [wayu-ai/wayu-paxa-tts-edge](https://huggingface.co/wayu-ai/wayu-paxa-tts-edge) by Wayu AI,
licensed **CC BY-NC 4.0: non-commercial use only**, with attribution. It is downloaded on first run (about 330 MB),
not shipped here.

## Set up (Windows)

Keep the Python environment outside OneDrive.

```bash
python -m venv %USERPROFILE%\.jarvis-tools\tts-venv
```

```bash
%USERPROFILE%\.jarvis-tools\tts-venv\Scripts\python -m pip install -r requirements.txt
```

For an NVIDIA card (much faster than the CPU), replace PyTorch with a CUDA build afterwards:

```bash
%USERPROFILE%\.jarvis-tools\tts-venv\Scripts\python -m pip install torch==2.11.0 --index-url https://download.pytorch.org/whl/cu128
```

## Run

```bash
%USERPROFILE%\.jarvis-tools\tts-venv\Scripts\python server.py
```

It listens on `127.0.0.1:3900` only. Settings by environment variable: `PAXA_VOICE` (default `m_young_clear`),
`PAXA_SPEED` (default `1.0`), `PAXA_DEVICE` (`cuda` or `cpu`; default: the graphics card when PyTorch can use it).

## Let Roamies start it

Add the command to `%USERPROFILE%\.gg\sidekick.json` (with Roamies closed), then pick VoiceStudio as the voice:

```json
"localTtsCommand": ["C:\\Users\\you\\.jarvis-tools\\tts-venv\\Scripts\\python.exe", "C:\\path\\to\\tools\\paxa-tts\\server.py"]
```

Roamies then starts the server when that voice is picked and nothing is answering, and stops it on quit. Its
output goes to `%USERPROFILE%\.gg\sidekick\logs\localtts.log`.
