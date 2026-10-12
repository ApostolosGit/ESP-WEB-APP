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
assert(Math.abs(hours[0].values[0]-2)<1e-9);
assert.equal(hours[0].values[1],0);
assert(Math.abs(hours[1].values[1]-2)<1e-9);
assert.equal(hours[1].values[0],0);
assert.equal(hours[2].values,null);
assert(hours[2].flags&16);
assert(hours[2].flags&32);

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
assert.equal(packets.at(-1).split('|').at(-1),'16');
feed(`E|${token}|16|1`);
assert.equal(packets.length,2);
token=packets.at(-1).split('|')[1];
feed(`B|${token}|1|1700000000|2072576|100000|1972576|4000|3000|2000|0|1791302400`);
feed(`E|${token}|-1|0`);
assert($('energyHistoryMemory').textContent.includes('1972576'));
assert($('energyHistoryPlot').innerHTML.includes('<svg'));
assert($('energyHistoryTable').innerHTML.includes('Ζ2 πρωί'));
assert($('energyHistoryTable').innerHTML.includes('Σύνολο'));
assert($('energyHistoryTable').innerHTML.includes('Χωρίς δεδομένα'));
assert($('energyHistoryStatus').textContent.includes('30 ημέρες · νεότερη → παλαιότερη'));

context.loadEnergyHistory('test');
token=packets.at(-1).split('|')[1];
feed(`B|${token}|1|1700000000|2072576|100000|1972576|4000|3000|2000|0|1791302400`);
feed(`E|${token}|-1|1`);
assert.equal(packets.at(-1).split('|').at(-1),'0');
assert.equal(context.historySession.retry,1);

$('energyHistoryRange').value='48';
context.loadEnergyHistory('test');
token=packets.at(-1).split('|')[1];
assert.equal(packets.at(-1).split('|')[2],'0');
const p0=Date.parse('2026-10-12T14:00:00+03:00')/1000;
feed(`B|${token}|0|${p0}|2072576|100000|1972576|4000|3000|2000|0|${p0+3600}`);
feed(`P|${token}|${p0}|1|1000|0`);
feed(`P|${token}|${p0+1800}|1|1600|100`);
feed(`P|${token}|${p0+3600}|1|2300|200`);
feed(`E|${token}|-1|3`);
assert($('energyHistoryStatus').textContent.includes('48 ώρες · ανά ώρα'));
assert.equal(context.historySession.rows.size,3);
assert($('energyHistoryTable').innerHTML.includes('Σύνολο'));

assert(!code.includes('<option value="7">'));
assert(code.includes('<option value="48">Τελευταίες 48 ώρες · ανά ώρα</option>'));
assert(code.includes('`${BASE}/+/admin/history`'));
assert(fs.readFileSync(resolve(root,'sw.js'),'utf8').includes('./history.js?v=5.57'));
assert(fs.readFileSync(resolve(root,'index.html'),'utf8').indexOf('history.js')<fs.readFileSync(resolve(root,'index.html'),'utf8').indexOf('app.js'));
console.log('App V5.57 charts: 48 hourly, stacked tariff zones, newest-first 30 days, MQTT paging and PWA precache PASS');
