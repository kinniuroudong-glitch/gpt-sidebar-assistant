const assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const html=fs.readFileSync('extension/panel.html','utf8');
const script=fs.readFileSync('extension/panel.js','utf8');

function fixture(){
 const dom=new JSDOM(html,{url:'https://local.test',runScripts:'outside-only'}),w=dom.window;
 let current={id:1,windowId:10,title:'Alpha',url:'https://alpha.test/article'},portReceive,runtimeReceive,extracts=0;
 const requests=[],waiting=new Map();
 w.chrome={
  tabs:{query:async()=>[current],onActivated:{addListener(){}},onUpdated:{addListener(){}}},
  runtime:{id:'ext',onMessage:{addListener:f=>runtimeReceive=f},connect:()=>({postMessage(){},disconnect(){},onMessage:{addListener:f=>portReceive=f}}),sendMessage:async message=>{
   if(message.type==='extract'){extracts++;const tab=current.id===message.tabId?current:{id:message.tabId,url:'https://alpha.test/article',title:'Alpha'};return {data:{tabId:tab.id,url:tab.url,title:tab.title,type:'page',text:`BODY-${tab.title}`}};}
   if(message.type==='assistant'){requests.push(message);if(message.uiQuestion==='流式问题')return new Promise(resolve=>waiting.set(message.requestId,resolve));return {text:`回答：${message.uiQuestion}`};}
   return {ok:true};
  }}
 };
 w.eval(script);
 return {dom,w,requests,waiting,get current(){return current},set current(value){current=value},get extracts(){return extracts},receive:m=>portReceive(m),runtime:(m,s={id:'ext'})=>runtimeReceive(m,s)};
}
async function submit(f,question){const q=f.w.document.getElementById('question');q.value=question;f.w.document.getElementById('form').dispatchEvent(new f.w.Event('submit',{cancelable:true}));await wait(230);}

(async()=>{
 const f=fixture();await wait(10);
 await submit(f,'第一问');await submit(f,'第二问');
 assert.equal(f.extracts,0,'plain questions never extract the page');
 assert.equal(f.requests.length,2);assert(f.requests.every(r=>r.uiTurnId&&r.uiQuestion));
 assert(f.requests.every(r=>!r.requiresTranscript&&!r.text.includes('BODY-')&&!r.text.includes('alpha.test')));
 const turns=[...f.w.document.querySelectorAll('.turn')];assert.equal(turns.length,2);assert.equal(turns[0].querySelector('.question').textContent,'第一问');assert.equal(turns[0].querySelector('.assistant').textContent,'回答：第一问');assert.equal(turns[1].querySelector('.assistant').textContent,'回答：第二问');assert.equal(f.w.document.querySelectorAll('#answer').length,1);assert.equal(turns[1].querySelector('.assistant').id,'answer');

 f.w.document.getElementById('attach').click();await wait(10);assert.equal(f.extracts,1);assert.equal(f.w.document.getElementById('attach').getAttribute('aria-pressed'),'true');
 f.current={id:2,windowId:10,title:'Beta',url:'https://beta.test/new'};await f.w.eval('sync()');assert.match(f.w.document.getElementById('attachment').textContent,/Alpha/,'selected snapshot survives browsing another tab');
 await submit(f,'只问已加入页面');const attached=f.requests.at(-1);assert.equal(attached.tabId,1);assert.equal(attached.url,'https://alpha.test/article');assert(attached.text.includes('BODY-Alpha'));assert.equal(f.w.document.getElementById('attach').getAttribute('aria-pressed'),'false','selection clears after one send');
 await submit(f,'普通追问');const plain=f.requests.at(-1);assert.equal(f.extracts,1);assert.equal(plain.tabId,2);assert(!plain.text.includes('BODY-')&&!plain.text.includes('beta.test'));

 const q=f.w.document.getElementById('question');q.value='流式问题';f.w.document.getElementById('form').dispatchEvent(new f.w.Event('submit',{cancelable:true}));await wait(10);
 const streaming=f.requests.at(-1),turnId=streaming.uiTurnId;f.receive({type:'assistant:delta',requestId:streaming.requestId,uiTurnId:turnId,uiQuestion:'流式问题',text:'😀ก้你好'});assert.equal(f.w.document.getElementById('answer').textContent,'😀');await wait(220);assert.equal(f.w.document.getElementById('answer').textContent,'😀ก้你好');assert(!/[\uD800-\uDBFF]$/.test(f.w.document.getElementById('answer').textContent));
 const viewport=f.w.document.querySelector('main');Object.defineProperties(viewport,{scrollHeight:{configurable:true,value:1000},clientHeight:{configurable:true,value:100}});viewport.scrollTop=100;viewport.dispatchEvent(new f.w.Event('scroll'));
 f.current={id:3,windowId:10,title:'Gamma',url:'https://gamma.test/'};await f.w.eval('sync()');f.receive({type:'assistant:delta',requestId:streaming.requestId,uiTurnId:turnId,text:'😀ก้你好，继续生成'});await wait(30);assert.equal(viewport.scrollTop,100,'reading earlier turns is not pulled to the bottom');
 f.receive({type:'assistant:result',requestId:streaming.requestId,uiTurnId:turnId,result:{text:'😀ก้你好，继续生成并最终完成'}});assert.notEqual(f.w.document.getElementById('answer').textContent,'😀ก้你好，继续生成并最终完成','final prefix drains through the renderer');f.waiting.get(streaming.requestId)({pending:true});await wait(230);assert.equal(f.w.document.getElementById('answer').textContent,'😀ก้你好，继续生成并最终完成');assert.equal(f.extracts,1,'tab browsing during generation does not read the new page');
 const count=f.w.document.querySelectorAll('.turn').length,latest=f.w.document.getElementById('answer');f.receive({type:'assistant:delta',requestId:'stale',uiTurnId:'ghost',uiQuestion:'ghost',text:'stale'});assert.equal(f.w.document.querySelectorAll('.turn').length,count,'stale deltas cannot create blank turns');assert.equal(f.w.document.getElementById('answer'),latest);
 f.dom.window.close();

 const restored=fixture();await wait(5);restored.receive({type:'assistant:history',turns:[{id:'one',question:'旧问题一',answer:'旧回答一',requestId:'old-1',completed:true},{id:'two',question:'旧问题二',answer:'旧回答二',requestId:'old-2',completed:true}]});
 assert.deepEqual([...restored.w.document.querySelectorAll('.question')].map(n=>n.textContent),['旧问题一','旧问题二']);assert.deepEqual([...restored.w.document.querySelectorAll('.assistant')].map(n=>n.textContent),['旧回答一','旧回答二']);const restoredLatest=restored.w.document.getElementById('answer');
 restored.receive({type:'assistant:result',requestId:'old-1',uiTurnId:'one',result:{text:'旧回答一'}});assert.equal(restored.w.document.getElementById('answer'),restoredLatest,'replayed old results cannot move the latest answer id');assert.equal(restored.w.document.querySelectorAll('.turn').length,2);
 restored.dom.window.close();
 console.log('PASS panel history/injection: two-turn history, restore/dedupe, one-shot manual page attachment, plain-chat isolation, tab-safe live Unicode streaming, final drain, reading-scroll preservation, stale replay isolation');
})().catch(error=>{console.error(error);process.exitCode=1});
