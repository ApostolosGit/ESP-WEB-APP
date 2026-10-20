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
assert.equal((H.svg([{label:'zero',values:[0,0,0],flags:0}],true).match(/class="zero-axis"/g)||[]).length,1);
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
  [...latestSvg.matchAll(/<text class="y-tick"[^>]*>[^<]*<\/text>/g)].map(m=>m[0]).join(''),
  [...earlierSvg.matchAll(/<text class="y-tick"[^>]*>[^<]*<\/text>/g)].map(m=>m[0]).join('')
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


const anchor=Date.parse('2026-10-20T12:00:00+03:00')/1000;
const raw=Array.from({length:151},(_,i)=>({epoch:anchor-75*3600+i*1800,generation:1,import:5000+i*120,export:0}));
const feed=text=>context.handleEnergyHistory('test',text);
const lastRequest=()=>packets.at(-1).split('|');
const load=range=>{ $('energyHistoryRange').value=String(range);context.loadEnergyHistory('test'); };
function deliver(records,next,mode=0,declared=records.length) {
 const token=lastRequest()[1];
 feed(`B|${token}|${mode}|${raw[0].epoch}|2072576|100000|1972576|4000|3000|2000|0|${anchor}`);
 for(const row of records) {
  if(mode===0) feed(`P|${token}|${row.epoch}|${row.generation}|${row.import}|${row.export}`);
  else feed(`D|${token}|${row.day}|${row.first}|${row.last}|0|86400|1000|200|300|50|400|60`);
 }
 feed(`E|${token}|${next}|${declared}`);
}
function rawPage() {
 const offset=+lastRequest()[3];
 const first=offset===0?raw.findIndex(p=>p.epoch>=anchor-86400):offset;
 const rows=raw.slice(first,first+16), next=first+rows.length;
 deliver(rows,next<raw.length?next:-1);
 return offset;
}
// Recent checkpoint pages are gathered first. Do not expose the older end
// of a page before the newest hours needed to fill from the left are known.
load(48);
assert.equal(+lastRequest()[3],0);
rawPage();
assert.equal(context.historySession.firstRecentIndex,102);
assert.equal(context.historySession.offset,118);
assert.equal($('energyHistoryPlot').innerHTML,'');
assert.equal($('exportEnergyHistoryCsv').disabled,true);
const recentOffsets=[0];
while(context.historySession.phase==='recent') recentOffsets.push(rawPage());
assert.deepEqual(recentOffsets,[0,118,134,150]);
assert.equal(context.historySession.offset,86,'Backfill begins nearest the recent-day boundary');
assert($('energyHistoryPlot').innerHTML.includes('<svg'));
assert(context.historySession.groups.slice(0,24).some(g=>g.values));
assert(context.historySession.groups.slice(24).every(g=>g.values===null && g.pending),'Lower graph waits until the upper day has been revealed');
assert.equal($('energyHistoryTable').innerHTML,'');
assert.equal(context.historySession.tableData,null);
assert.equal(context.historySession.csvRows,null);
assert.equal(context.energyHistoryCsvRows(),null);
assert($('energyHistoryStatus').textContent.includes('Προσωρινή προβολή'));
const olderOffsets=[];
let previousFilled=0;
while(context.historySession.loading) {
 olderOffsets.push(rawPage());
 const lower=context.historySession.groups.slice(24);
 const filled=lower.filter(g=>g.values).length;
 assert(filled>=previousFilled,'Older pages add bars from left to right');
 if(context.historySession.loading) {
  const firstPending=lower.findIndex(g=>g.pending);
  assert(firstPending<0 || lower.slice(firstPending).every(g=>g.pending),'No older bar appears to the right of a pending gap in the contiguous fixture');
 }
 previousFilled=filled;
}
assert.deepEqual(olderOffsets,[86,70,54]);
assert.equal(context.historySession.complete,true);
assert.deepEqual(JSON.parse(JSON.stringify(context.historySession.groups)),JSON.parse(JSON.stringify(H.hourly(raw,48,anchor))));
assert.equal($('energyHistoryTable').innerHTML,'');
assert.equal(context.historySession.csvRows,null);
assert.equal($('exportEnergyHistoryCsv').disabled,false);
assert.equal(context.energyHistoryCsvRows().length,49);
assert.equal($('energyHistoryTable').innerHTML,'','CSV preparation does not build a DOM table');
context.renderEnergyHistoryTable();
assert($('energyHistoryTable').innerHTML.includes('Σύνολο'));
assert($('energyHistoryMemory').textContent.includes('1972576'));

// Refresh keeps the last graph; a rejected page must not leak data into it.
const completedPlot=$('energyHistoryPlot').innerHTML;
load(48);
assert.equal($('energyHistoryPlot').innerHTML,completedPlot);
assert($('energyHistoryStatus').textContent.includes('προηγούμενο γράφημα'));
assert.equal($('energyHistoryTable').innerHTML,'');
const rejected={epoch:anchor-100, generation:999,import:1,export:0};
deliver([rejected],-1,0,2);
assert.equal(context.historySession.rows.size,0);
assert.equal(context.historySession.pageData.size,0);
assert.equal(context.historySession.retry,1);
assert.equal($('energyHistoryPlot').innerHTML,completedPlot);
rawPage();
assert(!context.historySession.rows.has(rejected.epoch));
while(context.historySession.phase==='recent') rawPage();
const partialPlot=$('energyHistoryPlot').innerHTML;
for(let attempt=0;attempt<3;attempt++) {
 const callback=timers.get(context.historySession.timer);
 assert(callback);callback();
}
assert.equal(context.historySession.loading,false);
assert.equal(context.historySession.complete,false);
assert.equal($('energyHistoryPlot').innerHTML,partialPlot);
assert($('energyHistoryStatus').textContent.includes('δεν ολοκληρώθηκε'));
assert($('energyHistoryStatus').textContent.includes('μόνο τα δεδομένα'));
assert.equal($('exportEnergyHistoryCsv').disabled,true);
deliver([],-1);
assert.equal(context.historySession.complete,false,'Late responses cannot complete an abandoned transfer');

// Calendar slots permit newest-first daily fetching without firmware changes.
load(30);
assert.equal($('energyHistoryPlot').innerHTML,'','Changing range clears the previous graph');
assert.equal(+lastRequest()[3],14);
const today=Math.floor(anchor/86400);
const daysFixture=Array.from({length:30},(_,i)=>({day:today-29+i,first:anchor-(29-i)*86400-3600,last:anchor-(29-i)*86400}));
deliver(daysFixture.slice(14),-1,1);
assert.equal(+lastRequest()[3],0);
assert(context.historySession.groups.slice(0,16).every(g=>g.values));
assert(context.historySession.groups.slice(16).every(g=>g.pending));
context.renderEnergyHistoryTable();
assert($('energyHistoryTable').innerHTML.includes('Αναμονή δεδομένων'));
$('energyHistoryTable').hidden=false;
deliver(daysFixture.slice(0,16),16,1);
assert.equal(context.historySession.complete,true);
assert.equal(context.historySession.rows.size,30);
assert(context.historySession.groups.every(g=>g.values));
assert(!context.historySession.groups.some(g=>g.pending));
assert.equal(context.energyHistoryCsvRows().length,31);
assert($('energyHistoryTable').innerHTML.includes('Ζ2 πρωί'));
assert($('energyHistoryStatus').textContent.includes('30 ημέρες · νεότερη → παλαιότερη'));
context.loadEnergyHistory('another-device');
assert.equal($('energyHistoryPlot').innerHTML,'','Switching devices clears another meter\'s chart');

// Uniform Y ticks: mixed signs, tiny negatives and a large positive range,
// all-negative/all-zero values, and large labels that need extra left space.
for(const values of [[100,-.001,0],[.001,-100,0],[-7,-3,-1],[0,0,0],[1e6,-1e6,0],[1e-6,-1e-6,0]]) {
 for(const dual of [false,true]) {
  const chart=H.svg([{label:'signed',values,flags:0}],dual);
  const ticks=[...chart.matchAll(/class="y-tick" x="[^"]+" y="([^"]+)"[^>]*>([^<]+)<\/text>/g)];
  assert(ticks.length>=2 && ticks.length<=7);
  const ys=ticks.map(m=>+m[1]);
  for(let i=1;i<ys.length;i++) assert(ys[i-1]-ys[i]>=25,'Y tick labels must not overlap');
  assert.equal(new Set(ticks.map(m=>m[2])).size,ticks.length,'Tick labels must stay distinct, including tiny values');
  assert.equal((chart.match(/class="zero-axis"/g)||[]).length,1);
  assert(!chart.includes('NaN') && !chart.includes('Infinity'));
 }
}
const negativeMono=H.svg([{label:'negative',values:[-4,0,0],flags:0}],false);
const negLabel=+negativeMono.match(/class="bar-value"[^>]* y="([^"]+)"/)[1];
const negBar=negativeMono.match(/<rect [^>]*y="([^"]+)"[^>]*height="([^"]+)"/);
assert(negLabel>+negBar[1]+Number(negBar[2]),'Negative mono labels appear below their bar');
const pendingSvg=H.svg([{label:'pending',values:null,pending:true,flags:32}],true);
assert(!pendingSvg.includes('>×</text>'),'Pending slots are not presented as permanent missing data');
assert(!code.includes('<option value="7">'));
assert(code.includes('`${BASE}/+/admin/history`'));
const appVersion=code.match(/APP_VERSION = "([^"]+)"/)[1];
assert(fs.readFileSync(resolve(root,'sw.js'),'utf8').includes('./history.js?v='+appVersion));
console.log('Newest-first upper/lower ordering, reverse backfill, signed Y ticks, deferred table/CSV, retries, timeouts and range switching PASS');
