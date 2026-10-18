(function () {
  'use strict';
  var E = Engine, LS = 'dta.v1';
  var $app = document.getElementById('app');
  var SETTING_FIELDS = [
    ['capital', 'Starting capital (USD)', 'Paper money only. v1 supports USD accounts and USD-quoted pairs.', 100, 1e9, 100],
    ['riskPct', 'Risk per trade (% of capital)', 'The most the plan aims to lose on one trade if the stop fills as planned.', 0.1, 5, 0.1],
    ['minRR', 'Minimum reward-to-risk (1 : x)', 'Setups below this are never recommended.', 1, 10, 0.5],
    ['maxOpen', 'Max open positions', 'v1 trades one pair, so 1 is the working value.', 1, 5, 1],
    ['maxExposurePct', 'Max total exposure (% of capital)', 'Position value as a share of capital. Sizes are cut to fit.', 50, 2000, 50],
    ['dailyLossPct', 'Daily loss limit (%)', 'Stops new trades for the day. No override.', 0.5, 20, 0.5],
    ['weeklyLossPct', 'Weekly loss limit (%)', 'Stops new trades for the week. No override.', 1, 40, 0.5],
    ['maxDailyLosses', 'Stop after losing trades in a day', 'Protects against revenge trading.', 1, 10, 1],
    ['streakPause', 'Review pause after losing streak (0 = off)', 'After this many losses in a row the app asks you to review the journal.', 0, 30, 1],
    ['spreadPips', 'Spread (pips, round trip)', 'Typical cost of buying then selling. Check your broker.', 0, 10, 0.1],
    ['slipPips', 'Slippage (pips per side)', 'Allowance for getting a slightly worse price.', 0, 10, 0.1],
    ['carryPips', 'Overnight financing (pips per day)', 'Placeholder, not a real quote. Rollover can be a cost or a credit; check your broker.', 0, 10, 0.1]
  ];
  var S = { settings: {}, theme: 'dark', data: null, span: 2, cur: null, acks: [], paused: false, resumeArm: false, tab: 'today', full: false, details: false, bt: null, jfilter: 'trades', msg: '', fxBusy: false };
  var eng = null;

  // ---------- storage (per-browser convenience only; the journal is recomputed by replay) ----------
  function save() {
    try {
      var d = S.data;
      localStorage.setItem(LS, JSON.stringify({ settings: S.settings, theme: S.theme, span: S.span, cur: S.cur, acks: S.acks, paused: S.paused, tab: S.tab,
        meta: d.meta, csv: d.meta.kind === 'demo' ? null : d.bars.map(function (b) { return b.date + ',' + b.close; }).join('|') }));
    } catch (e) { /* storage unavailable */ }
  }
  function load() {
    try {
      var j = JSON.parse(localStorage.getItem(LS) || 'null'); if (!j) return;
      S.settings = j.settings || {}; S.theme = j.theme || 'dark'; S.span = j.span == null ? 2 : j.span; S.cur = j.cur; S.acks = j.acks || []; S.paused = !!j.paused; S.tab = j.tab || 'today';
      if (j.csv && j.meta) { S.data = { meta: j.meta, bars: j.csv.split('|').map(function (r) { var p = r.split(','); return { date: p[0], close: +p[1] }; }) }; }
    } catch (e) { /* ignore */ }
  }
  function demoData() { return { meta: { kind: 'demo', pair: 'EUR/USD (synthetic)', provider: 'Built-in random generator' }, bars: E.demoBars(1500) }; }
  function params() { return Object.assign({}, S.settings); }
  function startIdx() { var n = S.data.bars.length, w = E.warmup(Object.assign({}, E.DEFAULTS, S.settings)); return S.span === 0 ? w : Math.max(w, n - Math.round(S.span * 252)); }
  function today() { return new Date().toISOString().slice(0, 10); }

  function build(target) {
    eng = E.create(S.data.bars, params(), startIdx(), { acks: S.acks, today: today() });
    eng.demo = S.data.meta.kind === 'demo';
    E.step(eng);
    var t = target == null ? eng.start : target;
    while (eng.i < t && E.step(eng)) { /* replay */ }
    S.cur = eng.i; save();
  }
  function advance(k) { if (S.paused) return; for (var j = 0; j < k; j++) if (!E.step(eng)) break; S.cur = eng.i; save(); }

  // ---------- formatting ----------
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function px(x) { return x.toFixed(5); }
  function money(x, sign) { var a = Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return (x < 0 ? '-' : sign && x > 0 ? '+' : '') + '$' + a; }
  function pct(x, d) { return (x == null ? '–' : x.toFixed(d == null ? 1 : d) + '%'); }
  function num(x, d) { return x == null ? '–' : x === Infinity ? '∞' : x.toFixed(d == null ? 2 : d); }
  function cls(x) { return x > 0 ? 'good' : x < 0 ? 'bad' : ''; }
  function pairName() { return S.data.meta.pair; }
  function mode() {
    if (S.data.meta.kind === 'demo') return { c: 'demo', t: 'Demonstration data' };
    return eng.i < S.data.bars.length - 1 ? { c: 'replay', t: 'Historical replay' } : { c: 'latest', t: 'Latest daily data' };
  }
  function stamp() {
    var m = S.data.meta, b = S.data.bars[eng.i], k = m.kind;
    return { instrument: pairName(), tf: 'Daily', provider: m.provider, ts: b.date + (k === 'fx' ? ' (ECB reference rate, about 16:00 CET)' : k === 'csv' ? ' (daily close from your file)' : ' (synthetic day)') };
  }
  function lots(u) { return (u / 100000).toFixed(2); }

  // ---------- charts ----------
  function plot(o) {
    var W = 640, H = o.h || 240, L = 54, R = 10, T = 10, B = 24, all = [];
    o.series.forEach(function (s) { s.y.forEach(function (v) { if (v != null) all.push(v); }); });
    (o.hlines || []).forEach(function (h) { all.push(h.y); });
    var mn = Math.min.apply(null, all), mx = Math.max.apply(null, all), pad = (mx - mn) * 0.06 || 1e-4; mn -= pad; mx += pad;
    var n = o.n, X = function (i) { return L + (W - L - R) * (n < 2 ? 0 : i / (n - 1)); }, Y = function (v) { return T + (H - T - B) * (1 - (v - mn) / (mx - mn)); };
    var g = '';
    for (var k = 0; k < 4; k++) { var v = mn + (mx - mn) * k / 3; g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" style="stroke:var(--line)" stroke-width="1"/><text x="' + (L - 6) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + o.fmt(v) + '</text>'; }
    [[0, 'start'], [Math.floor((n - 1) / 2), 'middle'], [n - 1, 'end']].forEach(function (a) { g += '<text x="' + X(a[0]) + '" y="' + (H - 6) + '" text-anchor="' + a[1] + '">' + o.xs[a[0]] + '</text>'; });
    (o.vlines || []).forEach(function (vl) { g += '<line x1="' + X(vl.i) + '" x2="' + X(vl.i) + '" y1="' + T + '" y2="' + (H - B) + '" style="stroke:var(--muted)" stroke-dasharray="4 4"/><text x="' + (X(vl.i) + 4) + '" y="' + (T + 10) + '">' + vl.label + '</text>'; });
    (o.hlines || []).forEach(function (h) { g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(h.y) + '" y2="' + Y(h.y) + '" style="stroke:' + h.color + '" stroke-width="1.5" stroke-dasharray="6 4"/><text x="' + (W - R - 2) + '" y="' + (Y(h.y) - 4) + '" text-anchor="end" style="fill:' + h.color + '">' + h.label + '</text>'; });
    o.series.forEach(function (s) { var d = '', pen = false; s.y.forEach(function (v, i) { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); pen = true; }); g += '<path d="' + d + '" fill="none" style="stroke:' + s.color + '" stroke-width="' + (s.w || 2) + '" stroke-linejoin="round"/>'; });
    (o.markers || []).forEach(function (m) { var x = X(m.i), y = Y(m.y), c = m.color; g += m.shape === 'up' ? '<path d="M' + x + ' ' + (y - 8) + 'L' + (x - 6) + ' ' + (y + 4) + 'L' + (x + 6) + ' ' + (y + 4) + 'Z" style="fill:' + c + '"/>' : m.shape === 'down' ? '<path d="M' + x + ' ' + (y + 8) + 'L' + (x - 6) + ' ' + (y - 4) + 'L' + (x + 6) + ' ' + (y - 4) + 'Z" style="fill:' + c + '"/>' : '<circle cx="' + x + '" cy="' + y + '" r="4.5" style="fill:var(--bg);stroke:' + c + '" stroke-width="2.5"/>'; });
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.label) + '">' + g + '</svg>';
  }
  function priceChart() {
    var bars = eng.bars, i = eng.i, a = Math.max(0, i - 150), xs = [], close = [], sma = [], p = eng.p, j, k;
    for (j = a; j <= i; j++) { xs.push(bars[j].date); close.push(bars[j].close); if (j >= p.trendLen - 1) { var s = 0; for (k = j - p.trendLen + 1; k <= j; k++) s += bars[k].close; sma.push(s / p.trendLen); } else sma.push(null); }
    var hl = [], mk = [], pos = eng.pos, rec = eng.rec;
    if (pos) { hl.push({ y: pos.stop, color: 'var(--short)', label: 'stop ' + px(pos.stop) }, { y: pos.target, color: 'var(--buy)', label: 'target ' + px(pos.target) }); }
    else if (rec && rec.sig && (rec.kind === 'long' || rec.kind === 'short')) { hl.push({ y: rec.sig.stop, color: 'var(--short)', label: 'stop ' + px(rec.sig.stop) }, { y: rec.sig.target, color: 'var(--buy)', label: 'target ' + px(rec.sig.target) }); }
    eng.trades.forEach(function (t) { if (t.entryIdx >= a) mk.push({ i: t.entryIdx - a, y: bars[t.entryIdx].close, shape: t.side === 'long' ? 'up' : 'down', color: t.side === 'long' ? 'var(--buy)' : 'var(--short)' }); if (t.exitIdx >= a) mk.push({ i: t.exitIdx - a, y: bars[t.exitIdx].close, shape: 'dot', color: 'var(--exit)' }); });
    if (pos && pos.entryIdx >= a) mk.push({ i: pos.entryIdx - a, y: bars[pos.entryIdx].close, shape: pos.side === 'long' ? 'up' : 'down', color: pos.side === 'long' ? 'var(--buy)' : 'var(--short)' });
    return plot({ n: xs.length, xs: xs, fmt: function (v) { return v.toFixed(4); }, label: 'Price chart of the last ' + xs.length + ' days', series: [{ y: sma, color: 'var(--exit)', w: 1.5 }, { y: close, color: 'var(--fg)', w: 2 }], hlines: hl, markers: mk }) +
      '<div class="legend"><span><i style="background:var(--fg)"></i>Daily close</span><span><i style="background:var(--exit)"></i>' + p.trendLen + '-day average</span><span>▲ long entry · ▼ short entry · ○ exit</span></div>';
  }
  function equityChart(curve, start, cut) {
    var xs = curve.map(function (c) { return c.date; }), vl = [];
    if (cut) { var ci = xs.indexOf(cut); if (ci > 0) vl.push({ i: ci, label: 'out-of-sample →' }); }
    return plot({ n: xs.length, xs: xs, fmt: function (v) { return '$' + Math.round(v).toLocaleString('en-US'); }, label: 'Account value over time', series: [{ y: curve.map(function (c) { return c.eq; }), color: 'var(--buy)', w: 2 }], hlines: [{ y: start, color: 'var(--muted)', label: 'start' }], vlines: vl });
  }

  // ---------- recommendation card ----------
  function exposure() {
    var p = eng.pos, b = eng.bars[eng.i]; if (!p) return { open: false, text: 'No open position. Exposure 0%.' };
    var nt = p.units * b.close, dir = p.side === 'long' ? 1 : -1, up = (b.close - p.entry) * dir * p.units;
    return { open: true, text: 'Open ' + p.side + ': ' + p.units.toLocaleString('en-US') + ' units (' + pct(nt / eng.equity * 100, 0) + ' of capital), risk to stop about ' + money(p.riskAmt) + ', open result ' + money(up, true) + '.' };
  }
  function reasonText(rec) {
    var p = eng.p, sg = rec.sig, pr = pairName().split(' ')[0];
    if (rec.kind === 'long') return pr + ' just closed higher than any day in the past ' + p.breakLen + ', and it sits above its ' + p.trendLen + '-day average. The rules read that as an uptrend continuing.';
    if (rec.kind === 'short') return pr + ' just closed lower than any day in the past ' + p.breakLen + ', and it sits below its ' + p.trendLen + '-day average. The rules read that as a downtrend continuing.';
    if (rec.kind === 'exit') { var t = rec.trade, r = t.reason === 'stop' ? 'The price closed beyond the stop-loss, so the plan exits.' : t.reason === 'target' ? 'The price reached the take-profit, so the plan takes it.' : 'The trade ran ' + p.maxHold + ' bars without reaching stop or target, so the plan closes it.'; return r + ' Result ' + money(t.pnl, true) + ' (' + t.R.toFixed(2) + 'R).'; }
    if (rec.kind === 'holding') { var q = rec.pos; return (rec.openedToday ? 'Paper trade opened today at ' + px(q.entry) + '. ' : 'Paper trade open since ' + q.entryDate + '. ') + 'Nothing to do: the plan exits only at the stop (' + px(q.stop) + '), the target (' + px(q.target) + ') or after ' + p.maxHold + ' bars.'; }
    if (rec.kind === 'wait') { var extra = rec.cancelled ? 'Yesterday\'s setup was cancelled because ' + rec.cancelled.why + '. ' : ''; return extra + (rec.reason || 'No setup today.') + ' Not trading is a normal, planned result.'; }
    return rec.reason || '';
  }
  function cardHtml() {
    if (S.paused) return '<section class="card k-paused" aria-live="polite"><div class="tag">Emergency pause on</div><div class="big">PAUSED</div><p class="why">All recommendations are halted. ' + esc(exposure().text) + '</p></section>';
    var rec = eng.rec, k = rec.kind, tag, big, sub = '', why = reasonText(rec), rr = '', extra = '';
    var sz = rec.size;
    if (k === 'long') { tag = 'New trade · Long'; big = 'CONSIDER BUY'; sub = '(open long)'; }
    else if (k === 'short') { tag = 'New trade · Short'; big = 'CONSIDER SELL'; sub = '(open short)'; }
    else if (k === 'exit') { var ls = rec.trade.side === 'long'; tag = 'Close your position'; big = ls ? 'CONSIDER SELL' : 'CONSIDER BUY'; sub = ls ? '(exit long)' : '(close short)'; }
    else if (k === 'holding') { tag = 'Paper trade open'; big = 'HOLD'; sub = '(' + rec.pos.side + ')'; }
    else if (k === 'stop') { tag = 'Stop rule'; big = rec.guard.title; why = rec.guard.why; }
    else if (k === 'norec') { tag = 'Data check'; big = 'NO RECOMMENDATION'; }
    else { tag = 'Today'; big = 'WAIT / NO TRADE'; }
    if ((k === 'long' || k === 'short') && sz) rr = '<div class="rr">You risk ' + money(sz.riskAmt) + ' to potentially gain ' + money(sz.riskAmt * rec.sig.rr) + ' (1:' + num(rec.sig.rr, 1) + ', your minimum is 1:' + eng.p.minRR + ').</div>';
    if (k === 'exit' && rec.guard) extra = '<p class="why" style="margin-top:12px"><b>' + esc(rec.guard.title) + '.</b> ' + esc(rec.guard.why) + '</p>';
    if (k === 'stop' && rec.guard.code === 'review') extra = '<div class="row" style="margin-top:14px"><button class="btn primary" data-act="ack">I have reviewed the journal</button><button class="btn" data-act="tab" data-v="journal">Open journal</button></div>';
    return '<section class="card k-' + k + '" aria-live="polite"><div class="tag">' + tag + '</div><div class="big">' + esc(big) + '</div>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '<p class="why">' + esc(why) + '</p>' + rr + extra + '</section>';
  }
  function detailHtml() {
    var rec = eng.rec, st = stamp(), h = '', kv = function (l, v) { return '<div><div class="l">' + l + '</div><div class="v">' + v + '</div></div>'; };
    var data = '<h2 style="margin-top:18px">Data</h2><div class="kv">' + kv('Instrument', esc(st.instrument)) + kv('Timeframe', st.tf) + kv('Provider', esc(st.provider)) + kv('Data timestamp', esc(st.ts)) + '</div>';
    if (S.paused) return '<div class="panel"><h2>Current exposure</h2><p>' + esc(exposure().text) + '</p></div>';
    if ((rec.kind === 'long' || rec.kind === 'short') && rec.size) {
      var g = rec.sig, z = rec.size, lg = rec.kind === 'long';
      h = '<div class="kv">' + kv('Entry', 'about ' + px(g.ref) + '<br><span class="note">filled at the next rate</span>') + kv('Stop-loss', px(g.stop)) + kv('Take-profit', px(g.target)) + kv('Position size', z.units.toLocaleString('en-US') + ' units<br><span class="note">' + lots(z.units) + ' lots</span>') +
        kv('Risk', money(z.riskAmt)) + kv('Potential gain', money(z.riskAmt * g.rr)) + kv('Reward : risk', '1:' + num(g.rr, 1)) + kv('Position value', money(z.notional) + '<br><span class="note">' + pct(z.notional / eng.equity * 100, 0) + ' of capital' + (z.capped ? ', cut to your exposure limit' : '') + '</span>') + '</div>' +
        '<h2 style="margin-top:18px">What would invalidate it</h2><p>Do not enter if the next rate is ' + (lg ? 'at or below ' : 'at or above ') + px(g.level) + ' (back inside the ' + eng.p.breakLen + '-day range) or already beyond ' + px(g.stop) + '. After entry, exit if a daily close is ' + (lg ? 'at or below ' : 'at or above ') + px(g.stop) + ', and close the trade after ' + eng.p.maxHold + ' bars if neither stop nor target was reached.</p>' +
        '<h2>Why it qualifies</h2><p class="note">Rules ' + g.rules.join(', ') + '. Trend: price ' + (lg ? 'above' : 'below') + ' its average. Breakout: close beyond the ' + eng.p.breakLen + '-day ' + (lg ? 'high' : 'low') + ' close (' + px(g.level) + '). Stop distance: ' + eng.p.stopMult + ' × recent daily movement (' + px(g.ind.vol) + ').</p>';
    } else if (rec.kind === 'holding') {
      var q = rec.pos, b = eng.bars[eng.i], un = (b.close - q.entry) * (q.side === 'long' ? 1 : -1) * q.units;
      h = '<div class="kv">' + kv('Entry', px(q.entry)) + kv('Stop-loss', px(q.stop)) + kv('Take-profit', px(q.target)) + kv('Size', q.units.toLocaleString('en-US') + ' units') + kv('Risk at stop', money(q.riskAmt)) + kv('Open result', '<span class="' + cls(un) + '">' + money(un, true) + '</span>') + '</div>' +
        '<h2 style="margin-top:18px">What would invalidate it</h2><p>A daily close ' + (q.side === 'long' ? 'at or below ' : 'at or above ') + px(q.stop) + ' ends the trade. So does reaching ' + px(q.target) + ' or ' + eng.p.maxHold + ' bars in the trade.</p>';
    } else h = '<p>No entry, stop or target today because there is no active setup.</p><p class="note">' + esc(exposure().text) + '</p>';
    return '<div class="panel">' + h + '<p class="note" style="margin-top:12px">A stop-loss is a plan, not a guaranteed maximum loss. Price can jump past it (gaps), fill at a worse rate (slippage), or be hard to trade when few people are trading (liquidity).</p>' + data + '</div>';
  }
  function lesson() {
    var r = eng.rec, k = r.kind;
    if (k === 'exit') return r.trade.pnl < 0 ? 'A loss of ' + money(-r.trade.pnl) + ' is the plan working as written: the stop kept it close to the risk you chose. Gaps and slippage can make a loss a little larger. One trade says nothing about the strategy.' : 'A win of ' + money(r.trade.pnl) + ' came from letting the trade reach its target. Winners like this pay for the losers, so the plan is the same after a win as after a loss.';
    if (k === 'long' || k === 'short') return 'A setup needs trend, a breakout and a stop that fits your risk limit, all at the same time. When all three are present the plan acts. Otherwise it waits.';
    if (k === 'holding') return 'While a trade is open only two prices matter: the stop and the target. Everything in between is noise to the plan.';
    if (k === 'stop') return 'Stop rules are boundaries set while calm. They apply on purpose at the moments when emotions run highest.';
    if (k === 'norec') return 'When the data cannot be trusted the app says nothing. A missing signal is safer than an invented one.';
    return 'Most days have no setup. Staying out costs nothing, and the strategy earns only when conditions fit.';
  }
  function dailySummary() {
    var r = eng.rec, ev = eng.events.map(function (e) { return e.type === 'entry' ? 'Paper ' + e.pos.side + ' opened at ' + px(e.pos.entry) : e.type === 'exit' ? 'Paper ' + e.trade.side + ' closed at ' + px(e.trade.exit) + ' (' + money(e.trade.pnl, true) + ')' : 'Setup skipped: ' + e.why; });
    var label = { long: 'Consider buy', short: 'Consider sell (open short)', exit: 'Exit the open trade', holding: 'Hold', wait: 'Wait, no trade', stop: r.guard ? r.guard.title : '', norec: 'No recommendation' }[r.kind];
    return '<div class="panel"><h2>Daily summary · ' + r.date + '</h2><p><b>Recommended:</b> ' + esc(label) + '</p><p><b>What happened:</b> ' + (ev.length ? ev.map(esc).join('; ') : 'No trades opened or closed.') + '</p><p><b>Lesson:</b> ' + esc(lesson()) + '</p></div>';
  }
  function suggestion(tr) {
    var n = tr.length; if (n < 10) return 'Not enough closed trades for a specific suggestion yet (' + n + ' so far, 10 needed). Suggestions drawn from fewer trades would mostly be noise.';
    var L = tr.filter(function (t) { return t.side === 'long'; }), Sh = tr.filter(function (t) { return t.side === 'short'; }), avg = function (a) { return a.reduce(function (x, t) { return x + t.R; }, 0) / a.length; };
    if (L.length >= 5 && Sh.length >= 5) { var a = avg(L), b = avg(Sh); if (Math.abs(a - b) >= 0.4) { var w = a > b ? 'long' : 'short', l = a > b ? 'short' : 'long'; return 'Your ' + l + ' trades have averaged ' + num(Math.min(a, b)) + 'R against ' + num(Math.max(a, b)) + 'R for ' + w + ' trades. A possible v1.1 would trade only the ' + w + ' side. The app will not change the rules itself. Any change would be tested on data it has not seen first.'; } }
    var T = tr.filter(function (t) { return t.reason === 'time'; }); if (T.length >= 4 && avg(T) < 0) return T.length + ' trades ended on the ' + eng.p.maxHold + '-bar time limit and averaged ' + num(avg(T)) + 'R. A possible v1.1 would test a shorter limit, judged on out-of-sample data before use.';
    var St = tr.filter(function (t) { return t.reason === 'stop'; }); if (St.length / n > 0.7) return 'About ' + Math.round(St.length / n * 100) + '% of trades ended at the stop. A possible v1.1 would test a wider stop multiple, judged on out-of-sample data before use.';
    return 'No weak spot stands out in ' + n + ' trades. Keep following the rules and keep the journal going.';
  }
  function weekly() {
    var wk = E.weekKey(eng.rec.date), tr = eng.trades.filter(function (t) { return E.weekKey(t.exitDate) === wk; }), h = '<div class="panel"><h2>Weekly review · ' + wk + '</h2>';
    if (!tr.length) h += '<p>No trades closed this week.</p>'; else {
      var best = tr.reduce(function (a, t) { return t.pnl > a.pnl ? t : a; }), worst = tr.reduce(function (a, t) { return t.pnl < a.pnl ? t : a; });
      h += '<p><b>Best trade:</b> ' + best.side + ' closed ' + best.exitDate + ', ' + money(best.pnl, true) + '. <b>Worst trade:</b> ' + worst.side + ' closed ' + worst.exitDate + ', ' + money(worst.pnl, true) + '.</p>';
    }
    h += '<p><b>Rules followed:</b> ' + eng.trades.length + ' of ' + eng.trades.length + ' paper trades matched a written rule. In paper mode the app places trades itself, so this is always full. A discipline score for your own decisions needs real-trade logging, which is planned for a later version.</p><p><b>One suggestion:</b> ' + esc(suggestion(eng.trades)) + '</p></div>';
    return h;
  }

  // ---------- tabs ----------
  function tabToday() {
    var atEnd = eng.i >= eng.bars.length - 1, h = '<div class="today"><div>' + cardHtml();
    h += '<div class="row" style="margin-top:14px"><button class="btn primary" data-act="next"' + (S.paused || atEnd ? ' disabled' : '') + '>Next day ▶</button><button class="btn" data-act="full">' + (S.full ? 'Hide' : 'Show') + ' entry, stop &amp; size</button><button class="btn" data-act="details">' + (S.details ? 'Hide details' : 'Details') + '</button></div>';
    if (atEnd) h += '<p class="note" style="margin-top:10px">You are at the newest day in the data.</p>';
    var m = mode(), st = stamp();
    h += '<div class="meta" style="margin-top:12px"><span>' + esc(st.instrument) + '</span><span>' + st.tf + '</span><span>' + esc(st.provider) + '</span><span>Data as of ' + esc(st.ts) + '</span><span>' + m.t + '</span></div>';
    h += '<p class="note" style="margin-top:6px">Session-only prototype: nothing runs in the background. Recommendations update when you tap Next day or reload.</p>';
    if (S.data.meta.kind === 'demo') h += '<div class="warn demo" style="margin-top:12px"><b>Demonstration data.</b> These prices are generated by a random-number program. They are not a real market, and the results mean nothing about trading. Import real daily data in Settings.</div>';
    h += '</div><div>' + (S.full ? detailHtml() : '<div class="panel"><h2>Exposure</h2><p>' + esc(exposure().text) + '</p><p class="note">Paper account: ' + money(eng.equity) + ' · ' + eng.trades.length + ' closed trades · ' + eng.waitDays + ' wait days</p></div>') + '</div>';
    if (S.details) h += '<div class="full panel"><h2>Price chart</h2>' + priceChart() + '</div>';
    h += '<div class="full grid2">' + dailySummary() + weekly() + '</div></div>';
    return h;
  }
  function tabJournal() {
    var h = '<div class="row" style="margin-bottom:12px"><button class="btn small' + (S.jfilter === 'trades' ? ' primary' : '') + '" data-act="jf" data-v="trades">Trades</button><button class="btn small' + (S.jfilter === 'all' ? ' primary' : '') + '" data-act="jf" data-v="all">All decisions</button></div>';
    if (S.jfilter === 'trades') {
      if (!eng.trades.length && !eng.pos) h += '<p class="panel">No trades yet in this replay. Tap Next day on the Today tab.</p>';
      h += '<div class="tl">';
      if (eng.pos) { var q = eng.pos; h += '<div class="ev"><div class="h"><span>OPEN · ' + q.entryDate + '</span><span>Rules ' + q.rules.join(' ') + '</span></div><b>' + esc(pairName()) + ' ' + q.side + '</b> · entry ' + px(q.entry) + ' · stop ' + px(q.stop) + ' · target ' + px(q.target) + ' · ' + q.units.toLocaleString('en-US') + ' units</div>'; }
      eng.trades.slice().reverse().forEach(function (t) {
        var after = eng.bars[t.exitIdx + 5], mv = after ? ((after.close - t.exit) / E.PIP) : null, dirW = after ? (mv > 0 ? 'higher' : 'lower') : '';
        h += '<div class="ev"><div class="h"><span>#' + t.n + ' · ' + t.entryDate + ' → ' + t.exitDate + ' (' + t.held + ' days)</span><span>Rules ' + t.rules.join(' ') + ', ' + (t.reason === 'time' ? 'R5' : 'R3') + '</span></div><b>' + esc(pairName()) + ' ' + t.side + '</b> · in ' + px(t.entry) + ' · out ' + px(t.exit) + ' · exit by ' + t.reason + '<br><span class="' + cls(t.pnl) + '"><b>' + money(t.pnl, true) + ' (' + t.R.toFixed(2) + 'R)</b></span> after costs' + (after ? '<br><span class="note">Five days later the rate was ' + Math.abs(mv).toFixed(0) + ' pips ' + dirW + ' than the exit.</span>' : '') + '</div>';
      });
      h += '</div><p class="note">Setup screenshots are planned for a later version. The Today tab chart shows the setup at the time.</p>';
    } else {
      h += '<div class="tl">' + (eng.log.length ? eng.log.slice().reverse().map(function (l) { return '<div class="ev"><div class="h"><span>' + l.date + ' · ' + l.type.toUpperCase() + '</span><span>' + (l.rules.length ? 'Rules ' + l.rules.join(' ') : '') + '</span></div>' + esc(l.text) + '</div>'; }).join('') : '<p class="panel">Nothing logged yet.</p>') + '</div><p class="note">Days with no setup are counted (' + eng.waitDays + ' so far) but not listed one by one.</p>';
    }
    if (eng.reviewNeeded) h = '<div class="warn" style="margin-bottom:12px"><b>Review checkpoint.</b> Read the recent trades below, then confirm. <button class="btn small primary" data-act="ack">I have reviewed it</button></div>' + h;
    return h;
  }
  function tile(t, n, p, c) { return '<div class="stat"><div class="t">' + t + '</div><div class="n ' + (c || '') + '">' + n + '</div><p>' + p + '</p></div>'; }
  function tabStats() {
    var s = E.stats(eng.trades, eng.curve, eng.p.capital), b0 = eng.bars[eng.start - 1] || eng.bars[0], bh = (eng.bars[eng.i].close / b0.close - 1) * 100;
    var h = s.n < 30 ? '<div class="warn" style="margin-bottom:14px"><b>Only ' + s.n + ' closed trades.</b> With fewer than about 30 trades, every number here can be luck. Read them as a first look, not a verdict.</div>' : '';
    h += '<div class="grid2">' +
      tile('Net result', money(s.net, true), 'Paper account ' + money(eng.equity) + ' (' + pct(s.retPct) + '). Buy-and-hold over the same days: ' + pct(bh) + '.', cls(s.net)) +
      tile('Win rate', pct(s.winRate == null ? null : s.winRate * 100, 0), 'Share of trades that made money. Trend strategies often win under half their trades, so read it together with average win and loss.') +
      tile('Average win vs loss', s.avgWin == null || s.avgLoss == null ? '–' : money(s.avgWin) + ' / ' + money(s.avgLoss), 'What a typical winner earns against what a typical loser costs. Winners clearly bigger than losers let a strategy profit while winning less than half the time.') +
      tile('Average R achieved', num(s.avgR) + 'R', 'R is the amount you planned to risk. +0.3R means an average trade made 30% of that, after costs. The plan targets +2R on winners.', cls(s.avgR)) +
      tile('Biggest drawdown', pct(s.maxDD), 'The largest fall from a peak in account value. Expect a future one to be bigger. If you could not sit through this with real money, lower the risk per trade.') +
      tile('Profit factor', num(s.profitFactor), 'Total won divided by total lost. Above 1.0 means ahead after costs. Many sound systems sit around 1.2 to 2.0. Small samples can look much better than they are.') +
      tile('Longest losing streak', String(s.longestLosing), 'The most losses in a row so far. Streaks of this size are normal for any strategy and will recur.') + '</div>';
    h += '<div class="panel" style="margin-top:14px"><h2>Account value (paper)</h2>' + equityChart(eng.curve, eng.p.capital) + '</div>';
    h += '<div class="panel" style="margin-top:14px"><h2>Your trader profile</h2><p class="note">Not built yet. It needs many of your own trades by setup, time of day and market condition. The prototype does not fake it.</p></div>';
    return h;
  }
  function tabBacktest() {
    var h = '<div class="panel"><h2>Walk-forward test</h2><p>Runs the written rules over all loaded data, in date order, using only information available on each day. Costs and slippage are included. Results are split into the first 60% and the last 40%. The rules were fixed before testing and were not tuned to either part.</p><button class="btn primary" data-act="bt">Run test</button></div>';
    if (S.data.meta.kind === 'demo') h += '<div class="warn demo" style="margin-top:14px"><b>Demonstration data.</b> This test runs on synthetic prices. It checks that the machinery works. It says nothing about the real EUR/USD market.</div>';
    var r = S.bt; if (!r) return h;
    var row = function (x) { return '<tr><td>' + esc(x.label) + '<br><span class="note">' + x.from + ' to ' + x.to + '</span></td><td>' + x.n + '</td><td>' + pct(x.winRate == null ? null : x.winRate * 100, 0) + '</td><td class="' + cls(x.avgR) + '">' + num(x.avgR) + '</td><td>' + num(x.profitFactor) + '</td><td class="' + cls(x.retPct) + '">' + pct(x.retPct) + '</td><td>' + pct(x.bh) + '</td><td class="bad">' + pct(x.maxDD) + '</td><td>' + x.longestLosing + '</td></tr>'; };
    var head = '<thead><tr><th>Period</th><th>Trades</th><th>Win rate</th><th>Avg R</th><th>Profit factor</th><th>Strategy return</th><th>Buy and hold</th><th>Max drawdown</th><th>Longest losing streak</th></tr></thead>';
    var o = r.outSample, verdict;
    if (o.n < 20) verdict = 'Only ' + o.n + ' trades in the out-of-sample part. That is too few to say whether the strategy has an edge.';
    else if (o.retPct <= 0 || (o.profitFactor != null && o.profitFactor < 1)) verdict = 'On data the rules were not fitted to, the strategy lost money after costs. No edge is shown.';
    else verdict = 'The out-of-sample part was positive after costs. That is encouraging but is not proof. See the validation plan for what must be true before real money is considered.';
    h += '<div class="panel" style="margin-top:14px"><h2>Result in plain words</h2><p><b>' + esc(verdict) + '</b></p><p class="note">Out-of-sample results are only honest while the rules stay unchanged. If you edit the rules after seeing them, that part becomes in-sample and the test must be redone on new data.</p></div>';
    h += '<div class="panel tw" style="margin-top:14px"><table>' + head + '<tbody>' + row(r.all) + row(r.inSample) + row(r.outSample) + '</tbody></table></div>';
    h += '<div class="panel" style="margin-top:14px"><h2>Account value over the test</h2>' + equityChart(r.state.curve, r.state.p.capital, r.cutDate) + '</div>';
    h += '<div class="panel tw" style="margin-top:14px"><h2>Year by year</h2><table>' + head + '<tbody>' + r.years.map(row).join('') + '</tbody></table></div>';
    return h;
  }
  function tabRules() {
    var p = eng.p;
    return '<div class="panel"><h2>Strategy ' + E.VERSION + ' · Close Breakout With Trend Filter</h2><p class="note">Daily closes, long and short, one pair. Every signal maps to one of these rules. The app interprets nothing else.</p><ul class="tight rules">' +
      '<li><b>R1 Trend.</b> Price closes above its ' + p.trendLen + '-day average: only longs. Below: only shorts.</li>' +
      '<li><b>R2 Break of structure.</b> The close is beyond every close of the previous ' + p.breakLen + ' days (above for longs, below for shorts). The order fills at the next day\'s rate, and is cancelled if that rate is back inside the range.</li>' +
      '<li><b>R3 Stop and target.</b> Stop ' + p.stopMult + ' × recent daily movement (average absolute daily change over ' + p.volLen + ' days) from the signal close. Target ' + p.targetMult + ' ×. Exit if a daily close passes either.</li>' +
      '<li><b>R4 Reward-to-risk gate.</b> Skip any setup below your minimum (default 1:2).</li>' +
      '<li><b>R5 Time limit.</b> Close a trade still open after ' + p.maxHold + ' bars.</li></ul>' +
      '<p>Position size = (capital × risk %) ÷ stop distance, cut to fit your exposure limit. Costs: spread, slippage and overnight financing from Settings.</p></div>' +
      '<div class="panel" style="margin-top:14px"><h2>Limits you should know</h2><ul class="tight"><li>Only one daily price per day is used, so intraday stop hits are not modelled. A real stop could trigger earlier or at another price.</li><li>Liquidity sweeps, change of character and volume are not used in v1. Daily spot forex data has no real volume.</li><li>Overnight financing is a placeholder. Real rollover differs by broker and by day.</li><li>A backtest describes the past. It does not promise anything about the future.</li></ul></div>' +
      '<div class="panel" style="margin-top:14px"><h2>Validation plan in short</h2><ol class="tight"><li>Import 10+ years of real daily data from a source you trust. Run the walk-forward test once.</li><li>Pass only if out-of-sample trades number 30 or more, profit factor stays above 1.2 after costs, and the worst drawdown is one you could live with.</li><li>Paper trade forward in real time for at least 3 months and 30 trades. Compare with the backtest.</li><li>Only then consider tiny real positions, as a separate version with your explicit opt-in.</li></ol><p class="note">The full plan is in the README that comes with the app files.</p></div>' +
      '<div class="panel" style="margin-top:14px"><h2>Not in this version</h2><p class="note">Importing your own strategy notes and books, learning from history, the trader profile, setup screenshots, logging your own trades, and live execution. Each is labelled as unavailable rather than faked.</p></div>';
  }
  function tabSettings() {
    var s = eng.p, h = '<form id="sf" class="panel"><h2>Risk limits and costs</h2><div class="form">' + SETTING_FIELDS.map(function (f) { return '<label class="f" for="s_' + f[0] + '">' + f[1] + '<input type="number" id="s_' + f[0] + '" name="' + f[0] + '" value="' + s[f[0]] + '" min="' + f[3] + '" max="' + f[4] + '" step="' + f[5] + '"><span class="d">' + f[2] + '</span></label>'; }).join('') + '</div><div class="row" style="margin-top:14px"><button class="btn primary" type="submit">Apply and restart replay</button></div><p class="note">Applying re-runs the paper replay from its start date, so the journal always matches the current settings. Limits like the daily stop have no override while a day is running.</p></form>';
    var m = S.data.meta;
    h += '<div class="panel" style="margin-top:14px"><h2>Market data</h2><p>Now using: <b>' + esc(pairName()) + '</b> · ' + esc(m.provider) + ' · ' + S.data.bars.length + ' days (' + S.data.bars[0].date + ' to ' + S.data.bars[S.data.bars.length - 1].date + ')</p>' +
      '<label class="f" for="span" style="max-width:320px">Replay starts<select id="span">' + [[0, 'At the first usable day'], [1, '1 year before the end'], [2, '2 years before the end'], [4, '4 years before the end']].map(function (o) { return '<option value="' + o[0] + '"' + (S.span === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
      '<div class="row" style="margin-top:14px"><button class="btn" data-act="demo">Use demonstration data</button><label class="btn" for="csvf" style="cursor:pointer">Import CSV<input id="csvf" type="file" accept=".csv,.txt" hidden></label><button class="btn" data-act="fx"' + (S.fxBusy ? ' disabled' : '') + '>' + (S.fxBusy ? 'Fetching…' : 'Fetch free EUR/USD rates') + '</button></div>' +
      '<p class="note" style="margin-top:10px">CSV needs a Date column and a Close column (Yahoo, Stooq and similar exports work). Use a USD-quoted pair such as EUR/USD or GBP/USD, daily. Name it: <input type="text" id="pairname" value="EUR/USD" style="min-height:40px;border-radius:8px;border:2px solid var(--line);background:var(--surface2);padding:0 10px;width:120px;color:inherit"></p>' +
      (S.msg ? '<div class="warn" style="margin-top:10px">' + esc(S.msg) + '</div>' : '') + '<p class="note">"Fetch" loads European Central Bank reference rates from the free Frankfurter service. It works when the app is hosted as your own web app. Inside a preview that blocks outside connections it will say so, and CSV import still works.</p></div>';
    h += '<div class="panel" style="margin-top:14px"><h2>Appearance</h2><div class="row"><button class="btn" data-act="theme">' + (S.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode') + '</button><button class="btn" data-act="reset">Reset everything</button></div></div>';
    return h;
  }

  var TABS = [['today', 'Today'], ['journal', 'Journal'], ['stats', 'Stats'], ['backtest', 'Test'], ['rules', 'Rules'], ['settings', 'Settings']];
  function render() {
    var m = mode(), body = { today: tabToday, journal: tabJournal, stats: tabStats, backtest: tabBacktest, rules: tabRules, settings: tabSettings }[S.tab]();
    document.documentElement.setAttribute('data-theme', S.theme);
    var pauseBtn = S.paused ? '<button class="pause on" data-act="pause">' + (S.resumeArm ? 'Tap again to resume' : 'Resume recommendations') + '</button>' : '<button class="pause" data-act="pause">EMERGENCY PAUSE</button>';
    $app.innerHTML = '<header class="top"><div style="min-width:0"><div class="brand">Disciplined Trading Assistant</div><span class="badge ' + m.c + '">' + m.t + '</span> <span class="badge" style="color:var(--muted)">Paper money</span></div>' + pauseBtn + '</header>' +
      '<nav class="nav" aria-label="Sections">' + TABS.map(function (t, k) { return '<button data-act="tab" data-v="' + t[0] + '"' + (S.tab === t[0] ? ' aria-current="page"' : '') + '>' + t[1] + '<kbd>' + (k + 1) + '</kbd></button>'; }).join('') + '</nav>' +
      '<main id="main">' + body + '<p class="note keys">Keys: Space or → next day · P pause · D details · 1–6 sections</p></main>';
  }
  function toast(t) { var d = document.createElement('div'); d.className = 'toast'; d.setAttribute('role', 'status'); d.textContent = t; document.body.appendChild(d); setTimeout(function () { d.remove(); }, 2600); }

  // ---------- data loading ----------
  function setData(d, msg) { S.data = d; S.acks = []; S.bt = null; S.msg = msg || ''; build(); }
  function sanity(bars) { var c = bars.map(function (b) { return b.close; }).sort(function (a, b) { return a - b; }); var med = c[Math.floor(c.length / 2)]; if (med > 10) throw new Error('These prices look like a pair such as USD/JPY. Version 1 supports USD-quoted pairs around 0.5 to 2.5 (EUR/USD, GBP/USD, AUD/USD).'); }
  function importCsv(file) {
    var r = new FileReader();
    r.onload = function () {
      try {
        var res = E.parseCSV(r.result); sanity(res.bars);
        var nm = (document.getElementById('pairname') || {}).value || 'EUR/USD';
        setData({ meta: { kind: 'csv', pair: nm, provider: 'Your CSV file: ' + file.name }, bars: res.bars }, 'Loaded ' + res.bars.length + ' days' + (res.skipped ? ' (' + res.skipped + ' rows skipped)' : '') + '.'); S.tab = 'today'; render(); toast('Real data loaded. Replay restarted.');
      } catch (e) { S.msg = e.message; render(); }
    };
    r.readAsText(file);
  }
  function iso(d) { return d.toISOString().slice(0, 10); }
  function fetchFx() {
    S.fxBusy = true; S.msg = ''; render();
    var hosts = ['https://api.frankfurter.dev/v1', 'https://api.frankfurter.app'], year = new Date().getUTCFullYear() - 8, end = new Date();
    function tryHost(k) {
      if (k >= hosts.length) return Promise.reject(new Error('Could not reach the rate service from here. If this page is a preview, host the app files yourself or import a CSV.'));
      var wins = []; for (var d = new Date(Date.UTC(year, 0, 1)); d <= end; d = new Date(d.getTime() + 85 * 864e5)) wins.push([iso(d), iso(new Date(Math.min(d.getTime() + 84 * 864e5, end.getTime())))]);
      var out = {}, idx = 0;
      function batch() {
        if (idx >= wins.length) return Promise.resolve();
        var part = wins.slice(idx, idx + 4); idx += 4;
        return Promise.all(part.map(function (w) { return fetch(hosts[k] + '/' + w[0] + '..' + w[1] + '?base=EUR&symbols=USD').then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (j) { Object.keys(j.rates || {}).forEach(function (dt) { out[dt] = j.rates[dt].USD; }); }); })).then(batch);
      }
      return batch().then(function () {
        var bars = Object.keys(out).sort().map(function (dt) { return { date: dt, close: out[dt] }; });
        var gaps = []; for (var q = 1; q < bars.length; q++) gaps.push(E.daysBetween(bars[q - 1].date, bars[q].date)); gaps.sort(function (a, b) { return a - b; });
        if (bars.length < 400 || gaps[Math.floor(gaps.length / 2)] > 3) throw new Error('The service did not return daily data, so the app refused to use it.');
        return bars;
      }).catch(function () { return tryHost(k + 1); });
    }
    tryHost(0).then(function (bars) { S.fxBusy = false; setData({ meta: { kind: 'fx', pair: 'EUR/USD', provider: 'ECB reference rates via Frankfurter' }, bars: bars }, 'Loaded ' + bars.length + ' days.'); S.tab = 'today'; render(); toast('Real data loaded. Replay restarted.'); })
      .catch(function (e) { S.fxBusy = false; S.msg = e.message; render(); });
  }

  // ---------- events ----------
  $app.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-act]'); if (!t) return; var a = t.getAttribute('data-act'), v = t.getAttribute('data-v');
    if (a === 'tab') { S.tab = v; save(); }
    else if (a === 'next') advance(1);
    else if (a === 'full') S.full = !S.full;
    else if (a === 'details') S.details = !S.details;
    else if (a === 'jf') S.jfilter = v;
    else if (a === 'pause') { if (!S.paused) { S.paused = true; S.resumeArm = false; } else if (!S.resumeArm) { S.resumeArm = true; render(); return; } else { S.paused = false; S.resumeArm = false; } save(); }
    else if (a === 'ack') { S.acks.push(eng.i); build(S.cur); toast('Review recorded. New trades are allowed again.'); }
    else if (a === 'bt') { S.bt = E.backtest(S.data.bars, params()); }
    else if (a === 'demo') { setData(demoData(), 'Using synthetic demonstration data.'); toast('Demonstration data loaded.'); }
    else if (a === 'fx') { fetchFx(); return; }
    else if (a === 'theme') { S.theme = S.theme === 'dark' ? 'light' : 'dark'; save(); }
    else if (a === 'reset') { try { localStorage.removeItem(LS); } catch (e) { /* ignore */ } S = Object.assign(S, { settings: {}, span: 2, acks: [], paused: false, bt: null, msg: '', tab: 'today', data: demoData() }); build(); toast('Reset.'); }
    render();
  });
  $app.addEventListener('submit', function (ev) {
    if (ev.target.id !== 'sf') return; ev.preventDefault();
    var s = {}, ok = true; SETTING_FIELDS.forEach(function (f) { var v = parseFloat(document.getElementById('s_' + f[0]).value); if (!(v >= f[3] && v <= f[4])) ok = false; s[f[0]] = v; });
    if (!ok) { S.msg = 'One of the values is out of range. Check the limits shown in each field.'; render(); return; }
    S.settings = s; S.acks = []; S.bt = null; S.msg = ''; build(); render(); toast('Settings applied. Replay restarted.');
  });
  $app.addEventListener('change', function (ev) { if (ev.target.id === 'span') { S.span = +ev.target.value; S.acks = []; S.bt = null; build(); render(); } else if (ev.target.id === 'csvf' && ev.target.files[0]) importCsv(ev.target.files[0]); });
  document.addEventListener('keydown', function (ev) {
    var tg = ev.target.tagName; if (tg === 'INPUT' || tg === 'SELECT' || tg === 'TEXTAREA' || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    var k = ev.key.toLowerCase();
    if (k === ' ' || k === 'arrowright') { if (tg === 'BUTTON' && k === ' ') return; ev.preventDefault(); advance(1); }
    else if (k === 'p') { S.paused = !S.paused; S.resumeArm = false; save(); }
    else if (k === 'd') S.details = !S.details;
    else if (/^[1-6]$/.test(k)) { S.tab = TABS[+k - 1][0]; save(); }
    else return;
    render();
  });

  load(); if (!S.data) S.data = demoData();
  build(S.cur != null && S.cur >= 0 ? S.cur : null); render();
})();
