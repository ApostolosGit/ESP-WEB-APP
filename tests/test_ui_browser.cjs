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
 // Real MQTT states: all 'Διαφορά' amounts use the configurable €/kWh
 // without changing meter readings. Typography matches the kWh unit.
 await page.evaluate(()=>{
  frame('DDS-5CCF7FF0904F','state',{
   meter:'DDS238',firmware:'5.56',dual_zone:false,
   power:23,current:.35,voltage:236,has_utility:true,estimate_valid:true,
   z_ref:40,z_now:100,z_diff:60
  });
  frame('jsy_house-84F3EB041E89','state',{
   meter:'JSY-MK-333',firmware:'5.56',dual_zone:true,
   power_total:800,has_utility:true,estimate_valid:true,
   z1_ref:40,z1_now:100,z1_diff:60,z2_ref:8,z2_now:12,z2_diff:4
  });
 });
 const ddsCost=page.locator('article[data-device="DDS-5CCF7FF0904F"] .tariff-estimated-cost');
 assert.equal(await ddsCost.textContent(),'(15€)');
 const costSizes=await ddsCost.evaluate(node=>({
  cost:getComputedStyle(node).fontSize,
  unit:getComputedStyle(node.parentElement.querySelector('small:not(.tariff-estimated-cost)')).fontSize
 }));
 assert.equal(costSizes.cost,costSizes.unit,'Euro amount should match kWh font size');
 assert.deepEqual(await page.locator('article[data-device="jsy_house-84F3EB041E89"] .tariff-estimated-cost').allTextContents(),['(15€)','(1€)']);
 await page.locator('#settingsBtn').click();
 assert.equal(await page.locator('#energyPriceInput').inputValue(),'0,25');
 await page.locator('#energyPriceInput').fill('0,30');
 await page.locator('#saveEnergyPriceBtn').click();
 assert.equal(await page.evaluate(()=>localStorage.getItem('energy.pricePerKwh')),'0.3');
 await page.locator('#closeSettingsBtn').click();
 assert.equal(await ddsCost.textContent(),'(18€)');
 await page.locator('#settingsBtn').click();
 await page.locator('#energyPriceInput').fill('');
 await page.locator('#saveEnergyPriceBtn').click();
 await page.locator('#closeSettingsBtn').click();
 assert.equal(await page.locator('.tariff-estimated-cost').count(),0);
 await page.locator('#settingsBtn').click();
 await page.locator('#energyPriceInput').fill('0,25');
 await page.locator('#saveEnergyPriceBtn').click();
 await page.locator('#closeSettingsBtn').click();
 assert.equal(await ddsCost.textContent(),'(15€)');
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

 // Reproduce asymmetric positive/negative ranges in Chromium: tick boxes
 // must not overlap or clip, and each bar stays on its side of zero.
 for(const values of [[7,3,1],[-7,-3,-1],[100,-.001,0],[.001,-100,0],[1e6,-1e6,0],[1e-6,-2e-6,0],[0,0,0]]) {
  for(const dual of [false,true]) {
   await page.evaluate(({values,dual})=>{
    document.getElementById('energyHistoryPlot').innerHTML=EnergyHistory.svg([{label:'signed',values,flags:0}],dual);
   },{values,dual});
   const signed=await page.locator('#energyHistoryPlot svg').evaluate(svg=>{
    const bounds=node=>{const b=node.getBBox();return {left:b.x,right:b.x+b.width,top:b.y,bottom:b.y+b.height};};
    return {
     ticks:[...svg.querySelectorAll('.y-tick')].map(bounds).sort((a,b)=>a.top-b.top),
     zero:+svg.querySelector('.zero-axis').getAttribute('y1'),
     bars:[...svg.querySelectorAll('rect')].map(rect=>({
      top:+rect.getAttribute('y'),bottom:+rect.getAttribute('y')+Number(rect.getAttribute('height')),
      value:Number(rect.querySelector('title').textContent.match(/: ([^ ]+) kWh/)[1].replaceAll('.','').replace(',','.'))
     })),
     labels:[...svg.querySelectorAll('.bar-value')].map(bounds),height:svg.viewBox.baseVal.height
    };
   });
   for(let i=0;i<signed.ticks.length;i++) {
    const tick=signed.ticks[i];
    assert(tick.left>=0 && tick.top>=0 && tick.bottom<=signed.height,'Signed Y tick must fit inside the SVG');
    if(i) assert(signed.ticks[i-1].bottom+2<tick.top,'Signed Y tick labels must not overlap');
   }
   for(const bar of signed.bars) {
    assert(bar.top>=28-0.01 && bar.bottom<=254.01,'Signed bars stay within the plot');
    if(bar.value>0) assert(bar.bottom<=signed.zero+0.01,JSON.stringify({values,dual,bar,zero:signed.zero}));
    if(bar.value<0) assert(bar.top>=signed.zero-0.01,JSON.stringify({values,dual,bar,zero:signed.zero}));
   }
   for(const label of signed.labels) assert(label.top>=0 && label.bottom<282,'Value labels do not collide with the X labels');
   if(dual && values[0]===100) await page.screenshot({path:path.join(artifacts,'signed-axis.png')});
  }
 }


 // Real DOM: collect the recent day first, reveal the upper chart, then
 // request older checkpoint pages in reverse order for the lower chart.
 await page.evaluate(()=>{
  window.mockClient.publish=(topic,payload)=>{window.historyPublish={topic,payload};};
  document.getElementById('energyHistoryRange').value='48';
  const id='jsy_house-84F3EB041E89';
  const anchor=Date.parse('2026-10-19T12:00:00+03:00')/1000;
  window.fixtureRaw=Array.from({length:151},(_,i)=>({epoch:anchor-75*3600+i*1800,import:5000+i*120,export:Math.min(i,102)*240}));
  window.sendNextHistoryPage=()=>{
   const request=window.historyPublish.payload.split('|'),token=request[1],offset=+request[3];
   const first=offset===0?102:offset,rows=fixtureRaw.slice(first,first+16),next=first+rows.length;
   frame(id,'admin/history',`B|${token}|0|${fixtureRaw[0].epoch}|2072576|100000|1972576|4000|3000|2000|0|${anchor}`);
   for(const row of rows) frame(id,'admin/history',`P|${token}|${row.epoch}|1|${row.import}|${row.export}`);
   frame(id,'admin/history',`E|${token}|${next<fixtureRaw.length?next:-1}|${rows.length}`);
   return offset;
  };
  testApp.loadEnergyHistory(id);
  sendNextHistoryPage();
 });
 assert.equal(await page.locator('.history-comparison-panel svg').count(),0,'Do not reveal the old end of the upper day before the newest end arrives');
 await page.evaluate(()=>{sendNextHistoryPage();sendNextHistoryPage();sendNextHistoryPage();});
 assert.equal(await page.locator('.history-comparison-panel svg').count(),2);
 assert.match(await page.locator('#energyHistoryStatus').textContent(),/Προσωρινή προβολή/);
 assert.equal(await page.locator('.history-comparison-panel').nth(0).locator('rect').count()>0,true);
 assert.equal(await page.locator('.history-comparison-panel').nth(1).locator('rect').count(),0,'Upper day is shown before any lower-day bars');
 assert.equal(await page.locator('#energyHistoryPlot').getAttribute('aria-busy'),'true');
 assert.equal(await page.locator('#energyHistoryTable table').count(),0);
 assert.equal(await page.locator('#exportEnergyHistoryCsv').isEnabled(),false);
 await page.screenshot({path:path.join(artifacts,'upper-first.png')});
 await page.locator('#energyHistoryTableToggle').click();
 const partialTable=await page.locator('#energyHistoryTable').textContent();
 assert.match(partialTable,/Αναμονή δεδομένων/);
 assert.equal(await page.evaluate(()=>sendNextHistoryPage()),86);
 assert.notEqual(await page.locator('#energyHistoryTable').textContent(),partialTable);
 const partialLower=await page.locator('.history-comparison-panel').nth(1).locator('rect').evaluateAll(rects=>rects.map(r=>+r.getAttribute('x')));
 assert(partialLower.length>0);
 await page.locator('#energyHistoryTableToggle').click();
 assert.equal(await page.evaluate(()=>sendNextHistoryPage()),70);
 const nextLower=await page.locator('.history-comparison-panel').nth(1).locator('rect').evaluateAll(rects=>rects.map(r=>+r.getAttribute('x')));
 assert(nextLower.length>partialLower.length);
 assert(Math.max(...nextLower)>Math.max(...partialLower),'Lower day fills from its newer left edge towards older right columns');
 assert.equal(await page.evaluate(()=>sendNextHistoryPage()),54);
 assert.equal(await page.locator('#energyHistoryPlot').getAttribute('aria-busy'),'false');
 assert.equal(await page.locator('#energyHistoryTable table').count(),0);
 const completedPlot=await page.locator('#energyHistoryPlot').innerHTML();
 await page.locator('#reloadEnergyHistory').click();
 assert.equal(await page.locator('#energyHistoryPlot').innerHTML(),completedPlot);
 assert.match(await page.locator('#energyHistoryStatus').textContent(),/προηγούμενο γράφημα/);
 assert.equal(await page.locator('#exportEnergyHistoryCsv').isEnabled(),false);
 await page.evaluate(()=>{for(let i=0;i<7;i++)sendNextHistoryPage();});
 assert.equal(await page.locator('.history-comparison-panel').count(),2);
 assert.deepEqual(await page.locator('.history-comparison-panel h3').allTextContents(),['Πρόσφατες 24 ώρες','Προηγούμενες 24 ώρες']);
 assert.equal(await page.locator('.history-comparison-panel svg').count(),2);
 assert.equal(await page.locator('.history-comparison-panel svg text[y="282"]').count(),24);
 const aligned=await page.locator('.history-comparison-panel svg').evaluateAll(svgs=>svgs.map(svg=>({
   viewBox:svg.getAttribute('viewBox'),
   left:svg.getBoundingClientRect().left,
   width:svg.getBoundingClientRect().width,
   axis:[...svg.querySelectorAll('.y-tick')].map(t=>t.textContent)
 })));
 // The full 48-hour fixture covers all three Greek time-of-day zones in
 // each row, not merely in the legend.
 const hourColors=await page.locator('.history-comparison-panel svg').evaluateAll(svgs=>svgs.map(svg=>[
  ...new Set([...svg.querySelectorAll('rect')].map(rect=>rect.getAttribute('fill')))
 ]));
 for(const palette of hourColors) for(const color of ['#ff9800','#ffd600','#000000'])
  assert(palette.includes(color),'Missing time-of-day bar color '+color);
 assert.equal(aligned[0].viewBox,aligned[1].viewBox);
 assert.deepEqual(aligned[0].axis,aligned[1].axis);
 assert(Math.abs(aligned[0].left-aligned[1].left)<1,'24-hour comparisons must align on X');
 assert.equal(await page.locator('#energyHistoryTable').isVisible(),false);
 assert.equal(await page.locator('#exportEnergyHistoryCsv').isEnabled(),true);
 const [lazyDownload]=await Promise.all([
  page.waitForEvent('download'),
  page.locator('#exportEnergyHistoryCsv').click()
 ]);
 assert.equal(fs.readFileSync(await lazyDownload.path(),'utf8').trim().split('\r\n').length,49);
 assert.equal(await page.locator('#energyHistoryTable table').count(),0,'Exporting CSV must not build an unused DOM table');
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

