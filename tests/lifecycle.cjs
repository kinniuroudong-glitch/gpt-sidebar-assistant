const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const bg=fs.readFileSync('extension/background.js','utf8');
const tick=()=>new Promise(r=>setTimeout(r,10));
(async()=>{
 let saved={},removed=[],created=0,bridgeReject,submitOnSend=false,mode='error';let workerTimers=new Set();
 const source={id:1,windowId:10,active:true,url:'https://www.youtube.com/watch?v=abcdefghijk'},backend={id:100,windowId:10,url:'https://chatgpt.com/?temporary-chat=true'};
 const tabs=new Map([[1,source],[100,backend],[2,{id:2,url:'https://example.com/'}],[3,{id:3,url:'https://www.youtube.com/shorts/lmnopqrstuv'}]]);
 function boot(){
  // Restarting a real worker terminates its previous timers.
  for(const timer of workerTimers)clearInterval(timer);workerTimers=new Set();
  let handler,updated,activated,register,disconnect;const messages=[];
  const api={storage:{session:{get:async()=>saved,set:async d=>{saved=JSON.parse(JSON.stringify(d))}}},sidePanel:{setPanelBehavior(){}},runtime:{id:'ext',getURL:p=>'chrome-extension://ext/'+p,onMessage:{addListener:f=>handler=f},onConnect:{addListener:f=>{f({name:'assistant-panel',sender:{id:'ext',url:'chrome-extension://ext/panel.html'},onMessage:{addListener:g=>register=g},onDisconnect:{addListener:g=>disconnect=g},postMessage:m=>messages.push(m)});register({windowId:10})}}},tabs:{onUpdated:{addListener:f=>updated=f},onActivated:{addListener:f=>activated=f},onRemoved:{addListener(){}},get:async id=>{if(!tabs.has(id))throw Error('missing tab');return tabs.get(id)},create:async()=>{created++;return backend},remove:async id=>{removed.push(id)},sendMessage:async(id,m)=>{
   if(m.type==='assistant:privacy')return {temporary:true};
   if(mode==='error')return {error:'Temporary marker missing'};
   return new Promise((resolve,reject)=>{bridgeReject=reject;if(submitOnSend)queueMicrotask(()=>call('assistant:submitted',{requestId:m.requestId},true));});
  }}};
  vm.runInNewContext(bg,{chrome:api,importScripts(){},URL,Map,Set,Error,setInterval:(f,ms)=>{const timer=setInterval(f,ms);workerTimers.add(timer);return timer},clearInterval:timer=>{clearInterval(timer);workerTimers.delete(timer)},setTimeout,clearTimeout});
  function call(type,extra={},fromBackend=false){return new Promise(r=>handler({type,tabId:1,url:source.url,text:'secret subtitle question',requestId:'r',...extra},fromBackend?{id:'ext',url:backend.url,tab:backend}:{id:'ext',url:'chrome-extension://ext/panel.html'},r))}
  return {call,updated,activated,disconnect,messages,register};
 }
 let a=boot();await tick();
 let result=await a.call('assistant');assert(result.error);assert.deepEqual(removed,[],'read error must preserve GPT');
 mode='hold';submitOnSend=true;const long=a.call('assistant',{requestId:'long',transcriptFinal:true});await tick();bridgeReject(Error('The message port closed before a response was received.'));
 result=await long;assert.equal(result.pending,true);assert.equal(saved.assistantSessions[0].busy,true);assert.equal(saved.assistantSessions[0].submitted,true);assert(!JSON.stringify(saved).includes('secret'));
 a.disconnect();a.activated({windowId:10,tabId:2});a.updated(1,{url:source.url+'&t=90#chapter'});await tick();assert.deepEqual(removed,[]);
 // Recreate the worker while ChatGPT is still generating.
 a=boot();await tick();assert.deepEqual(removed,[],'worker restart must preserve active GPT');
 await a.call('assistant:stream',{requestId:'long',text:'Partial'},true);assert(a.messages.some(m=>m.type==='assistant:delta'&&m.text==='Partial'));
 await a.call('assistant:result',{requestId:'long',result:{text:'Complete',temporary:true,submitted:true}},true);
 assert(a.messages.some(m=>m.type==='assistant:result'&&m.result.text==='Complete'));assert.equal(saved.assistantSessions[0].busy,false);
 a=boot();await tick();assert(a.messages.some(m=>m.type==='assistant:result'&&m.result.text==='Complete'),'completed answer must survive worker restart and port reconnect');
 assert.equal((await a.call('assistant:context')).data.hasTranscript,true);assert.equal(created,1);
 a.activated({windowId:10,tabId:3});await tick();assert.deepEqual(removed,[],'different video in another tab preserves GPT');
 // Same-tab SPA navigation to a different ID also cancels.
 mode='error';await a.call('assistant');a.updated(1,{url:'https://www.youtube.com/watch?v=lmnopqrstuv'});await tick();assert.equal(removed.length,0);
 // A known stale restored session is cleaned only because the source changed.
 saved={ownedAssistantTabs:[100,77],assistantSessions:[{windowId:10,sourceId:1,sourceUrl:'https://www.youtube.com/watch?v=oldoldoldol',transportId:100,busy:true,requestId:'old'}]};tabs.set(77,{url:'https://downsub.com/'});a=boot();await tick();assert(removed.includes(77));assert.equal(removed.filter(x=>x===100).length,0,'restored chat survives source navigation');
 saved={ownedAssistantTabs:[100],assistantSessions:[]};a=boot();await tick();assert.equal(removed.filter(x=>x===100).length,1,'owned GPT orphan without a session must be cleaned');
 // A missing UI marker during generation must not throw away the current reply.
 const d=new JSDOM('<button aria-label="关闭临时聊天"></button><textarea></textarea><button aria-label="发送"></button>',{url:backend.url,runScripts:'outside-only'}),w=d.window;let receiver,clicks=0;const emitted=[];
 w.HTMLElement.prototype.getBoundingClientRect=()=>({width:100,height:100});Object.defineProperty(w.HTMLElement.prototype,'innerText',{get(){return this.textContent}});
 const interval=w.setInterval.bind(w);w.setInterval=f=>interval(f,5);w.chrome={runtime:{id:'ext',onMessage:{addListener:f=>receiver=f},sendMessage:async m=>emitted.push(m)}};
 w.document.querySelector('[aria-label="发送"]').onclick=()=>{clicks++;w.document.querySelector('[aria-label="关闭临时聊天"]').remove();const response=w.document.createElement('div');response.setAttribute('data-message-author-role','assistant');response.textContent='Answer survived';w.document.body.append(response)};
 w.eval(fs.readFileSync('extension/bridge.js','utf8'));
 result=await new Promise(r=>receiver({type:'assistant:ask',text:'Question',requestId:'bridge'},{id:'ext'},r));assert.equal(result.text,'Answer survived');assert.equal(result.temporary,false);assert.equal(clicks,1);assert(emitted.some(m=>m.type==='assistant:submitted'));assert(emitted.some(m=>m.type==='assistant:result'&&m.result.text==='Answer survived'));w.close();
 // Fresh content script restores only the matching last submitted question.
 const rd=new JSDOM('<div data-message-author-role="user">Old question</div><div data-message-author-role="assistant">Old answer</div>',{url:backend.url,runScripts:'outside-only'}),rw=rd.window;let resumeReceiver;const resumeEmitted=[];
 rw.HTMLElement.prototype.getBoundingClientRect=()=>({width:100,height:100});Object.defineProperty(rw.HTMLElement.prototype,'innerText',{get(){return this.textContent}});const ri=rw.setInterval.bind(rw);rw.setInterval=f=>ri(f,5);
 rw.chrome={runtime:{id:'ext',onMessage:{addListener:f=>resumeReceiver=f},sendMessage:async m=>resumeEmitted.push(m)}};rw.eval(fs.readFileSync('extension/bridge.js','utf8'));
 const fp=value=>{let h=2166136261;for(const c of value.replace(/\s+/g,''))h=Math.imul(h^c.charCodeAt(0),16777619);return (h>>>0).toString(16)};
 const resumed=new Promise(r=>resumeReceiver({type:'assistant:resume',requestId:'restored',beforeCount:1,promptFingerprint:fp('New question')},{id:'ext'},r));
 await new Promise(r=>setTimeout(r,60));assert(!resumeEmitted.some(m=>m.type==='assistant:stream'),'old answer must not be reused');
 rw.document.body.insertAdjacentHTML('beforeend','<div data-content-search-unit-key="fallback-turn-0:0:user">New question<button>显示更多</button></div><div data-markdown-text-style="assistant-message">Recovered after reload</div>');
 assert.equal((await resumed).text,'Recovered after reload');assert.equal(resumeEmitted.filter(m=>m.type==='assistant:submitted').length,0,'resume must never submit a second question');rw.close();
 // Original long-request channel failure is recovered by the independent result.
 const p=new JSDOM(fs.readFileSync('extension/panel.html','utf8'),{url:'https://local.test',runScripts:'outside-only'});let panelReceive,payload,disconnected,reconnects=0;
 p.window.chrome={tabs:{query:async()=>[source],onUpdated:{addListener(){}},onActivated:{addListener(){}}},runtime:{id:'ext',onMessage:{addListener(){}},connect:()=>{reconnects++;return {postMessage(){},disconnect(){},onMessage:{addListener:f=>panelReceive=f},onDisconnect:{addListener:f=>disconnected=f}}},sendMessage:async m=>{if(m.type==='extract')return {data:{...source,tabId:1,type:'page',text:'Body'}};payload=m;throw Error('message channel closed')}}};
 p.window.eval(fs.readFileSync('extension/panel.js','utf8'));await tick();p.window.document.getElementById('summary').click();await tick();assert.equal(p.window.document.getElementById('summary').disabled,true);panelReceive({type:'assistant:result',requestId:payload.requestId,uiTurnId:payload.uiTurnId,uiQuestion:payload.uiQuestion,result:{text:'Recovered answer'}});await new Promise(r=>setTimeout(r,230));assert.equal(p.window.document.getElementById('answer').textContent,'Recovered answer');assert.equal(p.window.document.getElementById('summary').disabled,false);disconnected();await new Promise(r=>setTimeout(r,1100));assert.equal(reconnects,2);p.window.close();
 console.log('PASS lifecycle: error/port loss/tab switch/time parameters/restart preserve GPT; same-tab and cross-tab new video preserve it; independent completion and panel reconnect recover answers; generation tolerates temporary marker disappearance without new sends; no subtitle persistence; saved completed answers replay after worker restart; full document reload ignores old answers and never resubmits');
})().catch(e=>{console.error(e);process.exitCode=1});
