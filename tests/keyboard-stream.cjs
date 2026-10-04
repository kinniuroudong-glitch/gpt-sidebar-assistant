const assert=require('node:assert/strict'),fs=require('node:fs');const {JSDOM}=require('jsdom');
(async()=>{
const d=new JSDOM(fs.readFileSync('extension/panel.html','utf8'),{url:'https://local.test',runScripts:'outside-only'}),w=d.window;let receiver,portReceiver,payload,resolveReply,sends=0;
w.chrome={tabs:{query:async()=>[{id:1,windowId:10,url:'https://example.com/'}],onActivated:{addListener(){}},onUpdated:{addListener(){}}},runtime:{id:'ext',onMessage:{addListener:f=>receiver=f},connect:()=>({postMessage(){},disconnect(){},onMessage:{addListener:f=>portReceiver=f}}),sendMessage:async m=>{if(m.type==='translation:progress:get')return {data:null};if(m.type==='translation:progress:set')return {ok:true};if(m.type==='extract')return {data:{tabId:1,url:'https://example.com/',title:'Example',type:'page',text:'content',captions:''}};payload=m;sends++;return new Promise(r=>resolveReply=r)}}};
w.eval(fs.readFileSync('extension/panel.js','utf8'));await new Promise(r=>setTimeout(r,10));
const q=w.document.getElementById('question');q.value='My question';
function key(extras={}){const e=new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true,...extras});q.dispatchEvent(e);return e}
assert.equal(key({shiftKey:true}).defaultPrevented,false);assert.equal(sends,0);
assert.equal(key({isComposing:true}).defaultPrevented,false);assert.equal(sends,0);
q.dispatchEvent(new w.CompositionEvent('compositionstart'));assert.equal(key().defaultPrevented,false);q.dispatchEvent(new w.CompositionEvent('compositionend'));assert.equal(sends,0);
assert.equal(key().defaultPrevented,true);await new Promise(r=>setTimeout(r,5));assert.equal(sends,1);assert.equal(q.value,'');assert.equal(payload.uiQuestion,'My question');assert(payload.uiTurnId);assert(!payload.requiresTranscript);assert(!payload.text.includes('content'));
portReceiver({type:'assistant:delta',requestId:payload.requestId,text:'Partial'});assert.equal(w.document.getElementById('answer').textContent,'P');await new Promise(r=>setTimeout(r,240));assert.equal(w.document.getElementById('answer').textContent,'Partial');
receiver({type:'assistant:delta',requestId:'wrong',text:'Stale'},{id:'ext'});assert.equal(w.document.getElementById('answer').textContent,'Partial');
receiver({type:'assistant:delta',requestId:payload.requestId,text:'Partial answer'},{id:'ext'});assert.equal(w.document.getElementById('answer').textContent,'Partial');await new Promise(r=>setTimeout(r,240));assert.equal(w.document.getElementById('answer').textContent,'Partial answer');
resolveReply({text:'Partial answer complete'});await new Promise(r=>setTimeout(r,10));assert.notEqual(w.document.getElementById('answer').textContent,'Partial answer complete','final prefix drains instead of jumping as one block');await new Promise(r=>setTimeout(r,230));assert.equal(w.document.getElementById('answer').textContent,'Partial answer complete');d.window.close();
console.log('PASS: Enter sends once; Shift+Enter and IME remain untouched; streaming renders before completion; stale request updates ignored');
})().catch(e=>{console.error(e);process.exitCode=1});
