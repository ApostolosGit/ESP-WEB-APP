const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright' : 'playwright');
const root=path.resolve(__dirname,'..');
const artifacts=path.join(root,'tests/ui-artifacts');fs.mkdirSync(artifacts,{recursive:true});
const previewTmp=path.join(artifacts,'tmp');fs.mkdirSync(previewTmp,{recursive:true});process.env.TMPDIR=previewTmp;
const server=http.createServer((req,res)=>{
 const file=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
 const full=path.join(root,file);
 if(!fs.existsSync(full)){res.writeHead(404);res.end();return;}
 let content=fs.readFileSync(full);
 if(file==='index.html') content=Buffer.from(content.toString().replace(/<script[^>]+src="https:[^>]+><\/script>/g,''));
 if(file==='app.js') content=Buffer.from(content.toString().replace(/\}\)\(\);\s*$/,'window.testApp={devices,renderAll,connect,loadEnergyHistory};})();'));
 res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':'text/html');res.end(content);
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1280,height:850}});
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 await page.locator('#settingsDialog').waitFor({state:'visible'});
 await page.evaluate(()=>{
  for(const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  window.mqtt={connect(){const handlers=new Map();const c={connected:false,on:(e,f)=>handlers.set(e,f),
   subscribe(_t,_o,cb){cb(null,[{qos:0}]);},publish(_t,_p,_o,cb){cb?.(null);},end(){c.connected=false;},
   emit(e,...args){if(e==='connect')c.connected=true;handlers.get(e)?.(...args);}};window.mockClient=c;return c;}};
  testApp.connect({host:'fixture.example',port:'8884',path:'/mqtt',username:'fixture',password:'test-only'});
  mockClient.emit('connect');
  window.frame=(id,suffix,payload,retain=false)=>mockClient.emit('message',`home/energy/${id}/${suffix}`,{toString:()=>typeof payload==='string'?payload:JSON.stringify(payload)},{retain});
  frame('jsy_house','status','online',true);
  frame('jsy_house-84F3EB041E89','status','online',true);
  frame('jsy_house-84F3EB041E89','state',{meter:'JSY-MK-333',firmware:'5.56',dual_zone:true,rssi:-45,v1:231,v2:232,v3:230,i1:2,i2:1,i3:3,p1:400,p2:-200,p3:600,power_total:800,pf1:.9,pf2:.9,pf3:.9,frequency:50});
  frame('DDS-5CCF7FF0904F','state',{meter:'DDS238',firmware:'5.56',dual_zone:false,rssi:-46,power:23,current:.35,voltage:236,frequency:49.99,pf:.283});
 });
 assert.equal(await page.locator('#metersStatus').textContent(),'2');
 assert.equal(await page.locator('article[data-device="jsy_house"]').count(),0,'Retired retained ID must not appear in the real DOM');
 assert.equal(await page.locator('.meter-error').count(),0);
 await page.evaluate(()=>frame('jsy_house','state',{meter:'JSY-MK-333',firmware:'5.00',power_total:123}));
 assert.equal(await page.locator('#metersStatus').textContent(),'3');
 await page.evaluate(()=>frame('jsy_house','status','offline'));
 assert.equal(await page.locator('#metersStatus').textContent(),'2');
 const firstActions=page.locator('.device-actions').first();
 assert.deepEqual(await firstActions.locator('button').evaluateAll(bs=>bs.map(b=>b.dataset.action)),['admin','history','refresh']);
 const colors=await firstActions.locator('button').evaluateAll(bs=>bs.map(b=>({bg:getComputedStyle(b).backgroundColor,fg:getComputedStyle(b).color})));
 assert.deepEqual(colors[1],colors[2]);assert.notEqual(colors[0].bg,colors[2].bg);
 await page.screenshot({path:path.join(artifacts,'desktop.png')});
 await page.setViewportSize({width:390,height:850});
 await page.screenshot({path:path.join(artifacts,'mobile.png')});
 const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,elements:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(e=>({tag:e.tagName,class:e.className,text:e.textContent.slice(0,70),right:e.getBoundingClientRect().right}))}));
 console.log('Mobile geometry',JSON.stringify(overflow));
 assert(overflow.scroll<=overflow.width,'App must not overflow on mobile');
 await page.setViewportSize({width:1000,height:650});
 await page.evaluate(()=>{
  const dialog=document.querySelector('.energy-history-dialog');dialog.showModal();
  document.getElementById('energyHistoryRange').value='30';
  document.getElementById('energyHistoryPlot').innerHTML=EnergyHistory.svg([
   {label:'01/10',values:[5.25,-3.125,0],flags:0},
   {label:'02/10',values:[3.96,-6.94,1.5],flags:1},
   {label:'03/10',values:null,flags:32},
   {label:'04/10',values:[2.075,-1.56,.85],flags:0},
   {label:'05/10',values:[6.71,-8.16,-.76],flags:0},
   {label:'06/10',values:[-1.257,-3.584,1.51],flags:0},
   {label:'07/10',values:[1.08,-.731,.289],flags:16}
  ],true);
 });
 assert.equal(await page.locator('.bar-value').count(),6);
 assert.equal(await page.locator('.energy-history-plot svg rect').count(),17);
 const geometry=await page.locator('.energy-history-plot svg').evaluate(svg=>{
  const labels=[...svg.querySelectorAll('.bar-value')].map(text=>{const box=text.getBBox();return {text:text.textContent,left:box.x,right:box.x+box.width,top:box.y,bottom:box.y+box.height,x:+text.getAttribute('x')};});
  const rects=[...svg.querySelectorAll('rect')].map(rect=>({x:+rect.getAttribute('x'),y:+rect.getAttribute('y'),h:+rect.getAttribute('height')}));
  return {labels,rects,height:svg.viewBox.baseVal.height};
 });
 for(const label of geometry.labels) assert(label.top>=0&&label.bottom<=geometry.height,'Total label must stay inside SVG: '+label.text);
 for(let i=1;i<geometry.labels.length;i++) assert(geometry.labels[i-1].right<geometry.labels[i].left,'Hourly/daily total labels must not overlap');
 const xGroups=[...new Set(geometry.rects.map(rect=>rect.x))];
 assert.equal(xGroups.length,6,'Stacked tariff segments must share one X position per non-empty block');
 await page.screenshot({path:path.join(artifacts,'chart.png')});

 // Feed genuine MQTT history frames into the real APP DOM: 48 hourly slots,
 // both comparison rows, table visibility toggle and downloadable Greek CSV.
 await page.evaluate(()=>{
  window.mockClient.publish=(topic,payload)=>{window.historyPublish={topic,payload};};
  document.getElementById('energyHistoryRange').value='48';
  const id='jsy_house-84F3EB041E89';
  testApp.loadEnergyHistory(id);
  const token=window.historyPublish.payload.split('|')[1];
  const anchor=Date.parse('2026-10-19T12:00:00+03:00')/1000;
  frame(id,'admin/history',`B|${token}|0|${anchor-48*3600}|2072576|100000|1972576|4000|3000|2000|0|${anchor}`);
  for(let i=0;i<=96;i++) {
   const ep=anchor-48*3600+i*1800;
   frame(id,'admin/history',`P|${token}|${ep}|1|${5000+i*120}|0`);
  }
  frame(id,'admin/history',`E|${token}|-1|97`);
 });
 assert.equal(await page.locator('.history-comparison-panel').count(),2);
 assert.deepEqual(await page.locator('.history-comparison-panel h3').allTextContents(),['Πρόσφατες 24 ώρες','Προηγούμενες 24 ώρες']);
 assert.equal(await page.locator('.history-comparison-panel svg').count(),2);
 assert.equal(await page.locator('.history-comparison-panel svg text[y="282"]').count(),24);
 const aligned=await page.locator('.history-comparison-panel svg').evaluateAll(svgs=>svgs.map(svg=>({
   viewBox:svg.getAttribute('viewBox'),
   left:svg.getBoundingClientRect().left,
   width:svg.getBoundingClientRect().width,
   axis:[...svg.querySelectorAll('text[x="50"]')].map(t=>t.textContent)
 })));
 assert.equal(aligned[0].viewBox,aligned[1].viewBox);
 assert.deepEqual(aligned[0].axis,aligned[1].axis);
 assert(Math.abs(aligned[0].left-aligned[1].left)<1,'24-hour comparisons must align on X');
 assert.equal(await page.locator('#energyHistoryTable').isVisible(),false);
 assert.equal(await page.locator('#exportEnergyHistoryCsv').isEnabled(),true);
 await page.locator('#energyHistoryTableToggle').click();
 assert.equal(await page.locator('#energyHistoryTable').isVisible(),true);
 assert.equal(await page.locator('#energyHistoryTable tbody tr').count(),48);
 await page.locator('#energyHistoryTableToggle').click();
 assert.equal(await page.locator('#energyHistoryTable').isVisible(),false);
 const [download]=await Promise.all([
  page.waitForEvent('download'),
  page.locator('#exportEnergyHistoryCsv').click()
 ]);
 assert.match(download.suggestedFilename(),/-48h\.csv$/);
 const csv=fs.readFileSync(await download.path(),'utf8');
 assert(csv.startsWith('\uFEFF"Περίοδος";"Ζ1 kWh";'));
 assert.equal(csv.trim().split('\r\n').length,49);
 await page.screenshot({path:path.join(artifacts,'compare-48h.png')});
 await page.setViewportSize({width:390,height:850});
 const mobileCharts=await page.evaluate(()=>({
  viewport:innerWidth,scroll:document.documentElement.scrollWidth,
  plot:document.getElementById('energyHistoryPlot').getBoundingClientRect().width,
  content:document.querySelector('.history-comparison').getBoundingClientRect().width
 }));
 assert(mobileCharts.scroll<=mobileCharts.viewport,'History modal must not overflow mobile viewport');
 assert(mobileCharts.content>mobileCharts.plot,'Wide charts should scroll inside plot on mobile');
 await page.screenshot({path:path.join(artifacts,'compare-48h-mobile.png')});
 await browser.close();server.close();console.log('Real-browser responsive 24h comparison, collapsed table/reveal, UTF-8 CSV export and existing UI PASS');
})().catch(e=>{console.error(e);server.close();process.exit(1);});
