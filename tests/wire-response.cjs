const assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const pause=()=>new Promise(r=>setImmediate(r)),wait=ms=>new Promise(r=>setTimeout(r,ms));
const fp=value=>{let h=2166136261;for(const c of value.replace(/\s+/g,''))h=Math.imul(h^c.charCodeAt(0),16777619);return (h>>>0).toString(16)};
(async()=>{
 const d=new JSDOM('<button aria-label="关闭临时聊天"></button><textarea></textarea><button aria-label="发送"></button>',{url:'https://chatgpt.com/?temporary-chat=true',runScripts:'outside-only'}),w=d.window;
 Object.defineProperty(w.document,'visibilityState',{value:'hidden'});
 Object.assign(w,{Promise,Request,Response,ReadableStream,TextDecoder,URL});
 w.HTMLElement.prototype.getBoundingClientRect=()=>({width:10,height:10});
 const interval=w.setInterval.bind(w);w.setInterval=f=>interval(f,5);
 let handler,controller,calls=0;const messages=[];
 w.fetch=()=>{calls++;return Promise.resolve(new Response(new ReadableStream({start(c){controller=c}})))};
 w.chrome={runtime:{id:'ext',sendMessage:async m=>{messages.push(m)},onMessage:{addListener:f=>handler=f}}};
 w.eval(fs.readFileSync('extension/response-stream.js','utf8'));const wrapped=w.fetch;w.eval(fs.readFileSync('extension/response-stream.js','utf8'));assert.equal(w.fetch,wrapped,'re-injection does not wrap again');
 w.eval(fs.readFileSync('extension/bridge.js','utf8'));
 w.document.querySelector('[aria-label="发送"]').onclick=()=>{const editor=w.document.querySelector('textarea'),prompt=editor.value;editor.value='';void w.fetch('/backend-api/f/conversation',{method:'POST',body:JSON.stringify({messages:[{author:{role:'user'},content:{parts:[prompt]}}]})}).then(r=>r.text());};
 let finished=false;const pending=new Promise(resolve=>handler({type:'assistant:ask',requestId:'hidden-request',text:'Exact question'},{id:'ext'},result=>{finished=true;resolve(result)}));
 for(let i=0;i<100&&!controller;i++)await wait(5);
 const event=value=>controller.enqueue(new TextEncoder().encode('data: '+(typeof value==='string'?value:JSON.stringify(value))+'\n\n'));
 event({v:'protocol metadata'});event({p:'',o:'add',v:{message:{id:'a',author:{role:'assistant'},channel:'final',content:{content_type:'text',parts:['先给']},status:'in_progress'}}});await pause();await pause();
 let snapshot;handler({type:'assistant:snapshot',requestId:'hidden-request'},{id:'ext'},r=>snapshot=r);assert.equal(snapshot.text,'先给');assert.equal(w.document.querySelectorAll('[data-message-author-role="assistant"]').length,0);assert(messages.some(m=>m.type==='assistant:stream'&&m.text==='先给'));
 await wait(80);assert.equal(finished,false,'a wire pause never becomes a completed DOM answer');
 event({p:'/message',o:'patch',v:[{p:'/content/parts/0',o:'append',v:'结论😀'}]});await pause();assert(messages.some(m=>m.type==='assistant:stream'&&m.text==='先给结论😀'));
 event('[DONE]');controller.close();const result=await pending;assert.equal(result.text,'先给结论😀');assert.equal(result.responseSource,'stream');assert.equal(result.submitted,true);assert.equal(calls,1);
 // A reconnect replays the passive reader's answer without fetching or sending.
 const resumed=await new Promise(resolve=>handler({type:'assistant:resume',requestId:'hidden-request',beforeCount:0,promptFingerprint:fp('Exact question')},{id:'ext'},resolve));assert.equal(resumed.text,'先给结论😀');assert.equal(calls,1);w.close();
 console.log('PASS hidden wire bridge: incremental reply and completion without any answer DOM, hidden page, pauses not premature, idempotent install, reconnect without resend');
})().catch(e=>{console.error(e);process.exitCode=1});
