const assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync('extension/bridge.js','utf8');
const pause=()=>new Promise(resolve=>setImmediate(resolve));

function fixture({fakeClock=false}={}){
 const dom=new JSDOM('<button aria-label="关闭临时聊天"></button><textarea id="prompt-textarea"></textarea><button aria-label="发送"></button>',{url:'https://chatgpt.com/?temporary-chat=true',runScripts:'outside-only'}),w=dom.window;
 let handler,arm,now=1000,nextTimer=1;const timers=new Map(),sent=[];
 w.HTMLElement.prototype.getBoundingClientRect=()=>({width:20,height:20});
 if(fakeClock){w.Date.now=()=>now;w.setInterval=(callback,delay)=>{const id=nextTimer++;timers.set(id,{callback,delay});return id};w.clearInterval=id=>timers.delete(id)}
 w.console.debug=()=>{};
 w.chrome={runtime:{id:'ext',sendMessage:async()=>{},onMessage:{addListener:listener=>handler=listener}}};
 w.document.addEventListener('gpt-sidebar-stream-control-v3',event=>{const value=JSON.parse(event.detail);if(value.action==='arm')arm=value});
 w.eval(source);
 w.document.querySelector('[aria-label="发送"]').onclick=()=>{
  const editor=w.document.querySelector('textarea'),prompt=editor.value;editor.value='';sent.push(prompt);
  const user=w.document.createElement('div');user.dataset.messageAuthorRole='user';user.textContent=prompt;w.document.body.append(user);
 };
 const ready=()=>{if(fakeClock){const entry=[...timers.values()].find(timer=>timer.delay===500);assert(entry,'missing send-ready timer');entry.callback()}};
 const ask=(requestId,text)=>{let settled=false,result;const returned=handler({type:'assistant:ask',requestId,text},{id:'ext'},value=>{settled=true;result=value});ready();return {returned,get settled(){return settled},get result(){return result}}};
 const wire=(status,text='')=>{assert(arm);w.document.dispatchEvent(new w.CustomEvent('gpt-sidebar-stream-update-v3',{detail:JSON.stringify({token:arm.token,requestId:arm.requestId,status,text})}))};
 const snapshot=requestId=>{let result;handler({type:'assistant:snapshot',requestId},{id:'ext'},value=>result=value);return result};
 return {dom,w,timers,sent,ask,wire,snapshot,advance(ms){now+=ms},run(delay){const entry=[...timers.values()].find(timer=>timer.delay===delay);assert(entry,`missing ${delay}ms timer`);entry.callback()}};
}

(async()=>{
 // A pause is not completion: only a finalized wire event may use the fast path.
 let f=fixture({fakeClock:true}),first=f.ask('wire-fast','first prompt');assert.equal(first.returned,true);
 f.wire('started');f.wire('delta','complete-looking text');f.advance(10000);assert.equal(first.settled,false);assert.equal(f.snapshot('wire-fast').busy,true,'a long network pause stays busy');
 f.wire('done','complete-looking text');assert.equal(first.settled,true,'finalized wire completes inside its event, before the next timer tick');assert.equal(first.result.text,'complete-looking text');
 assert.equal(f.snapshot('wire-fast').busy,false);
 const follow=f.ask('followup','second prompt');assert.equal(follow.returned,true);assert.deepEqual(f.sent,['first prompt','second prompt'],'completion unlocks a follow-up in the same chat');
 f.wire('done','second answer');assert.equal(follow.settled,true);f.dom.window.close();

 // The cloned response may finish before ChatGPT's original fetch/render path.
 // Keep busy while Stop exists, then finish in the removal mutation microtask.
 f=fixture({fakeClock:false});first=f.ask('dom-signal','question');await new Promise(resolve=>setTimeout(resolve,550));
 const stop=f.w.document.createElement('button');stop.dataset.testid='stop-button';f.w.document.body.append(stop);await pause();
 const answer=f.w.document.createElement('div');answer.dataset.messageAuthorRole='assistant';answer.textContent='rendered answer';f.w.document.body.append(answer);f.wire('started');f.wire('delta','rendered answer');f.wire('done','rendered answer');
 assert.equal(first.settled,false,'clone SSE completion waits for the original page while Stop is visible');
 stop.remove();await pause();assert.equal(first.settled,true,'Stop removal signals completion without a 250ms polling wait');assert.equal(first.result.text,'rendered answer');
 f.dom.window.close();

 // A live wire is stronger evidence than a transient Stop disappearance during
 // a UI rerender. The bridge must wait until the transport actually finalizes.
 f=fixture({fakeClock:false});first=f.ask('transient-stop','rerender question');await new Promise(resolve=>setTimeout(resolve,550));
 const transient=f.w.document.createElement('button');transient.dataset.testid='stop-button';f.w.document.body.append(transient);
 const partial=f.w.document.createElement('div');partial.dataset.messageAuthorRole='assistant';partial.textContent='partial';f.w.document.body.append(partial);await pause();
 f.wire('started');f.wire('delta','partial');transient.remove();await pause();assert.equal(first.settled,false,'an in-progress wire blocks completion while Stop is transiently absent');
 f.w.document.body.append(transient);await pause();assert.equal(first.settled,false,'restoring Stop keeps the same request busy');
 f.wire('done','partial final');assert.equal(first.settled,false,'finalized clone still waits for the restored original-page Stop');
 transient.remove();await pause();assert.equal(first.settled,true);assert.equal(first.result.text,'partial final');f.dom.window.close();

 console.log('PASS completion latency: pauses and transient Stop rerenders stay busy, finalized wire completes before the next tick, definitive Stop removal completes from DOM signaling, and same-chat follow-up sends');
})().catch(error=>{console.error(error);process.exitCode=1});
