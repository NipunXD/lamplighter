# The pitch film, generated from code

`film/` renders the 5-minute pitch video without a screen recorder or an editor:

- `index.html` + `film.js` — a 1920×1080 stage with title cards, an animated SVG problem board, captions, callouts, a synthetic cursor, and the live app embedded in an iframe.
- `narration.json` — the script. `record.mjs` turns it into speech with macOS `say` (voice Rishi, en-IN), measures each scene, and builds the timeline.
- `record.mjs` — drives the page with Playwright in your installed Chrome (`channel: 'chrome'`), records 1920×1080 video, starts a real run in the app, clicks a house, pays a lantern through Razorpay's test checkout (netbanking → demo bank → Success), switches to a run paused at night, then to a finished run's week-in-review, and finally muxes the narration with ffmpeg into `film/out/lamplighter-pitch.mp4`.
- `dryrun.mjs` — a 30-second pass with 3-second scenes and a screenshot per scene, for checking layout.

```bash
pnpm add -D playwright && npx playwright install ffmpeg      # Playwright uses the local Chrome; only its tiny ffmpeg helper downloads
python3 -m pip install imageio-ffmpeg                        # bundled ffmpeg binary for the final mux
PORT=8801 pnpm start &  API_PORT=8801 pnpm dev:web &         # the app
(cd film && python3 -m http.server 5180 --bind 127.0.0.1) &  # the stage
# narration (once): see the python block in the repo history or re-run `say` per scene into film/out/narration/<id>.aiff → .m4a, and write durations.json
RUN_A=<finished 60-case run id> RUN_B=<run id paused at night> node film/record.mjs
```

Runs A and B are created through the API before recording (`POST /api/runs`); B is paused with `POST /api/runs/:id/pause` once its simulated clock passes 21:00 IST so the quiet-hours scene shows a real night.
