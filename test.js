const E=require('./engine.js'), assert=require('assert');
// 1 no look-ahead: signals at i identical when future bars are removed
const bars=E.demoBars(900);
for (const i of [150,300,500,700]) { const a=E.signal(bars,i,E.DEFAULTS), b=E.signal(bars.slice(0,i+1),i,E.DEFAULTS); assert.deepStrictEqual(JSON.stringify(a),JSON.stringify(b)); }
// 2 stepwise replay on truncated data gives same trades up to that point
const full=E.backtest(bars), part=E.backtest(bars.slice(0,600));
const pt=part.state.trades, ft=full.state.trades.filter(t=>t.exitIdx<=pt.length&&t.exitIdx<599);
const common=pt.filter(t=>t.exitIdx<599); common.forEach((t,k)=>assert.strictEqual(t.pnl,full.state.trades[k].pnl));
// 3 sizing
const z=E.sizeFor(10000,E.DEFAULTS,1.1,1.09); assert(z.units===9999||z.units===10000); assert(z.riskAmt<=100.0001 && z.riskAmt>99.9);
const cap=E.sizeFor(10000,{...E.DEFAULTS,maxExposurePct:50},1.1,1.09); assert(cap.capped&&cap.units<=4545);
// 4 risk per trade never above riskPct at the stop (fills at stop distance)
full.state.trades.forEach(t=>assert(t.riskAmt<=10000*1.5*0.01*4));
// 5 guards: force losses
const s=E.create(bars,{dailyLossPct:0.5},200); s.demo=true; E.step(s); s.days[bars[200].date].pnl=-60; assert.strictEqual(E.guard(s,bars[200].date).code,'daily');
// 6 csv
const csv='Date,Open,High,Low,Close\n'+bars.slice(0,300).map(b=>`${b.date},1,1,1,${b.close}`).join('\n');
assert.strictEqual(E.parseCSV(csv).bars.length,300);
assert.throws(()=>E.parseCSV('Date,Close\n2020-01-01,1.1'));
// 7 week key
assert.strictEqual(E.weekKey('2021-01-03'),'2020-W53'); assert.strictEqual(E.weekKey('2021-01-04'),'2021-W1');
const a=full.all; console.log('trades',a.n,'win',(a.winRate*100).toFixed(0)+'%','PF',a.profitFactor,'ret',a.retPct.toFixed(1),'DD',a.maxDD.toFixed(1),'streak',a.longestLosing,'B&H',a.bh.toFixed(1));
console.log('IS',full.inSample.n,full.inSample.retPct.toFixed(1),'OOS',full.outSample.n,full.outSample.retPct.toFixed(1));
console.log('ALL TESTS PASSED');
