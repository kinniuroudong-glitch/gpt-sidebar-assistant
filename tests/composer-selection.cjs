const assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync('extension/bridge.js','utf8');
function fixture(draft=''){
 const dom=new JSDOM(`<button aria-label="关闭临时聊天"></button><div role="textbox" contenteditable="true" aria-label="开始写作">Original canvas answer</div><textarea>Unrelated editor</textarea><div contenteditable="true" data-composer-markdown role="textbox" aria-label="询问 ChatGPT">${draft}</div><button aria-label="发送"></button>`,{url:'https://chatgpt.com/?temporary-chat=true',runScripts:'outside-only'}),w=dom.window;
 let receive,sends=0;const composer=w.document.querySelector('[data-composer-markdown]');
 w.HTMLElement.prototype.getBoundingClientRect=()=>({width:100,height:100});
 Object.defineProperty(w.HTMLElement.prototype,'innerText',{get(){return this.textContent}});
 const interval=w.setInterval.bind(w);w.setInterval=f=>interval(f,5);
 w.chrome={runtime:{id:'ext',sendMessage:async()=>{},onMessage:{addListener:f=>receive=f}}};
 w.document.querySelector('[aria-label="发送"]').onclick=()=>{sends++;const user=w.document.createElement('div');user.dataset.messageAuthorRole='user';user.textContent=composer.textContent;w.document.body.append(user);composer.textContent='';const answer=w.document.createElement('div');answer.dataset.messageAuthorRole='assistant';answer.textContent='Answer '+sends;w.document.body.append(answer)};
 w.eval(source);return {w,composer,ask:text=>new Promise(resolve=>receive({type:'assistant:ask',text,requestId:text},{id:'ext'},resolve)),sends:()=>sends};
}
(async()=>{
 const f=fixture();assert.equal((await f.ask('First exact question')).text,'Answer 1');assert.equal((await f.ask('Second exact question')).text,'Answer 2');assert.equal(f.sends(),2);assert.equal(f.w.document.querySelector('[aria-label="开始写作"]').textContent,'Original canvas answer');assert.equal(f.w.document.querySelector('textarea').value,'Unrelated editor');assert.equal(f.composer.textContent,'');f.w.close();
 const draft=fixture('Real user draft');assert.match((await draft.ask('Followup')).error,/草稿/);assert.equal(draft.composer.textContent,'Real user draft');assert.equal(draft.sends(),0);draft.w.close();
 const css=fs.readFileSync('extension/panel.css','utf8');assert.match(css,/font:33px\/1.7/);assert.match(css,/font-size:24px/);assert.match(css,/#resume\{[^}]*font-size:22px/);assert.match(css,/#attachment\{font-size:12px/);
 console.log('PASS composer selection: canvas and unrelated editor untouched, actual composer handles two sequential questions, real draft preserved, font scaled 1.5x');
})().catch(e=>{console.error(e);process.exitCode=1});
