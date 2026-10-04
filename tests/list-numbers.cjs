const assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync('extension/bridge.js','utf8');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const fp=value=>{let hash=2166136261;for(const char of value.replace(/\s+/g,''))hash=Math.imul(hash^char.charCodeAt(0),16777619);return (hash>>>0).toString(16)};
const answer='Intro<ol start="3"><li>Third</li><li value="7">Seventh<ol reversed start="4"><li>Nested four</li><li value="2">Nested two</li><li></li></ol></li><li>Eight</li></ol><ol reversed><li>Reverse three</li><li>Reverse two</li><li>Reverse one</li></ol><ol start="9"><li>9. Already explicit</li><li>Ten</li></ol><ul><li>Bullet text</li></ul>';
const expected='Intro\n3. Third\n7. Seventh\n  4. Nested four\n  2. Nested two\n  1. \n8. Eight\n3. Reverse three\n2. Reverse two\n1. Reverse one\n9. Already explicit\n10. Ten\nBullet text';

function fixture(html){
 const dom=new JSDOM(html,{url:'https://chatgpt.com/c/lists?temporary-chat=true',runScripts:'outside-only'}),w=dom.window;let handler,arm,now=1000;const sent=[];
 w.HTMLElement.prototype.getBoundingClientRect=()=>({width:20,height:20});
 Object.defineProperty(w.HTMLElement.prototype,'innerText',{get(){return this.textContent}});
 w.Date.now=()=>now;
 const interval=w.setInterval.bind(w);w.setInterval=callback=>interval(callback,5);
 w.chrome={runtime:{id:'ext',onMessage:{addListener:listener=>handler=listener},sendMessage:async message=>sent.push(message)}};
 w.document.addEventListener('gpt-sidebar-stream-control-v3',event=>{const value=JSON.parse(event.detail);if(value.action==='arm')arm=value});
 w.eval(source);return {dom,w,sent,get handler(){return handler},advance(ms){now+=ms},wire(status,text=''){assert(arm);w.document.dispatchEvent(new w.CustomEvent('gpt-sidebar-stream-update-v3',{detail:JSON.stringify({token:arm.token,requestId:arm.requestId,status,text})}))}};
}

(async()=>{
 const f=fixture('<button aria-label="关闭临时聊天"></button><textarea></textarea><button data-testid="send-button">发送</button>');
 const send=f.w.document.querySelector('[data-testid="send-button"]');let stopClicks=0;
 send.onclick=()=>{
  const editor=f.w.document.querySelector('textarea'),user=f.w.document.createElement('div');user.setAttribute('data-message-author-role','user');user.textContent=editor.value;editor.value='';f.w.document.body.append(user);
  const response=f.w.document.createElement('div');response.setAttribute('data-message-author-role','assistant');response.innerHTML=answer;f.w.document.body.append(response);
  send.dataset.testid='stop-button';send.textContent='停止回答';send.onclick=()=>{stopClicks++;send.remove()};
 };
 const pending=new Promise(resolve=>f.handler({type:'assistant:ask',requestId:'list-ask',text:'List question'},{id:'ext'},resolve));
 for(let i=0;i<30&&!f.w.document.querySelector('[data-message-author-role="assistant"]');i++)await wait(5);
 f.wire('delta','Intro\n3. Third\n7. Seventh');f.advance(4101);await wait(10);
 let snapshot;f.handler({type:'assistant:snapshot',requestId:'list-ask'},{id:'ext'},value=>snapshot=value);
 assert.equal(snapshot.text,expected,'assistant:snapshot includes CSS ordered-list markers, nesting, reversed order, and li values');
 assert(!snapshot.text.includes('9. 9. Already'),'an explicit textual number is not duplicated');
 assert(!snapshot.text.includes('1. Bullet'),'unordered lists do not gain invented numbers');
 const stopped=await new Promise(resolve=>f.handler({type:'assistant:stop',requestId:'list-ask'},{id:'ext'},resolve));
 assert.equal(stopClicks,1);assert.equal(stopped.text,expected);assert.equal((await pending).text,expected,'the ask final path retains numbered DOM text');f.dom.window.close();

 const r=fixture('<button aria-label="关闭临时聊天"></button><div data-message-author-role="user">Resume lists</div><ol data-message-author-role="assistant"><li>Root one</li><li>Root two</li></ol><textarea></textarea>');
 const resumed=await new Promise(resolve=>r.handler({type:'assistant:resume',requestId:'list-resume',beforeCount:0,promptFingerprint:fp('Resume lists')},{id:'ext'},resolve));
 assert.equal(resumed.text,'1. Root one\n2. Root two','the resume final path numbers an ordered list that is itself the extraction root');
 let resumedSnapshot;r.handler({type:'assistant:snapshot',requestId:'list-resume'},{id:'ext'},value=>resumedSnapshot=value);assert.equal(resumedSnapshot.result.text,resumed.text);r.dom.window.close();
 console.log('PASS list numbers: snapshots and ask/resume finals preserve start, reversed, li value, nesting, explicit markers, and unordered lists');
})().catch(error=>{console.error(error);process.exitCode=1});
