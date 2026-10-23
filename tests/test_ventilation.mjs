import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const appSource = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const nodes = new Map(), timers = new Map(), clients = [];
let idClock = 0, confirms = 0;
const addIds = (markup) => {
  for (const found of String(markup).matchAll(/\bid="([^"]+)"/g))
    if (!nodes.has(found[1])) nodes.set(found[1], makeNode());
};
function makeNode() {
  return {value:"",innerHTML:"",textContent:"",open:false,disabled:false,checked:false,
    dataset:{},handlers:new Map(),
    classList:{add(){},remove(){},toggle(){},contains(){return false;}},
    addEventListener(event,callback){this.handlers.set(event,callback);},
    insertAdjacentElement(_,node){addIds(node.innerHTML);},
    querySelectorAll(){return [];},
    showModal(){this.open=true;},close(){this.open=false;},focus(){},reset(){},setAttribute(){}
  };
}
addIds(html);
const footer=[makeNode(),makeNode()];
const memory = new Map();
const ctx={
  console:{log(){},warn(){},error(){}},Date,Intl,Map,Set,Math,Number,JSON,URL,Promise,
  document:{body:{appendChild(n){addIds(n.innerHTML);}},getElementById(id){return nodes.get(id)||null;},
    createElement(){return makeNode();},querySelectorAll(){return footer;},addEventListener(){},visibilityState:"visible"},
  window:{addEventListener(){},confirm(){confirms++;return true;},location:{reload(){}}},
  navigator:{serviceWorker:{controller:null,addEventListener(){},register:async()=>({update:async()=>{}})}},
  localStorage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)},
  sessionStorage:{getItem(){return null;},setItem(){},removeItem(){}},
  setTimeout(fn){timers.set(++idClock,fn);return idClock;},clearTimeout(id){timers.delete(id);},
  setInterval(){return ++idClock;},clearInterval(){},
  mqtt:{connect(){const handlers=new Map();const c={connected:false,published:[],
    on(name,fn){handlers.set(name,fn);},
    emit(name,...args){if(name==="connect")this.connected=true;handlers.get(name)?.(...args);},
    subscribe(_topics,_options,cb){cb(null,[]);},
    publish(t,p,_options,cb){this.published.push({topic:t,payload:p});cb?.(null);},
    end(){this.connected=false;}
  };clients.push(c);return c;}}
};
vm.createContext(ctx);
const patched=appSource.replace(/\}\)\(\);\s*$/, "globalThis.vtest={devices,meterType,otaManifestMatchesDevice,otaManifestUrlForDevice,startRemoteOta,sendVentCommand,openVentHistory,requestVentHistory,handleVentHistory,getHistory:()=>ventHistorySession};})();");
assert.notEqual(patched,appSource,"app test bridge");
vm.runInContext(patched,ctx);

ctx.vtest.devices.clear();
const settings={host:"mqtt.example",port:"8884",path:"/mqtt",username:"tester",password:"not-real"};
ctx.vtest.devices.clear();
const app=ctx.vtest;
const connection=ctx.mqtt.connect;
 // Use the real application connect by exposing it from the closure below.
assert(html.includes('id="ventilationSettings"'));
assert(html.includes('id="ventHistoryDialog"'));
assert(html.includes('v=5.71'));
assert(appSource.includes('const APP_VERSION = "5.71"'));
assert(appSource.includes('type === "VENTILATION"'));
assert(appSource.includes("manifest-ventilation.txt"));
assert(appSource.includes('meterType(device) === "VENTILATION"'));
assert(appSource.includes('startRemoteOta(id)'));

// Open a real MQTT connection using the same mocked client API as the production app.
const start=appSource.replace(/\}\)\(\);\s*$/, "globalThis.vtest={devices,connect,meterType,otaManifestMatchesDevice,otaManifestUrlForDevice,startRemoteOta,sendVentCommand,openVentHistory,requestVentHistory,handleVentHistory,getHistory:()=>ventHistorySession};})();");
assert(start.includes("globalThis.vtest"));
const ctx2={...ctx};
const doc2=new Map();
function buildContext(){
  const nodeMap=new Map(), published=[], delayed=new Map();
  const defineIds=markup=>{for(const m of String(markup).matchAll(/\bid="([^"]+)"/g))if(!nodeMap.has(m[1]))nodeMap.set(m[1],mockNode());};
  function mockNode(){
    const classes=new Set();
    return {innerHTML:"",textContent:"",value:"",open:false,disabled:false,checked:false,handlers:new Map(),dataset:{},
      classList:{add(c){classes.add(c);},remove(c){classes.delete(c);},
        toggle(c,force){const on=force===undefined?!classes.has(c):Boolean(force);
          if(on)classes.add(c);else classes.delete(c);return on;},
        contains(c){return classes.has(c);}},
      addEventListener(k,fn){this.handlers.set(k,fn);},insertAdjacentElement(_,n){defineIds(n.innerHTML);},
      querySelectorAll(){return [];},showModal(){this.open=true;},close(){this.open=false;},focus(){},setAttribute(){},reset(){}};
  }
  defineIds(html);
  const clientHandlers=new Map();
  const c={connected:false,published,on(k,fn){clientHandlers.set(k,fn);},
    emit(k,...args){if(k==="connect")this.connected=true;clientHandlers.get(k)?.(...args);},
    subscribe(_t,_o,cb){cb(null,[]);},
    publish(topic,payload,_o,cb){published.push({topic,payload});cb?.(null);},end(){this.connected=false;}};
  const storage=new Map();
  const sandbox={console:{log(){},warn(){},error(){}},Date,Intl,Map,Set,Math,Number,JSON,URL,Promise,
    document:{getElementById:k=>nodeMap.get(k)||null,createElement:mockNode,
      querySelectorAll:()=>[mockNode(),mockNode()],addEventListener(){},body:{appendChild:n=>defineIds(n.innerHTML)},visibilityState:"visible"},
    window:{addEventListener(){},location:{reload(){}},confirm(){return true;}},
    navigator:{serviceWorker:{controller:null,addEventListener(){},register:async()=>({update:async()=>{}})}},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    sessionStorage:{getItem(){return null;},setItem(){},removeItem(){}},
    setTimeout(fn,ms){const id=++idClock;delayed.set(id,{fn,ms});return id;},
    clearTimeout(id){delayed.delete(id);},setInterval(){return ++idClock;},clearInterval(){},
    mqtt:{connect(){return c;}}};
  vm.createContext(sandbox);
  vm.runInContext(start,sandbox);
  sandbox.vtest.connect(settings);
  c.emit("connect");
  const message=(id,suffix,data)=>c.emit("message",`home/energy/${id}/${suffix}`,{
    toString:()=>typeof data==="string"?data:JSON.stringify(data)
  },{retain:false});
  return {app:sandbox.vtest,c,message,nodes:nodeMap,published,delayed};
}
const b=buildContext();
// Never show "no online device" immediately when the MQTT session connects.
// After the 8-second discovery period, show it if still empty.
assert(b.nodes.get("emptyState").classList.contains("hidden"),"Hide empty state during MQTT discovery");
const discovery = [...b.delayed.entries()].find(([,timer])=>timer.ms===8000);
assert(discovery, "Exactly one 8-second device discovery grace is scheduled");
b.delayed.delete(discovery[0]);discovery[1].fn();
assert.equal(b.nodes.get("emptyState").classList.contains("hidden"),false,
  "Show empty state only after the grace expires");
const vid="vent-A1B2C3D4E5F6";
b.message(vid,"status","online");
assert(b.nodes.get("emptyState").classList.contains("hidden"),"Hide no-device notice as soon as a device is online");
b.message(vid,"health",{meter:"VENTILATION",device_type:"VENTILATION",firmware:"1.03",meter_ok:true,read_attempted:true,has_sample:true,rssi:-45,chip_id:123});
b.message(vid,"state",{meter:"VENTILATION",device_type:"VENTILATION",firmware:"1.03",temp_inside:21.3,temp_outside:15.2,temp_middle:19.1,humidity_inside:60,humidity_outside:45,fan_on:false,speed:"low",mode:"auto",season:"winter",stop_from:"06:15",stop_to:"08:30",sensors_ok:true,time:"10:30:00",mains_present:true,rf_high:false,time_synced:false});
assert.equal(b.app.meterType(b.app.devices.get(vid)),"VENTILATION");
const card=b.nodes.get("devicesGrid").innerHTML;
assert(card.includes("21,3") && card.includes("Διακόπτης RF") && card.includes("Ώρα ESP") && card.includes("Παύση λειτουργίας"));
assert(!card.includes("Έλεγχος 220V"));
assert(!card.includes("Οι εντολές MANUAL επηρεάζουν"));
assert(!card.includes("Χαμηλή ταχύτητα"));
assert(html.includes("570 m³/h") && html.includes("440 m³/h"));
assert(appSource.includes('btn.classList.toggle("vent-selected"'));
assert(appSource.includes('btn.setAttribute("aria-pressed"'));
assert(appSource.includes('btn.classList.toggle("vent-auto-disabled"'));
assert(!card.includes("Μετρητής ΔΕΗ"));
assert.equal(b.app.otaManifestMatchesDevice({meter:"DDS238"},b.app.devices.get(vid)),false);
assert(b.app.otaManifestUrlForDevice(b.app.devices.get(vid)).endsWith("manifest-ventilation.txt"));
assert.equal(b.app.otaManifestMatchesDevice({meter:"VENTILATION",version:"1.05",file:"Ventilation_ESP8266_V1_05.bin"},b.app.devices.get(vid)),true);
assert.equal(b.app.otaManifestMatchesDevice({meter:"VENTILATION",version:"1.05",file:"Ventilation_ESP8266_V1_04.bin"},b.app.devices.get(vid)),false);
const countBefore=b.published.length;
await b.app.startRemoteOta(vid);
assert.equal(b.published.length,countBefore,"No remote OTA without public manifest");
assert.equal(b.app.sendVentCommand(vid,"vent_fan|on"),false,"AUTO forbids manual fan");
assert.equal(b.app.sendVentCommand(vid,"vent_speed|high"),true,"v1.03 speed works in AUTO");
assert(b.published.some(x=>x.payload==="vent_speed|high"));
b.message(vid,"admin/response",{ok:true,cmd:"vent_speed"});
b.message(vid,"state",{...b.app.devices.get(vid).state,firmware:"1.02"});
assert.equal(b.app.sendVentCommand(vid,"vent_speed|low"),false,"v1.02 speed still requires MANUAL");
b.message(vid,"state",{...b.app.devices.get(vid).state,firmware:"1.03"});

assert.equal(b.app.sendVentCommand(vid,"vent_mode|manual"),true);
assert(b.published.some(x=>x.payload==="vent_mode|manual"));
b.message(vid,"admin/response",{ok:true,cmd:"vent_mode"});
b.message(vid,"state",{...b.app.devices.get(vid).state,mode:"manual"});
assert.equal(b.app.sendVentCommand(vid,"vent_fan|on"),true);
assert(b.published.some(x=>x.payload==="vent_fan|on"));
b.message(vid,"admin/response",{ok:true,cmd:"vent_fan"});
assert.equal(b.app.sendVentCommand(vid,"ota_https|10|xxxx|https://example.org"),false);
assert.equal(b.app.sendVentCommand(vid,"vent_schedule|06:15|08:30"),true);
b.message(vid,"admin/response",{ok:true,cmd:"vent_schedule"});
assert.equal(b.app.sendVentCommand(vid,"vent_time|12:34:56"),true);
b.message(vid,"admin/response",{ok:true,cmd:"vent_time"});
b.message(vid,"state",{...b.app.devices.get(vid).state,time_synced:true});
assert.equal(b.app.sendVentCommand(vid,"vent_time|12:34:57"),false,"NTP forbids manual time");
b.message(vid,"state",{...b.app.devices.get(vid).state,firmware:"1.00",time_synced:false});
assert.equal(b.app.sendVentCommand(vid,"vent_mode|auto"),false,"Legacy reversed relay build must be command-locked");
b.message(vid,"state",{...b.app.devices.get(vid).state,firmware:"1.03"});


b.app.openVentHistory(vid);
assert(b.published.some(x=>x.payload==="vent_history|current"));
for(let offset=0;offset<96;offset+=8){
  const data=Array.from({length:8},(_,i)=>
    i===1&&offset===0?"null,null":`${(20+i/10).toFixed(1)},${(14+i/10).toFixed(1)}`);
  b.message(vid,"vent/history",`R|current|${offset}|${data.join("|")}`);
}
b.message(vid,"vent/history","E|current");
assert.equal(b.app.getHistory().complete,true);
const liveSvg=b.nodes.get("ventHistoryChart").innerHTML;
assert(liveSvg.includes('class="vent-live-dot"') || !b.app.getHistory().live,
  "Render a live temperature dot if a valid ESP time is present");
b.message(vid,"state",{...b.app.devices.get(vid).state,time:"10:30:15",
  temp_inside:25.25,temp_outside:16.75});
assert.equal(b.app.getHistory().live?.time,"10:30:15",
  "Update the live chart from the latest 15-second MQTT state");
assert(b.nodes.get("ventHistoryChart").innerHTML.includes('data-series="inside"'),
  "Show the live interior thermometer point");
assert(b.nodes.get("ventHistoryChart").innerHTML.includes('data-series="outside"'),
  "Show the live exterior thermometer point");
assert.equal(b.app.getHistory().rows.length,96,
  "Do not replace the 15-minute history with 15-second samples");

assert.equal(b.app.getHistory().seen.size,12);
const plotted=b.nodes.get("ventHistoryChart").innerHTML;
assert(plotted.includes("<svg"),"Show graph");
assert(plotted.includes('data-min-temp="14"'),"Actual recorded minimum is exact Y minimum");
assert(plotted.includes('data-max-temp="25.25"'),"Max Y also includes the latest live ESP temperature");
assert.equal((plotted.match(/class="vent-grid-hour"/g)||[]).length,25,
  "Preserve 25 hourly vertical grid lines, including the final boundary");
assert.equal((plotted.match(/class="vent-x-label"/g)||[]).length,24,
  "Only label the 24 hours from 00 to 23");
assert(plotted.includes(">00</text>") && plotted.includes(">01</text>") &&
       plotted.includes(">23</text>"), "Use short hour numbers, not HH:MM");
assert(!plotted.includes(">24</text>") && !plotted.includes(">23:00</text>"),
  "No 24 label or time suffix");
assert.equal((plotted.match(/class="vent-grid-half-degree"/g)||[]).length,23,
  "Draw grid every half-degree within the observed temperature span");
assert(plotted.includes("25,25°C"),"Top axis text follows observed maximum");
assert(b.nodes.get("ventHistoryTable").innerHTML.includes("Πίνακας 96"));
assert.equal(b.app.requestVentHistory(vid,"previous"),true);
assert(b.published.some(x=>x.payload==="vent_history|previous"));
// Packets for the old day must not pollute the newly selected day.
b.message(vid,"vent/history","R|current|0|1,2|1,2|1,2|1,2|1,2|1,2|1,2|1,2");
assert.equal(b.app.getHistory().seen.size,0);
b.message(vid,"vent/history","R|previous|0|notvalid,3|1,2|1,2|1,2|1,2|1,2|1,2|1,2");
assert.equal(b.app.getHistory().seen.size,0);
// Degenerate day: all readings identical must render without division by zero.
for (let offset=0;offset<96;offset+=8) {
  b.message(vid,"vent/history",`R|previous|${offset}|${Array(8).fill("18.5,18.5").join("|")}`);
}
b.message(vid,"vent/history","E|previous");
const flatChart=b.nodes.get("ventHistoryChart").innerHTML;
assert(flatChart.includes('data-min-temp="18.5"') && flatChart.includes('data-max-temp="18.5"'));
assert(!flatChart.includes("NaN"),"Flat temperature must not yield NaN coordinates");
console.log("Ventilation v1.03 discovery, dashboard, command safety, OTA isolation, 96-slot MQTT history PASS");
