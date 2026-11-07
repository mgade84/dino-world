"""Records <out>/<key>.mp3 for every entry in <out>/phrases.json; runs in the Dockerfile's voice stage.

Usage: generate.py <out dir> <cache dir>
Recordings are kept in the cache dir between builds, so only new or changed phrases are
recorded. Changing the voice or the settings below re-records everything.
"""
import hashlib
import io
import json
import shutil
import sys
import wave
from pathlib import Path

import lameenc
import numpy as np
from piper import PiperVoice, SynthesisConfig

MODEL = Path('/voices/da.onnx')
# A little slower than normal: the listeners are 4-10 years old.
CONFIG = SynthesisConfig(length_scale=1.12)
# Even out loudness between clips: RMS to -18 dBFS, peaks capped at -1.5 dBFS.
# No silence trimming: Piper adds almost none, and trimming clipped soft endings.
TARGET_RMS, PEAK = 10 ** (-18 / 20), 10 ** (-1.5 / 20)
BITRATE = 32  # kbit/s, mono


def to_mp3(text: str, voice: PiperVoice) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as w:
        voice.synthesize_wav(text, w, syn_config=CONFIG)
    buf.seek(0)
    with wave.open(buf, 'rb') as w:
        rate = w.getframerate()
        pcm = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    rms, peak = np.sqrt(np.mean(pcm ** 2)), np.max(np.abs(pcm))
    if rms > 0:
        pcm = pcm * min(TARGET_RMS / rms, PEAK / peak)
    enc = lameenc.Encoder()
    enc.set_bit_rate(BITRATE)
    enc.set_in_sample_rate(rate)
    enc.set_channels(1)
    enc.set_quality(2)
    return enc.encode((pcm * 32767).astype(np.int16).tobytes()) + enc.flush()


def main():
    out, cache = Path(sys.argv[1]), Path(sys.argv[2])
    phrases: dict[str, str] = json.loads((out / 'phrases.json').read_text())

    cache.mkdir(parents=True, exist_ok=True)
    stamp = json.dumps({'model': hashlib.sha256(MODEL.read_bytes()).hexdigest(), 'length_scale': CONFIG.length_scale,
                        'noise_scale': CONFIG.noise_scale, 'noise_w': CONFIG.noise_w_scale,
                        'rms': TARGET_RMS, 'peak': PEAK, 'bitrate': BITRATE})
    stamp_file = cache / 'settings.json'
    if not stamp_file.exists() or stamp_file.read_text() != stamp:
        for p in cache.glob('*.mp3'):
            p.unlink()
        stamp_file.write_text(stamp)

    todo = [k for k in phrases if not (cache / f'{k}.mp3').exists()]
    voice = PiperVoice.load(str(MODEL)) if todo else None
    for i, key in enumerate(todo, 1):
        (cache / f'{key}.mp3').write_bytes(to_mp3(phrases[key], voice))
        print(f'{i}/{len(todo)} {phrases[key]}', flush=True)

    for key in phrases:
        shutil.copyfile(cache / f'{key}.mp3', out / f'{key}.mp3')
    print(f'{len(todo)} recorded, {len(phrases) - len(todo)} from cache, {len(phrases)} total')


main()
