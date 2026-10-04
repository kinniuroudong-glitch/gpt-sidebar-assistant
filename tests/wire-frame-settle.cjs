const assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const frameSource=fs.readFileSync('extension/background-frames.js','utf8');
const bridgeSource=fs.readFileSync('extension/bridge.js','utf8');

function fixture(){
 const dom=new JSDOM('<button aria-label="关闭临时聊天"></button><textarea></textarea><button aria-label="发送"></button>',{url:'https://chatgpt.com/?temporary-chat=true',runScripts:'outside-only'}),w=dom.window;
 let now=10000,nextFrame=1,nextTimeout=1,nextInterval=1,handler,streamArm;
 const nativeFrames=new Map(),timeouts=new Map(),intervals=new Map(),messages=[],frameControls=[];
 w.Date.now=()=>now;
 w.HTMLElement.prototype.getBoundingClientRect=()=>({width:20,height:20});
 w.requestAnimationFrame=callback=>{const id=nextFrame++;nativeFrames.set(id,callback);return id};
 w.cancelAnimationFrame=id=>nativeFrames.delete(id);
 w.setTimeout=(callback,delay)=>{const id=nextTimeout++;timeouts.set(id,{callback,delay});return id};
 w.clearTimeout=id=>timeouts.delete(id);
 w.setInterval=(callback,delay)=>{const id=nextInterval++;intervals.set(id,{callback,delay});return id};
 w.clearInterval=id=>intervals.delete(id);
 w.console.debug=()=>{};
 w.chrome={runtime:{id:'ext',sendMessage:async message=>{messages.push(message)},onMessage:{addListener:listener=>handler=listener}}};
 w.document.addEventListener('gpt-sidebar-frames-control-v1',event=>frameControls.push(JSON.parse(event.detail)));
 w.document.addEventListener('gpt-sidebar-stream-control-v3',event=>{const value=JSON.parse(event.detail);if(value.action==='arm')streamArm=value});
 w.eval(frameSource);w.eval(bridgeSource);
 w.document.querySelector('[aria-label="发送"]').onclick=()=>{
  w.document.querySelector('textarea').value='';
  if(!w.document.querySelector('[data-testid="stop-button"]')){
   const stop=w.document.createElement('button');stop.dataset.testid='stop-button';w.document.body.append(stop);
  }
 };
 const runInterval=delay=>{
  const found=[...intervals].find(([,entry])=>entry.delay===delay);assert(found,`missing ${delay}ms interval`);
  found[1].callback();
 };
 const advance=ms=>{now+=ms};
 const snapshot=requestId=>{let result;handler({type:'assistant:snapshot',requestId},{id:'ext'},value=>result=value);return result};
 const emit=(status,text='')=>{
  assert(streamArm,'stream listener was not armed');
  w.document.dispatchEvent(new w.CustomEvent('gpt-sidebar-stream-update-v3',{detail:JSON.stringify({requestId:streamArm.requestId,token:streamArm.token,status,text})}));
 };
 const ask=(requestId,text)=>{
  let settled=false,result;
  const returned=handler({type:'assistant:ask',requestId,text},{id:'ext'},value=>{settled=true;result=value});
  return {returned,get settled(){return settled},get result(){return result}};
 };
 return {dom,w,messages,frameControls,nativeFrames,timeouts,intervals,ask,emit,snapshot,runInterval,advance};
}

(async()=>{
 // The stream clone can finish before ChatGPT's original reader commits its
 // last two animation frames. Snapshot pulses keep the owned lease alive until
 // the real Stop control is gone, then the DOM mutation completes immediately.
 let f=fixture(),first=f.ask('settle','First question');assert.equal(first.returned,true);
 f.runInterval(500);assert(f.w.document.querySelector('[data-testid="stop-button"]'));
 f.emit('started');f.emit('delta','Complete streamed answer');
 f.w.requestAnimationFrame(()=>f.w.requestAnimationFrame(()=>f.w.document.querySelector('[data-testid="stop-button"]')?.remove()));
 f.emit('done','Complete streamed answer');
 assert.equal(first.settled,false,'wire completion must not release the frame lease immediately');
 assert.equal(f.frameControls.filter(value=>value.action==='disarm'&&value.requestId==='settle').length,0);

 let state=f.snapshot('settle');assert.equal(state.busy,true);assert.equal(state.transport.stopping,true);assert.equal(first.settled,false);
 state=f.snapshot('settle');assert.equal(state.transport.stopping,false);await new Promise(resolve=>setImmediate(resolve));assert.equal(first.settled,true,'Stop removal is the original-reader settle signal and needs no fixed delay');
 assert.equal(first.result.text,'Complete streamed answer');assert.equal(first.result.responseSource,'stream');assert.equal(first.result.submitted,true);
 assert.equal(f.frameControls.filter(value=>value.action==='disarm'&&value.requestId==='settle').length,1);

 const follow=f.ask('followup','Second question');assert.equal(follow.returned,true);assert.equal(follow.settled,false,'the settled page accepts a follow-up instead of reporting the prior Stop state');
 assert(f.frameControls.some(value=>value.action==='arm'&&value.requestId==='followup'));
 f.dom.window.close();

 // A broken/stale Stop marker cannot retain the invasive frame lease forever.
 // The short cap publishes the already-complete wire result and cleans up once.
 f=fixture();const capped=f.ask('cap','Cap question');f.runInterval(500);
 f.emit('started');f.emit('delta','Wire answer at hard cap');f.emit('done','Wire answer at hard cap');
 for(let i=0;i<3;i++){const snapshot=f.snapshot('cap');assert.equal(snapshot.transport.stopping,true)}
 f.advance(1499);f.runInterval(250);assert.equal(capped.settled,false);
 f.advance(1);f.runInterval(250);assert.equal(capped.settled,true);
 assert.equal(capped.result.text,'Wire answer at hard cap');assert.equal(capped.result.responseSource,'stream');
 assert.equal(f.frameControls.filter(value=>value.action==='disarm'&&value.requestId==='cap').length,1);
 const completed=f.snapshot('cap');assert.equal(completed.busy,false);assert.equal(completed.result.text,'Wire answer at hard cap');
 assert.equal(f.frameControls.filter(value=>value.action==='disarm'&&value.requestId==='cap').length,1,'completion and later snapshots must not clean the lease twice');
 f.dom.window.close();

 console.log('PASS wire frame settle: clone completion retains owned pulses through original page frames, finishes on Stop removal, permits follow-up, and hard-caps stale cleanup at 1.5s');
})().catch(error=>{console.error(error);process.exitCode=1});
