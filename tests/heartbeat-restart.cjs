const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');

(async()=>{
 let handler,nextInterval=1;const intervals=new Map(),created=[],cleared=[];
 let saved={
  ownedAssistantTabs:[2],
  assistantSessions:[{
   windowId:10,sourceId:1,sourceUrl:'https://www.youtube.com/watch?v=abcdefghijk',transportId:2,
   requestId:'restored-request',busy:true,submitted:true,beforeCount:1,promptFingerprint:'abc123',cancelled:false
  }]
 };
 const backend={id:2,windowId:10,url:'https://chatgpt.com/c/restored?temporary-chat=true'};
 const chrome={
  storage:{session:{
   get:async()=>saved,
   set:async value=>{saved={...saved,...JSON.parse(JSON.stringify(value))}},
   remove:async key=>{delete saved[key]}
  }},
  sidePanel:{setPanelBehavior(){}},
  runtime:{id:'ext',getURL:path=>'chrome-extension://ext/'+path,onMessage:{addListener:listener=>handler=listener},onConnect:{addListener(){}}},
  tabs:{
   get:async id=>{if(id!==2)throw Error('unexpected tab');return backend},
   remove:async()=>{},sendMessage:async()=>{throw Error('watch should not tick in this test')},
   onActivated:{addListener(){}},onUpdated:{addListener(){}},onRemoved:{addListener(){}}
  }
 };
 const context={
  chrome,URL,Map,Set,Error,Date,AbortController,importScripts(){},setTimeout,clearTimeout,
  setInterval(callback,delay){const id=nextInterval++;intervals.set(id,{callback,delay});created.push({id,delay});return id},
  clearInterval(id){cleared.push(id);intervals.delete(id)}
 };
 vm.runInNewContext(fs.readFileSync('extension/background.js','utf8'),context);
 const sender={id:'ext',url:backend.url,tab:backend};
 const event=message=>new Promise(resolve=>handler(message,sender,resolve));

 await event({type:'assistant:heartbeat',requestId:'restored-request'});
 assert.equal(created.length,1,'the first authentic heartbeat recreates the lost worker watcher');
 assert.equal(created[0].delay,200);assert.equal(intervals.size,1);
 await event({type:'assistant:heartbeat',requestId:'restored-request'});
 assert.equal(created.length,1,'repeated heartbeats reuse the same request watcher');assert.equal(intervals.size,1);

 await event({type:'assistant:result',requestId:'restored-request',result:{text:'Completed answer',submitted:true,temporary:true}});
 assert.deepEqual(cleared,[created[0].id]);assert.equal(intervals.size,0,'completion stops the restored watcher');
 await event({type:'assistant:heartbeat',requestId:'restored-request'});
 assert.equal(created.length,1,'a completed job heartbeat never creates another watcher');assert.equal(intervals.size,0);
 assert.equal(saved.assistantSessions[0].busy,false);assert.equal(saved.assistantSessions[0].lastResult.text,'Completed answer');

 console.log('PASS heartbeat restart: restored busy job recreates one 200ms watcher without panel/ready, duplicate heartbeat reuses it, completion stops it permanently');
})().catch(error=>{console.error(error);process.exitCode=1});
