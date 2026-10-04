const assert=require('node:assert/strict'),fs=require('node:fs');const {JSDOM}=require('jsdom');
(async()=>{
const d=new JSDOM(fs.readFileSync('extension/panel.html','utf8'),{url:'https://local.test',runScripts:'outside-only'}),w=d.window;
const captions=Array.from({length:16000},(_,i)=>`[${i}] 字幕行${i}`).join('\n');let extracted=0;const prompts=[];
w.chrome={tabs:{query:async()=>[{id:1,windowId:10,url:'https://www.youtube.com/watch?v=abcdefghijk'}],onActivated:{addListener(){}},onUpdated:{addListener(){}}},runtime:{id:'ext',onMessage:{addListener(){}},connect:()=>({postMessage(){},disconnect(){},onMessage:{addListener(){}}}),sendMessage:async m=>{
if(m.type==='assistant:context')return {data:{hasTranscript:false}};
if(m.type==='extract')return {data:{tabId:1,url:'https://www.youtube.com/watch?v=abcdefghijk',title:'Video',type:'youtube',text:'Metadata',captions:''}};
if(m.type==='captions'){extracted++;return {data:{error:'这个视频没有可读取的字幕轨道。'}}}
if(m.type==='assistant'){prompts.push(m.text);return {text:'answer'}};
}}};
w.eval(fs.readFileSync('extension/panel.js','utf8'));await new Promise(r=>setTimeout(r,10));assert.equal(extracted,0);assert.equal(prompts.length,0);
await w.eval("preparePage().then(p=>ask('总结全片',p))");assert.equal(extracted,1);assert.equal(prompts.length,0,'caption failure must never send metadata to ChatGPT');assert.match(w.document.getElementById('status').textContent,/尚未向 ChatGPT 发送/);
await w.eval("preparePage().then(p=>ask('重试',p))");assert.equal(extracted,2,'failed extraction can retry');assert.equal(prompts.length,0);
d.window.close();console.log('PASS: failed subtitle extraction stops all ChatGPT sends, reports failure and permits retry');
})().catch(e=>{console.error(e);process.exitCode=1});
