importScripts('captions.js','downsub.js');
chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true});
const jobs=new Map();
const captionJobs=new Map();
// Session metadata only; keep active ChatGPT pages across worker restarts.
const ownedTabIds=new Set();
function pageKey(value){
 try{const u=new URL(value);if(u.hostname==='youtube.com'||u.hostname.endsWith('.youtube.com')){const id=u.searchParams.get('v')||u.pathname.match(/^\/(?:shorts|live)\/([^/]+)/)?.[1];if(id)return 'youtube:'+id;}u.hash='';return u.href}catch{return value}
}
function chatKey(value){try{const u=new URL(value);if(u.origin!=='https://chatgpt.com')return null;return u.origin+(u.pathname.replace(/\/+$/,'')||'/')}catch{return null}}
function isInitialChatRouteChange(before,after){return chatKey(before)==='https://chatgpt.com/'&&/^https:\/\/chatgpt\.com\/c\/[^/]+$/.test(chatKey(after)||'')}
function captionPages(job){return job.contextPages||((job.hasTranscript||job.transcriptUrl)?[pageKey(job.sourceUrl)]:[])}
function markTranscript(job,url){job.contextPages=[...new Set([...captionPages(job),pageKey(job.sourceUrl)])];job.hasTranscript=true;job.transcriptUrl=url;}
async function transcriptAvailable(job,sourceUrl=job?.sourceUrl){
 if(!job||job.cancelled||!Number.isInteger(job.transportId))return false;
 if(!job.needsConversationReset&&!captionPages(job).includes(pageKey(sourceUrl)))return false;
 const requestId=job.requestId;
 let transport;
 try{transport=await chrome.tabs.get(job.transportId)}catch{throw Error('无法连接原 ChatGPT 标签页；尚未重新提取字幕，请稍后重试。')}
 let privacy;
 try{privacy=await chrome.tabs.sendMessage(job.transportId,{type:'assistant:privacy',promptFingerprint:job.promptFingerprint})}
 catch(e){
  if(/Receiving end does not exist|Could not establish connection/.test(e.message)&&chrome.scripting?.executeScript){
   await chrome.scripting.executeScript({target:{tabId:job.transportId},files:['bridge.js']});
   privacy=await chrome.tabs.sendMessage(job.transportId,{type:'assistant:privacy',promptFingerprint:job.promptFingerprint});
  }else throw Error('原 ChatGPT 会话暂时未响应；尚未重新提取字幕，请稍后重试。');
 }
 // A temporarily missing header can hydrate without replacing the chat.
 for(let attempt=0;attempt<5&&!privacy?.temporary&&!privacy?.conversationMissing;attempt++){
  if(job.cancelled||job.requestId!==requestId)throw Error('会话状态已变化，请重试当前问题。');
  await new Promise(resolve=>setTimeout(resolve,300));
  privacy=await chrome.tabs.sendMessage(job.transportId,{type:'assistant:privacy',promptFingerprint:job.promptFingerprint});
 }
 if(job.cancelled||job.requestId!==requestId)throw Error('会话状态已变化，请重试当前问题。');
 if(privacy?.conversationMissing){job.hasTranscript=false;job.contextPages=[];job.needsConversationReset=true;await persistJobs();return false;}
 if(job.needsConversationReset)return false;
 if(!job.hasTranscript&&!job.transcriptUrl)return false;
 const same=chatKey(transport.url)&&chatKey(transport.url)===chatKey(job.transcriptUrl),migration=isInitialChatRouteChange(job.transcriptUrl,transport.url);
 if(!same&&!migration)throw Error('后台聊天地址发生变化，未确认原会话；尚未重新提取字幕。');
 if(!privacy?.temporary)throw Error('原会话的临时模式暂未确认；会话和字幕状态已保留，请稍后重试。');
 // A stable chat address is the session identity. Visible prompt text may be
 // collapsed, virtualized, or transformed, so a missing fingerprint is not loss.
 if(migration&&privacy.contextMatches!==true)throw Error('正在确认原 ChatGPT 会话；尚未重新提取字幕，请稍后重试。');
 job.hasTranscript=true;job.transcriptUrl=transport.url;await persistJobs();return true;
}
async function resetMissingConversation(job,requestId=job.requestId){
 if(job.cancelled)throw Error('网页已切换，任务已取消。');
 if(job.requestId!==requestId||job.stoppedRequestId===requestId||job.stoppingRequestId===requestId)return;
 await chrome.tabs.update(job.transportId,{url:'https://chatgpt.com/?temporary-chat=true',active:false});
 const start=Date.now();
 while(Date.now()-start<30000){
  if(job.cancelled)throw Error('网页已切换，任务已取消。');
  if(job.requestId!==requestId||job.stoppedRequestId===requestId||job.stoppingRequestId===requestId)return;
  const tab=await chrome.tabs.get(job.transportId);
  if(job.requestId!==requestId||job.stoppedRequestId===requestId||job.stoppingRequestId===requestId)return;
  if(tab.status==='complete'&&chatKey(tab.url)==='https://chatgpt.com/'){job.needsConversationReset=false;job.hasTranscript=false;job.transcriptUrl=null;await persistJobs();return;}
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 throw Error('新的临时聊天未加载完成，请稍后重试。');
}
function bounded(operation,ms,label,signal){
 return new Promise((resolve,reject)=>{
  let done=false;const finish=(fn,value)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);fn(value)};
  const abort=()=>finish(reject,Error('字幕任务已取消。'));
  const timer=setTimeout(()=>finish(reject,Error(label)),ms);
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  Promise.resolve(operation).then(value=>finish(resolve,value),error=>finish(reject,error));
 });
}
// UI history contains only the user's short question and returned answer.
// It never contains the injected page body, subtitles, or constructed prompts.
function recordTurn(job,value,completed=false){
 const id=job.uiTurnId||job.requestId;if(!id)return;
 job.history ||= [];
 let turn=job.history.find(t=>t.id===id);
 if(!turn){turn={id,question:typeof job.uiQuestion==='string'?job.uiQuestion.slice(0,4000):'',answer:'',sourceUrl:job.sourceUrl};job.history.push(turn);}
 turn.requestId=job.requestId;
 if(typeof value==='string')turn.answer=value.slice(0,200000);
 turn.completed=completed;
}
let historySaveTimer;
function scheduleHistorySave(){if(historySaveTimer)return;historySaveTimer=setTimeout(()=>{historySaveTimer=null;void persistJobs()},500);}
async function persistJobs(){
 const sessions=[...jobs].map(([windowId,job])=>({windowId,sourceId:job.sourceId,sourceUrl:job.sourceUrl,transportId:job.transportId,requestId:job.requestId,stoppedRequestId:job.stoppedRequestId,busy:job.busy,submitted:job.submitted,uiTurnId:job.uiTurnId,uiQuestion:job.uiQuestion,history:job.history,hasTranscript:job.hasTranscript,contextPages:job.contextPages,transcriptUrl:job.transcriptUrl,transcriptFinal:job.transcriptFinal,batchStage:job.batchStage,needsConversationReset:job.needsConversationReset,beforeCount:job.beforeCount,promptFingerprint:job.promptFingerprint,lastResult:job.lastResult}));
 await chrome.storage?.session?.set({ownedAssistantTabs:[...ownedTabIds],assistantSessions:sessions}).catch(()=>{});
}
const startupCleanup=(async()=>{
 if(!chrome.storage?.session)return;
 const data=await chrome.storage.session.get(['ownedAssistantTabs','assistantSessions']).catch(()=>({}));
 for(const record of data.assistantSessions||[]){
  if(!Number.isInteger(record.windowId)||!Number.isInteger(record.transportId))continue;
  try{const target=await chrome.tabs.get(record.transportId);if(new URL(target.url).origin==='https://chatgpt.com'){jobs.set(record.windowId,{...record,cancelled:false});ownedTabIds.add(record.transportId);}}catch{}
 }
 for(const id of data.ownedAssistantTabs||[]){
  if(!Number.isInteger(id)||ownedTabIds.has(id))continue;
  await chrome.tabs.remove(id).catch(()=>{});
 }
 await persistJobs();
})();
async function rememberTab(tab){await startupCleanup;ownedTabIds.add(tab.id);await persistJobs();return tab;}
async function forgetTab(id){ownedTabIds.delete(id);await persistJobs();}
const panelPorts=new Map();
const restoredHistory=new WeakMap();
// Mutation events are the primary stream. A lightweight snapshot fills lost
// messages while a response is active; it never resubmits a prompt.
function startLiveWatch(job){
 if(job.liveWatch&&job.liveWatchRequest===job.requestId)return;
 if(job.liveWatch)clearInterval(job.liveWatch);
 const requestId=job.requestId;job.liveWatchRequest=requestId;let reading=false;
 const watch=setInterval(async()=>{
  if(job.cancelled||job.requestId!==requestId||!job.busy||job.lastResult){clearInterval(watch);if(job.liveWatch===watch)job.liveWatch=null;return;}
  if(!job.submitted||reading)return;
  reading=true;const sequence=job.streamSequence||0;
  try{
   const snapshot=await chrome.tabs.sendMessage(job.transportId,{type:'assistant:snapshot',requestId});
   if(job.cancelled||job.requestId!==requestId||job.lastResult||sequence!==(job.streamSequence||0)||snapshot?.requestId!==requestId)return;
   if(snapshot.result){await deliverResult(job,snapshot.result,[...jobs].find(([,value])=>value===job)?.[0]);return;}
   if(typeof snapshot.text!=='string'||!snapshot.text||snapshot.text===job.lastDelta)return;
   job.lastDelta=snapshot.text.slice(0,200000);recordTurn(job,job.lastDelta,false);scheduleHistorySave();
   const update={type:'assistant:delta',requestId,uiTurnId:job.uiTurnId,uiQuestion:job.uiQuestion,sourceUrl:job.sourceUrl,text:job.lastDelta};
   for(const [port,windowId] of panelPorts)if(jobs.get(windowId)===job)try{port.postMessage(update)}catch{panelPorts.delete(port)}
  }catch{}finally{reading=false;}
 },200);job.liveWatch=watch;
}

async function advanceTranslationProgress(job,result,windowId){
 const stage=job.batchStage,requestId=job.requestId;
 if(!stage?.translation||result.error||!result.text||!Number.isInteger(windowId))return;
 const key='translationProgress_'+windowId,saved=await chrome.storage.session.get(key),progress=saved[key];
 if(job.requestId!==requestId||!progress||progress.completed||pageKey(progress.source.url)!==pageKey(job.sourceUrl)||progress.nextIndex!==stage.index-1||progress.lastRequestId&&progress.lastRequestId!==requestId)return;
 if(progress.mode==='chunks'){
  if(progress.total!==stage.total)return;progress.nextIndex=stage.index;progress.completed=stage.index>=stage.total;
 }else{
  const markers=result.text.match(/\[(?:翻译完成|继续：[^\]]+)\]/g)||[],next=result.text.match(/\[继续：([^\]]+)\]\s*$/)?.[1]?.trim(),complete=/\[翻译完成\]\s*$/.test(result.text);
  if(markers.length!==1||!complete&&(!next||next===progress.continuation))return;
  progress.nextIndex=stage.index;progress.continuation=next||null;progress.completed=complete;
 }
 progress.lastRequestId=requestId;await chrome.storage.session.set({[key]:progress});
}
async function deliverResult(job,result,windowId){
 const requestId=job.requestId;
 if(job.stoppedRequestId===requestId)return;
 if(job.liveWatch){clearInterval(job.liveWatch);job.liveWatch=null;}
 job.busy=false;job.lastResult={...result,text:typeof result.text==='string'?result.text.slice(0,200000):undefined};
 recordTurn(job,result.text,!job.batchStage||job.batchStage.final===true);
 if(result.code==='conversation_missing')job.needsConversationReset=true;
 if(result.code==='conversation_missing'){job.hasTranscript=false;job.contextPages=[];}
 else if(job.transcriptFinal&&result.temporary===true){const tab=await chrome.tabs.get(job.transportId);if(job.cancelled||job.requestId!==requestId)return;markTranscript(job,tab.url);}
 await advanceTranslationProgress(job,result,windowId);
 if(job.cancelled||job.requestId!==requestId)return;
 for(const [port,id] of panelPorts)if(id===windowId)try{port.postMessage({type:'assistant:result',requestId,uiTurnId:job.uiTurnId,uiQuestion:job.uiQuestion,sourceUrl:job.sourceUrl,result:job.lastResult,batchStage:job.batchStage});}catch{panelPorts.delete(port)}
 await persistJobs();
}
function restorePanel(port,job){
 if(!job||job.cancelled)return;
 if(job.busy&&job.submitted)startLiveWatch(job);
 if(restoredHistory.get(port)!==job){try{if(!job.history?.length&&job.lastResult?.text)recordTurn(job,job.lastResult.text,true);port.postMessage({type:'assistant:history',turns:job.history||[]});restoredHistory.set(port,job)}catch{return;}}
 try{port.postMessage({type:'assistant:state',requestId:job.requestId,uiTurnId:job.uiTurnId,uiQuestion:job.uiQuestion,sourceUrl:job.sourceUrl,busy:job.busy,submitted:job.submitted,text:job.lastDelta||'',batchStage:job.batchStage});}catch{return;}
 if(job.lastResult)try{port.postMessage({type:'assistant:result',requestId:job.requestId,uiTurnId:job.uiTurnId,uiQuestion:job.uiQuestion,sourceUrl:job.sourceUrl,result:job.lastResult,batchStage:job.batchStage});}catch{}
 // Request the currently rendered answer as well: no new prompt is submitted.
 // This fills the gap if the worker restarted or the panel missed updates.
 if(job.busy&&job.submitted){
  const requestId=job.requestId,baseline=job.streamSequence||0;
  void chrome.tabs.sendMessage(job.transportId,{type:'assistant:snapshot',requestId}).then(snapshot=>{
   if(!panelPorts.has(port)||job.cancelled||job.requestId!==requestId||job.lastResult)return;
   if(snapshot?.requestId!==requestId){
    if(job.recoveryPending)return;
    job.recoveryPending=true;
    void chrome.tabs.sendMessage(job.transportId,{type:'assistant:resume',requestId,beforeCount:job.beforeCount,promptFingerprint:job.promptFingerprint}).then(result=>{
     if(!job.cancelled&&job.requestId===requestId&&!job.lastResult&&result&&!result.pending)return deliverResult(job,result,panelPorts.get(port));
    }).catch(()=>{}).finally(()=>{job.recoveryPending=false});
    return;
   }
   if(snapshot.result&&(typeof snapshot.result.text==='string'||typeof snapshot.result.error==='string'))return deliverResult(job,snapshot.result,panelPorts.get(port));
   if(!snapshot.text||(job.streamSequence||0)!==baseline)return;
   job.lastDelta=snapshot.text.slice(0,200000);recordTurn(job,job.lastDelta,false);scheduleHistorySave();
   try{port.postMessage({type:'assistant:delta',requestId,uiTurnId:job.uiTurnId,uiQuestion:job.uiQuestion,sourceUrl:job.sourceUrl,text:job.lastDelta});}catch{}
  }).catch(async error=>{
   if(!/Receiving end does not exist|Could not establish connection/.test(error.message)||job.recoveryPending||job.cancelled||job.requestId!==requestId)return;
   job.recoveryPending=true;
   try{
    await chrome.scripting.executeScript({target:{tabId:job.transportId},files:['bridge.js']});
    if(job.cancelled||job.requestId!==requestId)return;
    const result=await chrome.tabs.sendMessage(job.transportId,{type:'assistant:resume',requestId,beforeCount:job.beforeCount,promptFingerprint:job.promptFingerprint});
    if(!job.cancelled&&job.requestId===requestId&&!job.lastResult&&result&&!result.pending)await deliverResult(job,result,panelPorts.get(port));
   }catch{}finally{job.recoveryPending=false;}
  });
 }
}
async function dispose(job){
 const id=job.transportId;job.transportId=null;
 if(Number.isInteger(id)){await chrome.tabs.remove(id).catch(()=>{});await forgetTab(id);}
}
async function cancel(job){if(job.liveWatch)clearInterval(job.liveWatch);job.liveWatch=null;job.cancelled=true;job.controller?.abort();for(const map of [jobs,captionJobs])for(const [key,value] of map)if(value===job)map.delete(key);await dispose(job);await persistJobs();}
// Browsing another tab does not cancel the chosen source or its response.
chrome.tabs.onActivated.addListener(()=>{});
chrome.tabs.onUpdated.addListener((id,info)=>{void startupCleanup.then(()=>{
 if(!info.url)return;
 for(const job of captionJobs.values())if(job.transportId===id){try{const u=new URL(info.url);if(u.protocol==='https:'&&u.hostname==='subtitle.downsub.com'&&u.pathname.startsWith('/raw/'))job.exportUrl=u.href}catch{}}
 for(const job of captionJobs.values())if(job.sourceId===id&&pageKey(info.url)!==pageKey(job.sourceUrl))void cancel(job);
 for(const job of jobs.values())if(job.transportId===id&&job.hasTranscript&&chatKey(info.url)!==chatKey(job.transcriptUrl)&&!isInitialChatRouteChange(job.transcriptUrl,info.url)){job.hasTranscript=false;job.contextPages=[];job.transcriptUrl=null;}
});});
chrome.tabs.onRemoved.addListener(id=>{void startupCleanup.then(()=>{for(const job of captionJobs.values())if(job.sourceId===id||job.transportId===id)void cancel(job);for(const job of jobs.values())if(job.transportId===id)void cancel(job)});});
chrome.runtime.onConnect.addListener(port=>{
 if(port.name!=='assistant-panel'||port.sender?.id!==chrome.runtime.id||port.sender?.url!==chrome.runtime.getURL('panel.html'))return;
 let windowId;
 port.onMessage.addListener(m=>{if(Number.isInteger(m.windowId)){windowId=m.windowId;panelPorts.set(port,windowId);void startupCleanup.then(()=>restorePanel(port,jobs.get(windowId)))}});
 port.onDisconnect.addListener(()=>{panelPorts.delete(port)});
});
chrome.runtime.onMessage.addListener((m,s,reply)=>{
 if(['assistant:stream','assistant:submitted','assistant:heartbeat','assistant:result','assistant:ready'].includes(m.type)){
  if(s.id!==chrome.runtime.id||!s.tab||!s.url?.startsWith('https://chatgpt.com/'))return;
  (async()=>{
   await startupCleanup;
   const job=jobs.get(s.tab.windowId);
   if(!job||job.cancelled||job.transportId!==s.tab.id||m.type!=='assistant:ready'&&(job.requestId!==m.requestId||job.stoppedRequestId===m.requestId||job.stoppingRequestId===m.requestId))return;
   if(m.type==='assistant:ready'){if(job.busy&&job.submitted)startLiveWatch(job);if(job.busy&&job.submitted)void chrome.tabs.sendMessage(job.transportId,{type:'assistant:resume',requestId:job.requestId,beforeCount:job.beforeCount,promptFingerprint:job.promptFingerprint}).catch(()=>{});return;}
   if(m.type==='assistant:submitted'){job.submitted=true;job.beforeCount=Number.isInteger(m.beforeCount)?m.beforeCount:0;job.promptFingerprint=typeof m.promptFingerprint==='string'?m.promptFingerprint:undefined;if(job.transcriptFinal)markTranscript(job,s.tab.url||s.url);startLiveWatch(job);await persistJobs();return;}
   if(m.type==='assistant:heartbeat'){if(job.busy&&job.submitted&&!job.lastResult)startLiveWatch(job);return;}
   if(m.type==='assistant:result'){
    if(!m.result||typeof m.result.text!=='string'&&typeof m.result.error!=='string')return;
    await deliverResult(job,m.result,s.tab.windowId);
    return;
   }
   if(typeof m.text!=='string'||job.lastResult)return;
   job.streamSequence=(job.streamSequence||0)+1;
   job.lastDelta=m.text.slice(0,200000);recordTurn(job,job.lastDelta,false);scheduleHistorySave();
   const update={type:'assistant:delta',requestId:job.requestId,uiTurnId:job.uiTurnId,uiQuestion:job.uiQuestion,sourceUrl:job.sourceUrl,text:job.lastDelta};
   for(const [port,windowId] of panelPorts)if(windowId===s.tab.windowId)try{port.postMessage(update)}catch{panelPorts.delete(port)}
  })().then(()=>reply({ok:true}),e=>reply({error:e.message}));return true;
 }
 if(s.id!==chrome.runtime.id||s.tab||s.url!==chrome.runtime.getURL('panel.html'))return;
 if(m.type==='assistant:stop'){
  (async()=>{
   await startupCleanup;
   if(typeof m.requestId!=='string'||!m.requestId)throw Error('无法确认要停止的回答。');
   let entry;
   if(Number.isInteger(m.windowId)){const candidate=jobs.get(m.windowId);if(candidate?.requestId===m.requestId)entry=[m.windowId,candidate];}
   if(!entry&&Number.isInteger(m.tabId)){const source=await chrome.tabs.get(m.tabId);const candidate=jobs.get(source.windowId);if(candidate?.requestId===m.requestId)entry=[source.windowId,candidate];}
   if(!entry)entry=[...jobs].find(([,candidate])=>candidate.requestId===m.requestId);
   if(!entry){
    let captionEntry;
    if(Number.isInteger(m.windowId)){const candidate=captionJobs.get(m.windowId);if(candidate?.requestId===m.requestId)captionEntry=[m.windowId,candidate];}
    if(!captionEntry&&Number.isInteger(m.tabId)){const source=await chrome.tabs.get(m.tabId);const candidate=captionJobs.get(source.windowId);if(candidate?.requestId===m.requestId)captionEntry=[source.windowId,candidate];}
    if(!captionEntry)captionEntry=[...captionJobs].find(([,candidate])=>candidate.requestId===m.requestId);
    if(captionEntry){await cancel(captionEntry[1]);return {ok:true,stopped:true,text:''};}
    return {ok:true,stopped:true,text:''};
   }
   const [windowId,job]=entry;
   if(job.stoppedRequestId===m.requestId)return job.lastResult||{text:job.lastDelta||'',stopped:true};
   if(!job.busy)throw Error('当前回答已经结束。');
   const requestId=job.requestId;job.stoppingRequestId=requestId;
   if(job.liveWatch){clearInterval(job.liveWatch);job.liveWatch=null;}
   let stopped;
   try{
    if(!Number.isInteger(job.transportId))stopped={text:job.lastDelta||'',stopped:true,submitted:false};
    else try{stopped=await chrome.tabs.sendMessage(job.transportId,{type:'assistant:stop',requestId});}
    catch(first){
     if(!/Receiving end does not exist|Could not establish connection/.test(first.message)||!chrome.scripting?.executeScript)throw first;
     await chrome.scripting.executeScript({target:{tabId:job.transportId},files:['bridge.js']});
     stopped=await chrome.tabs.sendMessage(job.transportId,{type:'assistant:stop',requestId});
    }
    if(stopped?.stopped!==true)throw Error(stopped?.error||'ChatGPT 未确认停止当前回答。');
   }catch(e){delete job.stoppingRequestId;if(job.submitted)startLiveWatch(job);await persistJobs();throw Error('未能确认 ChatGPT 已停止：'+e.message);}
   if(job.requestId!==requestId){delete job.stoppingRequestId;throw Error('当前回答已经变化。');}
   delete job.stoppingRequestId;job.stoppedRequestId=requestId;job.busy=false;
   const text=typeof stopped?.text==='string'&&stopped.text.length>=(job.lastDelta||'').length?stopped.text.slice(0,200000):(job.lastDelta||'');
   job.lastDelta=text;job.lastResult={text,stopped:true,submitted:job.submitted};recordTurn(job,text,false);await persistJobs();
   const update={type:'assistant:result',requestId,uiTurnId:job.uiTurnId,uiQuestion:job.uiQuestion,sourceUrl:job.sourceUrl,result:job.lastResult,batchStage:job.batchStage};
   for(const [port,id] of panelPorts)if(id===windowId)try{port.postMessage(update)}catch{panelPorts.delete(port)}
   return job.lastResult;
  })().then(reply,e=>reply({error:e.message}));return true;
 }
 if(m.type==='translation:progress:get'||m.type==='translation:progress:set'){
  (async()=>{
   await startupCleanup;
   if(!Number.isInteger(m.windowId))throw Error('无法确认翻译所在窗口。');
   const key='translationProgress_'+m.windowId;
   if(m.type==='translation:progress:get'){
    const saved=await chrome.storage.session.get(key);if(saved[key])return {data:saved[key]};
    // Recover an interrupted pre-checkpoint chunk run from completed history.
    const job=jobs.get(m.windowId),history=job?.history||[];
    let start=-1,total=0;for(let i=0;i<history.length;i++){const match=history[i].question?.match(/^校正翻译 1\/(\d+)$/);if(match){start=i;total=Number(match[1]);}}
    if(start<0)return {data:null};
    const sourceUrl=history[start].sourceUrl;let nextIndex=0;
    for(const turn of history.slice(start)){const match=turn.question?.match(/^校正翻译 (\d+)\/(\d+)$/);if(!match||turn.sourceUrl!==sourceUrl||Number(match[2])!==total)continue;if(Number(match[1])===nextIndex+1&&turn.completed&&turn.answer)nextIndex++;}
    if(nextIndex===0||nextIndex>=total)return {data:null};
    let source;try{source=await chrome.tabs.get(job.sourceId)}catch{return {data:null};}
    if(pageKey(source.url)!==pageKey(sourceUrl))return {data:null};
    const progress={source:{tabId:source.id,url:sourceUrl,title:source.title||sourceUrl,type:pageKey(sourceUrl).startsWith('youtube:')?'youtube':'video'},mode:'chunks',nextIndex,total,completed:false,legacy:true};
    await chrome.storage.session.set({[key]:progress});return {data:progress};
   }
   if(m.data==null){await chrome.storage.session.remove(key);return {ok:true};}
   const d=m.data,source=d.source;
   if(!source||!Number.isInteger(source.tabId)||typeof source.url!=='string'||!/^https?:\/\//.test(source.url)||!['chunks','context'].includes(d.mode)||!Number.isInteger(d.nextIndex)||d.nextIndex<0||d.nextIndex>10000||!Number.isInteger(d.total)||d.total<0||d.total>10000)throw Error('翻译进度格式无效。');
   const progress={source:{tabId:source.tabId,url:source.url.slice(0,4000),title:String(source.title||'').slice(0,500),type:source.type==='video'?'video':'youtube'},mode:d.mode,nextIndex:d.nextIndex,total:d.total,continuation:typeof d.continuation==='string'?d.continuation.slice(0,500):null,completed:d.completed===true};
   if(typeof d.captionFingerprint==='string')progress.captionFingerprint=d.captionFingerprint.slice(0,128);
   if(typeof d.lastRequestId==='string')progress.lastRequestId=d.lastRequestId.slice(0,128);
   await chrome.storage.session.set({[key]:progress});return {ok:true};
  })().then(reply,e=>reply({error:e.message}));return true;
 }
 if(m.type==='extract'){
  (async()=>{
   const tab=await chrome.tabs.get(m.tabId);
   if(!/^https?:/.test(tab.url)||new URL(tab.url).origin==='https://chatgpt.com')throw Error('请切换到要阅读的网页。');
   await chrome.scripting.executeScript({target:{tabId:m.tabId},files:['extract.js']});
   const [result]=await chrome.scripting.executeScript({target:{tabId:m.tabId},func:()=>extractPage()});
   return {...result.result,tabId:tab.id};
  })().then(data=>reply({data}),e=>reply({error:e.message}));return true;
 }
 if(m.type==='assistant:context'){
  (async()=>{
   await startupCleanup;
   const source=await chrome.tabs.get(m.tabId);
   if(pageKey(source.url)!==pageKey(m.url))return {hasTranscript:false};
   const job=jobs.get(source.windowId);
   if(!job||job.cancelled)return {hasTranscript:false};
   const hasTranscript=await transcriptAvailable(job,source.url);return {hasTranscript,conversationReset:!!job.needsConversationReset}
  })().then(data=>reply({data}),e=>reply({error:e.message}));return true;
 }
 if(m.type==='captions:cancel'){
  (async()=>{const source=await chrome.tabs.get(m.tabId);const job=captionJobs.get(source.windowId);if(job&&job.requestId===m.requestId)await cancel(job);return {ok:true};})().then(reply,e=>reply({error:e.message}));return true;
 }
 if(m.type==='captions'){
  (async()=>{
   await startupCleanup;
   const tab=await chrome.tabs.get(m.tabId);
   if(pageKey(tab.url)!==pageKey(m.url))throw Error('视频已切换，字幕读取已取消。');
   const url=new URL(tab.url);
   if(!(url.hostname==='youtube.com'||url.hostname.endsWith('.youtube.com')))throw Error('当前平台尚未支持独立字幕提取。');
   const videoId=url.searchParams.get('v')||url.pathname.match(/^\/(?:shorts|live)\/([^/]+)/)?.[1];
   if(!videoId||!videoId.match(/^[A-Za-z0-9_-]{11}$/))throw Error('当前页面不是可读取的视频。');
   const installed=chrome.runtime.getManifest?.();
   if(installed&&!installed.content_scripts?.some(c=>c.js?.includes('downsub-bridge.js')&&c.matches?.includes('https://downsub.com/*'))){
    throw Error('当前加载的是 '+installed.version+'，DownSub 页面脚本尚未加载。请在扩展管理页刷新 GPT 随页助手，再重新打开侧边栏。');
   }
   if(chrome.permissions?.contains&&!(await chrome.permissions.contains({origins:['https://downsub.com/*','https://subtitle.downsub.com/*']}))){
    throw Error('Chrome 未允许扩展访问 DownSub 字幕网站。请在 GPT 随页助手的网站访问权限中允许 downsub.com 与 subtitle.downsub.com，再重试。');
   }
   const prior=captionJobs.get(tab.windowId);if(prior)await cancel(prior);
   const job={sourceId:tab.id,sourceUrl:tab.url,requestId:m.requestId,transportId:null,cancelled:false,controller:new AbortController()};captionJobs.set(tab.windowId,job);
   const heartbeat=setInterval(()=>{void chrome.tabs.get(tab.id).catch(()=>{})},10000);
   const watchdog=setTimeout(()=>{job.timedOut=true;void cancel(job)},85000);
   const probe=(options,ms=5000,label='YouTube 字幕轨道读取超时。')=>bounded(chrome.scripting.executeScript({...options,injectImmediately:true}),ms,label,job.controller.signal);
   const progress=message=>{for(const [port,windowId] of panelPorts)if(windowId===tab.windowId)try{port.postMessage({type:'assistant:caption-progress',requestId:m.requestId,sourceUrl:m.url,text:message})}catch{panelPorts.delete(port)}};
   async function ensureCurrent(){const current=await chrome.tabs.get(tab.id);if(job.cancelled||pageKey(current.url)!==pageKey(m.url))throw Error(job.timedOut?'字幕提取超时，请重试。':'视频已切换，字幕读取已取消。');}
   let downsubError,preferredLanguageCode=null;
   try{
    // Read metadata only, before starting a helper. No subtitle request or
    // model call is needed to identify the video's original caption language.
    try{
     const [metadata]=await probe({target:{tabId:tab.id},world:'MAIN',func:readYoutubeCaptionLanguage,args:[m.url]},1800,'视频语言信息读取超时。');
     const code=metadata?.result?.languageCode;
     if(typeof code==='string'&&/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(code))preferredLanguageCode=code.toLowerCase().split('-')[0];
    }catch(e){if(job.cancelled)throw e;}
    await ensureCurrent();
    progress('正在连接 DownSub'+(installed?'（'+installed.version+'）':'')+'…');
    const canonical='https://www.youtube.com/watch?v='+videoId;
    const entryUrl='https://downsub.com/?url='+encodeURIComponent(canonical);
    let helper=await chrome.tabs.create({windowId:tab.windowId,url:entryUrl,active:false});job.transportId=helper.id;await rememberTab(helper);
    await ensureCurrent();
    // Read usable controls without waiting for every ad/iframe to finish loading.
    let data,lastProbeError,reloaded=false;const started=Date.now(),downsubDeadline=started+45000;
    // A timed-out read may still be running. Reuse that same Promise until it
    // settles or we replace the document, rather than stacking injections.
    let pendingProbe=null;
    const downsubProbe=(message,label)=>{
     const left=downsubDeadline-Date.now();if(left<=0)throw Error('DownSub 读取超时，正在切换字幕来源。');
     if(!pendingProbe){const entry={promise:chrome.tabs.sendMessage(helper.id,{type:'downsub:probe',...message})};pendingProbe=entry;const clear=()=>{if(pendingProbe===entry)pendingProbe=null;};entry.promise.then(clear,clear);}
     return bounded(pendingProbe.promise,Math.min(5000,left),label,job.controller.signal);
    };
    const notReady=e=>/Receiving end does not exist|Could not establish connection/i.test(e.message);
    const transient=e=>/入口脚本读取超时|正文脚本读取超时|context.*destroyed|frame.*removed|No frame/i.test(e.message)||notReady(e);
    async function replaceDocument(url=entryUrl){
     // A reload call returns before a new document commits. A fresh tab ID
     // prevents a late old-document probe/click from racing with recovery.
     pendingProbe=null;reloaded=true;await dispose(job);await ensureCurrent();
     helper=await chrome.tabs.create({windowId:tab.windowId,url,active:false});job.transportId=helper.id;await rememberTab(helper);await ensureCurrent();
    }
    for(let i=0;i<90&&Date.now()<downsubDeadline;i++){
     await ensureCurrent();const helperTab=await chrome.tabs.get(helper.id);
     if(helperTab.url?.startsWith('https://downsub.com/')){
      let exported;
      try{exported=await downsubProbe({phase:'entry',videoUrl:canonical,languageCode:preferredLanguageCode},'DownSub 入口脚本读取超时。');if(exported?.error)throw Error(exported.error);}
      catch(e){
       if(!transient(e))throw e;lastProbeError=e.message;
       if(notReady(e)&&helperTab.status==='complete'&&Date.now()-started>5000){
        if(reloaded)throw Error('DownSub 页面脚本未启动'+(installed?'（'+installed.version+'）':'')+'。请确认已刷新扩展，并允许它访问 downsub.com 与 subtitle.downsub.com。');
        await replaceDocument();
       }else if(!reloaded&&!notReady(e))await replaceDocument();
       progress(notReady(e)?'正在等待 DownSub 页面脚本启动…':'正在等待字幕页面恢复响应…');
      }
      if(exported?.data?.language){data=exported.data;break;}
      progress(exported?.data?.serviceError?'DownSub 暂时不可用，正在重试…':'正在等待 DownSub 字幕入口…');
      if(!reloaded&&(exported?.data?.serviceError||Date.now()-started>20000)){await replaceDocument();}
     }
     await new Promise(r=>setTimeout(r,500));
    }
    if(!data)throw Error(lastProbeError||'DownSub 未能及时提供字幕入口。');
    await ensureCurrent();progress('已找到 '+data.language+' 字幕，正在读取全文…');
    // The RAW button navigates away and can destroy its own message channel.
    // Start the click, then use the raw URL transition as the success signal.
    let clickError;
    chrome.tabs.sendMessage(helper.id,{type:'downsub:click',videoUrl:canonical,languageCode:preferredLanguageCode,rawTitle:data.rawTitle}).then(result=>{if(result?.error)clickError=Error(result.error)},e=>{clickError=e});
    let text='';
    for(let i=0;i<24;i++){
     if(Date.now()>=downsubDeadline)throw Error('DownSub 字幕读取超时。');
     await ensureCurrent();const current=await chrome.tabs.get(helper.id);let valid=false;
     try{const u=new URL(current.url);valid=u.protocol==='https:'&&u.hostname==='subtitle.downsub.com'&&u.pathname.startsWith('/raw/');}catch{}
     if(clickError&&!valid&&!/context.*destroyed|frame.*removed|No frame/i.test(clickError.message))throw Error('DownSub RAW 点击失败：'+clickError.message);
     if(valid&&current.status==='complete'){
      try{const raw=await downsubProbe({phase:'raw'},'DownSub 正文脚本读取超时。');if(raw?.error)throw Error(raw.error);text=typeof raw?.data==='string'?raw.data.replace(/^\uFEFF/,'').trim():'';if(/^(?:503\b|Service Unavailable\b|Bad Gateway\b|Gateway Timeout\b|Internal Server Error\b)/i.test(text))throw Error('DownSub 字幕服务返回错误，未取得字幕正文。');if(text&&!/^\s*</.test(text))break;text='';}
      catch(e){if(!transient(e))throw e;if(!reloaded&&!notReady(e))await replaceDocument(current.url);progress('正在恢复字幕正文读取…');}
     }
     await new Promise(r=>setTimeout(r,500));
    }
    if(!text)throw Error('DownSub 字幕全文未能读取，已停止发送空字幕。');
    const selectedCode=data.languageCode||(/^Thai(?:\s|$)/i.test(data.language)?'th':/^Japanese(?:\s|$)/i.test(data.language)?'ja':/^English(?:\s|$)/i.test(data.language)?'en':null);
    if(preferredLanguageCode&&selectedCode!==preferredLanguageCode)throw Error('DownSub 返回的字幕语言与视频原语言不一致，已停止发送。');
    if(selectedCode==='th'&&!/[\u0E00-\u0E7F]/.test(text))throw Error('DownSub 返回的正文不是泰语字幕，已停止发送。');
    if(selectedCode==='ja'&&!/[\u3040-\u30FF\u3400-\u9FFF]/.test(text))throw Error('DownSub 返回的正文不是日语字幕，已停止发送。');
    if(selectedCode==='en'&&!/[A-Za-z]/.test(text))throw Error('DownSub 返回的正文不是英语字幕，已停止发送。');
    await ensureCurrent();progress('已读取 '+text.length.toLocaleString()+' 字字幕。');
    return {...data,rawTitle:undefined,text,characters:text.length,lines:text.split('\n').length};
   }catch(e){
    if(job.cancelled)throw Error(job.timedOut?'字幕提取超时，请重试。':'视频已切换，字幕读取已取消。');
    downsubError=e.message;await dispose(job);await ensureCurrent();
    progress('DownSub 未完成，正在尝试 YouTube 字幕轨道…');
    const [result]=await probe({target:{tabId:tab.id},world:'MAIN',func:readYoutubeCaptions,args:[m.url,25000,preferredLanguageCode]},30000);
    await ensureCurrent();if(result?.result?.text)return {...result.result,downsubError};
    throw Error('字幕提取失败：'+downsubError+'；'+(result?.result?.error||'YouTube 轨道也未能取得字幕。'));
   }finally{clearInterval(heartbeat);clearTimeout(watchdog);await cancel(job);}
  })().then(data=>reply({data}),e=>reply({error:e.message}));return true;
 }
 if(m.type==='assistant'){
  (async()=>{
   await startupCleanup;
   const source=await chrome.tabs.get(m.tabId);
   if(pageKey(source.url)!==pageKey(m.url)||!/^https?:/.test(source.url))throw Error('网页已切换，请对当前页重新总结。');
   let job=jobs.get(source.windowId);
   if(job?.busy)throw Error('ChatGPT 正在回答，请稍后再试。');
   if(m.requiresTranscript&&!await transcriptAvailable(job,source.url))throw Error('原字幕会话已关闭，请重新发送问题以再次提取字幕。');
   if(!job){job={sourceId:source.id,sourceUrl:source.url,transportId:null,cancelled:false,busy:false};jobs.set(source.windowId,job);}
   else if(pageKey(job.sourceUrl)!==pageKey(source.url)){job.contextPages=captionPages(job);job.hasTranscript=job.contextPages.includes(pageKey(source.url));job.sourceId=source.id;job.sourceUrl=source.url;}
   else{job.sourceId=source.id;job.sourceUrl=source.url;}
   job.busy=true;job.requestId=m.requestId;delete job.stoppedRequestId;delete job.stoppingRequestId;job.uiTurnId=typeof m.uiTurnId==='string'?m.uiTurnId:job.requestId;job.uiQuestion=typeof m.uiQuestion==='string'?m.uiQuestion.slice(0,4000):'';recordTurn(job,undefined,false);job.submitted=false;job.transcriptFinal=!!m.transcriptFinal;job.batchStage=m.batchStage;job.streamSequence=0;delete job.lastResult;delete job.lastDelta;
   const requestActive=()=>!job.cancelled&&job.requestId===m.requestId&&job.stoppedRequestId!==m.requestId&&job.stoppingRequestId!==m.requestId;
   try{
    if(!Number.isInteger(job.transportId)){const fresh=await chrome.tabs.create({windowId:source.windowId,url:'https://chatgpt.com/?temporary-chat=true',active:false});if(!requestActive()){await chrome.tabs.remove(fresh.id).catch(()=>{});return {text:job.lastDelta||'',stopped:true};}job.transportId=fresh.id;await rememberTab(fresh);if(!requestActive())return {text:job.lastDelta||'',stopped:true};}
    if(job.needsConversationReset)await resetMissingConversation(job,m.requestId);if(!requestActive())return {text:job.lastDelta||'',stopped:true};
    await persistJobs();
    const tab={id:job.transportId};let preparationError='';
    if(chrome.scripting?.executeScript)await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',files:['background-frames.js','response-stream.js']});
    if(!requestActive())return job.lastResult||{text:job.lastDelta||'',stopped:true};
    for(let attempt=0;attempt<30;attempt++){
     if(!requestActive())return job.lastResult||{text:job.lastDelta||'',stopped:true};
     try{
      if(!requestActive())return job.lastResult||{text:job.lastDelta||'',stopped:true};
      const result=await chrome.tabs.sendMessage(tab.id,{type:'assistant:ask',text:m.text,requestId:job.requestId});
      if(!requestActive())return job.lastResult||{text:job.lastDelta||'',stopped:true};
      if(job.requestId!==m.requestId)return result;
      if(result.retryable){preparationError=result.error||'';await new Promise(resolve=>setTimeout(resolve,750));if(!requestActive())return job.lastResult||{text:job.lastDelta||'',stopped:true};continue}
      if(result.code==='conversation_missing')job.needsConversationReset=true;
      if(result.code==='conversation_missing'){job.hasTranscript=false;job.contextPages=[];}
      else if(m.transcriptFinal&&result.temporary===true){const transport=await chrome.tabs.get(job.transportId);markTranscript(job,transport.url);}
      if(job.requestId===m.requestId){if(job.liveWatch){clearInterval(job.liveWatch);job.liveWatch=null;}job.lastResult={...result,text:typeof result.text==='string'?result.text.slice(0,200000):undefined};recordTurn(job,result.text,!job.batchStage||job.batchStage.final===true);}await advanceTranslationProgress(job,result,source.windowId);await persistJobs();return result;
     }catch(e){
      if(job.cancelled)throw Error('网页已切换，任务已取消。');
      if(!/Receiving end does not exist|Could not establish connection/.test(e.message))throw e;
      if(attempt===0&&chrome.scripting?.executeScript){if(!requestActive())return job.lastResult||{text:job.lastDelta||'',stopped:true};await chrome.scripting.executeScript({target:{tabId:job.transportId},files:['bridge.js']});}
      await new Promise(resolve=>setTimeout(resolve,750));if(!requestActive())return job.lastResult||{text:job.lastDelta||'',stopped:true};
     }
    }
    throw Error((preparationError.includes('未确认 ChatGPT 临时聊天')?'等待临时聊天开启超时；未填入或发送内容。':preparationError)||'ChatGPT 页面未准备好，请先在普通浏览器标签页登录 ChatGPT，再重试。');
   }catch(e){if(!job.cancelled&&job.requestId===m.requestId&&(job.submitted||/message port closed|message channel closed|channel closed before a response/i.test(e.message))&&!job.lastResult){job.submitted=true;return {pending:true};}if(job.requestId===m.requestId&&!job.submitted)job.lastResult={error:e.message};throw e}finally{if(job.requestId===m.requestId&&(!job.submitted||job.lastResult))job.busy=false;await persistJobs();}
  })().then(data=>reply(data),e=>reply({error:e.message}));return true;
 }
});
