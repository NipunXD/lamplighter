# Handoff — where things stand (2026-09-04, 23:10 IST)

## Shipped and committed
- Server: recovery engine, policy engine (+ overrides, quiet-hours/DND switches, human-in-the-loop actions), simulator, local-model diagnosis/plan/copy with validators and fallbacks, Razorpay test-mode Orders + hosted checkout + HMAC verify + capture, hash-chained audit log, headless batch runner with baseline and per-hour timelines, Express API with SSE. 25 vitest tests, CI workflow.
- Town UI: SVG village with day/night, lantern states, lamplighter, ledger, narrated journal, case drawer, offline mock (`?mock=1`), autostart (`?autostart=1`), screenshots in `docs/screenshots/`.
- Docs: README (with 120-case / 14-day numbers), ARCHITECTURE, POLICY, API, METRICS, PITCH (shot list), SUBMISSION (form text).

## Partial / not committed (untracked in the working tree)
- The Week-in-Review panel shipped in a compact form (`web/src/review/WeekInReview.tsx`: recovery-over-time vs cron with quiet-hour bands, by-kind and by-root-cause outcome bars, agent-vs-cron small multiples, diagnosis and reliability tiles). It opens from the ledger button, auto-opens when a run finishes, and with `?review=1`. The fuller spec (money-flow ribbons, hover tooltips, table views) is in `docs/REVIEW_BRIEF.md` and `web/review.html` is a preview entry for it.
- Four more features were specified and a multi-agent build was started then stopped to save budget: Policy Lab (what-if sliders, `server/whatif.ts` + `web/src/lab/`), Escalation Desk (`server/inbox.ts` + `web/src/inbox/`), Hinglish voice playback + lantern chime (`web/src/audio.ts`), multi-seed evaluation (`scripts/eval.ts` → `docs/EVAL.md`). The engine/server groundwork for all four is committed. Full specs live in the stopped workflow script:
  `~/.claude/projects/-Users-nipunarora-final-razorpay-buildathon/7bf63151-b02d-468a-be55-f677eb557c05/workflows/scripts/lamplighter-exceptional-wf_d02fc733-393.js`
  Resume with Claude Code: `Workflow({ scriptPath: <that path>, resumeFromRunId: "wf_d02fc733-393" })`.

## Run it
```bash
pnpm install
# .env already has the test keys and LLM settings (never commit it)
~/.lmstudio/bin/lms server start && ~/.lmstudio/bin/lms load qwen/qwen3-4b -y --identifier qwen3-4b --context-length 8192
PORT=8801 API_PORT=8801 pnpm dev      # 8787 is occupied by ~/razorpay (pid 2855) on this machine
```
Open http://localhost:5173 → Light the lamps. Pay a lantern: click a house → "checkout page" → Razorpay test netbanking → Success.

## Submit (deadline 2026-09-05)
1. ✅ Pushed: https://github.com/NipunXD/lamplighter (public, 25 commits, CI on every push).
2. The 5-minute video is already rendered from code: `film/out/lamplighter-pitch.mp4` (1920×1080, narrated). Watch it once, then upload it unlisted to YouTube (or Loom) and paste the link in the form. To re-render after changes, see `film/README.md`. If you prefer your own voice, `docs/PITCH.md` is the shot list.
3. Fill the form with `docs/SUBMISSION.md` text + repo URL + video URL: https://forms.gle/d9r2gvxp8cmoZhon9 (Track 3, one-shot).
4. Rotate the Razorpay test key after the buildathon; it was pasted in chat.
