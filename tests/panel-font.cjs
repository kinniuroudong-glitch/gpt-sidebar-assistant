const assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const wait=ms=>new Promise(r=>setTimeout(r,ms));let settings={};
function fixture(delayed=false){const w=new JSDOM(fs.readFileSync('extension/panel.html','utf8'),{url:'https://local.test',runScripts:'outside-only'}).window;let receive,resolveLoad;
 w.chrome={storage:{local:{get:()=>delayed?new Promise(r=>resolveLoad=r):Promise.resolve({...settings}),set:async values=>{settings={...settings,...values};}}},tabs:{query:async()=>[{id:1,windowId:10,url:'https://example.com/',title:'Page'}],onActivated:{addListener(){}},onUpdated:{addListener(){}}},runtime:{id:'ext',onMessage:{addListener(){}},connect:()=>({postMessage(){},disconnect(){},onMessage:{addListener(f){receive=f;}}}),sendMessage:async()=>({ok:true})}};
 w.eval(fs.readFileSync('extension/panel.js','utf8'));return {w,receive,load:value=>resolveLoad(value)};
}
(async()=>{const f=fixture();await wait(10);const d=f.w.document,read=()=>d.documentElement.style.getPropertyValue('--content-font-size');assert.equal(read(),'33px');
 f.receive({type:'assistant:history',turns:[{id:'old',question:'问题',answer:'1. 原文\n2. 下一段',completed:true}]});d.getElementById('font-larger').click();assert.equal(read(),'36px');assert.equal(settings.contentFontSize,36);assert.equal(d.getElementById('answer').textContent,'1. 原文\n2. 下一段');d.getElementById('font-smaller').click();assert.equal(read(),'33px');
 for(let i=0;i<30;i++)d.getElementById('font-smaller').click();assert.equal(read(),'18px');assert(d.getElementById('font-smaller').disabled);for(let i=0;i<30;i++)d.getElementById('font-larger').click();assert.equal(read(),'54px');assert(d.getElementById('font-larger').disabled);f.w.close();
 const restored=fixture();await wait(10);assert.equal(restored.w.document.documentElement.style.getPropertyValue('--content-font-size'),'54px');restored.w.close();
 const raced=fixture(true);raced.w.document.getElementById('font-smaller').click();raced.load({contentFontSize:54});await wait(10);assert.equal(raced.w.document.documentElement.style.getPropertyValue('--content-font-size'),'30px');raced.w.close();
 const css=fs.readFileSync('extension/panel.css','utf8');assert.match(css,/#status\{font-size:12px/);assert.match(css,/#attachment\{font-size:12px/);console.log('PASS font controls: increase/decrease, bounds, persisted reopen, load race, numbered answer unchanged, small metadata independent of content font');
})().catch(e=>{console.error(e);process.exitCode=1});
