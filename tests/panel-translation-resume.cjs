const assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const html=fs.readFileSync('extension/panel.html','utf8'),script=fs.readFileSync('extension/panel.js','utf8');
const video={id:7,tabId:7,windowId:10,title:'Saved Video',url:'https://www.youtube.com/watch?v=abcdefghijk',type:'youtube'};
function fingerprint(value){let hash=2166136261;for(let i=0;i<value.length;i++){hash^=value.charCodeAt(i);hash=Math.imul(hash,16777619)}return value.length+':'+(hash>>>0).toString(16)}
function fixture({checkpoint=null,current=video,raw='A'.repeat(7000),hasTranscript=false,answer}){
 const dom=new JSDOM(html,{url:'https://local.test',runScripts:'outside-only'}),w=dom.window;let progress=checkpoint?JSON.parse(JSON.stringify(checkpoint)):null,captionReads=0,extracts=0;const requests=[],sets=[];
 w.chrome={tabs:{query:async()=>[current],onActivated:{addListener(){}},onUpdated:{addListener(){}}},runtime:{id:'ext',onMessage:{addListener(){}},connect:()=>({postMessage(){},disconnect(){},onMessage:{addListener(){}}}),sendMessage:async message=>{
  if(message.type==='translation:progress:get')return {data:progress};
  if(message.type==='translation:progress:set'){progress=message.data?JSON.parse(JSON.stringify(message.data)):null;sets.push(progress);return {ok:true};}
  if(message.type==='extract'){extracts++;return {data:{...video,tabId:video.id,text:'metadata'}};}
  if(message.type==='assistant:context')return {data:{hasTranscript}};
  if(message.type==='captions'){captionReads++;assert.equal(message.tabId,video.id);assert.equal(message.url,video.url);return {data:{text:raw,language:'Thai',automatic:true}};}
  if(message.type==='assistant'){requests.push(message);return answer(message,requests.length);}
  return {ok:true};
 }}};w.eval(script);return {dom,w,requests,sets,get progress(){return progress},get captionReads(){return captionReads},get extracts(){return extracts}};
}
async function waitIdle(f,condition=()=>!f.w.document.getElementById('send').disabled){for(let i=0;i<200&&!condition();i++)await wait(10);await wait(10)}

(async()=>{
 // One click advances one segment. A failed segment leaves its cursor unchanged.
 let failed=false;const first=fixture({answer:async message=>{if(message.uiQuestion==='校正翻译 2/3'&&!failed){failed=true;return {error:'第二段临时失败'}}return {text:`${message.uiQuestion} 完成`}}});await wait(10);
 first.w.document.getElementById('translate').click();await waitIdle(first);assert.deepEqual(first.requests.map(r=>r.uiQuestion),['校正翻译 1/3']);assert.equal(first.progress.nextIndex,1);assert.equal(first.progress.total,3);assert.equal(first.progress.completed,false);assert.equal(first.progress.source.url,video.url);assert(first.progress.captionFingerprint);assert.equal(first.w.document.getElementById('resume').hidden,false);assert.match(first.w.document.getElementById('resume').getAttribute('aria-label'),/第 2\/3 段/);
 first.w.document.getElementById('resume').click();await waitIdle(first,()=>!first.w.document.getElementById('send').disabled&&/失败/.test(first.w.document.getElementById('status').textContent));assert.deepEqual(first.requests.map(r=>r.uiQuestion),['校正翻译 1/3','校正翻译 2/3']);assert.equal(first.progress.nextIndex,1,'failure does not advance the cursor');assert.match(first.w.document.getElementById('status').textContent,/继续/);
 first.w.document.getElementById('resume').click();await waitIdle(first);assert.equal(first.progress.nextIndex,2);first.w.document.getElementById('resume').click();await waitIdle(first,()=>first.progress?.completed===true);
 assert.deepEqual(first.requests.map(r=>r.uiQuestion),['校正翻译 1/3','校正翻译 2/3','校正翻译 2/3','校正翻译 3/3'],'completed segment 1 is never retransmitted');assert.equal(first.requests[1].text,first.requests[2].text,'failed segment remains in memory for an exact retry');assert.equal(first.captionReads,1,'open sidebar extracts captions once across continue and retry clicks');assert(first.sets.every(value=>!Object.hasOwn(value,'chunks')&&!Object.hasOwn(value,'captions')&&!Object.hasOwn(value,'rawCaptions')&&!JSON.stringify(value).includes('AAAA')),'raw and chunk text never enters progress storage');assert.equal(first.progress.nextIndex,3);assert.equal(first.w.document.getElementById('resume').hidden,true);assert.equal(first.w.document.getElementById('status').textContent,'校正翻译全部完成。');assert.equal(first.w.document.querySelectorAll('.turn').length,4,'prior output remains visible alongside retried/new segments');first.dom.window.close();

 // Reopening on another page restores the exact saved source and remaining index.
 const raw='B'.repeat(7000),saved={source:{tabId:video.id,url:video.url,title:video.title,type:'youtube'},mode:'chunks',nextIndex:1,total:3,continuation:null,completed:false,captionFingerprint:fingerprint(raw),lastRequestId:'old'};
 const reopened=fixture({checkpoint:saved,current:{id:99,windowId:10,title:'Other',url:'https://other.test/'},raw,answer:async message=>({text:`${message.uiQuestion} 完成`})});await wait(20);assert.equal(reopened.w.document.getElementById('resume').hidden,false);assert.match(reopened.w.document.getElementById('resume').getAttribute('aria-label'),/第 2\/3 段/);reopened.w.document.getElementById('resume').click();await waitIdle(reopened);assert.deepEqual(reopened.requests.map(r=>r.uiQuestion),['校正翻译 2/3']);assert.equal(reopened.progress.nextIndex,2,'restored resume also stops after one segment');reopened.w.document.getElementById('resume').click();await waitIdle(reopened,()=>reopened.progress?.completed===true);
 assert.deepEqual(reopened.requests.map(r=>r.uiQuestion),['校正翻译 2/3','校正翻译 3/3']);assert(reopened.requests.every(r=>r.tabId===video.id&&r.url===video.url));assert.equal(reopened.captionReads,1,'reopened sidebar reacquires once, verifies the fingerprint, then reuses unsent memory');assert.equal(reopened.extracts,0,'resume never prepares the newly active page');reopened.dom.window.close();

 // A backend-confirmed cursor can be ahead of the local cache after a lost
 // panel result. Reacquire once, then cache the remaining unsent chunks again.
 const ahead=fixture({raw:'D'.repeat(10000),answer:async message=>({text:`${message.uiQuestion} 完成`})});await wait(10);ahead.w.document.getElementById('translate').click();await waitIdle(ahead);ahead.progress.nextIndex=2;
 ahead.w.document.getElementById('resume').click();await waitIdle(ahead);assert.equal(ahead.progress.nextIndex,3);ahead.w.document.getElementById('resume').click();await waitIdle(ahead,()=>ahead.progress?.completed===true);assert.deepEqual(ahead.requests.map(r=>r.uiQuestion),['校正翻译 1/4','校正翻译 3/4','校正翻译 4/4']);assert.equal(ahead.captionReads,2,'replace a stale cache after exactly one validated reacquisition');ahead.dom.window.close();

 // Same chunk count with changed content is rejected before any completed segment is resent.
 const changed=fixture({checkpoint:saved,current:{id:99,windowId:10,title:'Other',url:'https://other.test/'},raw:'C'.repeat(7000),answer:async()=>{throw Error('must not send changed captions')}});await wait(20);changed.w.document.getElementById('resume').click();await waitIdle(changed,()=>!changed.w.document.getElementById('send').disabled);assert.equal(changed.requests.length,0);assert.match(changed.w.document.getElementById('status').textContent,/字幕与中断前不一致/);assert.equal(changed.w.document.getElementById('resume').hidden,false);changed.dom.window.close();

 // Existing-chat context resumes from its exact cursor, with no caption service call.
 const contextSaved={source:{tabId:video.id,url:video.url,title:video.title,type:'youtube'},mode:'context',nextIndex:2,total:0,continuation:'saved exact cursor',completed:false,lastRequestId:'context-old'};
 const context=fixture({checkpoint:contextSaved,current:{id:99,windowId:10,title:'Other',url:'https://other.test/'},hasTranscript:true,answer:async()=>({text:'原文：last\n校正：last\n逐词：last＝最后\n整句：最后\n[翻译完成]'})});await wait(20);context.w.document.getElementById('resume').click();await waitIdle(context,()=>context.progress?.completed===true);assert.equal(context.captionReads,0);assert.equal(context.requests.length,1);assert.equal(context.requests[0].uiQuestion,'校正翻译 3');assert.match(context.requests[0].text,/saved exact cursor/);assert.equal(context.requests[0].requiresTranscript,true);context.dom.window.close();

 // Resume is disabled while its current segment is pending, so repeat clicks cannot duplicate it.
 let release;const guarded=fixture({checkpoint:contextSaved,hasTranscript:true,answer:()=>new Promise(resolve=>{release=resolve})});await wait(20);guarded.w.document.getElementById('resume').click();await wait(10);assert.equal(guarded.w.document.getElementById('resume').disabled,true);guarded.w.document.getElementById('resume').click();assert.equal(guarded.requests.length,1);release({text:'原文：last\n校正：last\n逐词：last＝最后\n整句：最后\n[翻译完成]'});await waitIdle(guarded,()=>guarded.progress?.completed===true);guarded.dom.window.close();

 // Closing the panel drops ephemeral unsent chunks; the same checkpoint safely reacquires them.
 const hidden=fixture({raw,answer:async message=>({text:`${message.uiQuestion} 完成`})});await wait(10);hidden.w.document.getElementById('translate').click();await waitIdle(hidden);assert.equal(hidden.captionReads,1);hidden.w.dispatchEvent(new hidden.w.Event('pagehide'));hidden.w.document.getElementById('resume').click();await waitIdle(hidden);assert.equal(hidden.captionReads,2,'pagehide clears ephemeral subtitle memory');assert.equal(hidden.progress.nextIndex,2);hidden.dom.window.close();
 console.log('PASS translation resume: one segment per click, failed cursor unchanged, no completed retransmit, reopen/source snapshot, caption fingerprint rejection, context cursor without refetch, busy duplicate guard');
})().catch(error=>{console.error(error);process.exitCode=1});
