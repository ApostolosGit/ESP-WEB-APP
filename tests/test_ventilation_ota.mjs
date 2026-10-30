import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const base = 'https://raw.githubusercontent.com/ApostolosGit/ESP8266-OTA.bin/main/';
const settings = {host:'mqtt.example',port:'8884',path:'/mqtt',username:'tester',password:'not-real'};
const vent = 'vent-18FE34000001', otherVent = 'vent-18FE34000002';

function boot() {
  const nodes = new Map(), timers = new Map(), intervals = new Map(), prompts = [], fetched = [], clients = [];
  let next = 0, now = 100000, fetchBody = '', accept = true;
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  function node() {
    return {value:'',innerHTML:'',textContent:'',open:false,disabled:false,checked:false,dataset:{},handlers:new Map(),
      classList:{add(){},remove(){},toggle(){},contains(){return false;}},
      addEventListener(k,fn){this.handlers.set(k,fn);},insertAdjacentElement(_,n){ids(n.innerHTML);},
      showModal(){this.open=true;},close(){this.open=false;},focus(){},select(){},reset(){},setAttribute(){},querySelectorAll(){return [];}};
  }
  function ids(markup) { for (const m of String(markup).matchAll(/\bid="([^"]+)"/g)) if (!nodes.has(m[1])) nodes.set(m[1],node()); }
  ids(html);
  const storage = new Map();
  const ctx = {
    console:{log(){},warn(){},error(){}},Date:ClockDate,Intl,Map,Set,Math,Number,JSON,URL,Promise,
    document:{body:{appendChild:n=>ids(n.innerHTML)},getElementById:k=>nodes.get(k)||null,createElement:node,
      querySelectorAll:()=>[node(),node()],addEventListener(){},visibilityState:'visible'},
    window:{addEventListener(){},location:{reload(){}},confirm(text){prompts.push(text);return accept;}},
    navigator:{serviceWorker:{controller:null,addEventListener(){},register:async()=>({update:async()=>{}})}},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    sessionStorage:{getItem(){return null;},setItem(){},removeItem(){}},
    fetch:async url=>{fetched.push(url);return {ok:true,text:async()=>fetchBody};},
    setTimeout(fn,ms){timers.set(++next,{fn,ms});return next;},clearTimeout:k=>timers.delete(k),
    setInterval(fn,ms){intervals.set(++next,{fn,ms});return next;},clearInterval:k=>intervals.delete(k),
    mqtt:{connect(){
      const handlers=new Map();
      const c={connected:false,published:[],on:(k,fn)=>handlers.set(k,fn),
        emit(k,...args){if(k==='connect')c.connected=true;handlers.get(k)?.(...args);},
        subscribe(_t,_o,cb){cb(null,[]);},publish(t,p,_o,cb){c.published.push({t,p});cb?.(null);},end(){c.connected=false;}};
      clients.push(c);return c;
    }}
  };
  vm.createContext(ctx);
  const bridge = 'globalThis.testApp={devices,connect,parseOtaManifest,otaManifestMatchesDevice,otaManifestUrlForDevice,energyDeviceIdentity,ventilationDeviceIdentity,renderOtaAvailability,selectTarget:id=>adminTargetId=id,remoteOtaCommand,startRemoteOta,confirmOtaFromHealth,setSession:v=>otaSession=v,getSession:()=>otaSession,getPending:()=>otaAwaitingStart};})();';
  vm.runInContext(source.replace(/\}\)\(\);\s*$/, bridge),ctx);
  const app = ctx.testApp;
  app.connect(settings);
  const c = clients.at(-1); c.emit('connect');
  return {app,nodes,timers,intervals,prompts,fetched,c,
    advance(ms){now+=ms;},get now(){return now;},setManifest(m){fetchBody=typeof m==='string'?m:manifestText(m);},setAccept(v){accept=v;},
    frame(id,suffix,data,retain=false){c.emit('message',`home/energy/${id}/${suffix}`,{toString:()=>typeof data==='string'?data:JSON.stringify(data)},{retain});},
    pin(value){nodes.get('otaPinInput').value=value;nodes.get('otaPinForm').handlers.get('submit')({preventDefault(){}});}};
}

const profile = {
  application:'ventilation',platform_version:'1.01',driver:'DS18B20-DHT11',
  oled:'NONE',profile:'ventilation-3ds18b20-2dht11-none',ota_protocol:2
};
function health(version='2.00', changes={}) {
  return {meter:'VENTILATION',device_type:'VENTILATION',firmware:version,
    meter_ok:false,read_attempted:true,has_sample:false,rssi:-50,chip_id:1,
    ...(Number(version)>=2 ? profile : {}),...changes};
}
function manifest(version='2.00', changes={}) {
  return {version,file:`Ventilation_ESP8266_V${version.replace('.', '_')}.bin`,
    size:581120,md5:'0123456789abcdef0123456789abcdef',meter:'VENTILATION',
    ...profile,...changes};
}
function manifestText(m) { return Object.entries(m).map(([k,v])=>`${k}=${v}`).join('\n'); }
const otaMessages=b=>b.c.published.filter(m=>m.t.endsWith('/admin/request')&&m.p.startsWith('ota_https'));
function availability(b,m) {
  b.app.selectTarget(vent);
  b.app.renderOtaAvailability(b.app.devices.get(vent),m);
  b.setManifest(m);
}

// The production file spelling remains accepted by installed 1.xx downloaders.
let b=boot(); const first=manifest();
assert.equal(first.file,'Ventilation_ESP8266_V2_00.bin');
assert.equal(b.app.parseOtaManifest(manifestText(first)).profile,profile.profile);
for(const field of ['application','platform_version','driver','oled','profile','ota_protocol']) {
  const bad={...first};delete bad[field];
  assert.throws(()=>b.app.parseOtaManifest(manifestText(bad)),/προφίλ/);
}
for(const change of [{application:'energymeter'},{driver:'DDS238'},{oled:'SSD1309'},
  {profile:'ventilation-3ds18b20-2dht11-ssd1309'},{ota_protocol:1},{platform_version:'bad'},
  {version:'2.00-beta'},{file:'../fw.bin'},{size:1.5},{md5:'bad'}])
  assert.throws(()=>b.app.parseOtaManifest(manifestText({...first,...change})));
b.frame(vent,'health',health('1.08'));
assert(!b.app.otaManifestMatchesDevice({...first,file:'Ventilation_ESP8266_V2_01.bin'},b.app.devices.get(vent)));
assert(!b.app.otaManifestMatchesDevice({...first,meter:'DDS238'},b.app.devices.get(vent)));

// Regression: published CommonPlatform 1.05 Ventilation V7_0.bin with version=7.0
// must be accepted as newer by 2.04 and remain strictly profile-matched.
b=boot();b.frame(vent,'health',health('2.04'));
const productionV7=manifest('7.0');
assert.equal(productionV7.file,'Ventilation_ESP8266_V7_0.bin');
assert(b.app.otaManifestMatchesDevice(productionV7,b.app.devices.get(vent)));
availability(b,productionV7);
assert.match(b.nodes.get('otaTargetInfo').innerHTML,/Available.*NEW/);
assert(!b.app.otaManifestMatchesDevice({...productionV7,file:'Ventilation_ESP8266_V7_1.bin'},b.app.devices.get(vent)));
assert(!b.app.otaManifestMatchesDevice({...productionV7,profile:'energymeter-jsy-mk333-ssd1309'},b.app.devices.get(vent)));
await b.app.startRemoteOta(vent);
assert.equal(b.prompts.length,1);
b.pin('12134');
assert.equal(otaMessages(b)[0].p,`ota_https_v2|${productionV7.size}|${productionV7.md5}|${base+productionV7.file}|${profile.profile}`);
// First migration uses the original request including PIN, never the v2 command.
// Explicit confirmation explains the new local .81 address and no OLED.
for(const version of ['1.04','1.07','1.08']) {
  b=boot();b.frame(vent,'health',health(version));availability(b,first);
  await b.app.startRemoteOta(vent);
  assert.equal(b.prompts.length,1);assert.match(b.prompts[0],/192\.168\.1\.81/);
  assert.match(b.prompts[0],/χωρίς OLED/i);assert.equal(otaMessages(b).length,0);
  b.pin('wrong');assert.equal(otaMessages(b).length,0);
  b.pin('12134');assert.equal(otaMessages(b).length,1);
  assert.equal(otaMessages(b)[0].p,`ota_https|${first.size}|${first.md5}|${base+first.file}|12134`);
  b.frame(vent,'admin/response',{ok:true,cmd:'ota_https',state:'starting',from:version});
  assert([...b.timers.values()].some(t=>t.ms===300000),'Migration permits the full OTA transfer plus reconnect');
}
b=boot();b.frame(vent,'health',health('1.08'));availability(b,first);b.setAccept(false);
await b.app.startRemoteOta(vent);assert.equal(otaMessages(b).length,0);assert(!b.nodes.get('otaPinDialog').open);

// Once installed, full profile identity is required even if a stale measurement
// from the old firmware arrives after the v2 health frame.
b=boot();b.frame(vent,'health',health());
assert.equal(b.app.ventilationDeviceIdentity(b.app.devices.get(vent)).profile,profile.profile);
assert.equal(b.app.otaManifestUrlForDevice(b.app.devices.get(vent)),base+'manifest-ventilation.txt');
assert(!b.app.otaManifestMatchesDevice({...first,oled:'SSD1309'},b.app.devices.get(vent)));
assert(!b.app.otaManifestMatchesDevice({...first,profile:'energymeter-dds238-ssd1309'},b.app.devices.get(vent)));
const incomplete=health();delete incomplete.profile;
b.frame(vent,'health',incomplete);
assert.throws(()=>b.app.otaManifestUrlForDevice(b.app.devices.get(vent)),/ταυτότητας/);
assert(!b.app.otaManifestMatchesDevice(first,b.app.devices.get(vent)));
b.frame(vent,'health',health());b.frame(vent,'state',{meter:'VENTILATION',firmware:'1.08'});
assert.throws(()=>b.app.otaManifestUrlForDevice(b.app.devices.get(vent)),/ταυτότητας/);
assert(!b.app.otaManifestMatchesDevice(first,b.app.devices.get(vent)),'Old state cannot bypass v2 profile checks');

// Modern OTA sends the exact profile using the common command, with PIN still
// required in the UI and no legacy PIN appended to the v2 wire format.
b=boot();b.frame(vent,'health',health());const next=manifest('2.01');availability(b,next);
await b.app.startRemoteOta(vent);assert.equal(otaMessages(b).length,0);b.pin('12134');
assert.equal(otaMessages(b)[0].p,`ota_https_v2|${next.size}|${next.md5}|${base+next.file}|${profile.profile}`);
b.frame(vent,'admin/response',{ok:true,cmd:'ota_https',state:'starting',from:'2.00'});
assert(b.app.getSession());
b.frame(vent,'health',health('2.01'));assert(b.app.getSession(),'No success before observed disconnection');
b.frame(vent,'status','offline',true);assert(!b.app.getSession().sawOffline,'Retained offline cannot prove the OTA cycle');
b.frame(vent,'status','offline');b.frame(vent,'status','online');b.advance(50);
b.frame(vent,'health',health('2.01'),true);assert(b.app.getSession(),'Retained matching health cannot complete OTA');
b.frame(vent,'state',{meter:'VENTILATION',firmware:'2.01'});assert(b.app.getSession(),'Version-only state cannot complete OTA');
b.frame(otherVent,'health',health('2.01'));assert(b.app.getSession(),'Another controller cannot complete OTA');
b.frame(vent,'health',health('2.01',{oled:'SSD1309'}));assert(b.app.getSession(),'Wrong build cannot complete OTA');
b.frame(vent,'health',health('2.01'));assert.equal(b.app.getSession(),null);
assert.match(b.nodes.get('otaProgressStatus').textContent,/2.01 ενεργό/);

// Pending target invalidates if identity changes while the operator enters PIN.
b=boot();b.frame(vent,'health',health());availability(b,next);await b.app.startRemoteOta(vent);
b.frame(vent,'health',health('2.00',{profile:'wrong'}));b.pin('12134');assert.equal(otaMessages(b).length,0);

// Ventilation retains its newer-only policy, including identical-version and
// downgrade denial; existing 1.xx and Boiler manifest contracts stay compatible.
for(const current of ['2.00','2.01']) {
  b=boot();b.frame(vent,'health',health(current));availability(b,first);
  await b.app.startRemoteOta(vent);assert.equal(b.prompts.length,0);assert.equal(otaMessages(b).length,0);
}
const oldManifest={version:'1.08',file:'Ventilation_ESP8266_V1_08.bin',size:first.size,md5:first.md5,meter:'VENTILATION'};
assert(b.app.otaManifestMatchesDevice(oldManifest,{id:vent,state:{meter:'VENTILATION',firmware:'1.07'}}));
assert(!b.app.otaManifestMatchesDevice(oldManifest,{id:vent,state:{meter:'VENTILATION',firmware:'2.00'},health:health()}));
const boiler={version:'1.05',file:'Boiler_ESP32C3_V1_05.bin',size:first.size,md5:first.md5,meter:'BOILER'};
assert.equal(b.app.remoteOtaCommand({id:'boiler',state:{meter:'BOILER',firmware:'1.04'}},boiler,base+boiler.file,'12134'),
  `ota_https|${first.size}|${first.md5}|${base+boiler.file}|12134`);
console.log('Ventilation 1.xx migration/PIN, v2 profiles and commands, .81 notice, five-minute transfer, strict fresh completion, newer-only and legacy/Boiler contracts PASS');
