const assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const w=new JSDOM(fs.readFileSync('extension/panel.html','utf8'),{url:'https://local.test',runScripts:'outside-only'}).window;let receive;const sent=[],pending=new Map();
 w.chrome={tabs:{query:async()=>[{id:1,windowId:10,url:'https://example.com/',title:'Very long title'}],onActivated:{addListener(){}},onUpdated:{addListener(){}}},runtime:{id:'ext',onMessage:{addListener(){}},connect:()=>({postMessage(){},disconnect(){},onMessage:{addListener(fn){receive=fn;}}}),sendMessage:async m=>{sent.push(m);if(m.type==='assistant')return new Promise(r=>pending.set(m.requestId,r));if(m.type==='assistant:stop')return {ok:true,text:'部分回答'};return {ok:true};}}};
 w.eval(fs.readFileSync('extension/panel.js','utf8'));await wait(10);
 const d=w.document;function submit(q){d.getElementById('question').value=q;d.getElementById('form').requestSubmit();}
 submit('第一问');await wait(10);const first=sent.find(m=>m.type==='assistant');assert.equal(d.getElementById('stop').hidden,false);
 receive({type:'assistant:delta',requestId:first.requestId,uiTurnId:first.uiTurnId,text:'部分回答'});await wait(200);
 d.getElementById('stop').click();await wait(10);assert.equal(d.getElementById('answer').textContent,'部分回答');assert.equal(d.getElementById('send').disabled,false);assert.equal(d.getElementById('stop').hidden,true);
 receive({type:'assistant:result',requestId:first.requestId,uiTurnId:first.uiTurnId,result:{text:'迟来的旧回答'}});pending.get(first.requestId)({text:'迟来的旧回答'});await wait(10);assert.equal(d.getElementById('answer').textContent,'部分回答');
 submit('第二问');await wait(10);const last=sent.filter(m=>m.type==='assistant').at(-1);assert.equal(last.text,'第二问');assert.notEqual(last.requestId,first.requestId);pending.get(last.requestId)({text:'新回答'});await wait(220);assert.deepEqual([...d.querySelectorAll('.assistant')].map(n=>n.textContent),['部分回答','新回答']);assert.equal(d.getElementById('send').disabled,false);
 const css=fs.readFileSync('extension/panel.css','utf8');assert.match(css,/#attachment\{font-size:12px/);w.close();console.log('PASS panel stop: partial retained, stale results ignored, next plain followup unlocked, small page label');
})().catch(e=>{console.error(e);process.exitCode=1});
