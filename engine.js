/* Disciplined Trading Assistant - rules engine. Plain, testable code: no AI, no network.
   Strategy v1.0 "Close Breakout With Trend Filter" (daily closes, long and short). */
(function (root) {
  'use strict';
  var PIP = 0.0001;
  var VERSION = 'v1.0';
  var DEFAULTS = {
    capital: 10000, riskPct: 1, minRR: 2, maxOpen: 1, maxExposurePct: 300,
    dailyLossPct: 2, weeklyLossPct: 4, maxDailyLosses: 3, streakPause: 6,
    spreadPips: 1, slipPips: 0.5, carryPips: 0.3,
    // strategy v1.0 rules (fixed; changing them means a new strategy version)
    trendLen: 100, breakLen: 20, volLen: 14, stopMult: 2, targetMult: 4, maxHold: 30
  };

  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function dayNum(d) { var p = d.split('-'); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000); }
  function daysBetween(a, b) { return dayNum(b) - dayNum(a); }
  function weekKey(d) { var n = dayNum(d); var dow = (n + 3) % 7; /* Mon=0 */ var thu = n - dow + 3; var y = new Date(thu * 86400000).getUTCFullYear(); var jan1 = Math.round(Date.UTC(y, 0, 1) / 86400000); return y + '-W' + (1 + Math.floor((thu - jan1) / 7)); }
  function isoFromNum(n) { return new Date(n * 86400000).toISOString().slice(0, 10); }
  function warmup(p) { return Math.max(p.trendLen, p.breakLen + 1, p.volLen + 1); }

  function demoBars(n) {
    var rnd = mulberry32(7), bars = [], px = 1.10, day = dayNum('2019-01-01'), drift = 0, left = 0;
    while (bars.length < n) {
      var dow = (day + 3) % 7; if (dow < 5) {
        if (left <= 0) { var r = rnd(); drift = r < 0.35 ? 0.0004 : r < 0.7 ? -0.0004 : 0; left = 60 + Math.floor(rnd() * 120); }
        left--;
        var z = 0; for (var k = 0; k < 6; k++) z += rnd(); z = (z - 3) / 0.7071; // approx normal
        px *= Math.exp(drift + 0.0045 * z);
        bars.push({ date: isoFromNum(day), close: Math.round(px * 1e5) / 1e5 });
      }
      day++;
    }
    return bars;
  }

  function parseCSV(text) {
    var lines = String(text).replace(/\r/g, '').split('\n').filter(function (l) { return l.trim(); });
    if (lines.length < 2) throw new Error('The file has no data rows.');
    var delim = [',', ';', '\t'].map(function (d) { return [d, lines[0].split(d).length]; }).sort(function (a, b) { return b[1] - a[1]; })[0][0];
    var head = lines[0].split(delim).map(function (s) { return s.trim().replace(/^"|"$/g, '').toLowerCase(); });
    var di = head.findIndex(function (h) { return h === 'date' || h === 'time' || h === 'datetime' || h === '<date>'; });
    var ci = head.findIndex(function (h) { return h === 'close' || h === '<close>'; });
    if (ci < 0) ci = head.findIndex(function (h) { return h === 'adj close' || h === 'price' || h === 'last' || h === 'rate'; });
    var hasHead = di >= 0 || ci >= 0 || isNaN(parseFloat(head[head.length - 1]));
    if (di < 0) di = 0; if (ci < 0) ci = head.length - 1;
    var out = {}, bad = 0;
    lines.slice(hasHead ? 1 : 0).forEach(function (l) {
      var c = l.split(delim).map(function (s) { return s.trim().replace(/^"|"$/g, ''); });
      var d = normDate(c[di]), v = parseFloat(String(c[ci]).replace(',', '.'));
      if (!d || !(v > 0)) { bad++; return; }
      out[d] = v;
    });
    var bars = Object.keys(out).sort().map(function (d) { return { date: d, close: out[d] }; });
    if (bars.length < 200) throw new Error('Only ' + bars.length + ' usable daily rows found. At least 200 are needed (about 10 months).');
    return { bars: bars, skipped: bad };
  }
  function normDate(s) {
    if (!s) return null; s = String(s).trim().slice(0, 10);
    var m;
    if ((m = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/.exec(s))) return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
    if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) return m[1] + '-' + m[2] + '-' + m[3];
    if ((m = /^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})/.exec(s))) { var a = +m[1], b = +m[2]; if (a > 12) return m[3] + '-' + pad(b) + '-' + pad(a); if (b > 12) return m[3] + '-' + pad(a) + '-' + pad(b); return null; /* ambiguous */ }
    return null;
  }
  function pad(x) { x = String(x); return x.length < 2 ? '0' + x : x; }

  // ---- indicators and the written rules ----
  function indicators(bars, i, p) {
    var c = bars[i].close, s = 0, j;
    for (j = i - p.trendLen + 1; j <= i; j++) s += bars[j].close;
    var sma = s / p.trendLen, hi = -Infinity, lo = Infinity;
    for (j = i - p.breakLen; j <= i - 1; j++) { hi = Math.max(hi, bars[j].close); lo = Math.min(lo, bars[j].close); }
    var v = 0; for (j = i - p.volLen + 1; j <= i; j++) v += Math.abs(bars[j].close - bars[j - 1].close);
    return { close: c, sma: sma, hi: hi, lo: lo, vol: v / p.volLen };
  }
  function signal(bars, i, p) {
    if (i < warmup(p)) return { type: 'norec', reason: 'Not enough price history yet for the rules.' };
    var x = indicators(bars, i, p), up = x.close > x.sma, dn = x.close < x.sma, d;
    var base = { ind: x, trend: up ? 'up' : dn ? 'down' : 'flat' };
    if (up && x.close > x.hi) d = 'long'; else if (dn && x.close < x.lo) d = 'short';
    if (!d) {
      var near = up ? 'It needs a close above ' + x.hi.toFixed(5) + ' (the ' + p.breakLen + '-day high close) to qualify.' : dn ? 'It needs a close below ' + x.lo.toFixed(5) + ' (the ' + p.breakLen + '-day low close) to qualify.' : '';
      return Object.assign(base, { type: 'none', reason: 'The price is ' + (up ? 'above' : 'below') + ' its ' + p.trendLen + '-day average, but it has not broken out of its recent range. ' + near });
    }
    var risk = p.stopMult * x.vol, stop = d === 'long' ? x.close - risk : x.close + risk, tgt = d === 'long' ? x.close + p.targetMult * x.vol : x.close - p.targetMult * x.vol;
    var rr = p.targetMult / p.stopMult;
    if (rr < p.minRR) return Object.assign(base, { type: 'rr', reason: 'A setup appeared, but its reward-to-risk (1:' + rr.toFixed(1) + ') is below your minimum (1:' + p.minRR + '), so the rules skip it.' });
    return Object.assign(base, { type: d, ref: x.close, stop: stop, target: tgt, level: d === 'long' ? x.hi : x.lo, rr: rr, rules: ['R1', 'R2', 'R3', 'R4'] });
  }

  function sizeFor(equity, p, entry, stop) {
    var dist = Math.abs(entry - stop); if (!(dist > 0)) return { units: 0 };
    var riskAmt = equity * p.riskPct / 100, units = riskAmt / dist, capped = false, cap = equity * p.maxExposurePct / 100;
    if (units * entry > cap) { units = cap / entry; capped = true; }
    units = Math.floor(units);
    return { units: units, riskAmt: units * dist, wantedRisk: riskAmt, notional: units * entry, capped: capped, dist: dist };
  }

  // ---- state machine ----
  function create(bars, params, start, opts) {
    var p = Object.assign({}, DEFAULTS, params || {});
    var w = warmup(p);
    start = Math.max(start == null ? w : start, w);
    return { bars: bars, p: p, i: start - 1, start: start, equity: p.capital, pos: null, pending: null, trades: [], log: [], curve: [], days: {}, weeks: {},
      curStreak: 0, reviewNeeded: false, acks: (opts && opts.acks) || [], today: opts && opts.today, rec: null, events: [], waitDays: 0 };
  }
  function dayOf(s, d) { return s.days[d] || (s.days[d] = { startEq: s.equity, pnl: 0, consec: 0 }); }
  function weekOf(s, d) { var k = weekKey(d); return s.weeks[k] || (s.weeks[k] = { startEq: s.equity, pnl: 0 }); }

  function guard(s, date) {
    var p = s.p, ds = dayOf(s, date), ws = weekOf(s, date);
    if (s.reviewNeeded) return { code: 'review', title: 'REVIEW YOUR JOURNAL', why: 'The strategy has lost ' + p.streakPause + ' trades in a row. This rule pauses new trades until you have looked through the journal. Open the Journal tab, read the recent trades, then tap "I have reviewed it". Nothing is wrong with you; this is a scheduled checkpoint.' };
    if (ds.pnl <= -p.dailyLossPct / 100 * ds.startEq) return { code: 'daily', title: 'TRADING DONE FOR TODAY', why: 'Today\'s losses reached your ' + p.dailyLossPct + '% daily limit. This rule exists so one rough day cannot turn into a rough week. Trading resumes tomorrow.' };
    if (ds.consec >= p.maxDailyLosses) return { code: 'streak', title: 'TRADING DONE FOR TODAY', why: p.maxDailyLosses + ' losing trades in a row today triggered the daily stop. This rule exists to prevent chasing losses. Trading resumes tomorrow.' };
    if (ws.pnl <= -p.weeklyLossPct / 100 * ws.startEq) return { code: 'weekly', title: 'TRADING DONE FOR THIS WEEK', why: 'This week\'s losses reached your ' + p.weeklyLossPct + '% weekly limit. This rule protects your capital while the strategy is out of rhythm. Trading resumes next Monday.' };
    return null;
  }

  function closeTrade(s, i, reason) {
    var b = s.bars[i], p = s.p, pos = s.pos, dir = pos.side === 'long' ? 1 : -1;
    var px = b.close - dir * (p.spreadPips / 2 + p.slipPips) * PIP;
    var held = daysBetween(pos.entryDate, b.date);
    var gross = (px - pos.entry) * dir * pos.units, carry = p.carryPips * PIP * pos.units * held;
    var pnl = gross - carry, R = pnl / pos.riskAmt;
    s.equity += pnl;
    var ds = dayOf(s, b.date), ws = weekOf(s, b.date);
    ds.pnl += pnl; ws.pnl += pnl;
    if (pnl < 0) { ds.consec++; s.curStreak++; } else { ds.consec = 0; s.curStreak = 0; }
    var t = { n: s.trades.length + 1, side: pos.side, entryDate: pos.entryDate, exitDate: b.date, entryIdx: pos.entryIdx, exitIdx: i, entry: pos.entry, exit: px, stop: pos.stop, target: pos.target, units: pos.units, riskAmt: pos.riskAmt, pnl: pnl, carry: carry, R: R, reason: reason, rules: pos.rules, equityAfter: s.equity, held: held };
    s.trades.push(t); s.pos = null;
    if (p.streakPause > 0 && s.curStreak >= p.streakPause) s.reviewNeeded = true;
    var why = reason === 'stop' ? 'closed beyond the stop-loss (R3)' : reason === 'target' ? 'reached the take-profit (R3)' : 'held ' + p.maxHold + ' bars without resolving (R5 time limit)';
    s.events.push({ type: 'exit', trade: t });
    s.log.push({ date: b.date, type: 'exit', text: 'Closed ' + pos.side + ' at ' + px.toFixed(5) + ': ' + why + '. Result ' + (pnl >= 0 ? '+' : '-') + '$' + Math.abs(pnl).toFixed(2) + ' (' + R.toFixed(2) + 'R).', rules: [reason === 'time' ? 'R5' : 'R3'] });
  }

  function step(s) {
    var i = ++s.i, b = s.bars[i], p = s.p; if (!b) { s.i--; return false; }
    s.events = []; dayOf(s, b.date); weekOf(s, b.date);
    var opened = false;
    // 1. fill the order decided at the previous close
    if (s.pending) {
      var o = s.pending, dir = o.side === 'long' ? 1 : -1, v = b.close; s.pending = null;
      var g = guard(s, b.date), px = v + dir * (p.spreadPips / 2 + p.slipPips) * PIP, why = null;
      if (g) why = 'a stop rule fired (' + g.title.toLowerCase() + ')';
      else if (o.side === 'long' ? v <= o.level : v >= o.level) why = 'the rate came back inside the ' + p.breakLen + '-day range before entry (invalidation)';
      else if (o.side === 'long' ? px <= o.stop : px >= o.stop) why = 'the rate was already beyond the stop-loss';
      var sz = why ? null : sizeFor(s.equity, p, px, o.stop);
      if (!why && sz.units < 1) why = 'the position size rounds to zero units';
      if (why) { s.events.push({ type: 'cancel', why: why, side: o.side }); s.log.push({ date: b.date, type: 'skip', text: 'Skipped the ' + o.side + ' setup from the previous close: ' + why + '.', rules: ['R2'] }); }
      else {
        s.pos = { side: o.side, entryIdx: i, entryDate: b.date, entry: px, stop: o.stop, target: o.target, units: sz.units, riskAmt: sz.riskAmt, notional: sz.notional, capped: sz.capped, rules: o.rules, level: o.level };
        opened = true; s.events.push({ type: 'entry', pos: s.pos });
        s.log.push({ date: b.date, type: 'entry', text: 'Opened paper ' + o.side + ' at ' + px.toFixed(5) + ', stop ' + o.stop.toFixed(5) + ', target ' + o.target.toFixed(5) + ', ' + sz.units.toLocaleString('en-US') + ' units, risking $' + sz.riskAmt.toFixed(2) + '.', rules: o.rules });
      }
    }
    // 2. manage the open position
    if (s.pos && !opened) {
      var ps = s.pos, c = b.close, lg = ps.side === 'long';
      if (lg ? c <= ps.stop : c >= ps.stop) closeTrade(s, i, 'stop');
      else if (lg ? c >= ps.target : c <= ps.target) closeTrade(s, i, 'target');
      else if (i - ps.entryIdx >= p.maxHold) closeTrade(s, i, 'time');
    }
    // 3. equity curve (marked to market at the mid rate)
    var eq = s.equity; if (s.pos) eq += (b.close - s.pos.entry) * (s.pos.side === 'long' ? 1 : -1) * s.pos.units;
    s.curve.push({ idx: i, date: b.date, eq: eq });
    // 4. review checkpoint acknowledgement
    if (s.reviewNeeded && s.acks.indexOf(i) >= 0) { s.reviewNeeded = false; s.curStreak = 0; s.log.push({ date: b.date, type: 'review', text: 'Journal review confirmed. New trades allowed again.', rules: [] }); }
    // 5. recommendation for this bar
    s.rec = recommend(s, i);
    return true;
  }

  function recommend(s, i) {
    var b = s.bars[i], p = s.p, last = i === s.bars.length - 1;
    var rec = { idx: i, date: b.date, close: b.close, kind: 'wait' };
    if (last && s.today && !s.demo && daysBetween(b.date, s.today) > 5) { rec.kind = 'norec'; rec.reason = 'The newest price in your data is from ' + b.date + ', which is more than 5 days old. The app will not guess. Import fresher data to continue.'; return rec; }
    var ex = s.events.filter(function (e) { return e.type === 'exit'; })[0];
    var g = guard(s, b.date);
    if (ex) { rec.kind = 'exit'; rec.trade = ex.trade; rec.guard = g; return rec; }
    if (s.pos) { rec.kind = 'holding'; rec.pos = s.pos; rec.openedToday = s.events.some(function (e) { return e.type === 'entry'; }); return rec; }
    var cancelled = s.events.filter(function (e) { return e.type === 'cancel'; })[0];
    if (g) { rec.kind = 'stop'; rec.guard = g; if (!s.log.length || s.log[s.log.length - 1].type !== 'block' || s.log[s.log.length - 1].date !== b.date) s.log.push({ date: b.date, type: 'block', text: g.title + '. ' + g.why, rules: [] }); return rec; }
    var sg = signal(s.bars, i, p); rec.sig = sg; rec.cancelled = cancelled;
    if (sg.type === 'long' || sg.type === 'short') {
      var sz = sizeFor(s.equity, p, sg.ref, sg.stop);
      if (sz.units < 1) { rec.kind = 'wait'; rec.reason = 'A setup appeared but the size would be zero units at your risk limit.'; return rec; }
      rec.kind = sg.type; rec.size = sz;
      s.pending = { side: sg.type, level: sg.level, stop: sg.stop, target: sg.target, rules: sg.rules };
      s.log.push({ date: b.date, type: 'signal', text: 'Setup found: ' + sg.type + '. Close ' + sg.ref.toFixed(5) + ' broke the ' + p.breakLen + '-day ' + (sg.type === 'long' ? 'high' : 'low') + ' close (' + sg.level.toFixed(5) + ') with the trend ' + sg.trend + '. Order to be filled at the next rate.', rules: sg.rules });
      return rec;
    }
    if (sg.type === 'norec') { rec.kind = 'norec'; rec.reason = sg.reason; return rec; }
    rec.kind = 'wait'; rec.reason = sg.reason; s.waitDays++;
    if (sg.type === 'rr') s.log.push({ date: b.date, type: 'skip', text: sg.reason, rules: ['R4'] });
    return rec;
  }

  // ---- statistics ----
  function stats(trades, curve, startEq) {
    var n = trades.length, wins = trades.filter(function (t) { return t.pnl > 0; }), loss = trades.filter(function (t) { return t.pnl <= 0; });
    var gw = wins.reduce(function (a, t) { return a + t.pnl; }, 0), gl = -loss.reduce(function (a, t) { return a + t.pnl; }, 0);
    var peak = startEq, dd = 0, ddDays = 0;
    (curve || []).forEach(function (c) { peak = Math.max(peak, c.eq); dd = Math.max(dd, (peak - c.eq) / peak); });
    var streak = 0, best = 0; trades.forEach(function (t) { if (t.pnl <= 0) { streak++; best = Math.max(best, streak); } else streak = 0; });
    var end = curve && curve.length ? curve[curve.length - 1].eq : startEq;
    return { n: n, wins: wins.length, winRate: n ? wins.length / n : null, avgWin: wins.length ? gw / wins.length : null, avgLoss: loss.length ? -gl / loss.length : null,
      avgR: n ? trades.reduce(function (a, t) { return a + t.R; }, 0) / n : null, avgWinR: wins.length ? wins.reduce(function (a, t) { return a + t.R; }, 0) / wins.length : null,
      profitFactor: gl > 0 ? gw / gl : (gw > 0 ? Infinity : null), net: trades.reduce(function (a, t) { return a + t.pnl; }, 0), retPct: (end / startEq - 1) * 100, maxDD: dd * 100, longestLosing: best };
  }

  function backtest(bars, params) {
    var s = create(bars, params, null, { acks: [] }); s.demo = true;
    while (step(s)) { /* run */ }
    var p = s.p, first = s.start, n = bars.length, cut = first + Math.floor(0.6 * (n - first));
    function seg(a, b, label) {
      var tr = s.trades.filter(function (t) { return t.entryIdx >= a && t.entryIdx <= b; });
      var cv = s.curve.filter(function (c) { return c.idx >= a && c.idx <= b; });
      var startEq = a > first ? (s.curve[a - first - 1] ? s.curve[a - first - 1].eq : p.capital) : p.capital;
      var st = stats(tr, cv, startEq); st.label = label; st.from = bars[a].date; st.to = bars[b].date;
      st.bh = (bars[b].close / bars[Math.max(a - 1, 0)].close - 1) * 100; st.trades = tr; return st;
    }
    var years = {}, out = [];
    for (var k = first; k < n; k++) { var y = bars[k].date.slice(0, 4); (years[y] = years[y] || [k, k])[1] = k; }
    Object.keys(years).forEach(function (y) { out.push(seg(years[y][0], years[y][1], y)); });
    return { state: s, all: seg(first, n - 1, 'All tested data'), inSample: seg(first, cut - 1, 'First 60% (in-sample)'), outSample: seg(cut, n - 1, 'Last 40% (out-of-sample)'), years: out, cutDate: bars[cut].date };
  }

  var api = { PIP: PIP, VERSION: VERSION, DEFAULTS: DEFAULTS, demoBars: demoBars, parseCSV: parseCSV, signal: signal, sizeFor: sizeFor, create: create, step: step, guard: guard, stats: stats, backtest: backtest, daysBetween: daysBetween, weekKey: weekKey, warmup: warmup };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Engine = api;
})(typeof self !== 'undefined' ? self : this);
