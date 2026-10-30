import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const base = 'https://raw.githubusercontent.com/ApostolosGit/ESP32-OTA.bin/main/';
const id = 'boiler-18FE34000001';
const md5 = '0123456789abcdef0123456789abcdef';

function profile(oled='SH1106') {
  return {application:'boiler',platform_version:'1.05',driver:'4XDS18B20',oled,
    profile:'esp32c3-boiler-4ds18b20-'+oled.toLowerCase(),ota_protocol:2};
}
function health(version='3.05',oled='SH1106',changes={}) {
  return {meter:'BOILER',device_type:'BOILER',firmware:version,
    meter_ok:false,read_attempted:true,has_sample:false,rssi:-60,chip_id:1234,
    ...profile(oled),...changes};
}
function manifest(version='4.00',oled='SSD1309',changes={}) {
  return {version,file:`Boiler_ESP32C3_V${version.replace('.','_')}.bin`,
    size:1468288,md5,meter:'BOILER',...profile(oled),...changes};
}
function manifestText(m) { return Object.entries(m).map(([k,v])=>`${k}=${v}`).join('\n'); }

function boot() {
  const nodes=new Map(),timers=new Map(),intervals=new Map(),prompts=[],fetched=[],clients=[];
  let next=0,now=100000,fetchBody='',accept=true;
  class ClockDate extends Date {
    constructor(...args){super(...(args.length?args:[now]));}
    static now(){return now;}
  }
  function node() {
    return {value:'',innerHTML:'',textContent:'',open:false,disabled:false,checked:false,dataset:{},handlers:new Map(),
      classList:{add(){},remove(){},toggle(){},contains(){return false;}},
      addEventListener(k,fn){this.handlers.set(k,fn);},insertAdjacentElement(_,n){ids(n.innerHTML);},
      showModal(){this.open=true;},close(){this.open=false;},focus(){},select(){},reset(){},
      setAttribute(){},querySelectorAll(){return [];}};
  }
  function ids(markup){for(const m of String(markup).matchAll(/\bid="([^"]+)"/g))
    if(!nodes.has(m[1]))nodes.set(m[1],node());}
  ids(html);
  const storage=new Map();
  const ctx={
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
        subscribe(_t,_o,cb){cb(null,[]);},publish(t,p,_o,cb){c.published.push({t,p});cb?.(null);},
        end(){c.connected=false;}};
      clients.push(c);return c;
    }}
  };
  vm.createContext(ctx);
  const bridge='globalThis.testApp={devices,connect,parseOtaManifest,boilerDeviceIdentity,otaManifestMatchesDevice,otaManifestUrlForDevice,renderOtaAvailability,selectTarget:id=>adminTargetId=id,startRemoteOta,remoteOtaCommand,confirmOtaFromHealth,setSession:v=>otaSession=v,getSession:()=>otaSession};})();';
  vm.runInContext(source.replace(/\}\)\(\);\s*$/,bridge),ctx);
  const app=ctx.testApp;
  app.connect({host:'mqtt.example',port:'8884',path:'/mqtt',username:'tester',password:'not-real'});
  const c=clients.at(-1);c.emit('connect');
  return {app,nodes,timers,prompts,fetched,c,
    advance(ms){now+=ms;},
    setManifest(m){fetchBody=manifestText(m);},
    setAccept(v){accept=v;},
    frame(type,data,retained=false){c.emit('message',`home/energy/${id}/${type}`,
      {toString:()=>typeof data==='string'?data:JSON.stringify(data)},{retain:retained});},
    pin(value){nodes.get('otaPinInput').value=value;
      nodes.get('otaPinForm').handlers.get('submit')({preventDefault(){}});}
  };
}
function otaMessages(b){return b.c.published.filter(x=>x.t.endsWith('/admin/request')&&x.p.startsWith('ota_https'));}
function availability(b,m) {
  b.app.selectTarget(id);
  b.app.renderOtaAvailability(b.app.devices.get(id),m);
  b.setManifest(m);
}

let b=boot();const target=manifest();
assert.equal(b.app.parseOtaManifest(manifestText(target)).profile,'esp32c3-boiler-4ds18b20-ssd1309');
for(const change of [{oled:'NONE'},{profile:'esp32c3-boiler-4ds18b20-sh1106'},
  {driver:'DDS238'},{ota_protocol:1},{application:'energymeter'}])
  assert.throws(()=>b.app.parseOtaManifest(manifestText({...target,...change})),/Boiler manifest/);

b.frame('health',health('3.05','SH1106'));
const device=b.app.devices.get(id);
assert.equal(b.app.boilerDeviceIdentity(device)?.oled,'SH1106');
assert(b.app.otaManifestMatchesDevice(target,device),'pre-v4 SH1106 identity may target confirmed SSD1309 hardware');
assert(!b.app.otaManifestMatchesDevice({...target,profile:'esp32c3-boiler-4ds18b20-sh1106'},device));
assert(!b.app.otaManifestMatchesDevice({...target,driver:'JSY'},device));
assert(!b.app.otaManifestMatchesDevice(manifest('4.01'),device),'migration limited to 4.00');
assert(!b.app.otaManifestMatchesDevice(manifest('4.00','NONE'),device));

availability(b,target);
assert.match(b.nodes.get('otaTargetInfo').innerHTML,/Available.*NEW/);
await b.app.startRemoteOta(id);
assert.equal(b.prompts.length,1);
assert.match(b.prompts[0],/1,54/);
assert.match(b.prompts[0],/SSD1309/);
assert.match(b.prompts[0],/SH1106/);
assert.equal(otaMessages(b).length,0);
b.pin('wrong');assert.equal(otaMessages(b).length,0);
b.pin('12134');assert.equal(otaMessages(b).length,1);
assert.equal(otaMessages(b)[0].p,
  `ota_https_v2|${target.size}|${target.md5}|${base+target.file}|esp32c3-boiler-4ds18b20-sh1106`,
  'Current firmware receives its OWN profile in the command, not the new one');
b.frame('admin/response',{ok:true,cmd:'ota_https',state:'starting',from:'3.05'});
assert(b.app.getSession());
b.frame('status','offline');
b.frame('status','online');
b.advance(100);
b.frame('health',health('4.00','SH1106'));
assert(b.app.getSession(),'Version alone with old profile must not complete the OTA');
b.frame('health',health('4.00','SSD1309'),true);
assert(b.app.getSession(),'Retained health cannot confirm OTA');
b.frame('health',health('4.00','SSD1309'));
assert.equal(b.app.getSession(),null,'Fresh SSD1309 v4.00 health confirms successful OTA');

b=boot();b.frame('health',health('3.05','SH1106'));availability(b,target);b.setAccept(false);
await b.app.startRemoteOta(id);
assert.equal(otaMessages(b).length,0,'Operator cancel must not send OTA');

b=boot();b.frame('health',health('4.00','SH1106'));
assert(!b.app.otaManifestMatchesDevice(target,b.app.devices.get(id)),
  'Already-v4 SH1106 cannot silently replace same-version firmware');
b=boot();b.frame('health',health('4.00','SSD1309'));
assert(b.app.otaManifestMatchesDevice(target,b.app.devices.get(id)),
  'New firmware identity is an exact SSD1309 match');

const sh1106 = manifest('4.01','SH1106');
const sh1106ManifestUrl = base + 'manifest-boiler-sh1106.txt';
const ssdManifestUrl = base + 'manifest-boiler.txt';
// SH1106 1.3-inch and SSD1309 1.54-inch devices must fetch separate manifests.
b=boot();b.frame('health',health('3.05','SH1106'));
assert.equal(b.app.otaManifestUrlForDevice(b.app.devices.get(id)),sh1106ManifestUrl);
assert(b.app.otaManifestMatchesDevice(sh1106,b.app.devices.get(id)));
assert(!b.app.otaManifestMatchesDevice({...sh1106,profile:'esp32c3-boiler-4ds18b20-ssd1309'},b.app.devices.get(id)));
availability(b,sh1106);
await b.app.startRemoteOta(id);
assert.equal(b.prompts.length,1);
assert.match(b.prompts[0],/SH1106/);
assert.equal(otaMessages(b).length,0,'SH1106 requires PIN before sending OTA');
b.pin('wrong');assert.equal(otaMessages(b).length,0);
b.pin('12134');assert.equal(otaMessages(b).length,1);
assert.equal(otaMessages(b)[0].p,
  `ota_https_v2|${sh1106.size}|${sh1106.md5}|${base+sh1106.file}|esp32c3-boiler-4ds18b20-sh1106`);
b.frame('admin/response',{ok:true,cmd:'ota_https',state:'starting',from:'3.05'});
assert(b.app.getSession());
b.frame('status','offline');b.frame('status','online');b.advance(100);
b.frame('health',health('4.01','SSD1309'));
assert(b.app.getSession(),'Incorrect OLED target must not count as OTA completion');
b.frame('health',health('4.01','SH1106'));
assert.equal(b.app.getSession(),null,'Fresh SH1106 4.01 health confirms successful OTA');

b=boot();b.frame('health',health('4.00','SSD1309'));
assert.equal(b.app.otaManifestUrlForDevice(b.app.devices.get(id)),ssdManifestUrl);
assert(!b.app.otaManifestMatchesDevice(sh1106,b.app.devices.get(id)),
  'SSD1309 1.54-inch must never automatically receive SH1106 firmware');
assert(b.app.otaManifestMatchesDevice(target,b.app.devices.get(id)));
b=boot();b.frame('health',health('4.01','SH1106'));
assert.equal(b.app.otaManifestUrlForDevice(b.app.devices.get(id)),sh1106ManifestUrl);
assert(b.app.otaManifestMatchesDevice(sh1106,b.app.devices.get(id)));
b=boot();b.frame('health',health('3.05','SH1106',{profile:'invalid'}));
assert.throws(()=>b.app.otaManifestUrlForDevice(b.app.devices.get(id)),/ταυτότητας/);
assert(!b.app.otaManifestMatchesDevice(sh1106,b.app.devices.get(id)));

console.log('Boiler v4 SSD1309 and v4.01 SH1106 manifest, SH1106->SSD1309 confirmation/PIN, OTA v2 source profile, fresh target profile and no-same-version overwrite PASS');
