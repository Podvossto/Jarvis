"""Thai-English speech on this computer for Roamies: Wayu-Paxa-TTS-Edge behind VoiceStudio's local protocol.

Roamies already knows how to speak through the VoiceStudio app (sidecar/voicestudio.mjs): a health check, an engine
list, a voice list and a streaming socket, all on 127.0.0.1:3900. This server answers the same four calls with
Wayu-Paxa-TTS-Edge (82M parameters, 12 fixed voices, 24 kHz; CC BY-NC 4.0, non-commercial use only, by Wayu AI),
so picking "VoiceStudio" on the Speaking page gives a local Thai voice with no change to the app's voice code.

  GET /health            {"status": "ok" | "starting"}; 503 while the model loads
  GET /engines/tts       the one engine here
  GET /v1/audio/voices   the 12 voices, as saved profiles
  WS  /ws/tts            {"text", "voice"?} -> {"type":"start","sample_rate"} , 16-bit mono PCM, {"type":"done"}

Run it with the Python of the venv that has wayu-tts installed (see README.md):  python server.py [--port 3900]
Settings by environment: PAXA_VOICE (default voice), PAXA_SPEED (default 1.0), PAXA_DEVICE (cuda | cpu).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import threading
import time
from functools import lru_cache

# A saved Hugging Face token that has expired makes even public downloads fail: this model needs none.
os.environ.setdefault("HF_HUB_DISABLE_IMPLICIT_TOKEN", "1")

from aiohttp import WSMsgType, web  # noqa: E402

REPO = "wayu-ai/wayu-paxa-tts-edge"
VOICES = [
    ("m_young_clear", "Male, young, clear"), ("m_mid_warm", "Male, middle-aged, warm"),
    ("m_teen_bright", "Male, teen, bright"), ("m_elderly_deep", "Male, elderly, deep"),
    ("f_young_clear", "Female, young, clear"), ("f_young_warm", "Female, young, warm"),
    ("f_young_bright", "Female, young, bright"), ("f_teen_bright", "Female, teen, bright"),
    ("f_mid_clear", "Female, middle-aged, clear"), ("f_mid_warm", "Female, middle-aged, warm"),
    ("f_elderly_soft", "Female, elderly, soft"), ("f_elderly_low", "Female, elderly, low"),
]
VOICE_IDS = {v for v, _ in VOICES}
DEFAULT_VOICE = os.environ.get("PAXA_VOICE", "m_young_clear")
SPEED = float(os.environ.get("PAXA_SPEED", "1.0"))
# Every VoiceStudio response carries this header, and Roamies checks for it before trusting the port.
HEADERS = {"x-omnivoice-backend": "paxa-tts"}


def log(*a):
    print("[paxa]", *a, file=sys.stderr, flush=True)


class Engine:
    """The model, loaded once on its own thread; one sentence at a time (the model isn't thread-safe)."""

    def __init__(self):
        self.tts = None
        self.error = None
        self.device = None
        self.lock = threading.Lock()
        threading.Thread(target=self._load, daemon=True).start()

    def _load(self):
        t0 = time.time()
        try:
            import torch
            from wayu_tts import ThaiTTS

            want = os.environ.get("PAXA_DEVICE") or ("cuda" if torch.cuda.is_available() else "cpu")
            from huggingface_hub import snapshot_download

            try:
                # The copy already on disk when there is one: no network round trip at every start.
                source = snapshot_download(REPO, local_files_only=True)
            except Exception:
                source = snapshot_download(REPO)
            tts = ThaiTTS.from_pretrained(source, device=want)
            tts("สวัสดีครับ hello", voice=DEFAULT_VOICE if DEFAULT_VOICE in VOICE_IDS else VOICES[0][0])  # warm-up
            self.device = want
            self.tts = tts
            self._phonemes = lru_cache(maxsize=512)(lambda text: tuple(tts.phonemize(text)))
            log(f"ready in {time.time() - t0:.1f}s on {want}")
        except Exception as e:  # reported by /health and /engines/tts
            self.error = f"{type(e).__name__}: {e}"
            log("failed to load:", self.error)

    def speak(self, text: str, voice: str):
        """Yields 16-bit PCM, one piece per phrase the frontend splits the text into."""
        import numpy as np

        with self.lock:
            tts = self.tts
            speaker = tts.load_voice(voice)
            speed = SPEED * tts.config.voice_speed(speaker.name)
            t0 = time.time()
            phrases = self._phonemes(text)
            g2p = time.time() - t0
            total = 0
            for i, phonemes in enumerate(phrases):
                audio = tts._synthesize(phonemes, speaker, speed)
                if i == 0:
                    log(f"first audio after {time.time() - t0:.2f}s (g2p {g2p:.2f}s) for {len(text)} chars")
                total += len(audio)
                yield (np.clip(audio, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()
                if i + 1 < len(phrases):
                    yield b"\x00\x00" * int(0.12 * tts.sample_rate)
            log(f"{total / tts.sample_rate:.2f}s of audio in {time.time() - t0:.2f}s")


def make_app(engine: Engine) -> web.Application:
    def reply(data, status=200):
        return web.json_response(data, status=status, headers=HEADERS)

    async def health(_):
        if engine.error:
            return reply({"status": "error", "detail": engine.error}, 500)
        if not engine.tts:
            return reply({"status": "starting"}, 503)
        return reply({"status": "ok", "version": "paxa-tts-1", "device": engine.device})

    async def engines(_):
        return reply({"active": "paxa", "active_model": REPO, "backends": [{
            "id": "paxa", "display_name": "Wayu Paxa TTS Edge", "available": engine.tts is not None,
            **({"reason": engine.error or "still loading"} if engine.tts is None else {}),
        }]})

    async def voices(_):
        return reply({"voices": [{"voice_id": v, "name": n, "type": "profile"} for v, n in VOICES]})

    async def socket(request):
        ws = web.WebSocketResponse(max_msg_size=1 << 20)
        ws.headers.update(HEADERS)
        if not engine.tts:
            await ws.prepare(request)
            await ws.close(code=1008, message=b"starting")  # what VoiceStudio does until it's ready
            return ws
        await ws.prepare(request)
        loop = asyncio.get_running_loop()
        async for msg in ws:
            if msg.type != WSMsgType.TEXT:
                continue
            try:
                req = json.loads(msg.data)
                text = str(req.get("text") or "").strip()
                voice = req.get("voice") or DEFAULT_VOICE
            except Exception:
                await ws.send_json({"type": "error", "detail": "bad request"})
                continue
            if voice not in VOICE_IDS:
                await ws.send_json({"type": "error", "detail": f"voice not found: {voice}"})
                continue
            await ws.send_json({"type": "start", "sample_rate": engine.tts.sample_rate})
            try:
                if text:
                    pieces = engine.speak(text, voice)
                    while True:
                        # The socket closing (Roamies stopping the reply) ends the stream at the next phrase.
                        chunk = await loop.run_in_executor(None, next, pieces, None)
                        if chunk is None or ws.closed:
                            break
                        await ws.send_bytes(chunk)
                await ws.send_json({"type": "done"})
            except (ConnectionResetError, asyncio.CancelledError):
                break
            except Exception as e:
                log("speak failed:", e)
                if not ws.closed:
                    await ws.send_json({"type": "error", "detail": f"{type(e).__name__}: {e}"[:200]})
        return ws

    app = web.Application()
    app.add_routes([web.get("/health", health), web.get("/engines/tts", engines), web.get("/v1/audio/voices", voices), web.get("/ws/tts", socket)])
    return app


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=3900)
    args = ap.parse_args()
    # Loopback only: nothing off this computer can reach it.
    web.run_app(make_app(Engine()), host="127.0.0.1", port=args.port, print=lambda *_: log(f"listening on 127.0.0.1:{args.port}"))
