import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const base = 'https://raw.githubusercontent.com/ApostolosGit/ESP8266-OTA/main/';
const settings = {host:'mqtt.example',port:'8884',path:'/mqtt',username:'tester',password:'not-real'};
const dds = 'DDS-18FE34000001', jsy = 'jsy_house-18FE34000002';

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
  const bridge = 'globalThis.testApp={devices,connect,parseOtaManifest,otaManifestMatchesDevice,otaManifestUrlForDevice,energyDeviceIdentity,remoteOtaCommand,startRemoteOta,confirmOtaFromHealth,setSession:v=>otaSession=v,getSession:()=>otaSession,getPending:()=>otaAwaitingStart};})();';
  vm.runInContext(source.replace(/\}\)\(\);\s*$/, bridge),ctx);
  const app = ctx.testApp;
  app.connect(settings);
  const c = clients.at(-1); c.emit('connect');
  return {app,nodes,timers,intervals,prompts,fetched,c,
    advance(ms){now+=ms;},get now(){return now;},setManifest(m){fetchBody=typeof m==='string'?m:manifestText(m);},setAccept(v){accept=v;},
    frame(id,suffix,data,retain=false){c.emit('message',`home/energy/${id}/${suffix}`,{toString:()=>typeof data==='string'?data:JSON.stringify(data)},{retain});},
    pin(value){nodes.get('otaPinInput').value=value;nodes.get('otaPinForm').handlers.get('submit')({preventDefault(){}});}};
}

function identity(meter='DDS238', display='SSD1309') {
  const driver = meter.includes('JSY') ? 'JSY-MK333' : 'DDS238';
  return {application:'energymeter',platform_version:'1.00',driver,oled:display,
    profile:`energymeter-${driver.toLowerCase()}-${display==='NONE'?'none':'ssd1309'}`,ota_protocol:2};
}
function health(meter='DDS238', version='6.00', display='SSD1309') {
  return {meter,firmware:version,meter_ok:false,read_attempted:true,has_sample:false,rssi:-50,chip_id:1,
    ...(Number(version)>=6?identity(meter,display):{})};
}
function manifest(meter='DDS238', version='6.00', display='SSD1309') {
  return {version,file:`EnergyMeter_${meter}_SSD1309_Ver6_00_test.bin`,size:600000,md5:'0123456789abcdef0123456789abcdef',meter,
    ...identity(meter,display)};
}
function manifestText(m) { return Object.entries(m).map(([k,v])=>`${k}=${v}`).join('\n'); }
const otaMessages=b=>b.c.published.filter(m=>m.t.endsWith('/admin/request')&&m.p.startsWith('ota_https'));

// Parse actual manifest format and validate the complete declared identity.
let b=boot(); const m=manifest(); const parsed=b.app.parseOtaManifest(manifestText(m));
assert.equal(parsed.profile,m.profile);assert.equal(parsed.ota_protocol,2);
for (const key of ['application','platform_version','driver','oled','profile','ota_protocol']) {
  const broken={...m}; delete broken[key];
  assert.throws(()=>b.app.parseOtaManifest(manifestText(broken)),/manifest|προφίλ/);
}
for (const changes of [{profile:'energymeter-dds238-none'},{oled:'SH1106'},{ota_protocol:1},{driver:'JSY'},
  {platform_version:'bad'},{version:'6.00-beta'},{file:'../wrong.bin'},{size:1.5},{md5:'bad'}])
  assert.throws(()=>b.app.parseOtaManifest(manifestText({...m,...changes})));

b.frame(dds,'health',health());
let device=b.app.devices.get(dds);
assert(b.app.otaManifestMatchesDevice(m,device));
assert(!b.app.otaManifestMatchesDevice(manifest('JSY-MK333'),device));
assert(!b.app.otaManifestMatchesDevice(manifest('DDS238','6.00','NONE'),device));
assert(!b.app.otaManifestMatchesDevice({...m,driver:'JSY-MK333'},device));
assert.equal(b.app.otaManifestUrlForDevice(device),base+'manifest-dds.txt');
b.frame(dds,'state',{meter:'DDS238',firmware:'6.00',voltage:230,power:10});
assert.equal(b.app.energyDeviceIdentity(device).profile,m.profile,'Plain measurements must retain health identity');
b.frame(dds,'health',health('DDS238','6.00','NONE'));
assert.equal(b.app.otaManifestUrlForDevice(device),base+'manifest-dds-no-oled.txt');
assert(!b.app.otaManifestMatchesDevice(m,device),'Headless must reject SSD1309 manifest');
b.frame(jsy,'health',health('JSY-MK-333','6.00','NONE'));
assert.equal(b.app.otaManifestUrlForDevice(b.app.devices.get(jsy)),base+'manifest-jsy-no-oled.txt');
b.frame(dds,'state',{meter:'DDS238',firmware:'5.59',power:10});
assert.throws(()=>b.app.otaManifestUrlForDevice(device),/ταυτότητας/,'An out-of-order old state cannot make v6 headless fall back to SSD1309');
b.frame(dds,'health',health('DDS238','6.00','NONE'));

// A device claiming v6 without its profile cannot fall back to legacy routing.
const incomplete=health();delete incomplete.profile;
b.frame(dds,'health',incomplete);
assert.throws(()=>b.app.otaManifestUrlForDevice(device),/ταυτότητας/);
assert(!b.app.otaManifestMatchesDevice(m,device));

// v5.58/5.59 retain their existing wire command for the first migration, but
// the explicit SSD1309 confirmation and the existing PIN are both required.
for(const version of ['5.58','5.59']) {
  b=boot();b.frame(dds,'health',health('DDS238',version));b.setManifest(m);
  assert.throws(()=>b.app.remoteOtaCommand(b.app.devices.get(dds),m,base+m.file),/επιβεβαίωση/);
  await b.app.startRemoteOta(dds);
  assert.equal(b.prompts.length,1);assert.match(b.prompts[0],/δεν αναφέρει τον τύπο οθόνης/);
  assert.match(b.prompts[0],/Επιβεβαίωσε.*SSD1309/);
  assert.equal(otaMessages(b).length,0,'Confirmation alone cannot send OTA');
  b.pin('wrong');assert.equal(otaMessages(b).length,0,'Wrong PIN cannot send OTA');
  b.pin('12134');assert.equal(otaMessages(b).length,1);
  assert.equal(otaMessages(b)[0].p,`ota_https|${m.size}|${m.md5}|${base+m.file}`);
}
b=boot();b.frame(dds,'health',health('DDS238','5.59'));b.setManifest(m);b.setAccept(false);
await b.app.startRemoteOta(dds);assert.equal(otaMessages(b).length,0);assert(!b.nodes.get('otaPinDialog').open);

// v6 uses the new profile-aware protocol, checks again after the PIN dialog,
// and allows the firmware's full four-minute transfer plus reconnect time.
b=boot();b.frame(dds,'health',health());b.setManifest(m);await b.app.startRemoteOta(dds);b.pin('12134');
assert.equal(otaMessages(b)[0].p,`ota_https_v2|${m.size}|${m.md5}|${base+m.file}|${m.profile}`);
b.frame(dds,'admin/response',{ok:true,cmd:'ota_https',state:'starting',from:'6.00'});
assert(b.app.getSession());assert([...b.timers.values()].some(t=>t.ms===300000));
b.frame(dds,'health',health());assert(b.app.getSession(),'A same-version live heartbeat before disconnection cannot complete OTA');
b.frame(dds,'status','offline');b.frame(dds,'status','online');
const start=b.app.getSession().startedAt;
b.advance(50);
b.frame(dds,'health',health(),true);assert(b.app.getSession(),'Retained health cannot complete OTA');
b.frame(dds,'state',{meter:'DDS238',firmware:'6.00',power:20});assert(b.app.getSession(),'Version-only state cannot complete OTA');
b.frame(jsy,'health',health('JSY-MK333'));assert(b.app.getSession(),'Another ESP cannot complete OTA');
b.frame(dds,'health',health('DDS238','6.00','NONE'));assert(b.app.getSession(),'Wrong profile cannot complete OTA');
const stale={...b.app.devices.get(dds),health:health(),healthReceivedAt:start-1};
b.app.confirmOtaFromHealth(stale);assert(b.app.getSession(),'Cached matching health cannot complete OTA');
b.frame(dds,'health',health());assert.equal(b.app.getSession(),null);
assert.match(b.nodes.get('otaProgressStatus').textContent,/6.00 ενεργό/);

b=boot();b.frame(dds,'health',health());b.setManifest(m);await b.app.startRemoteOta(dds);
b.frame(dds,'health',health('DDS238','6.00','NONE'));b.pin('12134');
assert.equal(otaMessages(b).length,0,'Profile changes during PIN entry invalidate pending OTA');

// Legacy shared-ID recognition remains available for old-format releases;
// the new v6 profile path strictly requires the same hardware device ID.
b=boot();
const oldManifest={version:'5.59',meter:'DDS238',oled:'SSD1309',file:'legacy.bin',size:600000,md5:m.md5};
b.app.setSession({id:'DDS',fromVersion:'5.58',targetVersion:'5.59',manifest:oldManifest,knownDeviceIds:new Set(),startedAt:b.now});
b.frame(dds,'health',health('DDS238','5.59'));assert.equal(b.app.getSession(),null);
b.app.setSession({id:'DDS',fromVersion:'5.59',targetVersion:'6.00',manifest:m,knownDeviceIds:new Set(),startedAt:b.now,sawOffline:true});
b.frame(dds,'health',health());assert(b.app.getSession(),'v6 must not match a different ID by prefix alone');

// Existing other-application manifest and command contracts are unaffected.
for(const [meter,file,version,id] of [
  ['VENTILATION','Ventilation_ESP8266_V1_08.bin','1.08','ventilation'],
  ['BOILER','Boiler_ESP32C3_V1_05.bin','1.05','boiler']]) {
  const other={version,meter,file,size:600000,md5:m.md5};
  const d={id,state:{meter,firmware:version}};
  assert(b.app.otaManifestMatchesDevice(other,d));
  assert.equal(b.app.remoteOtaCommand(d,other,base+file,'12345'),`ota_https|600000|${m.md5}|${base+file}|12345`);
}
console.log('EnergyMeter v6 profiles, legacy SSD/PIN transition, v2 commands, five-minute timeout, headless isolation, fresh exact-profile completion and other-app contracts PASS');
