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
const currentVersion = appSource.match(/const APP_VERSION = "([0-9.]+)";/)?.[1];
assert(currentVersion, 'APP_VERSION must be present');
assert(html.includes(`v=${currentVersion}`), 'HTML assets must match APP_VERSION');
assert(appSource.includes('type === "VENTILATION"'));
assert(appSource.includes("manifest-ventilation.txt"));
assert(appSource.includes('if (otaResponse && !ok && otaSession && otaSession.id === id)'),
  "Post-ACK OTA failure must terminate active OTA progress");
assert(appSource.includes("low_heap_preflight"),
  "Firmware TLS heap failure must have a user-facing message");

assert(appSource.includes('meterType(device) === "VENTILATION"'));
assert(/async function startRemoteOta\(id(?:,\s*ch1116Trial\s*=\s*false)?\)/.test(appSource),
  'OTA function remains available; optional CH1116 trial must not change normal Ventilation OTA');
assert(html.includes('id="otaUpdateBtn" class="primary-btn admin-btn full-btn" type="button" disabled'),
  "OTA button must start disabled");
assert(appSource.includes('ventilationOtaAvailable.get(device.id)'),
  "Ventilation OTA disabled until matching newer public manifest");
assert(appSource.includes("manifest-ventilation.txt"));


// Open a real MQTT connection using the same mocked client API as the production app.
const start=appSource.replace(/\}\)\(\);\s*$/, "globalThis.vtest={devices,connect,meterType,otaManifestMatchesDevice,otaManifestUrlForDevice,startRemoteOta,sendVentCommand,openVentHistory,requestVentHistory,handleVentHistory,renderOtaAvailability,updateAdminButtons,selectOtaDevice:(id)=>{adminTargetId=id;},getHistory:()=>ventHistorySession};})();");
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
b.app.selectOtaDevice(vid);
b.app.renderOtaAvailability(b.app.devices.get(vid), null, true);
assert(b.nodes.get("otaUpdateBtn").disabled,
  "OTA must remain disabled while checking manifest");
b.app.renderOtaAvailability(b.app.devices.get(vid), null, false, true);
assert(b.nodes.get("otaUpdateBtn").disabled,
  "OTA must remain disabled when manifest is unavailable");
b.message(vid,"state",{...b.app.devices.get(vid).state,firmware:"1.04"});
b.app.renderOtaAvailability(b.app.devices.get(vid), {
  meter:"VENTILATION",version:"1.05",file:"Ventilation_ESP8266_V1_05.bin"
});
assert.equal(b.nodes.get("otaUpdateBtn").disabled,false,
  "Only a newer, matching Ventilation manifest can unlock OTA");
b.app.renderOtaAvailability(b.app.devices.get(vid),null,false,true);
assert(b.nodes.get("otaUpdateBtn").disabled,
  "Manifest becoming unavailable must lock OTA again");
b.message(vid,"state",{...b.app.devices.get(vid).state,firmware:"1.03"});

{
// Boiler four-series history uses a separate MQTT topic and wire protocol.
const boilerId="boiler-AABBCCDDEEFF";
b.message(boilerId,"status","online");
b.message(boilerId,"health",{meter:"BOILER",device_type:"BOILER",firmware:"3.05",
  application:"boiler",platform_version:"1.05",profile:"esp32c3-boiler-4ds18b20-sh1106",
  driver:"4xDS18B20",oled:"SH1106",ota_protocol:2,meter_ok:true});
b.message(boilerId,"state",{meter:"BOILER",device_type:"BOILER",firmware:"3.05",
  temp_1:15.1,temp_2:17.2,temp_3:22.3,temp_4:23.4,time:"11:30:00",sensors_ok:true});
const boilerCard=b.nodes.get("devicesGrid").innerHTML;
assert(boilerCard.includes("Θ1")&&boilerCard.includes("Θ2")&&
  boilerCard.includes("Θ3")&&boilerCard.includes("Θ4"));
b.app.openVentHistory(boilerId);
assert(b.published.some(p=>p.payload==="boiler_history|current"),
  "Boiler must request four-sensor history, not two-sensor Ventilation history");
for(let offset=0;offset<=88;offset+=8){
 const points=Array(8).fill("15.1,17.2,22.3,23.4").join("|");
 b.message(boilerId,"boiler/history","R|current|"+offset+"|"+points);
}
b.message(boilerId,"boiler/history","E|current");
assert(b.nodes.get("ventHistoryChart").innerHTML.includes("Boiler Θ1 Θ2 Θ3 Θ4"));
assert(b.nodes.get("ventHistoryChart").innerHTML.includes("Θ4"),
  "Boiler graph must include TH4 and its own color");
b.app.requestVentHistory(boilerId,"days30");
for(let offset=0;offset<=27;offset+=3){
 const d=Array(3).fill("50400,15.1,15.9,15.5,16.1,16.9,16.5,17.1,17.9,17.5,18.1,18.9,18.5").join("|");
 b.message(boilerId,"boiler/history","D|"+offset+"|"+d);
}
b.message(boilerId,"boiler/history","E|days30");
assert(b.nodes.get("ventHistoryChart").innerHTML.includes("Θ4"),
  "30d graph must include four independent daily series");
assert(b.nodes.get("ventHistoryTable").innerHTML.includes("Θ4 μέση"),
  "Daily min/max/mean table must show all four sensors");
b.nodes.get("ventHistoryDialog").close();

}
const card=b.nodes.get("devicesGrid").innerHTML;
assert(card.includes("21,3") && card.includes("Διακόπτης RF") && card.includes("Ώρα ESP") && card.includes("Παύση λειτουργίας"));
assert(card.includes("DHT11 Outside") && card.includes("DHT11 Inside") &&
  card.includes("Absolute humidity") && card.includes("Inside feels like"),
  "DHT11 measurements must render immediately after DS18B20");
assert(card.includes("Control:") && card.includes("Fan:") &&
  card.includes("Speed:") && card.includes("Season:"),
  "Main card must show confirmed fan operating state");
b.message(vid,"state",{...b.app.devices.get(vid).state,
  firmware:"2.03",safe_mode:true,safe_outside:true,safe_inside:false,
  temp_outside:null,temp_inside:21.3,absolute_humidity_inside:13.7,
  humidity_inside:83,dht_temp_inside:21,feels_like_inside:19.4,
  fan_on:false,speed:"high",mode:"auto",season:"winter"});
const safeCard=b.nodes.get("devicesGrid").innerHTML;
assert(safeCard.includes("SafeMode") && safeCard.includes("SAFE") === false,
  "Critical Outside should show SafeMode in its temperature cell");
assert(safeCard.includes("13,7") && safeCard.includes("19,4"),
  "APP must display received DHT absolute humidity and feels-like data");
assert(safeCard.includes("570 m³/h") && safeCard.includes("WINTER / Heating"),
  "APP must show requested speed and season");
b.message(vid,"state",{...b.app.devices.get(vid).state,safe_mode:false,safe_outside:false,
  temp_outside:15.2,firmware:"1.03"});
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
assert(liveSvg.includes('class="vent-live-dot vent-hover-target"') || !b.app.getHistory().live,
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
assert.equal((plotted.match(/class="vent-grid-half-degree"/g)||[]).length,24,
  "Draw grid every half-degree within the observed temperature span");
assert(plotted.includes('data-axis-min="14"') && plotted.includes('data-axis-max="25.5"'),
  "Round actual observed extremes to exterior 0.5C axis ticks");
assert(plotted.includes("25,5°C"),"Top Y tick follows the 0.5C axis grid");
assert(b.nodes.get("ventHistoryTable").innerHTML.includes("Πίνακας 96"));
assert.equal((plotted.match(/<path class="vent-hover-target"/g)||[]).length,2,
  "24-hour lines expose two full-width hover paths for X/Y values");
assert(plotted.includes('class="vent-hover-tooltip"'),"Coordinate label is included in SVG");
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
assert(flatChart.includes('data-axis-min="18"') && flatChart.includes('data-axis-max="19"'),
  "Flat measurements get a safe half-degree-padded Y scale");
// 48-hour comparison: 12 frames for today, followed by 12 for yesterday.
b.message(vid,"state",{...b.app.devices.get(vid).state,firmware:"1.07"});
assert.equal(b.app.requestVentHistory(vid,"compare"),true);
for(const range of ["current","previous"]){
  for(let offset=0;offset<96;offset+=8){
    b.message(vid,"vent/history",
      `R|${range}|${offset}|${Array(8).fill(range==="current"?"21.5,17.0":"20.0,16.0").join("|")}`);
  }
  b.message(vid,"vent/history",`E|${range}`);
}
assert.equal(b.app.getHistory().complete,true,"48-hour aggregate completed");
assert.equal((b.nodes.get("ventHistoryChart").innerHTML.match(/class="vent-yesterday"/g)||[]).length,2,
  "Yesterday is a dashed red and dashed blue line in the same graph");
assert(b.nodes.get("ventHistoryTable").innerHTML.includes("Μέσα χθες °C"));
assert.equal((b.nodes.get("ventHistoryChart").innerHTML.match(/<path class="vent-hover-target"/g)||[]).length,4,
  "48-hour lines expose hover paths for inside/outside today and yesterday");
// 30-day daily aggregates: 10 packets * 3 records, with no invented history.
assert.equal(b.app.requestVentHistory(vid,"days30"),true);
const day=(i)=>`${50500-i},14.5,23.0,${(19.2+i/10).toFixed(1)},12.0,20.0,16.1`;
for(let offset=0;offset<30;offset+=3){
  b.message(vid,"vent/history",`D|${offset}|${day(offset)}|${day(offset+1)}|${day(offset+2)}`);
}
b.message(vid,"vent/history","E|days30");
assert(b.app.getHistory().complete,"30-day data complete");
assert.equal((b.nodes.get("ventHistoryChart").innerHTML.match(/class="vent-daily-series"/g)||[]).length,6,
  "Six min/max/average daily lines");
assert(b.nodes.get("ventHistoryTable").innerHTML.includes("Μέσα μέση °C"));
assert.equal((b.nodes.get("ventHistoryChart").innerHTML.match(/<path class="vent-hover-target"/g)||[]).length,6,
  "Six daily curves provide X/Y hover targets");
const dailySvg=b.nodes.get("ventHistoryChart").innerHTML;
const dayLabels=[...dailySvg.matchAll(/class="vent-x-label"[^>]*>([^<]*)<\/text>/g)]
  .map(m=>m[1]);
assert.equal((dailySvg.match(/class="vent-grid-day"/g)||[]).length,30,
  "Ventilation 30-day axis keeps one vertical grid line per day");
assert.equal(dayLabels.length,15,"Show every other day, keeping the newest date visible");
assert.deepEqual(dayLabels.slice(0,3),["03-13","03-15","03-17"],
  "Oldest Ventilation dates must start on the left");
assert.equal(dayLabels.at(-1),"04-11","Newest date must be at the right edge");
const insideDailyPath=dailySvg.match(/data-series="insideAvg"\s+d="([^"]+)"/)?.[1];
assert(insideDailyPath,"Inside average series must be drawn");
const dailyPoints=[...insideDailyPath.matchAll(/[ML](\d+\.\d+),(\d+\.\d+)/g)];
assert.equal(Number(dailyPoints[0][1]),70,"Oldest Ventilation point starts on the left");
assert.equal(Number(dailyPoints.at(-1)[1]),1030,"Newest Ventilation point ends on the right");
assert(Number(dailyPoints[0][2])<Number(dailyPoints.at(-1)[2]),
  "Older higher daily average must be graphed before the newer lower average");

// Sparse 30-day history: no leading blank weeks on the Ventilation X axis.
// The daily table still contains all 30 original MQTT slots.
const missingDay=i=>`${50500-i},null,null,null,null,null,null`;
const loadVentDaily=record=>{
  assert.equal(b.app.requestVentHistory(vid,"days30"),true);
  for(let offset=0;offset<30;offset+=3){
    b.message(vid,"vent/history",
      `D|${offset}|${record(offset)}|${record(offset+1)}|${record(offset+2)}`);
  }
  b.message(vid,"vent/history","E|days30");
  assert.equal(b.app.getHistory().complete,true);
};
const xDateLabels=svg=>[...svg.matchAll(/class="vent-x-label"[^>]*>([^<]*)<\/text>/g)]
  .map(m=>m[1]);

loadVentDaily(i=>i<6?day(i):missingDay(i));
const sparseSvg=b.nodes.get("ventHistoryChart").innerHTML;
assert.equal((sparseSvg.match(/class="vent-grid-day"/g)||[]).length,6,
  "Only six recorded dates occupy the Ventilation X axis");
assert.deepEqual(xDateLabels(sparseSvg),["04-06","04-08","04-10","04-11"],
  "Date labels begin on the first recorded date and continue every two days");
assert.equal((b.nodes.get("ventHistoryTable").innerHTML.match(/<tr>/g)||[]).length,31,
  "Keep all 30 daily table rows even when chart begins at the first recording");

// Missing newest day and a gap inside the recorded span: trim the edges,
// preserve the one-day gap, and do not draw a connecting line through it.
loadVentDaily(i=>(i===2||i===4)?day(i):missingDay(i));
const gapSvg=b.nodes.get("ventHistoryChart").innerHTML;
assert.equal((gapSvg.match(/class="vent-grid-day"/g)||[]).length,3);
assert.deepEqual(xDateLabels(gapSvg),["04-07","04-09"]);
const gapPath=gapSvg.match(/data-series="insideAvg"\s+d="([^"]+)"/)?.[1];
assert.equal((gapPath.match(/M/g)||[]).length,2,
  "Keep a gap between two recorded days with an empty day between them");

// Exactly one day with readings must still render without invalid coordinates.
loadVentDaily(i=>i===7?day(i):missingDay(i));
const oneDaySvg=b.nodes.get("ventHistoryChart").innerHTML;
assert.equal((oneDaySvg.match(/class="vent-grid-day"/g)||[]).length,1);
assert.deepEqual(xDateLabels(oneDaySvg),["04-04"]);
assert.equal((oneDaySvg.match(/class="vent-standalone-point"/g)||[]).length,6,
  "Single-day curves keep visible and hoverable recorded data points");
assert(!oneDaySvg.includes("NaN"),"Single-day X axis must avoid division by zero");

// All-null daily history must keep the normal no-recordings message.
loadVentDaily(i=>missingDay(i));
assert(b.nodes.get("ventHistoryChart").innerHTML.includes("Δεν υπάρχουν ακόμη καταγραφές"));



// Boiler is a SEPARATE type: only 3 DS18B20 readings, no control settings.
const boiler = buildContext();
const boilerId = "boiler-A1B2C3D4E5F6";
boiler.message(boilerId,"status","online");
boiler.message(boilerId,"health",{
  meter:"BOILER",device_type:"BOILER",firmware:"1.00",
  meter_ok:true,read_attempted:true,has_sample:true,rssi:-53,chip_id:999
});
boiler.message(boilerId,"state",{
  meter:"BOILER",device_type:"BOILER",firmware:"1.00",
  temp_outside:35.2,temp_middle:42.7,temp_inside:49.1,
  sensors_ok:true,time:"12:30:00",time_synced:true,rssi:-53
});
assert.equal(boiler.app.meterType(boiler.app.devices.get(boilerId)),"BOILER");
const boilerCard = boiler.nodes.get("devicesGrid").innerHTML;
assert(boilerCard.includes("Boiler") && boilerCard.includes("35,2") &&
  boilerCard.includes("42,7") && boilerCard.includes("49,1"),
  "Boiler renders three temperature readings");
assert(boilerCard.includes('data-action="admin" data-device="'+boilerId+'"') &&
  boilerCard.includes("FIRMWARE / OTA"),
  "Boiler must offer a firmware-only settings entry");
assert(appSource.includes('ui.adminDialog.classList.toggle("boiler-ota-only"'),
  "Boiler firmware panel must hide all control/settings sections");
assert(boiler.app.otaManifestUrlForDevice(boiler.app.devices.get(boilerId))
  .includes("ESP32-OTA.bin/main/manifest-boiler.txt"));
assert.equal(boiler.app.otaManifestMatchesDevice(
  {meter:"BOILER",file:"Boiler_ESP32C3_V1_02.bin",version:"1.02"},
  boiler.app.devices.get(boilerId)),true);
assert.equal(boiler.app.otaManifestMatchesDevice(
  {meter:"VENTILATION",file:"Ventilation_ESP8266_V1_08.bin",version:"1.08"},
  boiler.app.devices.get(boilerId)),false);
boiler.app.selectOtaDevice(boilerId);
boiler.app.renderOtaAvailability(boiler.app.devices.get(boilerId),null,true);
assert(boiler.nodes.get("otaUpdateBtn").disabled,
  "Boiler OTA disabled until a newer matching release is available");
assert.equal(boiler.app.sendVentCommand(boilerId,"vent_fan|on"),false);
assert.equal(boiler.app.sendVentCommand(boilerId,"vent_mode|manual"),false);
const beforeBoilerHistory=boiler.published.length;
boiler.app.openVentHistory(boilerId);
assert(boiler.published.slice(beforeBoilerHistory).some(p=>p.payload==="boiler_history|current"),
  "Boiler requests its own read-only MQTT temperature history");
assert.equal(boiler.app.requestVentHistory(boilerId,"days30"),true,
  "Boiler firmware 1.00 already supports 30 day history");
assert(boiler.published.some(p=>p.payload==="boiler_history|days30"));
boiler.message(boilerId,"boiler/history",`D|0|${day(0)}|${day(1)}|${day(2)}`);
const boilerDailySvg=boiler.nodes.get("ventHistoryChart").innerHTML;
const boilerLabels=[...boilerDailySvg.matchAll(/class="vent-x-label"[^>]*>([^<]*)<\/text>/g)]
  .map(m=>m[1]);
assert.equal(boilerLabels.length,10,"Boiler keeps its original every-third-day labeling");
assert.equal(boilerLabels[0],"04-11","Boiler keeps its original date ordering");
// New Boiler v1.05 publishes exactly one sensor per independent bus.
const boiler4=buildContext();
const boiler4Id="boiler-112233445566";
boiler4.message(boiler4Id,"status","online");
boiler4.message(boiler4Id,"health",{
  meter:"BOILER",device_type:"BOILER",firmware:"1.05",
  meter_ok:true,read_attempted:true,has_sample:true,rssi:-48
});
boiler4.message(boiler4Id,"state",{
  meter:"BOILER",device_type:"BOILER",firmware:"1.05",
  temp_1:21.5,temp_2:35.7,temp_3:48.9,temp_4:62.3,
  temp_outside:21.5,temp_middle:35.7,temp_inside:48.9,
  sensors_ok:true,time:"19:05:00"
});
const boiler4Card=boiler4.nodes.get("devicesGrid").innerHTML;
for(const [label,value] of [
  ["Θ1 · GPIO5","21,5"],["Θ2 · GPIO6","35,7"],
  ["Θ3 · GPIO7","48,9"],["Θ4 · GPIO21","62,3"]]){
  assert(boiler4Card.includes(label),`Missing boiler probe: ${label}`);
  assert(boiler4Card.includes(value),`Missing temperature ${value}`);
}
assert(!boiler4Card.includes('data-action="fan"'),"Boiler must remain monitoring only");
boiler4.message(boiler4Id,"state",{
  meter:"BOILER",device_type:"BOILER",firmware:"1.05",
  temp_1:22.1,temp_2:40,temp_3:50,temp_4:null,time:"19:06:00"
});
const boiler4Missing=boiler4.nodes.get("devicesGrid").innerHTML;
assert(boiler4Missing.includes("Θ4 · GPIO21"),"Disconnected fourth probe remains visible");
assert(boiler4Missing.includes(">—</b>"),"Disconnected probe displays dash, never zero");
console.log("Boiler v1.05 4x independent DS18B20, GPIO5/6/7/21 UI and disconnect status PASS");

console.log("Boiler 3xDS18B20 discovery, read-only UI, blocked controls and history PASS");

console.log("Ventilation v1.03 discovery, dashboard, command safety, OTA isolation, 96-slot MQTT history PASS");
