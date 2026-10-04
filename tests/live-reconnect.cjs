const fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 // A panel reopened in the middle of a response must render current words,
 // continue accepting live chunks, then unlock without re-sending a prompt.
 const dom=new JSDOM(fs.readFileSync('extension/panel.html','utf8'),{url:'https://local.test',runScripts:'outside-only'}),w=dom.window;
 let receiver,source='https://www.youtube.com/watch?v=abcdefghijk',activated,sends=0;
 w.chrome={tabs:{query:async()=>[{id:1,windowId:10,url:source}],onActivated:{addListener:f=>activated=f},onUpdated:{addListener(){}}},runtime:{id:'ext',onMessage:{addListener(){}},connect:()=>({postMessage(){},disconnect(){},onMessage:{addListener:f=>receiver=f}}),sendMessage:async m=>{if(m.type==='translation:progress:get')return {data:null};if(m.type==='translation:progress:set')return {ok:true};if(m.type==='extract')return {data:{tabId:1,url:source,title:'Video',type:'youtube'}};sends++;return {}}}};
 w.eval(fs.readFileSync('extension/panel.js','utf8'));await wait(10);
 receiver({type:'assistant:state',requestId:'r1',uiTurnId:'turn-1',uiQuestion:'问题一',sourceUrl:source,busy:true,submitted:true,text:'正在生成的第一段'});
 assert.equal(w.document.getElementById('answer').textContent,'正在生成的第一段');assert(w.document.getElementById('summary').disabled);
 receiver({type:'assistant:delta',requestId:'r1',uiTurnId:'turn-1',sourceUrl:source,text:'正在生成的第一段\n第二段也出现了'});
 await wait(240);assert.match(w.document.getElementById('answer').textContent,/第二段/);assert(w.document.getElementById('summary').disabled,'still generating: no final result has arrived');assert.equal(sends,0);
 receiver({type:'assistant:delta',requestId:'wrong',uiTurnId:'ghost',sourceUrl:source,text:'Wrong response'});assert.match(w.document.getElementById('answer').textContent,/第二段/);
 receiver({type:'assistant:result',requestId:'r1',uiTurnId:'turn-1',sourceUrl:source,result:{text:'完整回答'}});assert.equal(w.document.getElementById('answer').textContent,'完整回答');assert.equal(w.document.getElementById('summary').disabled,false);
 receiver({type:'assistant:state',requestId:'segment',uiTurnId:'turn-segment',uiQuestion:'总结',sourceUrl:source,busy:true,submitted:true,text:'分段内容',batchStage:{index:1,total:3,final:false}});receiver({type:'assistant:result',requestId:'segment',uiTurnId:'turn-segment',sourceUrl:source,result:{text:'第一段记录'},batchStage:{index:1,total:3,final:false}});assert.match(w.document.getElementById('status').textContent,/不是全片结论/);assert.equal(w.document.getElementById('summary').disabled,false);
 receiver({type:'assistant:state',requestId:'r2',uiTurnId:'turn-2',uiQuestion:'问题二',sourceUrl:source,busy:true,submitted:true,text:'下一条正在生成'});source='https://www.youtube.com/watch?v=zzzzzzzzzzz';await w.eval('sync()');assert.equal(w.document.getElementById('summary').disabled,true,'new video retains the pending recovered answer');receiver({type:'assistant:result',requestId:'r2',uiTurnId:'turn-2',sourceUrl:'https://www.youtube.com/watch?v=abcdefghijk',result:{text:'旧页面回答正常完成'}});assert.equal(w.document.getElementById('summary').disabled,false);assert.equal(w.document.getElementById('answer').textContent,'旧页面回答正常完成');assert.equal(sends,0);dom.window.close();
 // Worker restarts / lost panel updates can obtain current text from the
 // bridge without awaiting completion or issuing another assistant:ask.
 let handler,connect,register,posted=[],messages=[];
 const chrome={runtime:{id:'ext',getURL:p=>'chrome-extension://ext/'+p,onMessage:{addListener:f=>handler=f},onConnect:{addListener:f=>connect=f}},sidePanel:{setPanelBehavior(){}},tabs:{onActivated:{addListener(){}},onUpdated:{addListener(){}},onRemoved:{addListener(){}},sendMessage:async(id,m)=>{messages.push(m);return {requestId:m.requestId,text:'最新已生成的正文',busy:true}}}};
 const ctx=vm.createContext({chrome,URL,Map,Set,Error,setTimeout,clearTimeout,setInterval,clearInterval,AbortController,importScripts(){}});vm.runInContext(fs.readFileSync('extension/background.js','utf8'),ctx);
 vm.runInContext("jobs.set(10,{sourceId:1,sourceUrl:'https://www.youtube.com/watch?v=abcdefghijk',transportId:2,requestId:'r',busy:true,submitted:true,cancelled:false,lastDelta:'先前部分'})",ctx);
 connect({name:'assistant-panel',sender:{id:'ext',url:'chrome-extension://ext/panel.html'},onMessage:{addListener:f=>register=f},onDisconnect:{addListener(){}},postMessage:m=>posted.push(m)});register({windowId:10});await wait(10);
 assert.equal(posted[0].type,'assistant:history');const restoredState=posted.find(m=>m.type==='assistant:state');assert.equal(restoredState.text,'先前部分');assert(posted.some(m=>m.type==='assistant:delta'&&m.text==='最新已生成的正文'));assert.equal(messages[0].type,'assistant:snapshot');assert(!messages.some(m=>m.type==='assistant:ask'));
 // A snapshot captured before a newer stream must not roll text backwards.
 let resolveSnapshot;chrome.tabs.sendMessage=async()=>new Promise(r=>resolveSnapshot=r);posted=[];register({windowId:10});await wait(5);
 await new Promise(r=>handler({type:'assistant:stream',requestId:'r',text:'更新的正文 C'},{id:'ext',tab:{id:2,windowId:10},url:'https://chatgpt.com/'},r));
 resolveSnapshot({requestId:'r',text:'迟到的旧正文 B',busy:true});await wait(5);
 assert.equal(posted.at(-1).text,'更新的正文 C');assert(!posted.some(m=>m.text==='迟到的旧正文 B'));
 // Lost completion is replayed explicitly, including errors, and unlocks.
 chrome.tabs.sendMessage=async()=>({requestId:'r',text:'最终正文',busy:false,result:{text:'最终正文',temporary:false,submitted:true}});posted=[];register({windowId:10});await wait(10);
 assert(posted.some(m=>m.type==='assistant:result'&&m.result.text==='最终正文'));assert.equal(vm.runInContext('jobs.get(10).busy',ctx),false);
 vm.runInContext('jobs.get(10).busy=true;delete jobs.get(10).lastResult',ctx);
 chrome.tabs.sendMessage=async()=>({requestId:'r',text:'',busy:false,result:{error:'网页返回错误',submitted:true}});posted=[];register({windowId:10});await wait(10);
 assert(posted.some(m=>m.type==='assistant:result'&&m.result.error==='网页返回错误'));assert.equal(vm.runInContext('jobs.get(10).busy',ctx),false);
 // A fresh bridge with no in-memory request must restore observation, not silently drop recovery.
 vm.runInContext("jobs.get(10).busy=true;delete jobs.get(10).lastResult;jobs.get(10).beforeCount=0;jobs.get(10).promptFingerprint='fp'",ctx);
 messages=[];posted=[];chrome.tabs.sendMessage=async(id,m)=>{messages.push(m);return m.type==='assistant:snapshot'?{requestId:null,text:'',busy:false}:{error:'原问题已经不在后台页面',submitted:true}};
 register({windowId:10});await wait(10);
 assert(messages.some(m=>m.type==='assistant:resume'&&m.promptFingerprint==='fp'));assert(posted.some(m=>m.type==='assistant:result'&&m.result.error==='原问题已经不在后台页面'));assert.equal(vm.runInContext('jobs.get(10).busy',ctx),false);
 // Extension refresh removes the old receiver; reinstall only into the owned backend and resume, never ask again.
 vm.runInContext("jobs.get(10).busy=true;delete jobs.get(10).lastResult",ctx);let injected=0;messages=[];posted=[];
 chrome.scripting={executeScript:async details=>{assert.equal(details.target.tabId,2);assert.equal(details.files[0],'bridge.js');injected++}};
 chrome.tabs.sendMessage=async(id,m)=>{messages.push(m);if(m.type==='assistant:snapshot')throw Error('Could not establish connection. Receiving end does not exist.');return {text:'刷新后恢复已有答案',temporary:false,submitted:true}};
 register({windowId:10});await wait(10);assert.equal(injected,1);assert(messages.some(m=>m.type==='assistant:resume'));assert(!messages.some(m=>m.type==='assistant:ask'));assert(posted.some(m=>m.type==='assistant:result'&&m.result.text==='刷新后恢复已有答案'));
 console.log('PASS live reconnect: partial text displayed while generation still active; subsequent chunks live; current DOM snapshot fills lost updates; no duplicate prompt; final result unlocks even after navigation');
})().catch(e=>{console.error(e);process.exitCode=1});
