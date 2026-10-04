const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
async function check(languageCode,body,fail=false){
 let handler,helperUrl='',nextId=100;const calls=[],removed=[],created=[];
 const source={id:1,windowId:10,url:'https://www.youtube.com/watch?v=abcdefghijk'};
 const label=languageCode==='ja'?'Japanese (auto-generated)':languageCode==='en'?'English (United States)':'Thai';
 const chrome={runtime:{id:'ext',getURL:p=>'chrome-extension://ext/'+p,onMessage:{addListener:f=>handler=f},onConnect:{addListener(){}}},sidePanel:{setPanelBehavior(){}},tabs:{onUpdated:{addListener(){}},onActivated:{addListener(){}},onRemoved:{addListener(){}},get:async id=>id===1?source:{id:nextId,url:helperUrl,status:'complete'},create:async options=>{created.push(options);helperUrl=options.url;return {id:++nextId}},remove:async id=>removed.push(id),sendMessage:async(id,m)=>{
  calls.push(m);
  if(m.type==='downsub:probe'&&m.phase==='entry'){assert.equal(m.languageCode,languageCode);return {data:{language:label,languageCode,rawTitle:'[RAW] '+label,source:'DownSub'}};}
  if(m.type==='downsub:click'){assert.equal(m.languageCode,languageCode);assert.equal(m.rawTitle,'[RAW] '+label);helperUrl='https://subtitle.downsub.com/raw/opaque/';return {data:true};}
  return {data:body};
 }},scripting:{executeScript:async o=>{
  if(o.func.name==='readYoutubeCaptionLanguage')return [{result:{languageCode,evidence:'original-asr'}}];
  assert.equal(o.func.name,'readYoutubeCaptions');assert.equal(o.args[2],languageCode);return [{result:{text:'native fallback',language:languageCode,source:'YouTube'}}];
 }}};
 vm.runInNewContext(fs.readFileSync('extension/background.js','utf8'),{chrome,importScripts(){},readYoutubeCaptionLanguage:function readYoutubeCaptionLanguage(){},readYoutubeCaptions:function readYoutubeCaptions(){},URL,Map,Set,Error,AbortController,setInterval,clearInterval,setTimeout,clearTimeout});
 const result=await new Promise(resolve=>handler({type:'captions',tabId:1,url:source.url,requestId:'lang-'+languageCode},{id:'ext',url:'chrome-extension://ext/panel.html'},resolve));
 assert.equal(result.data.text,fail?'native fallback':body);
 assert.equal(created.length,1);assert.equal(created[0].active,false);assert.deepEqual(removed,[101]);
 assert(calls.some(m=>m.type==='downsub:click'),'automatically click selected original RAW');
 assert(!calls.some(m=>m.type==='assistant'),'caption extraction itself must not invoke a model');
 if(fail)assert.match(result.data.downsubError,/不是日语字幕/);else assert.equal(result.data.languageCode,languageCode);
}
(async()=>{await check('ja','こんにちは。\nこれは字幕です。');await check('en','Hello.\nThis is an English caption.');await check('th','สวัสดีครับ\nจบ');await check('ja','Wrong-language English text',true);console.log('PASS background languages: detected original language passed to probe/click/fallback, JP/en/th full text, inactive helper closes, no model extraction, wrong body refused');})().catch(e=>{console.error(e);process.exitCode=1});
