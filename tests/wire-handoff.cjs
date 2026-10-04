const assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync('extension/bridge.js','utf8');
const pause=()=>new Promise(resolve=>setImmediate(resolve));
const fp=value=>{let hash=2166136261;for(const char of value.replace(/\s+/g,''))hash=Math.imul(hash^char.charCodeAt(0),16777619);return (hash>>>0).toString(16)};

function fixture(body){
 const dom=new JSDOM(body,{url:'https://chatgpt.com/c/handoff?temporary-chat=true',runScripts:'outside-only'}),w=dom.window;
 let handler,now=1000,nextTimer=1,arm;const timers=new Map(),messages=[];
 w.HTMLElement.prototype.getBoundingClientRect=()=>({width:20,height:20});
 w.Date.now=()=>now;
 w.setInterval=(callback,delay)=>{const id=nextTimer++;timers.set(id,{callback,delay});return id};
 w.clearInterval=id=>timers.delete(id);
 w.chrome={runtime:{id:'ext',sendMessage:async message=>{messages.push(message)},onMessage:{addListener:listener=>handler=listener}}};
 w.document.addEventListener('gpt-sidebar-stream-control-v3',event=>{const value=JSON.parse(event.detail);if(value.action==='arm')arm=value});
 w.eval(source);
 const runTimer=async(delay,count=1,advance=0)=>{
  for(let i=0;i<count;i++){
   const entry=[...timers.values()].find(timer=>timer.delay===delay);
   assert(entry,`missing ${delay}ms interval`);now+=advance;entry.callback();await pause();
  }
 };
 const advance=ms=>{now+=ms};
 const wire=(status,text='')=>{
  assert(arm,'wire listener was not armed');
  w.document.dispatchEvent(new w.CustomEvent('gpt-sidebar-stream-update-v3',{detail:JSON.stringify({token:arm.token,requestId:arm.requestId,status,text})}));
 };
 return {dom,w,messages,get handler(){return handler},runTimer,advance,wire};
}

(async()=>{
 const f=fixture('<button aria-label="关闭临时聊天"></button><textarea></textarea><button aria-label="发送"></button>');
 const {w}=f;let sent=0,finished=false;
 w.document.querySelector('[aria-label="发送"]').onclick=()=>{
  sent++;
  const user=w.document.createElement('div');user.setAttribute('data-message-author-role','user');user.textContent=w.document.querySelector('textarea').value;
  w.document.body.append(user);w.document.querySelector('textarea').value='';
 };
 const pending=new Promise(resolve=>f.handler({type:'assistant:ask',requestId:'handoff',text:'Exact question'},{id:'ext'},result=>{finished=true;resolve(result)}));
 await f.runTimer(500);assert.equal(sent,1);
 f.wire('started');f.wire('delta','Alpha **beta**');await pause();
 assert(f.messages.some(message=>message.type==='assistant:stream'&&message.text==='Alpha **beta**'));

 const answer=w.document.createElement('div');answer.setAttribute('data-message-author-role','assistant');answer.textContent='Alpha';w.document.body.append(answer);
 const stop=w.document.createElement('button');stop.dataset.testid='stop-button';w.document.body.append(stop);
 f.advance(4100);await f.runTimer(250);let snapshot;
 f.handler({type:'assistant:snapshot',requestId:'handoff'},{id:'ext'},reply=>snapshot=reply);
 assert.equal(snapshot.text,'Alpha **beta**','DOM behind the wire must not regress the streamed answer');
 assert(!f.messages.some(message=>message.type==='assistant:stream'&&message.text==='Alpha'));

 answer.textContent='Unrelated replacement that is much longer than the real answer';await pause();await f.runTimer(250);
 f.handler({type:'assistant:snapshot',requestId:'handoff'},{id:'ext'},reply=>snapshot=reply);
 assert.equal(snapshot.text,'Alpha **beta**','length alone must not let unrelated DOM replace wire text');

 answer.innerHTML='<p>Alpha <strong>beta</strong> plus DOM continuation</p>';await pause();await f.runTimer(250);
 const continued='Alpha beta plus DOM continuation';
 assert(f.messages.some(message=>message.type==='assistant:stream'&&message.text===continued),'a quiet wire hands incremental publishing to a covering DOM while generation continues');
 f.handler({type:'assistant:snapshot',requestId:'handoff'},{id:'ext'},reply=>snapshot=reply);
 assert.equal(snapshot.text,continued);

 answer.textContent='Alpha';await pause();await f.runTimer(250);
 f.handler({type:'assistant:snapshot',requestId:'handoff'},{id:'ext'},reply=>snapshot=reply);
 assert.equal(snapshot.text,continued,'an accepted DOM handoff must not regress during transient render shrinkage');
 assert.equal(f.messages.at(-1).text,continued,'transient stale DOM must not publish an older wire prefix');
 answer.innerHTML='<p>Alpha <strong>beta</strong> plus DOM continuation</p>';await pause();await f.runTimer(250);

 await f.runTimer(250,10,250);assert.equal(finished,false,'a visible stop button prevents stable DOM completion');
 stop.remove();await pause();
 assert.equal(finished,true,'removing the Stop control completes from the DOM mutation without another polling tick');const result=await pending;
 assert.equal(result.text,continued);assert.equal(result.submitted,true);assert.equal(finished,true);
 assert(f.messages.some(message=>message.type==='assistant:result'&&message.result.text===continued));
 w.close();

 const r=fixture('<button aria-label="关闭临时聊天"></button><div data-message-author-role="user">Resume question</div><div data-message-author-role="assistant"><p>Wire prefix</p></div><button data-testid="stop-button"></button><textarea></textarea>');
 let resumed=false;const resumePending=new Promise(resolve=>r.handler({type:'assistant:resume',requestId:'resume-handoff',beforeCount:0,promptFingerprint:fp('Resume question')},{id:'ext'},result=>{resumed=true;resolve(result)}));
 r.wire('started');r.wire('delta','Wire prefix');await pause();r.advance(4100);
 const resumedAnswer=r.w.document.querySelector('[data-message-author-role="assistant"]');resumedAnswer.innerHTML='<p>Wire prefix continued after reconnect</p>';await pause();await r.runTimer(250);
 assert(r.messages.some(message=>message.type==='assistant:stream'&&message.text==='Wire prefix continued after reconnect'));
 await r.runTimer(250,9,250);assert.equal(resumed,false,'resume also waits while generation is visibly active');
 r.w.document.querySelector('[data-testid="stop-button"]').remove();await pause();
 assert.equal(resumed,true,'resume completes immediately when the Stop control disappears');
 const resumedResult=await resumePending;assert.equal(resumedResult.text,'Wire prefix continued after reconnect');assert.equal(resumedResult.submitted,true);r.w.close();

 console.log('PASS wire handoff: stale SSE yields only to covering DOM, streams while active, waits for stop removal, completes after stability, and applies on resume');
})().catch(error=>{console.error(error);process.exitCode=1});
