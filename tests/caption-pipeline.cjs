const assert=require('node:assert/strict'),fs=require('node:fs');const {JSDOM}=require('jsdom');
(async()=>{
const d=new JSDOM(fs.readFileSync('extension/panel.html','utf8'),{url:'https://local.test',runScripts:'outside-only'}),w=d.window;
const captions=Array.from({length:16000},(_,i)=>`[${i}] 字幕行${i}`).join('\n');let extracted=0,hasTranscript=false;const prompts=[];
w.chrome={tabs:{query:async()=>[{id:1,windowId:10,url:'https://www.youtube.com/watch?v=abcdefghijk'}],onActivated:{addListener(){}},onUpdated:{addListener(){}}},runtime:{id:'ext',onMessage:{addListener(){}},connect:()=>({postMessage(){},disconnect(){},onMessage:{addListener(){}}}),sendMessage:async m=>{
if(m.type==='assistant:context')return {data:{hasTranscript}};
if(m.type==='extract')return {data:{tabId:1,url:'https://www.youtube.com/watch?v=abcdefghijk',title:'Video',type:'youtube',text:'Metadata',captions:''}};
if(m.type==='captions'){extracted++;return {data:{text:captions,language:'th',automatic:true,complete:true}}}
if(m.type==='assistant'){prompts.push(m.text);if(m.transcriptFinal)hasTranscript=true;return {text:'answer'}};
}}};
w.eval(fs.readFileSync('extension/panel.js','utf8'));await new Promise(r=>setTimeout(r,10));assert.equal(extracted,0);assert.equal(prompts.length,0);
await w.eval("preparePage().then(p=>ask('总结全片',p))");assert.equal(extracted,1);assert.ok(prompts.length>2);
const sent=prompts.slice(0,-1).map(s=>s.split('---字幕资料---\n')[1].split('\n---资料结束---')[0]).join('');assert.equal(sent,captions,'all subtitle characters must be delivered');assert.ok(prompts.every(s=>s.length<70000));assert.match(prompts.at(-1),/综合所有段落/);
assert.match(fs.readFileSync('extension/panel.js','utf8'),/source.captions='';delete source.subtitleInfo/);const sentCount=prompts.length;
await w.eval("ask('再解释一下')");assert.equal(prompts.length,sentCount+1);assert.ok(prompts.at(-1).length<500,'plain followup must not resend full transcript');assert.equal(extracted,1,'plain follow-up does not extract captions');await new Promise(r=>setTimeout(r,220));assert.equal(w.document.getElementById('answer').textContent,'answer');
d.window.close();console.log('PASS pipeline: click-only extraction, entire long transcript delivered in bounded chunks, final synthesis, caption reuse on follow-up');
})().catch(e=>{console.error(e);process.exitCode=1});
