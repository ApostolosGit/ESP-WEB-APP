import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../style.css',import.meta.url),'utf8');
function extract(name) {
  const start=source.indexOf('  function '+name+'(');
  assert(start>=0,'Missing '+name);
  const next=source.indexOf('\n  function ',start+1);
  return source.slice(start,next>=0?next:source.length);
}
const funcs=[
  'escapeHtml','formatNumber','parseEnergyPrice','estimatedCostText',
  'saveEnergyPrice','tariffRow','utilityReferenceDateShort','diffTone',
  'renderTariffEnergy','restoreSettings'
].map(extract).join('\n');
const store=new Map();
const localStorage={
  getItem:key=>store.has(key)?store.get(key):null,
  setItem:(key,val)=>store.set(key,String(val))
};
const input=(value='')=>({value,textContent:'',focus(){this.focused=true;}});
const ui={
  energyPriceInput:input('0,25'),energyPriceStatus:input(),
  hostInput:input('test-host'),portInput:input('8884'),pathInput:input('/mqtt'),
  usernameInput:input(),passwordInput:input('topsecret')
};
let renders=0;
const ctx=vm.createContext({Intl,Number,String,Math,localStorage,ui,renderAll:()=>++renders});
const declarations=[
  'const ENERGY_PRICE_KEY="energy.pricePerKwh";',
  'const DEFAULT_ENERGY_PRICE=0.25;',
  'const DEFAULTS={host:"",port:"8884",path:"/mqtt"};',
  'let energyPricePerKwh=DEFAULT_ENERGY_PRICE;'
].join('\n');
vm.runInContext(declarations+'\n'+funcs,ctx);
const run=(name,...args)=>ctx[name](...args);
assert.equal(run('parseEnergyPrice','0,25'),0.25);
assert.equal(run('parseEnergyPrice','0.25'),0.25);
assert.equal(run('parseEnergyPrice',' 1,2345 '),1.2345);
assert.equal(run('parseEnergyPrice',''),null);
for(const invalid of ['abc','-1','Infinity','1,12345','100,1','1,2.3'])
  assert.equal(run('parseEnergyPrice',invalid),undefined,invalid);
run('restoreSettings');
assert.equal(ui.energyPriceInput.value,'0,25');
assert.equal(run('estimatedCostText',60),'(15€)');
let row=run('tariffRow','Διαφορά',60,'kWh','diff-positive');
assert.match(row,/60,00 <small>kWh<\/small> <small class="tariff-estimated-cost">\(15€\)<\/small>/);
assert(!run('tariffRow','Εκτίμηση τώρα',60).includes('tariff-estimated-cost'));
assert(!run('tariffRow','Διαφορά',null).includes('tariff-estimated-cost'));
assert.equal(run('estimatedCostText',-60),'(-15€)');
assert(run('renderTariffEnergy',{
  dual_zone:false,has_utility:true,estimate_valid:true,z_diff:60,z_now:100,z_ref:40
}).includes('(15€)'));
const dual=run('renderTariffEnergy',{
  dual_zone:true,has_utility:true,estimate_valid:true,
  z1_diff:60,z2_diff:4,z1_now:100,z2_now:20,z1_ref:40,z2_ref:16
});
assert(dual.includes('(15€)')&&dual.includes('(1€)'));
assert.equal((dual.match(/tariff-estimated-cost/g)||[]).length,2);
ui.energyPriceInput.value='0,30';
assert.equal(run('saveEnergyPrice'),true);
assert.equal(store.get('energy.pricePerKwh'),'0.3');
assert.equal(run('estimatedCostText',60),'(18€)');
assert.equal(renders,1);
ui.energyPriceInput.value='invalid';
assert.equal(run('saveEnergyPrice'),false);
assert.equal(store.get('energy.pricePerKwh'),'0.3');
assert.equal(renders,1);
ui.energyPriceInput.value='';
assert.equal(run('saveEnergyPrice'),true);
assert.equal(store.get('energy.pricePerKwh'),'');
assert(!run('tariffRow','Διαφορά',60).includes('tariff-estimated-cost'));
store.set('energy.pricePerKwh','0.25');
run('restoreSettings');
assert.equal(ui.energyPriceInput.value,'0,25');
assert.equal(run('estimatedCostText',60),'(15€)');
assert(html.includes('id="energyPriceInput"')&&html.includes('id="saveEnergyPriceBtn"'));
assert(css.includes('.tariff-row-value small'));
assert(source.includes('tariffRow("Διαφορά", zDiff'));
assert(source.includes('tariffRow("Διαφορά", z1Diff'));
assert(source.includes('tariffRow("Διαφορά", z2Diff'));
console.log('APP €/kWh default, comma/dot, persistence, validation, dual/mono difference and compact euro PASS');
