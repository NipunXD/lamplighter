// Records the pitch film: drives film/index.html (which embeds the live app) with Playwright, then muxes narration.
import { chromium } from 'playwright';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const API = 'http://127.0.0.1:8801', APP = 'http://localhost:5173', FILM = 'http://localhost:5180/index.html';
const RUN_A = process.env.RUN_A, RUN_B = process.env.RUN_B;
if (!RUN_A || !RUN_B) throw new Error('set RUN_A (finished 60-case run) and RUN_B (run paused at night)');
const FF = execFileSync('python3', ['-c', 'import imageio_ffmpeg as f; print(f.get_ffmpeg_exe())']).toString().trim();
const pads = { title: 4, problem: 4, town: 3, light: 20, drawer: 10, pay: 18, night: 3, review: 5, reliability: 2, close: 3 };
const dur = JSON.parse(fs.readFileSync('film/out/narration/durations.json', 'utf8'));
let t = 0; const timeline = dur.map((s) => { const d = Math.round((s.audio + pads[s.id]) * 10) / 10; const o = { id: s.id, start: t, dur: d, text: s.text }; t += d; return o; });
const total = t; const scene = (id) => timeline.find((s) => s.id === id);
console.log('timeline', timeline.map((s) => `${s.id}@${s.start.toFixed(1)}+${s.dur}`).join(' '), 'total', total.toFixed(1));

const evalJson = JSON.parse(fs.readFileSync('data/runtime/eval.json', 'utf8'));
const seeds = evalJson.rows.map((r) => ({ seed: r.seed, agent: r.agent.recoveredPaise, cron: r.cron.recoveredPaise }));
const rec = evalJson.summary.recoveredPaise;
const inr = (p) => '₹' + Math.round(p / 100).toLocaleString('en-IN');
const seedSummary = `Agent wins ${rec.wins} of 10 seeds · +${inr(rec.diffMean)} per batch on average · 95% CI ${inr(rec.ci[0])} to ${inr(rec.ci[1])}`;
const chaos = fs.existsSync('film/out/chaos.json') ? JSON.parse(fs.readFileSync('film/out/chaos.json', 'utf8')).lines : [];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, recordVideo: { dir: 'film/out/raw', size: { width: 1920, height: 1080 } } });
const ctxCreated = Date.now();
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('page error:', m.text().slice(0, 160)); });
await page.goto(FILM, { waitUntil: 'load' });
await page.evaluate((d) => { window.FILM.data = d; }, { seeds, seedSummary, chaos });
// preload the app (empty state) so the town scene cuts straight to a loaded page
await page.evaluate((u) => window.FILM.app(u), `${APP}/`);
await page.waitForTimeout(3500);
await page.evaluate(() => window.FILM.appOff());
await page.waitForTimeout(800);
const t0 = Date.now(); const lead = (t0 - ctxCreated) / 1000;
await page.evaluate((tl) => window.FILM.start(tl), timeline);
const until = async (id, off = 0) => { const target = t0 + (scene(id).start + off) * 1000; const w = target - Date.now(); if (w > 0) await page.waitForTimeout(w); };
const app = page.frameLocator('#app');
const cursorClick = async (loc) => { const b = await loc.boundingBox(); if (!b) return false; const x = b.x + b.width / 2, y = b.y + b.height / 2; await page.evaluate(([x, y]) => window.FILM.cursor(x, y, true), [x, y]); await page.waitForTimeout(750); await page.mouse.click(x, y); setTimeout(() => page.evaluate(() => window.FILM.hideCursor()).catch(() => {}), 1800); return true; };

// ---- light: start the live run
await until('town', 0.2); await page.evaluate(() => window.FILM.app());
await until('light', 2.5);
let runC = null;
try { await cursorClick(app.getByRole('button', { name: /Light the lamps/i })); } catch (e) { console.log('light click failed', e.message); }
await page.waitForTimeout(2500);
try { const runs = await (await fetch(`${API}/api/runs`)).json(); runC = runs.filter((r) => r.status === 'running').map((r) => r.id).pop() || null; } catch {}
console.log('run C', runC);

// ---- drawer: open a house that already has a message out and a pay page (ask the API, then click that house)
await until('drawer', 0.8);
let caseId = null;
const deadline = Date.now() + 12000;
while (runC && Date.now() < deadline) {
  try { const snap = await (await fetch(`${API}/api/runs/${runC}`)).json(); const cand = snap.cases.find((c) => c.status === 'awaiting_customer' && c.razorpay?.payUrl); if (cand) { caseId = cand.case.id; break; } } catch {}
  await page.waitForTimeout(1500);
}
let house = caseId ? app.locator(`[data-case="${caseId}"]`).first() : app.locator('.house.st-awaiting_customer, .house.st-scheduled, .house').first();
try { if (!caseId) caseId = await house.getAttribute('data-case'); await cursorClick(house); } catch (e) { console.log('house click failed', e.message); }
console.log('drawer case', caseId);
for (const off of [9, 16, 24]) { await until('drawer', off); await page.mouse.move(1550, 700); await page.mouse.wheel(0, 300); }

// ---- pay: open the pay page for that case, try the checkout, then return to the town
await until('pay', 0.3);
let payUrl = null;
try { if (runC && caseId) { const c = await (await fetch(`${API}/api/runs/${runC}/cases/${caseId}`)).json(); payUrl = c.state?.razorpay?.payUrl || null; } } catch {}
if (payUrl) { await page.evaluate((u) => window.FILM.app(u), payUrl.replace('localhost:8801', '127.0.0.1:8801')); }
await until('pay', 3.5);
if (payUrl) {
  try {
    await cursorClick(app.locator('#pay'));
    await page.waitForTimeout(3200);
    const rz = app.frameLocator('iframe.razorpay-checkout-frame');
    const nb = rz.getByText(/netbanking/i).first();
    await cursorClick(nb).catch(() => nb.click({ timeout: 4000 }));
    await page.waitForTimeout(1600);
    const popupP = ctx.waitForEvent('page', { timeout: 15000 });
    const bank = rz.getByText(/^Canara Bank$/).first();
    await cursorClick(bank).catch(() => bank.click({ timeout: 4000 }));
    const popup = await popupP; await popup.waitForLoadState('load').catch(() => {}); await popup.waitForTimeout(2500);
    await popup.locator('button:has-text("Success"), a:has-text("Success"), input[value*="Success" i]').first().click({ timeout: 6000 });
    console.log('checkout: Success clicked on the demo bank page');
    await page.evaluate(() => window.FILM.callout(640, 120, 'demo bank page (opens in a new window) → Success', 6000, 700));
  } catch (e) { console.log('checkout not automatable:', e.message.slice(0, 140)); }
}
await until('pay', scene('pay').dur - 5);
await page.evaluate((u) => window.FILM.app(u), `${APP}/?run=${runC || ''}`);

// ---- night / review / reliability
await until('night', 0); await page.evaluate((u) => window.FILM.app(u), `${APP}/?run=${RUN_B}`);
await until('review', 0); await page.evaluate((u) => window.FILM.app(u), `${APP}/?run=${RUN_A}&review=1`);
await until('reliability', 0); await page.evaluate(() => window.FILM.appOff());
await until('close', scene('close').dur + 0.5);
const video = page.video();
await ctx.close(); await browser.close();
const webm = await video.path();
console.log('raw video', webm, 'lead', lead.toFixed(2));

// ---- mux narration
const inputs = ['-ss', lead.toFixed(3), '-i', webm];
const filters = []; const labels = [];
timeline.forEach((s, i) => { inputs.push('-i', `film/out/narration/${s.id}.m4a`); const ms = Math.round((s.start + 0.4) * 1000); filters.push(`[${i + 1}]adelay=${ms}|${ms}[a${i}]`); labels.push(`[a${i}]`); });
filters.push(`${labels.join('')}amix=inputs=${timeline.length}:normalize=0:dropout_transition=0[mix]`);
const out = 'film/out/lamplighter-pitch.mp4';
execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', filters.join(';'), '-map', '0:v', '-map', '[mix]', '-t', String(total + 0.5), '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out], { stdio: 'inherit' });
fs.writeFileSync('film/out/timeline.json', JSON.stringify({ timeline, total, lead, runC }, null, 1));
console.log('film written', out);
