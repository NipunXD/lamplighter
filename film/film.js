// Scene engine for the Lamplighter pitch film. Driven by record.mjs: FILM.data, then FILM.start(timeline).
const $ = (s) => document.querySelector(s);
const FILM = { timers: [], data: { seeds: [], chaos: [] } };
window.FILM = FILM;
const at = (ms, fn) => FILM.timers.push(setTimeout(fn, Math.max(0, ms)));
const fmt = (p) => '₹' + Math.round(p / 100).toLocaleString('en-IN');

FILM.cursor = (x, y, click) => {
  const c = $('#cursor'); c.style.transform = `translate(${x - 4}px, ${y - 4}px)`;
  if (click) setTimeout(() => { c.classList.add('click'); const r = $('#ring'); r.style.left = x + 'px'; r.style.top = y + 'px'; r.classList.remove('go'); void r.offsetWidth; r.classList.add('go'); setTimeout(() => c.classList.remove('click'), 400); }, 620);
};
FILM.hideCursor = () => { $('#cursor').style.transform = 'translate(-200px,-200px)'; };
FILM.app = (src) => { const f = $('#app'); if (src !== undefined && f.getAttribute('src') !== src) f.src = src; f.classList.add('on'); };
FILM.appOff = () => $('#app').classList.remove('on');
FILM.scene = (id) => document.querySelectorAll('.scene').forEach((s) => s.classList.toggle('on', !!id && s.id === 's-' + id));
FILM.callout = (x, y, text, ms, w) => {
  const el = document.createElement('div'); el.className = 'callout'; el.style.left = x + 'px'; el.style.top = y + 'px'; if (w) el.style.maxWidth = w + 'px'; el.textContent = text;
  $('#callouts').appendChild(el); requestAnimationFrame(() => el.classList.add('on'));
  setTimeout(() => { el.classList.remove('on'); setTimeout(() => el.remove(), 600); }, ms);
};
const captionText = (t) => t.replace(/A\.I\./g, 'AI').replace(/U\.P\.I\./g, 'UPI').replace(/H\.M\.A\.C\./g, 'HMAC').replace(/D\.N\.D\./g, 'DND').replace(/U thirty, debit has been failed/g, 'U30: DEBIT HAS BEEN FAILED').replace(/nine a\.m\./g, '09:00').replace(/Saanjh and Co\./g, 'Saanjh & Co').replace(/a cafe's/g, 'a café\u2019s');
FILM.caption = (raw, durMs) => {
  const text = captionText(raw);
  const box = $('#caption'); const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const total = sentences.reduce((a, s) => a + s.length, 0);
  box.innerHTML = sentences.map((s) => `<span class="next">${s.trim()} </span>`).join('');
  box.classList.add('on');
  const spans = [...box.querySelectorAll('span')];
  let acc = 0;
  sentences.forEach((s, i) => { const startMs = (acc / total) * (durMs - 1200); acc += s.length; at(startMs, () => spans[i].classList.replace('next', 'said')); });
  // keep at most two sentences visible around the current one
  sentences.forEach((s, i) => { const startMs = (acc = 0, sentences.slice(0, i).reduce((a, x) => a + x.length, 0) / total) * (durMs - 1200); at(startMs, () => spans.forEach((sp, j) => { sp.style.display = j >= i - 1 && j <= i + 1 ? '' : 'none'; })); });
  at(durMs - 300, () => box.classList.remove('on'));
};

const SCENES = {
  title(d) {
    FILM.scene('title'); FILM.appOff();
    at(300, () => { $('#lglow').setAttribute('opacity', '1'); $('#lflame').setAttribute('opacity', '1'); $('#lglass').setAttribute('fill', '#ffd27a'); });
    at(900, () => $('#t-word').classList.add('in')); at(1900, () => $('#t-sub').classList.add('in')); at(2800, () => $('#t-chips').classList.add('in'));
  },
  problem(d) {
    FILM.scene('problem');
    const cards = [
      { i: '📱', t: 'UPI timed out', c: 'BAD_REQUEST_ERROR · payment_timed_out\nU69: COLLECT EXPIRED', a: '₹1,299' },
      { i: '💳', t: 'Card hit its limit', c: 'BAD_REQUEST_ERROR · payment_failed\n61: EXCEEDS WITHDRAWAL AMOUNT LIMIT', a: '₹3,490' },
      { i: '🏦', t: 'Bank was down', c: 'GATEWAY_ERROR · gateway_technical_error\n91: ISSUER OR SWITCH INOPERATIVE', a: '₹899' },
      { i: '🔁', t: 'AutoPay paused', c: 'BAD_REQUEST_ERROR · mandate_paused\nUPI AutoPay paused by the customer', a: '₹999 / month' },
      { i: '🧾', t: 'Invoice overdue', c: 'Wholesale · 24× Dusk Candle Trio\n41 days past due', a: '₹1,15,310' },
    ];
    $('#p-cards').innerHTML = cards.map((k) => `<div class="card"><div style="font-size:44px">${k.i}</div><h3>${k.t}</h3><code>${k.c}</code><div class="amt">${k.a}</div></div>`).join('');
    at(400, () => $('#p-head').classList.add('in'));
    document.querySelectorAll('#p-cards .card').forEach((el, i) => at(6200 + i * 3500, () => el.classList.add('in')));
    const target = 107482600; const start = 24000, len = 5500;
    at(start, () => { $('#p-counter').classList.add('in'); const t0 = performance.now(); const tick = () => { const p = Math.min(1, (performance.now() - t0) / len); const e = 1 - Math.pow(1 - p, 3); $('#p-counter').textContent = fmt(target * e); if (p < 1) requestAnimationFrame(tick); }; tick(); });
    at(start + 2500, () => $('#p-note').classList.add('in'));
  },
  town(d) { FILM.scene(null); FILM.app(); at(1500, () => FILM.callout(700, 150, 'one house per customer · one dark lantern per payment at risk', d - 3000)); },
  light(d) {
    at(6000, () => FILM.callout(1250, 540, '1 · diagnose: rules first, the local model reads raw bank strings', 9000, 620));
    at(15500, () => FILM.callout(1250, 540, '2 · policy: every action, every rule, all in the audit log', 8000, 620));
    at(24000, () => FILM.callout(1250, 540, '3 · the model chooses only among the approved options', 7000, 620));
    at(31500, () => FILM.callout(1250, 300, 'every outreach = a real Razorpay test-mode order', d - 33000, 620));
  },
  drawer(d) {
    at(3500, () => FILM.callout(700, 150, 'the Razorpay error, with the raw bank string', 6500));
    at(10500, () => FILM.callout(700, 150, 'diagnosis · confidence · source (rules / local model)', 7000));
    at(18000, () => FILM.callout(700, 150, 'every candidate action, with the rules it failed as chips', 8000));
    at(27000, () => FILM.callout(700, 150, 'the message that went out · a real order behind the link', d - 28500));
  },
  pay(d) {
    FILM.scene('flow'); at(600, () => $('#flow').classList.add('on'));
    document.querySelectorAll('#flow .step').forEach((el, i) => at(1800 + i * 2600, () => el.classList.add('on')));
    at(d - 3800, () => { $('#flow').classList.remove('on'); });
  },
  night(d) {
    FILM.scene(null);
    at(2500, () => FILM.callout(600, 120, '21:00 IST · quiet hours · the lamplighter rests by the well', 8000, 700));
    at(12000, () => FILM.callout(1250, 620, 'deferred to 09:00 — it is in the journal, not hidden', 7000, 620));
    at(20000, () => FILM.callout(1250, 620, 'STOP ends contact · scheduled retries are cancelled too', d - 21500, 620));
  },
  review(d) {
    FILM.scene(null);
    at(3000, () => FILM.callout(60, 110, 'the week in review · same customers for agent and cron', 8000, 700));
    at(12000, () => FILM.callout(60, 110, 'quiet hours are the shaded bands: the agent pauses, the cron does not', 8000, 700));
    at(d - 22000, () => {
      FILM.scene('seeds');
      const rows = FILM.data.seeds; const max = Math.max(...rows.map((r) => Math.max(r.agent, r.cron)));
      $('#seedrows').innerHTML = rows.map((r) => `<div class="seedrow"><span>seed ${r.seed}</span><div class="bars"><i class="a" data-w="${(r.agent / max) * 100}"></i><i class="c" data-w="${(r.cron / max) * 100}"></i></div><b>${fmt(r.agent)}</b></div>`).join('');
      $('#seedsum').textContent = FILM.data.seedSummary || '';
      requestAnimationFrame(() => { $('#seeds').classList.add('on'); setTimeout(() => document.querySelectorAll('#seedrows i').forEach((i) => { i.style.width = i.dataset.w + '%'; }), 500); });
    });
  },
  reliability(d) {
    FILM.scene('reliability'); FILM.appOff();
    const term = $('#term'); term.innerHTML = '';
    const lines = FILM.data.chaos.length ? FILM.data.chaos : [{ actor: 'razorpay', type: 'api_retry', ts: '', note: 'injected: 503 Service Unavailable (chaos)', hash: 'a1b2c3' }];
    lines.forEach((l, i) => { const el = document.createElement('div'); el.className = 'l a-' + l.actor; el.textContent = `${(l.ts || '').slice(5, 16).replace('T', ' ')}  ${l.actor.padEnd(9)} ${l.type.padEnd(19)} ${l.note}  #${l.hash}`; term.appendChild(el); at(700 + i * 900, () => el.classList.add('on')); });
    at(15500, () => $('#b1').classList.add('on')); at(17500, () => $('#b2').classList.add('on')); at(19500, () => $('#b3').classList.add('on'));
  },
  close(d) {
    FILM.scene('close'); FILM.appOff();
    at(300, () => $('#c-word').classList.add('in')); at(1400, () => $('#c-sub').classList.add('in'));
    document.querySelectorAll('#arch .node').forEach((el, i) => at(2400 + i * 500, () => el.classList.add('on')));
    at(6200, () => $('#c-chips').classList.add('in'));
  },
};

FILM.start = (timeline) => {
  FILM.timers.forEach(clearTimeout); FILM.timers = [];
  for (const sc of timeline) {
    at(sc.start * 1000, () => { $('#callouts').innerHTML = ''; FILM.hideCursor(); (SCENES[sc.id] || (() => {}))(sc.dur * 1000); FILM.caption(sc.text, sc.dur * 1000); });
  }
};
