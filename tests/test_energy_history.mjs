import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT=dirname(fileURLToPath(import.meta.url));
const root=ROOT.endsWith('/tests') ? resolve(ROOT,'..') : ROOT;
const context={window:{},Date,Intl,Map,Number,Math};
vm.createContext(context);
vm.runInContext(fs.readFileSync(resolve(root,'history.js'),'utf8'),context);
const H=context.window.EnergyHistory;

const days=H.daily([
  {day:20000,wh:[1000,2000,3000,500,500,1500],flags:1,covered:60,first:1700000000,last:1700000060}
],3,20000);
assert.equal(days.length,3);
assert.equal(days[0].values[0],-1);
assert.equal(days[0].values[1],-1);
assert.equal(days[0].values[2],2.5);
assert.equal(days[1].values,null);
assert.equal(days[2].values,null);

const winterDay=Date.parse('2026-01-15T12:30:00+02:00')/1000;
const winterNight=Date.parse('2026-01-15T02:30:00+02:00')/1000;
const winterZ1=Date.parse('2026-01-15T08:30:00+02:00')/1000;
assert.equal(H.tariffZone(winterZ1),0);
assert.equal(H.tariffZone(winterDay),1);
assert.equal(H.tariffZone(winterNight),2);

const t0=Date.parse('2026-01-15T11:00:00+02:00')/1000;
const half=1800;
const points=[
  {epoch:t0,generation:1,import:0,export:0},
  {epoch:t0+half,generation:1,import:1000,export:0},
  {epoch:t0+2*half,generation:1,import:2000,export:0},
  {epoch:t0+3*half,generation:1,import:3000,export:0},
  {epoch:t0+4*half,generation:1,import:4000,export:0}
];
const hours=H.hourly(points,3,t0+4*half);
assert.equal(hours.length,3);
assert.equal(hours[0].values,null); // newest (current hour)
assert(hours[0].flags&16);
assert(hours[0].flags&32);
assert(Math.abs(hours[1].values[1]-2)<1e-9);
assert.equal(hours[1].values[0],0);
assert(Math.abs(hours[2].values[0]-2)<1e-9);
assert.equal(hours[2].values[1],0);
assert(hours[0].epoch > hours[1].epoch && hours[1].epoch > hours[2].epoch);

let chart=H.svg([
  {label:'A',values:[2.125,-3.456,1],flags:0},
  {label:'B',values:[1,2,3],flags:1}
],true);
assert.equal((chart.match(/class="bar-value"/g)||[]).length,2);
assert.equal((chart.match(/<rect /g)||[]).length,6);
assert(chart.includes('Ζ2 πρωί'));
assert(chart.includes('Ζ2 βράδυ'));
assert(chart.includes('Σ '));
const rectX=[...chart.matchAll(/<rect x="([^"]+)"/g)].map(m=>m[1]);
assert.equal(new Set(rectX.slice(0,3)).size,1);
assert.equal(new Set(rectX.slice(3,6)).size,1);
assert.notEqual(rectX[0],rectX[3]);
assert(!chart.includes('NaN'));

const mono=H.svg([{label:'mono',values:[2.125,-3.456,0],flags:0}],false);
assert.equal((mono.match(/<rect /g)||[]).length,1);
assert(mono.includes('>-1,331</text>'));
assert.equal((H.svg([{label:'zero',values:[0,0,0],flags:0}],true).match(/<line /g)||[]).length,1);
assert(!H.svg([{label:'<script>',values:[1],flags:0}],false).includes('<script>'));
assert(!H.svg([],false).includes('NaN'));
// A full 48-hour graph must render all 48 hourly slots, latest on the left,
// and exactly one X-axis date/time label per two hours.
const full48=H.hourly([],48,t0);
assert.equal(full48.length,48);
assert.equal(full48[0].epoch-full48.at(-1).epoch,47*3600);
const full48Svg=H.svg(full48,true);
assert.equal((full48Svg.match(/ y="282" /g)||[]).length,24);
assert(full48Svg.indexOf(full48[0].label)<full48Svg.indexOf(full48[2].label));
// Comparison mode renders 24 hourly slots per row, 12 time ticks in each,
// and uses a shared Y range even if one day consumes much more than the other.
const comparison=full48.map((g,i)=>({...g,values:i<24?[1,0,0]:[5,0,0],flags:0}));
const latestSvg=H.svg(comparison.slice(0,24),true,comparison);
const earlierSvg=H.svg(comparison.slice(24,48),true,comparison);
assert.equal((latestSvg.match(/ y="282" /g)||[]).length,12);
assert.equal((earlierSvg.match(/ y="282" /g)||[]).length,12);
assert.equal((latestSvg.match(/<rect /g)||[]).length,24);
assert.equal((earlierSvg.match(/<rect /g)||[]).length,24);
assert.equal(latestSvg.match(/viewBox="([^"]+)"/)[1],earlierSvg.match(/viewBox="([^"]+)"/)[1]);
assert.equal(
  [...latestSvg.matchAll(/<text x="50"[^>]*>[^<]*<\/text>/g)].map(m=>m[0]).join(''),
  [...earlierSvg.matchAll(/<text x="50"[^>]*>[^<]*<\/text>/g)].map(m=>m[0]).join('')
);
// In the hourly view, bar and 2-hour X-axis colors follow local Athens
// tariff hours rather than the browser timezone, including summer/winter.
const tariffCases=[
  ['2026-01-15T08:00:00+02:00',0,'#ff9800'], // winter Z1
  ['2026-01-15T13:00:00+02:00',1,'#ffd600'], // winter Z2 day
  ['2026-01-15T03:00:00+02:00',2,'#000000'], // winter Z2 night
  ['2026-07-15T08:00:00+03:00',0,'#ff9800'], // summer Z1
  ['2026-07-15T12:00:00+03:00',1,'#ffd600'], // summer Z2 day
  ['2026-07-15T03:00:00+03:00',2,'#000000']  // summer Z2 night
];
for(const [time,zone,color] of tariffCases) {
  const epoch=Date.parse(time)/1000;
  const group={epoch,label:'ώρες',values:[1,0,0],flags:0};
  assert.equal(H.tariffZone(epoch+1800),zone);
  const colored=H.svg([group],false);
  assert(colored.includes(`fill="${color}" data-hour-zone="${zone}"`));
  assert(colored.includes(`y="282" text-anchor="middle" fill="${color}"`));
  // The dual-tariff graph continues to preserve real zone-segment colors.
  const dualGroup={...group,values:[zone===0?1:0,zone===1?1:0,zone===2?1:0]};
  assert(H.svg([dualGroup],true).includes(`fill="${color}" data-hour-zone="${zone}"`));
}
const anchorSummer=Date.parse('2026-07-15T14:00:00+03:00')/1000;
const summerPoints=Array.from({length:97},(_,i)=>({
  epoch:anchorSummer-48*3600+i*1800,generation:1,import:i*100,export:0
}));
const summer48=H.hourly(summerPoints,48,anchorSummer);
for(const halfDay of [summer48.slice(0,24),summer48.slice(24,48)]) {
  const chartHtml=H.svg(halfDay,true,summer48);
  for(const color of ['#ff9800','#ffd600','#000000'])
    assert(chartHtml.includes(`fill="${color}"`),`Missing zone ${color} in one 24h plot`);
}
const css=fs.readFileSync(resolve(root,'style.css'),'utf8');
assert(css.includes('.legend-z1::before { background:#ff9800; }'));
assert(css.includes('.legend-z2-day::before { background:#ffd600; }'));
assert(css.includes('.legend-z2-night::before { background:#000000; }'));

const code=fs.readFileSync(resolve(root,'app.js'),'utf8');
const start=code.indexOf('  const historyStatus =');
const end=code.indexOf("  $('closeEnergyHistory').addEventListener",start);
const nodes=new Map();
const $=id=>{
  if(!nodes.has(id)) nodes.set(id,{value:'30',textContent:'',innerHTML:''});
  return nodes.get(id);
};
const packets=[],timers=new Map();let counter=0;
Object.assign(context,{
  $,EnergyHistory:H,historySession:null,
  historyDialog:{open:true,showModal(){}},
  devices:new Map([['test',{state:{firmware:'5.00',dual_zone:true}}]]),
  client:{connected:true,publish:(topic,msg)=>packets.push(msg)},
  BASE:'home/energy',compareFirmwareVersions:()=>0,showToast(){},
  escapeHtml:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
  setTimeout:fn=>{timers.set(++counter,fn);return counter;},
  clearTimeout:id=>timers.delete(id)
});
vm.runInContext(code.slice(start,end),context);

vm.runInContext("loadEnergyHistory('test')",context);
let token=packets.at(-1).split('|')[1];
assert.equal(packets.at(-1).split('|')[2],'1');
const feed=text=>context.handleEnergyHistory('test',text);
feed(`B|${token}|1|1700000000|2072576|100000|1972576|4000|3000|2000|0|1791302400`);
feed(`D|${token}|20731|1791302400|1791302460|16|60|1000|2000|3000|500|500|1500`);
feed(`E|${token}|16|1`);
assert.equal(packets.length,2);
assert($('energyHistoryPlot').innerHTML.includes('<svg'),'First verified page is shown before the next page arrives');
assert($('energyHistoryStatus').textContent.includes('Προσωρινή προβολή'));
assert.equal($('energyHistoryTable').innerHTML,'','Hidden table is not built for a partial page');
assert.equal(context.historySession.csvRows,null);
assert.equal($('exportEnergyHistoryCsv').disabled,true,'Partial results cannot be exported as complete');
assert.equal(packets.at(-1).split('|').at(-1),'16');
feed(`E|${token}|16|1`);
assert.equal(packets.length,2);
token=packets.at(-1).split('|')[1];
feed(`B|${token}|1|1700000000|2072576|100000|1972576|4000|3000|2000|0|1791302400`);
feed(`E|${token}|-1|0`);
assert($('energyHistoryMemory').textContent.includes('1972576'));
assert($('energyHistoryPlot').innerHTML.includes('<svg'));
assert.equal($('energyHistoryTable').innerHTML,'','Completed graph does not build an unused table');
assert.equal(context.historySession.tableData,null);
assert.equal(context.historySession.csvRows,null);
context.renderEnergyHistoryTable();
assert($('energyHistoryTable').innerHTML.includes('Ζ2 πρωί'));
assert($('energyHistoryTable').innerHTML.includes('Σύνολο'));
assert($('energyHistoryTable').innerHTML.includes('Χωρίς δεδομένα'));
assert.equal($('energyHistoryTable').hidden,true,'History table stays hidden by default');
assert.equal($('exportEnergyHistoryCsv').disabled,false);
assert.equal(context.historySession.csvRows,null,'Revealing a table does not create CSV rows');
assert.equal(context.energyHistoryCsvRows().length,31);
assert.equal(context.historySession.csvRows[0][0],'Περίοδος');
assert($('energyHistoryStatus').textContent.includes('30 ημέρες · νεότερη → παλαιότερη'));

const previousPlot=$('energyHistoryPlot').innerHTML;
context.loadEnergyHistory('test');
assert.equal($('energyHistoryPlot').innerHTML,previousPlot,'Refreshing the same device/range preserves the graph');
assert($('energyHistoryStatus').textContent.includes('προηγούμενο γράφημα'));
assert.equal($('energyHistoryTable').innerHTML,'');
assert.equal($('exportEnergyHistoryCsv').disabled,true);
token=packets.at(-1).split('|')[1];
feed(`B|${token}|1|1700000000|2072576|100000|1972576|4000|3000|2000|0|1791302400`);
feed(`E|${token}|-1|1`);
assert.equal(packets.at(-1).split('|').at(-1),'0');
assert.equal(context.historySession.retry,1);
assert.equal($('energyHistoryPlot').innerHTML,previousPlot,'A rejected page cannot replace the previous graph');

$('energyHistoryRange').value='48';
context.loadEnergyHistory('test');
assert.equal($('energyHistoryPlot').innerHTML,'','Changing range clears a graph from the other range');
token=packets.at(-1).split('|')[1];
assert.equal(packets.at(-1).split('|')[2],'0');
const p0=Date.parse('2026-10-12T14:00:00+03:00')/1000;
feed(`B|${token}|0|${p0}|2072576|100000|1972576|4000|3000|2000|0|${p0+3600}`);
feed(`P|${token}|${p0}|1|1000|0`);
feed(`P|${token}|${p0+1800}|1|1600|100`);
feed(`P|${token}|${p0+3600}|1|2300|200`);
feed(`E|${token}|-1|3`);
assert($('energyHistoryStatus').textContent.includes('48 ώρες · ανά ώρα'));
assert.equal(($('energyHistoryPlot').innerHTML.match(/<svg /g)||[]).length,2);
assert($('energyHistoryPlot').innerHTML.includes('Πρόσφατες 24 ώρες'));
assert($('energyHistoryPlot').innerHTML.includes('Προηγούμενες 24 ώρες'));
assert.equal($('energyHistoryTable').hidden,true);
assert.equal(context.historySession.csvRows,null);
assert.equal($('energyHistoryTable').innerHTML,'');
assert.equal(context.energyHistoryCsvRows().length,49);
assert.equal(context.historySession.csvRows[0].length,6);
assert.equal(context.historySession.rows.size,3);
assert.equal($('energyHistoryTable').innerHTML,'','CSV export does not construct the table DOM');
context.renderEnergyHistoryTable();
assert($('energyHistoryTable').innerHTML.includes('Σύνολο'));

assert(!code.includes('<option value="7">'));
assert(code.includes('<option value="48">Τελευταίες 48 ώρες · ανά ώρα</option>'));
assert(code.includes('`${BASE}/+/admin/history`'));
assert(fs.readFileSync(resolve(root,'sw.js'),'utf8').includes('./history.js?v=5.62'));
assert(fs.readFileSync(resolve(root,'index.html'),'utf8').indexOf('history.js')<fs.readFileSync(resolve(root,'index.html'),'utf8').indexOf('app.js'));
// The firmware sends the first 16 checkpoints with a 24h cutoff, then E
// exposes the checkpoint cursor. The APP must rewind and fetch older records.
$('energyHistoryRange').value='48';
context.loadEnergyHistory('test');
token=packets.at(-1).split('|')[1];
const anchor=p0+3600;
feed(`B|${token}|0|${anchor-40*3600}|2072576|100000|1972576|4000|3000|2000|0|${anchor}`);
for(let i=0;i<16;i++) {
  const epoch=anchor-23*3600+i*1800;
  feed(`P|${token}|${epoch}|1|${(i+1)*1000}|0`);
}
feed(`E|${token}|1016|16`);
assert.equal(context.historySession.backfillAttempted,true);
assert.equal(context.historySession.offset,944); // 1016 - 16 - 56
assert.equal(packets.at(-1).split('|').at(-1),'944');
token=packets.at(-1).split('|')[1];
feed(`B|${token}|0|${anchor-40*3600}|2072576|100000|1972576|4000|3000|2000|0|${anchor}`);
feed(`P|${token}|${anchor-44*3600}|1|0|0`);
feed(`P|${token}|${anchor-44*3600+1800}|1|500|0`);
feed(`E|${token}|-1|2`);
assert.equal(context.historySession.rows.size,18);
assert($('energyHistoryStatus').textContent.includes('νεότερη → παλαιότερη'));
assert.equal($('energyHistoryTable').innerHTML,'');
context.renderEnergyHistoryTable();
assert($('energyHistoryTable').innerHTML.includes('0,5'));
const chrono=H.hourly([...context.historySession.rows.values()],48,anchor);
assert(chrono[0].epoch>chrono.at(-1).epoch);
assert(chrono.some(g=>g.values && g.epoch<=anchor-43*3600));
// Failed pages must not leak into the progressively displayed history.
context.loadEnergyHistory('test');
token=packets.at(-1).split('|')[1];
feed(`B|${token}|0|${anchor-48*3600}|2072576|100000|1972576|4000|3000|2000|0|${anchor}`);
feed(`P|${token}|${anchor-3600}|1|1000|0`);
feed(`E|${token}|-1|2`); // Missing second record: discard this whole page.
assert.equal(context.historySession.rows.size,0);
assert.equal(context.historySession.pageData.size,0);
assert.equal(context.historySession.retry,1);
token=packets.at(-1).split('|')[1];
feed(`B|${token}|0|${anchor-48*3600}|2072576|100000|1972576|4000|3000|2000|0|${anchor}`);
feed(`P|${token}|${anchor-1800}|1|1500|0`);
feed(`E|${token}|-1|1`);
assert.equal(context.historySession.rows.size,1);
assert(!context.historySession.rows.has(anchor-3600));

// Keep a verified partial graph on timeout; do not advertise full completion.
context.loadEnergyHistory('test');
token=packets.at(-1).split('|')[1];
feed(`B|${token}|0|${anchor-48*3600}|2072576|100000|1972576|4000|3000|2000|0|${anchor}`);
feed(`P|${token}|${anchor-1800}|1|1500|0`);
feed(`E|${token}|16|1`);
const partialPlot=$('energyHistoryPlot').innerHTML;
assert.equal(context.energyHistoryCsvRows(),null);
for(let attempt=0;attempt<3;attempt++) {
  const callback=timers.get(context.historySession.timer);
  assert(callback); callback();
}
assert.equal(context.historySession.loading,false);
assert.equal($('energyHistoryPlot').innerHTML,partialPlot);
assert($('energyHistoryStatus').textContent.includes('δεν ολοκληρώθηκε'));
assert($('energyHistoryStatus').textContent.includes('μόνο τα δεδομένα'));
assert.equal($('exportEnergyHistoryCsv').disabled,true);
token=packets.at(-1).split('|')[1];
feed(`B|${token}|0|${anchor}|1|1|0|1|1|1|0|${anchor}`);
feed(`E|${token}|-1|0`);
assert.equal(context.historySession.complete,false,'Late frames cannot complete an abandoned request');

// Opening another device does not show the previous device's plot.
context.loadEnergyHistory('another-device');
assert.equal($('energyHistoryPlot').innerHTML,'');
console.log('Progressive verified MQTT pages, preserved refresh, lazy table/CSV, retries, timeouts, history and PWA PASS');

