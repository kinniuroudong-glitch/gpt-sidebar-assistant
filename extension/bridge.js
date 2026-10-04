(()=>{
 const bridgeVersion="0.12.4";if(globalThis.__gptSidebarBridgeVersion===bridgeVersion)return;globalThis.__gptSidebarBridgeVersion=bridgeVersion;
 let busy=false,currentRequest=null,readSnapshot=()=>'',lastFinal=null,activeStop=null;
 let frameLease=null,streamDiagnostics={version:bridgeVersion,state:'idle',helperVersion:null};
 const frameEvent=value=>document.dispatchEvent(new CustomEvent('gpt-sidebar-frames-control-v1',{detail:JSON.stringify(value)}));
 const pulseFrames=()=>{if(frameLease)frameEvent({...frameLease,action:'pulse'});};
 function beginFrames(requestId){
  if(frameLease)frameEvent({...frameLease,action:'disarm'});
  const lease={requestId,token:crypto.randomUUID?.()||Array.from(crypto.getRandomValues(new Uint32Array(4)),v=>v.toString(16)).join('')};
  frameLease=lease;frameEvent({...lease,action:'arm'});pulseFrames();
  return ()=>{if(frameLease!==lease)return;frameEvent({...lease,action:'disarm'});frameLease=null;};
 }
 const plainAnswer=value=>String(value).replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[\s`*_#>\[\]]/g,'');
 const coversWire=(dom,wire)=>!!wire&&plainAnswer(dom).length>=plainAnswer(wire).length&&plainAnswer(dom).startsWith(plainAnswer(wire));
 const WIRE_STALE_MS=4000,WIRE_DONE_STOP_CAP_MS=1500;
 const fingerprint=value=>{let hash=2166136261;for(const char of value.replace(/\s+/g,'')){hash=Math.imul(hash^char.charCodeAt(0),16777619);}return (hash>>>0).toString(16)};
 const visible=e=>!!e&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0;
 const label=e=>e.getAttribute('aria-label')||e.textContent||'';
 // Canvas documents and message editors also expose role=textbox. They are
 // never the composer. Prefer explicit composer identity over document order.
 const composer=()=>{
  for(const selector of ['#prompt-textarea[contenteditable="true"],textarea#prompt-textarea','#prompt-textarea [contenteditable="true"],#prompt-textarea textarea','[data-composer-markdown][contenteditable="true"]']){
   const found=[...document.querySelectorAll(selector)].find(visible);if(found)return found;
  }
  const candidates=[...document.querySelectorAll('textarea,[contenteditable="true"][role="textbox"]')].filter(e=>visible(e)&&!e.closest('[data-message-author-role],[data-markdown-text-style],[data-content-search-unit-key],[role="dialog"]')&&(e.tagName==='TEXTAREA'||/^(询问 ChatGPT|Ask ChatGPT|Message ChatGPT)$/i.test((e.getAttribute('aria-label')||'').trim())));
  return candidates.length===1?candidates[0]:null;
 };
 const composerReady=()=>{const editor=composer();return !!editor&&!editor.disabled&&editor.getAttribute('aria-disabled')!=='true'&&editor.getAttribute('contenteditable')!=='false'};
 const buttons=()=>[...document.querySelectorAll('button')];
 // A URL parameter requests temporary mode but is not evidence it activated.
 // Require affirmative UI evidence on every send and follow-up.
 const temporary=()=>{
  if(buttons().some(e=>visible(e)&&/^(关闭临时聊天|退出临时聊天|Turn off temporary chat|Close temporary chat|Exit temporary chat)$/i.test(label(e).trim())))return true;
  // The answered temporary-chat layout replaces the exit control with Save
  // chat. Require that real header control, the temporary route, and an actual
  // user turn together. Never click Save or accept a URL/title by itself.
  const route=new URL(location.href);
  if(route.searchParams.get('temporary-chat')!=='true'||!/^\/c\/[^/]+$/.test(route.pathname))return false;
  if(buttons().some(e=>visible(e)&&/^(临时聊天|Temporary chat)$/i.test(label(e).trim())))return false;
  return buttons().some(e=>visible(e)&&e.closest('header')&&!e.closest('[data-message-author-role],[data-markdown-text-style],[data-content-search-unit-key]')&&/^(Save chat|保存聊天|保存对话)$/i.test(label(e).trim()))&&messages('user').length>0;
 };
 // The user's separate whiteboard extension hides all toolbar controls.
 // Reveal tools only in the dedicated backend tab when contacted by this
 // extension, so the affirmative temporary-mode indicator can be checked.
 const revealBackendTools=()=>{if(document.documentElement.getAttribute('data-whiteboard')==='focus')document.dispatchEvent(new KeyboardEvent('keydown',{key:'F8',code:'F8',bubbles:true}));};
 const speaker=role=>role==='assistant'?/^(?:ChatGPT 说|ChatGPT 說|ChatGPT said|ChatGPT says)[:：]$/i:/^(?:你说|你說|You said)[:：]$/i;
 // Some ChatGPT layouts expose a speaker heading instead of an author attribute.
 // Read only that message's nearest content container; never the page or composer.
 function messages(role){
  const nodes=[...document.querySelectorAll('[data-message-author-role="'+role+'"], [data-markdown-text-style="'+role+'-message"]'+(role==='user'?', [data-content-search-unit-key$=":user"]':''))].filter((e,i,all)=>!all.some(parent=>parent!==e&&parent.contains(e)));
  for(const heading of document.querySelectorAll('main h1,main h2,main h3,main h4,main h5,main h6')){
   const name=heading.textContent.trim();if(!speaker(role).test(name)||heading.closest('[data-message-author-role]')||nodes.some(e=>heading.parentElement.contains(e)))continue;
   for(let node=heading.parentElement;node&&node.tagName!=='MAIN'&&node!==document.body;node=node.parentElement){
    if(node.querySelector('[contenteditable="true"],textarea,[data-message-author-role="'+(role==='assistant'?'user':'assistant')+'"]'))break;
    const labels=[...node.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(e=>speaker('assistant').test(e.textContent.trim())||speaker('user').test(e.textContent.trim()));
    if(labels.length>1)break;
    if((node.textContent||'').trim()!==name){nodes.push(node);break;}
   }
  }
  return [...new Set(nodes)].sort((a,b)=>a===b?0:a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1);
 }
 const responses=()=>messages('assistant');
 const text=e=>{
  if(!e)return '';
  const copy=e.cloneNode(true);copy.querySelectorAll('button,svg,[role="menu"]').forEach(n=>n.remove());
  copy.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(n=>{if(speaker('assistant').test(n.textContent.trim())||speaker('user').test(n.textContent.trim()))n.remove()});
  // textContent omits generated list markers. Materialize ordered markers in
  // the clone so snapshots match the numbered answer visible in ChatGPT.
  [...(copy.matches?.('ol')?[copy]:[]),...copy.querySelectorAll('ol')].forEach(list=>{
   const items=[...list.children].filter(n=>n.tagName==='LI'),reversed=list.hasAttribute('reversed');
   const parsedStart=Number.parseInt(list.getAttribute('start')||'',10);let number=Number.isFinite(parsedStart)?parsedStart:(reversed?items.length:1),depth=0;
   for(let parent=list.parentElement;parent&&parent!==copy;parent=parent.parentElement)if(parent.tagName==='OL'||parent.tagName==='UL')depth++;
   for(const [index,item] of items.entries()){
    const parsedValue=Number.parseInt(item.getAttribute('value')||'',10);if(Number.isFinite(parsedValue))number=parsedValue;
    const first=[...item.childNodes].find(n=>(n.nodeType===Node.TEXT_NODE&&n.textContent.trim())||(n.nodeType===Node.ELEMENT_NODE&&!/^(OL|UL)$/.test(n.tagName)&&(n.textContent||'').trim()));
    const explicit=/^\s*[+-]?\d+[.)](?:\s|$)/.test(first?.textContent||'');
    let prior=list.previousSibling;while(prior?.nodeType===Node.TEXT_NODE&&!prior.textContent.trim())prior=prior.previousSibling;
    const priorText=index===0&&!depth&&prior?.nodeType===Node.TEXT_NODE&&prior.textContent.trim();
    const indent='  '.repeat(depth),lineStart=index===0&&(depth||priorText)?'\n':'';
    item.insertBefore(document.createTextNode(lineStart+indent+(explicit?'':number+'. ')),item.firstChild);
    number+=reversed?-1:1;
   }
  });
  copy.querySelectorAll('br').forEach(n=>n.replaceWith(document.createTextNode('\n')));
  copy.querySelectorAll('p,li,h1,h2,h3,h4,h5,h6,pre,blockquote').forEach(n=>{if(n.tagName!=='LI'||!/^(OL|UL)$/.test(n.lastElementChild?.tagName))n.append(document.createTextNode('\n'))});
  return (copy.textContent||'').replace(/\n{3,}/g,'\n\n').trim();
 };
 const conversationMissing=()=>[...document.querySelectorAll('[role="alert"],main h1,main h2,main h3,main p')].some(e=>!e.closest('[data-message-author-role],[data-markdown-text-style],[data-content-search-unit-key]')&&visible(e)&&/^(?:找不到聊天|找不到对话|无法加载对话|Conversation not found|Unable to load conversation)(?:[\s:：。.!].*)?$/i.test((e.textContent||'').trim()));
 const missingResult=()=>({error:'ChatGPT 临时会话失效（找不到聊天）。再次发送将自动重建会话并重新读取字幕。',code:'conversation_missing'});
 const stopping=()=>buttons().some(e=>visible(e)&&(e.matches('[data-testid="stop-button"]')||/停止生成|停止回答|Stop response|Stop generating|^停止$|^Stop$/i.test(label(e))));
 const stopButton=()=>buttons().find(e=>visible(e)&&!e.disabled&&(e.matches('[data-testid="stop-button"]')||/停止生成|停止回答|Stop response|Stop generating|^停止$|^Stop$/i.test(label(e).trim())));
 function wireResponse(requestId,promptFingerprint,onUpdate){
  const token=crypto.randomUUID?.()||Array.from(crypto.getRandomValues(new Uint32Array(4)),v=>v.toString(16)).join('');
  streamDiagnostics={version:bridgeVersion,state:'armed',helperVersion:null};let loggedDelta=false;
  const listener=event=>{let data;try{data=JSON.parse(event.detail)}catch{return;}if(data.token!==token||data.requestId!==requestId)return;
   if(data.status==='ready'){streamDiagnostics.helperVersion=data.version;console.debug('[GPT sidebar] bridge='+bridgeVersion+' stream='+data.version+' visibility='+document.visibilityState);return;}
   if(!['started','delta','done','error'].includes(data.status))return;
   if(data.status==='done'||data.status==='error'||data.status==='delta'&&!loggedDelta){console.debug('[GPT sidebar] '+data.status+' length='+(data.text?.length||0)+' visibility='+document.visibilityState);if(data.status==='delta')loggedDelta=true;}
   streamDiagnostics.state=data.status;streamDiagnostics.updatedAt=Date.now();streamDiagnostics.length=data.text?.length||0;onUpdate(data);
  };
  document.addEventListener('gpt-sidebar-stream-update-v3',listener);
  document.dispatchEvent(new CustomEvent('gpt-sidebar-stream-control-v3',{detail:JSON.stringify({action:'arm',requestId,token,promptFingerprint})}));
  document.dispatchEvent(new CustomEvent('gpt-sidebar-stream-control-v3',{detail:JSON.stringify({action:'probe',requestId,token})}));
  return ()=>{document.removeEventListener('gpt-sidebar-stream-update-v3',listener);document.dispatchEvent(new CustomEvent('gpt-sidebar-stream-control-v3',{detail:JSON.stringify({action:'disarm',requestId,token})}));};
 }
 // Resume observation after a full ChatGPT document reload; never resubmit.
 function resume(m,reply){
  if(busy){reply({pending:true});return;}
  busy=true;const releaseFrames=beginFrames(m.requestId);let done=false,last='',stable=0,emitted='',wireText='',wireBusy=false,wireFailed=false,wireAdvancedAt=Date.now(),bestHandoff='',wireDone=false,wireDoneAt=0,sawStopping=stopping(),unwire=()=>{};const start=Date.now();
  const current=()=>{const response=responses().at(-1),user=messages('user').at(-1);if(!Number.isInteger(m.beforeCount)||responses().length<=m.beforeCount||!response||!user||!m.promptFingerprint||fingerprint(text(user))!==m.promptFingerprint)return '';return user.compareDocumentPosition(response)&Node.DOCUMENT_POSITION_FOLLOWING?text(response):'';};
  const wireQuiet=()=>Date.now()-wireAdvancedAt>=WIRE_STALE_MS;
  const domHandoff=()=>wireQuiet()&&coversWire(current(),wireText);
  currentRequest=m.requestId;readSnapshot=()=>{const dom=current();
   if(wireQuiet()&&coversWire(dom,wireText)&&(!bestHandoff||coversWire(dom,bestHandoff)))bestHandoff=dom;
   // Keep the accepted extension if a render is temporarily virtualized, or
   // the resumed wire has not caught up; never retract already shown text.
   if(bestHandoff&&!coversWire(wireText,bestHandoff))return bestHandoff;
   return wireText&&!domHandoff()&&(!wireFailed||dom.length<wireText.length)?wireText:dom;
  };lastFinal=null;
  const finish=result=>{if(done)return;done=true;clearInterval(timer);clearInterval(heartbeat);observer.disconnect();unwire();releaseFrames();busy=false;if(activeStop?.requestId===m.requestId)activeStop=null;const final={...result,submitted:true};lastFinal=final;void chrome.runtime.sendMessage({type:'assistant:result',requestId:m.requestId,result:final}).catch(()=>{});reply(final)};
  activeStop={requestId:m.requestId,run:()=>{const value=readSnapshot().slice(0,200000),control=stopButton();if(!control)return {error:'ChatGPT 尚未显示停止按钮，无法确认已停止。',retryable:true,stopped:false};control.click();finish({text:value,stopped:true,temporary:temporary()});return {text:value,stopped:true,submitted:true}}};
  const publish=()=>{const value=readSnapshot();if(value&&value!==emitted){emitted=value;void chrome.runtime.sendMessage({type:'assistant:stream',requestId:m.requestId,text:value}).catch(()=>{})}};
  const settle=()=>{if(done)return false;const active=stopping();if(active){sawStopping=true;return false;}if(!composerReady())return false;if(wireDone&&wireText){finish({text:wireText,temporary:temporary(),responseSource:'stream'});return true;}const value=readSnapshot();if(sawStopping&&value&&(!wireBusy||domHandoff())&&(!wireFailed||current().length>=wireText.length)){finish({text:value,temporary:temporary()});return true;}return false;};
  const observer=new MutationObserver(()=>{publish();settle()});observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['aria-label','aria-disabled','data-testid','disabled','class','style','hidden']});
  const heartbeat=setInterval(()=>{void chrome.runtime.sendMessage({type:'assistant:heartbeat',requestId:m.requestId}).catch(()=>{})},5000);
  const timer=setInterval(()=>{if(conversationMissing()){finish(missingResult());return;}const value=readSnapshot();publish();if(settle())return;if(wireDone&&wireText&&Date.now()-wireDoneAt>=WIRE_DONE_STOP_CAP_MS){finish({text:wireText,temporary:temporary(),responseSource:'stream'});return;}if(value&&value===last&&!stopping()&&(!wireBusy||domHandoff())&&(!wireFailed||current().length>=wireText.length))stable++;else stable=0;last=value;if(!wireDone&&stable>=8)finish({text:value,temporary:temporary()});else if(!wireBusy&&Date.now()-start>15000&&document.readyState==='complete'&&composer()&&!(messages('user').some(e=>m.promptFingerprint&&fingerprint(text(e))===m.promptFingerprint)))finish({error:'后台 ChatGPT 已变成新聊天，原问题和回答不在当前页面。无法继续回传；请重新发送问题。后台页已保留。'});else if(Date.now()-start>180000)finish({error:'重新连接后仍未读取到完整回答；后台会话已保留。'})},250);
  unwire=wireResponse(m.requestId,m.promptFingerprint,data=>{if(done)return;wireBusy=data.status==='started'||data.status==='delta';if(data.status==='error')wireFailed=true;if(typeof data.text==='string'&&data.text){if(data.text!==wireText)wireAdvancedAt=Date.now();wireText=data.text.slice(0,200000);}else if(data.status==='started')wireAdvancedAt=Date.now();publish();if(data.status==='done'&&wireText){wireDone=true;wireDoneAt=Date.now();wireBusy=false;settle();}});if(done)unwire();
 }
 chrome.runtime.onMessage.addListener((m,s,reply)=>{
  if(s.id!==chrome.runtime.id)return;
  if(m.type==='assistant:snapshot'){pulseFrames();const matches=m.requestId===currentRequest;reply({requestId:currentRequest,text:matches?readSnapshot().slice(0,200000):'',busy,result:matches?lastFinal:null,transport:{...streamDiagnostics,domLength:text(responses().at(-1)).length,stopping:stopping()}});return;}
  if(m.type==='assistant:privacy'){revealBackendTools();reply({bridgeVersion,temporary:temporary(),conversationMissing:conversationMissing(),contextMatches:m.promptFingerprint?messages('user').some(e=>fingerprint(text(e))===m.promptFingerprint):undefined});return;}
  if(m.type==='assistant:stop'){
   if(m.requestId!==currentRequest||!busy||activeStop?.requestId!==m.requestId){reply(lastFinal&&m.requestId===currentRequest?lastFinal:{text:'',stopped:true});return;}
   reply(activeStop.run());return;
  }
  if(m.type==='assistant:resume'){resume(m,reply);return true;}
  if(m.type!=='assistant:ask')return;
  revealBackendTools();
  if(conversationMissing()){reply(missingResult());return;}
  if(busy){reply({error:'ChatGPT 正在回答，请稍后再试。'});return;}
  const editor=composer();
  if(!editor){reply({error:'ChatGPT 页面尚未准备好。请确认已在 Chrome 登录 ChatGPT。',retryable:true});return;}
  if(!temporary()){
   // The requested URL may hydrate as normal chat first. Activate only an
   // empty root composer in our dedicated tab; never convert an existing chat.
   const empty=!(editor.value||editor.innerText||editor.textContent||'').trim();
   const enable=buttons().find(e=>visible(e)&&!e.disabled&&/^(临时聊天|Temporary chat)$/i.test(label(e).trim()));
   if(enable&&empty&&location.pathname==='/'&&!messages('user').length&&!responses().length)enable.click();
   // Even after clicking, wait for the affirmative control on the next retry.
   // No prompt is written while privacy is unconfirmed.
   reply({error:'未确认 ChatGPT 临时聊天，正在等待开启；尚未填入或发送内容。',retryable:true});return;
  }
  // During initial hydration the SSR editor exists but its controls are disabled.
  const controls=buttons().filter(e=>visible(e)&&/添加文件|添加照片|Add files|Add photos|选择 ChatGPT 模型|听写|Dictate/i.test(label(e)));
  if(controls.length&&!controls.some(e=>!e.disabled)){reply({error:'ChatGPT 页面正在加载。',retryable:true});return;}
  if((editor.value||editor.innerText||editor.textContent||'').trim()){reply({error:'专用 ChatGPT 标签页已有草稿，已停止，避免覆盖。'});return;}
  if(typeof m.text!=='string'||!m.text.trim()||m.text.length>70000){reply({error:'发送内容为空或太长，已停止。'});return;}
  if(stopping()){reply({error:'ChatGPT 正在处理另一个回答，请稍后再试。'});return;}
  busy=true;const releaseFrames=beginFrames(m.requestId);currentRequest=m.requestId;readSnapshot=()=>'';lastFinal=null;const before=responses().map(text);
  editor.focus();
  if(editor.tagName==='TEXTAREA')Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(editor,m.text);
  else{
   const range=document.createRange();range.selectNodeContents(editor);
   const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
   if(!document.execCommand?.('insertText',false,m.text))editor.textContent=m.text;
  }
  editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:m.text}));
  const compact=value=>value.replace(/\s+/g,'');
  if(compact(editor.value||editor.innerText||editor.textContent||'')!==compact(m.text)){releaseFrames();busy=false;reply({error:'字幕文本未完整写入输入框，已停止发送。'});return;}
  let done=false,submitted=false,readyTimer,answerTimer,heartbeatTimer,observer,unwire=()=>{};
  const finish=result=>{if(done)return;done=true;clearInterval(readyTimer);clearInterval(answerTimer);clearInterval(heartbeatTimer);observer?.disconnect();unwire();releaseFrames();busy=false;if(activeStop?.requestId===m.requestId)activeStop=null;const final={...result,submitted};lastFinal=final;void chrome.runtime.sendMessage({type:'assistant:result',requestId:m.requestId,result:final}).catch(()=>{});reply(final)};
  activeStop={requestId:m.requestId,run:()=>{const value=readSnapshot().slice(0,200000);if(submitted){const control=stopButton();if(!control)return {error:'ChatGPT 尚未显示停止按钮，无法确认已停止。',retryable:true,stopped:false};control.click();}else if(compact(editor.value||editor.innerText||editor.textContent||'')===compact(m.text)){if(editor.tagName==='TEXTAREA')Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(editor,'');else editor.textContent='';editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'deleteContentBackward',data:null}));}finish({text:value,stopped:true,temporary:temporary()});return {text:value,stopped:true,submitted}}};
  const readyStart=Date.now();
  readyTimer=setInterval(()=>{
   if(done)return;
   if(!temporary()){finish({error:'临时聊天已退出，已停止发送。'});return;}
   const send=buttons().find(e=>visible(e)&&!e.disabled&&(e.matches('[data-testid="send-button"]')||/^(发送|发送提示|Send|Send message|Send prompt)$/i.test(label(e).trim())));
   if(!send){if(Date.now()-readyStart>15000)finish({error:'ChatGPT 发送按钮未就绪，已停止；请检查登录或网页验证。'});return;}
   clearInterval(readyTimer);
   if(compact(editor.value||editor.innerText||editor.textContent||'')!==compact(m.text)){finish({error:'输入内容在发送前发生变化，已停止。'});return;}
   let last='',stable=0,emitted='',wireText='',wireBusy=false,wireFailed=false,wireAdvancedAt=Date.now(),bestHandoff='',wireDone=false,wireDoneAt=0,sawStopping=false;const start=Date.now();
   const domSnapshot=()=>{const r=responses(),value=text(r.at(-1));return r.length>before.length||value!==before.at(-1)?value:'';};
   const wireQuiet=()=>Date.now()-wireAdvancedAt>=WIRE_STALE_MS;
   const domHandoff=()=>wireQuiet()&&coversWire(domSnapshot(),wireText);
   currentRequest=m.requestId;readSnapshot=()=>{const dom=domSnapshot();
   if(wireQuiet()&&coversWire(dom,wireText)&&(!bestHandoff||coversWire(dom,bestHandoff)))bestHandoff=dom;
   // Keep the accepted extension if a render is temporarily virtualized, or
   // the resumed wire has not caught up; never retract already shown text.
   if(bestHandoff&&!coversWire(wireText,bestHandoff))return bestHandoff;
   return wireText&&!domHandoff()&&(!wireFailed||dom.length<wireText.length)?wireText:dom;
   };
   const publish=()=>{const value=readSnapshot();if(value&&value!==emitted){emitted=value;void chrome.runtime.sendMessage({type:'assistant:stream',requestId:m.requestId,text:value}).catch(()=>{})}};
   const settle=()=>{if(done)return false;const active=stopping();if(active){sawStopping=true;return false;}if(!composerReady())return false;if(wireDone&&wireText){finish({text:wireText,temporary:temporary(),responseSource:'stream'});return true;}const value=readSnapshot();if(sawStopping&&value&&(!wireBusy||domHandoff())&&(!wireFailed||domSnapshot().length>=wireText.length)){finish({text:value,temporary:temporary()});return true;}return false;};
   unwire=wireResponse(m.requestId,fingerprint(m.text),data=>{if(done)return;wireBusy=data.status==='started'||data.status==='delta';if(data.status==='error')wireFailed=true;if(typeof data.text==='string'&&data.text){if(data.text!==wireText)wireAdvancedAt=Date.now();wireText=data.text.slice(0,200000);}else if(data.status==='started')wireAdvancedAt=Date.now();publish();if(data.status==='done'&&wireText){wireDone=true;wireDoneAt=Date.now();wireBusy=false;settle();}});
   if(done)return;submitted=true;send.click();if(done){unwire();return;}
   void chrome.runtime.sendMessage({type:'assistant:submitted',requestId:m.requestId,beforeCount:before.length,promptFingerprint:fingerprint(m.text)}).catch(()=>{});
   heartbeatTimer=setInterval(()=>{void chrome.runtime.sendMessage({type:'assistant:heartbeat',requestId:m.requestId}).catch(()=>{})},5000);
   if(done)return;
   sawStopping=stopping();observer=new MutationObserver(()=>{publish();settle()});observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['aria-label','aria-disabled','data-testid','disabled','class','style','hidden']});
   answerTimer=setInterval(()=>{
    if(conversationMissing()){finish(missingResult());return;}
    const value=readSnapshot();
    publish();if(settle())return;if(wireDone&&wireText&&Date.now()-wireDoneAt>=WIRE_DONE_STOP_CAP_MS){finish({text:wireText,temporary:temporary(),responseSource:'stream'});return;}if(value&&value===last&&!stopping()&&(!wireBusy||domHandoff())&&(!wireFailed||domSnapshot().length>=wireText.length))stable++;else stable=0;last=value;
    if(!wireDone&&stable>=8)finish({text:value,temporary:temporary()});
    else if(Date.now()-start>180000)finish({error:'ChatGPT 回答读取超时；后台会话已保留，当前文字也已保留。'});
   },250);
  },500);
  return true;
 });
 void chrome.runtime.sendMessage({type:'assistant:ready'}).catch(()=>{});
})();
