const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source={id:1,windowId:10,url:'https://www.youtube.com/watch?v=abcdefghijk',title:'Video'},backend={id:100,windowId:10,url:'https://chatgpt.com/c/temp?temporary-chat=true'};
let saved={assistantSessions:[{windowId:10,sourceId:1,sourceUrl:source.url,transportId:100,history:[{question:'校正翻译 1/7',sourceUrl:source.url,completed:true,answer:'Translated segment 1'},{question:'校正翻译 2/7',sourceUrl:source.url,completed:false,answer:''}]}]},handler;
function boot(){
 const chrome={storage:{session:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,saved[k]])),set:async data=>Object.assign(saved,JSON.parse(JSON.stringify(data))),remove:async key=>delete saved[key]}},sidePanel:{setPanelBehavior(){}},runtime:{id:'ext',getURL:p=>'chrome-extension://ext/'+p,onMessage:{addListener:f=>handler=f},onConnect:{addListener(){}}},tabs:{get:async id=>id===1?source:backend,sendMessage:async()=>({text:'Translation segment completed',temporary:true}),remove:async()=>{},onActivated:{addListener(){}},onUpdated:{addListener(){}},onRemoved:{addListener(){}}}};
 vm.runInNewContext(fs.readFileSync('extension/background.js','utf8'),{chrome,URL,Map,Set,Error,Date,setTimeout,clearTimeout,setInterval,clearInterval,AbortController,importScripts(){}});
}
const call=m=>new Promise(resolve=>handler({windowId:10,...m},{id:'ext',url:'chrome-extension://ext/panel.html'},resolve));
(async()=>{
 boot();let result=await call({type:'translation:progress:get'});assert.equal(result.data.nextIndex,1);assert.equal(result.data.total,7);assert.equal(result.data.legacy,true);
 await call({type:'translation:progress:set',data:{...result.data,nextIndex:2,captionFingerprint:'abc123',rawCaptions:'SECRET_RAW_CAPTIONS',arbitrary:'extra'}});
 assert(!JSON.stringify(saved).includes('SECRET_RAW_CAPTIONS'));assert(!JSON.stringify(saved).includes('arbitrary'));
 boot();result=await call({type:'translation:progress:get'});assert.equal(result.data.nextIndex,2);assert.equal(result.data.captionFingerprint,'abc123');assert.equal(result.data.source.url,source.url);
 await call({type:'translation:progress:set',data:{...result.data,nextIndex:1,lastRequestId:'segment-2'}});
 await call({type:'assistant',tabId:1,url:source.url,text:'Only segment 2',requestId:'segment-2',uiQuestion:'校正翻译 2/7',batchStage:{index:2,total:7,final:true,translation:true,more:true}});
 assert.equal((await call({type:'translation:progress:get'})).data.nextIndex,2,'backend confirms progress even when no sidebar is connected');
 await call({type:'translation:progress:set',data:{...result.data,completed:true,nextIndex:7}});assert.equal((await call({type:'translation:progress:get'})).data.completed,true);
 result=await call({type:'translation:progress:set',data:{source,mode:'bad',nextIndex:0,total:1}});assert(result.error);assert.equal(saved.translationProgress_10.completed,true);
 result=await call({type:'translation:progress:set',windowId:null,data:null});assert(result.error);
 console.log('PASS translation progress: legacy interrupted 1/7 recovered at next segment, checkpoint survives restart, raw subtitle fields excluded, completed/invalid metadata handled');
})().catch(e=>{console.error(e);process.exitCode=1});
