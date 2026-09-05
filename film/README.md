# The pitch film, generated from code

`film/` renders the 5-minute pitch video without a screen recorder or an editor:

- `index.html` + `film.js` — a 1920×1080 stage with title cards, an animated SVG problem board, captions, callouts, a synthetic cursor, and the live app embedded in an iframe.
- `narration.json` — the script, written to be spoken rather than read. `narrate.py` turns it into speech with [Kokoro](https://github.com/thewh1teagle/kokoro-onnx), a neural TTS that runs locally (voice `af_heart`), one sentence at a time with a short breath between, then compresses and loudness-normalises each scene and writes `film/out/narration/durations.json`. `record.mjs` reads those durations to build the timeline.
- `record.mjs` — drives the page with Playwright in your installed Chrome (`channel: 'chrome'`), records 1920×1080 video, starts a real run in the app, clicks a house, pays a lantern through Razorpay's test checkout (netbanking → demo bank → Success), switches to a run paused at night, then to a finished run's week-in-review, and finally muxes the narration with ffmpeg into `film/out/lamplighter-pitch.mp4`.
- `dryrun.mjs` — a 30-second pass with 3-second scenes and a screenshot per scene, for checking layout.

```bash
pnpm add -D playwright && npx playwright install ffmpeg      # Playwright uses the local Chrome; only its tiny ffmpeg helper downloads
python3 -m pip install imageio-ffmpeg kokoro-onnx soundfile  # ffmpeg for the mux, Kokoro for the voice
mkdir -p ~/.cache/kokoro && curl -L -o ~/.cache/kokoro/kokoro-v1.0.onnx https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
curl -L -o ~/.cache/kokoro/voices-v1.0.bin https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
python3 film/narrate.py af_heart 1.0                         # narration + durations.json
PORT=8801 pnpm start &  API_PORT=8801 pnpm dev:web &         # the app
(cd film && python3 -m http.server 5180 --bind 127.0.0.1) &  # the stage
RUN_A=<finished 60-case run id> RUN_B=<run id paused at night> node film/record.mjs
```

Runs A and B are created through the API before recording (`POST /api/runs`); B is paused with `POST /api/runs/:id/pause` once its simulated clock passes 21:00 IST so the quiet-hours scene shows a real night.
