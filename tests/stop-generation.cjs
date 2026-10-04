const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

(async()=>{
 const source={id:1,windowId:10,url:'https://example.com/article'},backend={id:2,windowId:10,url:'https://chatgpt.com/c/session?temporary-chat=true'};
 let handler,stopCalls=0,failStop=false,saved={assistantSessions:[{windowId:10,sourceId:1,sourceUrl:source.url,transportId:2,requestId:'old',busy:true,submitted:true,lastDelta:'partial'}],ownedAssistantTabs:[2]};const askResolvers=new Map();
 const api={
  sidePanel:{setPanelBehavior(){}},
  storage:{session:{get:async keys=>typeof keys==='string'?{[keys]:saved[keys]}:saved,set:async value=>{saved={...saved,...JSON.parse(JSON.stringify(value))}}}},
  runtime:{id:'ext',getURL:path=>'chrome-extension://ext/'+path,onMessage:{addListener:f=>handler=f},onConnect:{addListener(){}}},
  tabs:{get:async id=>id===1?source:backend,remove:async()=>{},onUpdated:{addListener(){}},onActivated:{addListener(){}},onRemoved:{addListener(){}},sendMessage:async(id,message)=>{
   if(message.type==='assistant:stop'){stopCalls++;if(failStop)throw Error('bridge unavailable');return {text:'partial from bridge',stopped:true,submitted:true};}
   if(message.type==='assistant:privacy')return {temporary:true};
   if(message.type==='assistant:ask')return new Promise(resolve=>askResolvers.set(message.requestId,resolve));
   return {};
  }}
 };
 const context={chrome:api,importScripts(){},URL,Map,Set,Error,AbortController,setInterval,clearInterval,setTimeout,clearTimeout};vm.createContext(context);vm.runInContext(fs.readFileSync('extension/background.js','utf8'),context);
 const call=(message,sender={id:'ext',url:'chrome-extension://ext/panel.html'})=>new Promise(resolve=>handler(message,sender,resolve));
 await wait(5);
 const stopped=await call({type:'assistant:stop',requestId:'old',windowId:10});
 assert.equal(stopCalls,1);assert.equal(stopped.stopped,true);assert.equal(stopped.text,'partial from bridge');assert.equal(saved.assistantSessions[0].busy,false);assert.equal(saved.assistantSessions[0].transportId,2,'stop preserves backend tab');
 await call({type:'assistant:result',requestId:'old',result:{text:'late complete'}},{id:'ext',url:backend.url,tab:backend});
 assert.equal(saved.assistantSessions[0].lastResult.text,'partial from bridge','late result cannot replace stopped partial');
 const nextPromise=call({type:'assistant',requestId:'next',tabId:1,url:source.url,text:'followup'});await wait(5);assert(askResolvers.get('next'),'next followup reaches the same bridge');askResolvers.get('next')({text:'next answer',temporary:true,submitted:true});
 assert.equal((await nextPromise).text,'next answer');assert.equal(saved.assistantSessions[0].transportId,2);assert.equal(saved.assistantSessions[0].busy,false);
 vm.runInContext("captionJobs.set(10,{sourceId:1,sourceUrl:'https://example.com/article',requestId:'caption-only',transportId:null,cancelled:false,controller:new AbortController()})",context);
 const captionStop=await call({type:'assistant:stop',requestId:'caption-only',tabId:1,windowId:10});assert.equal(captionStop.stopped,true);assert.equal(vm.runInContext('captionJobs.has(10)',context),false,'caption-only stop cancels only the matching caption job');assert.equal(saved.assistantSessions[0].transportId,2,'caption stop preserves the assistant session');
 const racingOld=call({type:'assistant',requestId:'race-old',tabId:1,url:source.url,text:'old delayed'});await wait(5);const raceStop=await call({type:'assistant:stop',requestId:'race-old',windowId:10});assert.equal(raceStop.stopped,true);const racingNext=call({type:'assistant',requestId:'race-next',tabId:1,url:source.url,text:'new question'});await wait(5);askResolvers.get('race-old')({text:'late old answer',temporary:true,submitted:true});await wait(5);assert.equal(saved.assistantSessions[0].requestId,'race-next','late old send cannot regain ownership after the next request starts');askResolvers.get('race-next')({text:'new answer',temporary:true,submitted:true});assert.equal((await racingNext).text,'new answer');assert.equal((await racingOld).stopped,true);
 const failing=call({type:'assistant',requestId:'failure',tabId:1,url:source.url,text:'keep running'});await wait(5);failStop=true;const failedStop=await call({type:'assistant:stop',requestId:'failure',windowId:10});assert.match(failedStop.error,/未能确认/);assert.equal(saved.assistantSessions[0].busy,true,'unconfirmed bridge stop must keep the job locked');failStop=false;askResolvers.get('failure')({text:'eventual answer',temporary:true,submitted:true});assert.equal((await failing).text,'eventual answer');

 const dom=new JSDOM('<button aria-label="关闭临时聊天"></button><textarea></textarea><button data-testid="send-button">发送</button>',{url:'https://chatgpt.com/?temporary-chat=true',runScripts:'outside-only'}),w=dom.window;
 let bridge,stopClicks=0,sent=[];w.HTMLElement.prototype.getBoundingClientRect=()=>({width:100,height:100});Object.defineProperty(w.HTMLElement.prototype,'innerText',{get(){return this.textContent}});
 const nativeInterval=w.setInterval.bind(w);w.setInterval=f=>nativeInterval(f,5);w.chrome={runtime:{id:'ext',onMessage:{addListener:f=>bridge=f},sendMessage:async message=>sent.push(message)}};
 w.eval(fs.readFileSync('extension/bridge.js','utf8'));
 const send=w.document.querySelector('[data-testid="send-button"]');send.onclick=()=>{send.setAttribute('data-testid','stop-button');send.textContent='停止生成';send.onclick=()=>{stopClicks++;send.remove();};const answer=w.document.createElement('div');answer.setAttribute('data-message-author-role','assistant');answer.textContent='bridge partial';w.document.body.append(answer)};
 const ask=new Promise(resolve=>bridge({type:'assistant:ask',requestId:'bridge-one',text:'first question'},{id:'ext'},resolve));await wait(20);
 const bridgeStop=await new Promise(resolve=>bridge({type:'assistant:stop',requestId:'bridge-one'},{id:'ext'},resolve));
 assert.equal(stopClicks,1,'bridge clicks the real stop-generation control');assert.equal(bridgeStop.text,'bridge partial');assert.equal(bridgeStop.stopped,true);assert.equal((await ask).stopped,true);
 const editor=w.document.querySelector('textarea');assert.equal(editor.value,'first question','submitted prompt remains in chat composer state until ChatGPT clears it');
 editor.value='';const send2=w.document.createElement('button');send2.setAttribute('data-testid','send-button');send2.textContent='发送';w.document.body.append(send2);send2.onclick=()=>{const answer=w.document.createElement('div');answer.setAttribute('data-message-author-role','assistant');answer.textContent='second answer';w.document.body.append(answer)};
 const followup=new Promise(resolve=>bridge({type:'assistant:ask',requestId:'bridge-two',text:'second question'},{id:'ext'},resolve));assert.equal((await followup).text,'second answer','next followup runs in the same bridge session');
 dom.window.close();

 const pendingDom=new JSDOM('<button aria-label="关闭临时聊天"></button><textarea></textarea>',{url:'https://chatgpt.com/?temporary-chat=true',runScripts:'outside-only'}),pw=pendingDom.window;let pendingBridge;
 pw.HTMLElement.prototype.getBoundingClientRect=()=>({width:100,height:100});Object.defineProperty(pw.HTMLElement.prototype,'innerText',{get(){return this.textContent}});const pendingInterval=pw.setInterval.bind(pw);pw.setInterval=f=>pendingInterval(f,5);pw.chrome={runtime:{id:'ext',onMessage:{addListener:f=>pendingBridge=f},sendMessage:async()=>{}}};pw.eval(fs.readFileSync('extension/bridge.js','utf8'));
 const pendingAsk=new Promise(resolve=>pendingBridge({type:'assistant:ask',requestId:'pending',text:'owned prompt'},{id:'ext'},resolve));await wait(10);await new Promise(resolve=>pendingBridge({type:'assistant:stop',requestId:'pending'},{id:'ext'},resolve));assert.equal((await pendingAsk).stopped,true);assert.equal(pw.document.querySelector('textarea').value,'','pending owned prompt is removed so it cannot submit later');await wait(30);assert(!pw.document.querySelector('[data-testid="send-button"]'),'test never added a send control');pendingDom.window.close();
 console.log('PASS stop-generation: authenticated stop preserves tab/session and partial answer, rejects late results, cancels pending submission, clicks real stop control, and permits same-session followup');
})().catch(error=>{console.error(error);process.exitCode=1});
