import { chromium } from 'playwright';
import fs from 'node:fs';
const APP = 'http://localhost:5173', FILM = 'http://localhost:5180/index.html';
const dur = JSON.parse(fs.readFileSync('film/out/narration/durations.json', 'utf8'));
let t = 0; const timeline = dur.map((s) => { const o = { id: s.id, start: t, dur: 3, text: s.text }; t += 3; return o; });
const evalJson = JSON.parse(fs.readFileSync('data/runtime/eval.json', 'utf8'));
const seeds = evalJson.rows.map((r) => ({ seed: r.seed, agent: r.agent.recoveredPaise, cron: r.cron.recoveredPaise }));
const chaos = JSON.parse(fs.readFileSync('film/out/chaos.json', 'utf8')).lines;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message)); page.on('console', (m) => { if (m.type() === 'error') console.log('console error', m.text().slice(0, 120)); });
await page.goto(FILM); await page.waitForTimeout(1500);
await page.evaluate((d) => { window.FILM.data = d; }, { seeds, seedSummary: 'Agent wins 10 of 10 seeds', chaos });
await page.evaluate((u) => window.FILM.app(u), `${APP}/`); await page.waitForTimeout(2500); await page.evaluate(() => window.FILM.appOff());
await page.evaluate((tl) => window.FILM.start(tl), timeline);
fs.mkdirSync('film/out/dry', { recursive: true });
for (const s of timeline) { await page.waitForTimeout(2400); await page.screenshot({ path: `film/out/dry/${s.id}.png` }); await page.waitForTimeout(600); }
await browser.close(); console.log('dry run done');
