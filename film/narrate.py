# Narration for the pitch film: Kokoro neural TTS, one m4a per scene plus durations.json.
# Usage: python3 film/narrate.py [voice] [speed]     e.g. python3 film/narrate.py af_heart 1.0
import json, os, subprocess, sys
import numpy as np, soundfile as sf
from kokoro_onnx import Kokoro

VOICE = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('FILM_VOICE', 'af_heart')
SPEED = float(sys.argv[2]) if len(sys.argv) > 2 else float(os.environ.get('FILM_SPEED', '1.0'))
OUT = 'film/out/narration'
os.makedirs(OUT, exist_ok=True)
ff = subprocess.run(['python3', '-c', 'import imageio_ffmpeg as f; print(f.get_ffmpeg_exe())'], capture_output=True, text=True).stdout.strip()
k = Kokoro(os.path.expanduser('~/.cache/kokoro/kokoro-v1.0.onnx'), os.path.expanduser('~/.cache/kokoro/voices-v1.0.bin'))
scenes = json.load(open('film/narration.json'))
total = 0.0
for s in scenes:
    # sentence by sentence, with a short breath between: closer to how a person reads a script
    parts, sr = [], 24000
    sentences = [x.strip() for x in s['text'].replace('. ', '.\n').split('\n') if x.strip()]
    for i, sent in enumerate(sentences):
        audio, sr = k.create(sent, voice=VOICE, speed=SPEED, lang='en-us')
        parts.append(audio)
        if i < len(sentences) - 1:
            parts.append(np.zeros(int(sr * 0.22), dtype=audio.dtype))
    audio = np.concatenate(parts)
    wav, m4a = f'{OUT}/{s["id"]}.wav', f'{OUT}/{s["id"]}.m4a'
    sf.write(wav, audio, sr)
    subprocess.run([ff, '-hide_banner', '-loglevel', 'error', '-y', '-i', wav,
                    '-af', 'highpass=f=70,acompressor=threshold=-18dB:ratio=3:attack=8:release=180,loudnorm=I=-16:TP=-1.5:LRA=11',
                    '-c:a', 'aac', '-b:a', '160k', m4a], check=True)
    dur = len(audio) / sr
    s['audio'] = round(dur, 2); s['voice'] = VOICE; total += dur
    print(f'{s["id"]:12} {dur:6.1f}s')
json.dump(scenes, open(f'{OUT}/durations.json', 'w'), indent=1)
print(f'narration total {total:.1f}s  voice={VOICE} speed={SPEED}')
