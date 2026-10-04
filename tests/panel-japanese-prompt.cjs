const assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function scenario(raw,hasTranscript=false){
 const w=new JSDOM(fs.readFileSync('extension/panel.html','utf8'),{url:'https://local.test',runScripts:'outside-only'}).window,sent=[],url='https://www.youtube.com/watch?v=abcdefghijk';let progress=null;
 w.chrome={tabs:{query:async()=>[{id:1,windowId:10,url,title:'Video'}],onActivated:{addListener(){}},onUpdated:{addListener(){}}},runtime:{id:'ext',onMessage:{addListener(){}},connect:()=>({postMessage(){},disconnect(){},onMessage:{addListener(){}}}),sendMessage:async m=>{
  if(m.type==='extract')return {data:{tabId:1,url,title:'Video',type:'youtube'}};
  if(m.type==='assistant:context')return {data:{hasTranscript}};
  if(m.type==='captions')return {data:{text:raw}};
  if(m.type==='translation:progress:get')return {data:progress};
  if(m.type==='translation:progress:set'){progress=m.data;return {ok:true};}
  if(m.type==='assistant'){sent.push(m);return {text:hasTranscript?'原文：一文\n[翻译完成]':'本段完成'};}
  return {ok:true};
 }}};w.eval(fs.readFileSync('extension/panel.js','utf8'));await wait(10);w.document.getElementById('translate').click();for(let i=0;i<50&&(!sent.length||w.document.getElementById('send').disabled);i++)await wait(10);assert.equal(sent.length,1);const prompt=sent[0].text;assert.match(prompt,/以下三行格式/);assert.match(prompt,/直接输出修正后的原语言句子/);assert.doesNotMatch(prompt,/\n原文：|\n校正：/);assert.match(prompt,/有多个候选时选择语境依据最充分的一种/);
 w.document.getElementById('question').value='第二个词呢？';w.document.getElementById('form').requestSubmit();await wait(10);assert.equal(sent.at(-1).text,'第二个词呢？','plain followups must never receive the Japanese translation instructions');w.close();return prompt;
}
(async()=>{const jp=await scenario('今日はテレビを見ます。');assert.match(jp,/日语专用逐词规则/);assert.match(jp,/单词【片假名读音／音调数字】＝中文释义/);assert.match(jp,/外来语保留原片假名/);assert.match(jp,/0表示无下降核/);assert.match(jp,/禁止输出“不确定”“未确认”/);assert.doesNotMatch(jp,/具体词才写“未确认”/);assert.match(jp,/当前活用形/);assert.match(jp,/有可靠东京式词汇音调资料的词必须写数字/);assert.match(jp,/缺少视频音频不是拒绝标注/);assert.match(jp,/每一段内容.*都必须标记序号/);assert.match(jp,/不重置、不跳号/);const en=await scenario('This is an English caption.');assert.doesNotMatch(en,/日语专用/);assert.match(en,/都必须标记序号/);const th=await scenario('สวัสดีครับ');assert.doesNotMatch(th,/日语专用/);assert.match(th,/都必须标记序号/);const context=await scenario('',true);assert.match(context,/仅当这个视频的原始字幕是日语/);assert.match(context,/英语、泰语等其他语言保持普通/);console.log('PASS Japanese translation prompt: per-word katakana + numeric Tokyo accent, loanword form preserved, uncertainty and inflections, retained-context conditional, English/Thai isolation, plain followup untouched');})().catch(e=>{console.error(e);process.exitCode=1});
