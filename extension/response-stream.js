(()=>{
 const CONTROL='gpt-sidebar-stream-control-v3',UPDATE='gpt-sidebar-stream-update-v3';
 const MAX_TEXT=200000,MAX_PENDING=1024*1024;
 const nativeFetch=window.fetch;
 if(typeof nativeFetch!=='function')return;
 if(window.__gptSidebarResponseStreamVersion==='0.11.2')return;
 window.__gptSidebarResponseStreamVersion='0.11.2';
 const NativePromise=window.Promise,NativeTextDecoder=window.TextDecoder;
 let session=null;
 const pending=new Set();

 const fingerprint=value=>{let hash=2166136261;for(const char of String(value).replace(/\s+/g,''))hash=Math.imul(hash^char.charCodeAt(0),16777619);return (hash>>>0).toString(16)};
 const keyOf=value=>value.requestId+'\n'+value.promptFingerprint;
 const validArm=value=>value&&value.action==='arm'&&typeof value.requestId==='string'&&value.requestId.length>0&&value.requestId.length<=256&&typeof value.token==='string'&&value.token.length>0&&value.token.length<=512&&/^[0-9a-f]+$/i.test(value.promptFingerprint||'');
 const emit=(owner,status,text='')=>{
  if(session!==owner||!owner.token)return;
  document.dispatchEvent(new CustomEvent(UPDATE,{detail:JSON.stringify({token:owner.token,requestId:owner.requestId,text:String(text).slice(0,MAX_TEXT),status})}));
 };
 const replay=owner=>{
  if(!owner.matched)return;
  emit(owner,'started');
  if(owner.status==='done'||owner.status==='error')emit(owner,owner.status,owner.text);
  else if(owner.text)emit(owner,'delta',owner.text);
 };
 const invalidate=owner=>{
  owner.token=null;
  owner.observer?.stop();
  for(const item of pending)if(item.owner===owner)item.stop();
 };

 document.addEventListener(CONTROL,event=>{
  if(typeof event.detail!=='string')return;
  let value;try{value=JSON.parse(event.detail)}catch{return}
  if(value?.action==='probe'&&typeof value.token==='string'&&typeof value.requestId==='string'){
   document.dispatchEvent(new CustomEvent(UPDATE,{detail:JSON.stringify({token:value.token,requestId:value.requestId,status:'ready',text:'',version:'0.11.2'})}));return;
  }
  if(value?.action==='disarm'){
   if(session&&typeof value.token==='string'&&value.token===session.token&&(!value.requestId||value.requestId===session.requestId))session.token=null;
   return;
  }
  if(!validArm(value))return;
  const key=keyOf(value);
  if(session&&session.key===key){session.token=value.token;replay(session);return;}
  if(session)invalidate(session);
  session={key,requestId:value.requestId,promptFingerprint:value.promptFingerprint.toLowerCase(),token:value.token,matched:false,text:'',status:null,observer:null};
 },false);

 const requestInfo=(input,init)=>{
  let url,method,bodyTask;
  try{
   url=new URL(typeof input==='string'||input instanceof URL?String(input):input.url,location.href);
   method=String(init?.method||(typeof Request!=='undefined'&&input instanceof Request?input.method:'GET')).toUpperCase();
   if(url.origin!==location.origin||method!=='POST'||!/^\/backend-api\/(?:f\/)?conversation\/?$/.test(url.pathname))return null;
   if(init&&Object.prototype.hasOwnProperty.call(init,'body')){
    if(typeof init.body!=='string')return null;
    bodyTask=NativePromise.resolve(init.body);
   }else if(typeof Request!=='undefined'&&input instanceof Request){
    bodyTask=input.clone().text();
   }else return null;
  }catch{return null}
  return {bodyTask};
 };
 const bodyFingerprint=async task=>{
  let raw;try{raw=await task}catch{return null}
  let data;try{data=JSON.parse(raw)}catch{return null}finally{raw=''}
  const messages=Array.isArray(data?.messages)?data.messages:[];
  for(let i=messages.length-1;i>=0;i--){
   const message=messages[i],parts=message?.content?.parts;
   if(message?.author?.role!=='user'||!Array.isArray(parts)||!parts.length||!parts.every(part=>typeof part==='string'))continue;
   return fingerprint(parts.join(''));
  }
  return null;
 };

 function makeObserver(owner,response,authTask){
  let reader=null,stopped=false,attached=false,unsupported=false,buffer='',eligible=false,text='',ended=false,transportError=false,complete=false,stickyPath=null,stickyOp=null,missingDelta=false;
  const observer={owner,stop(){if(stopped)return;stopped=true;pending.delete(observer);try{const cancelled=reader?reader.cancel():response.body?.cancel();void cancelled?.catch(()=>{})}catch{}}};
  pending.add(observer);
  const active=()=>!stopped&&session===owner;
  const publish=value=>{text=String(value).slice(0,MAX_TEXT);owner.text=text;if(attached&&text)emit(owner,'delta',text)};
  const canonical=frame=>{
   if(!frame||typeof frame!=='object'||Array.isArray(frame)||!Object.prototype.hasOwnProperty.call(frame,'message'))return false;
   const message=frame.message;
   if(!message||typeof message!=='object'){eligible=false;return true;}
   const content=message.content,parts=content?.parts;
   if(message.author?.role!=='assistant'||message.channel!=null&&message.channel!=='final'||message.recipient!=null&&message.recipient!=='all'||content?.content_type!=='text'||!Array.isArray(parts)||!parts.every(part=>typeof part==='string')){eligible=false;return true;}
   eligible=true;complete=message.status==='finished_successfully'||message.end_turn===true;missingDelta=false;publish(parts.join(''));return true;
  };
  const onePatch=(patch,prefix='')=>{
   if(!patch||typeof patch!=='object'||Array.isArray(patch))return false;
   const path=prefix+(typeof patch.p==='string'?patch.p:'');
   if(patch.o==='patch'&&Array.isArray(patch.v)){
    // A batch can carry bookkeeping patches beside the visible text patch.
    // Validate the envelope first, then apply only the exact text path.
    if(!patch.v.every(item=>item&&typeof item==='object'&&!Array.isArray(item)&&typeof item.p==='string'&&typeof item.o==='string'))return false;
    for(const item of patch.v)onePatch(item,path);
    return true;
   }
   if((path===''||path==='/message')&&['add','replace'].includes(patch.o)&&patch.v&&typeof patch.v==='object')return canonical(path==='/message'?{message:patch.v}:patch.v);
   if(path==='/message/channel'&&patch.v!=='final'||path==='/message/author/role'&&patch.v!=='assistant'||path==='/message/recipient'&&patch.v!=='all'){eligible=false;return true;}
   if(path==='/message/status'&&patch.v==='finished_successfully'&&eligible){complete=true;return true;}
   if(path==='/message/end_turn'&&patch.v===true&&eligible){complete=true;return true;}
   if(path==='/message/content/parts/0'&&['append','replace'].includes(patch.o)&&typeof patch.v==='string'){
    if(prefix===''){stickyPath=path;stickyOp=patch.o;}if(eligible)publish(patch.o==='append'?text+patch.v:patch.v);return true;
   }
   return false;
  };
  const frame=(data,eventType)=>{
   if(data==='[DONE]'){ended=true;complete=true;return;}
   let value;try{value=JSON.parse(data)}catch{unsupported=true;return}
   if(canonical(value))return;
   // v1 delta encoding inherits BOTH the path and operation, including
   // root 'add' envelopes for a new message (not just text append strings).
   // Metadata outside delta events must never alter that inherited envelope.
   if(eventType==='delta'&&value&&typeof value==='object'&&!Array.isArray(value)&&Object.prototype.hasOwnProperty.call(value,'v')){
    if(typeof value.p==='string')stickyPath=value.p;
    if(typeof value.o==='string')stickyOp=value.o;
    if(stickyPath!==null&&stickyOp!==null)value={...value,p:stickyPath,o:stickyOp};
   }
   if(onePatch(value))return;
   // Compressed delta frames may reuse the previous explicit text append path.
   // Only accept this form in a delta event with an established final-message
   // baseline; a generic JSON string never becomes an answer.
   if(eventType==='delta'&&eligible&&stickyPath==='/message/content/parts/0'&&stickyOp==='append'&&value&&Object.keys(value).length===1&&typeof value.v==='string'){publish(text+value.v);return;}
   if(eligible&&value&&typeof value.v==='string'&&!value.p&&!value.o)missingDelta=true;
   // Protocol metadata is not answer text. Unknown JSON never becomes output.
  };
  const eventBlock=block=>{
   const values=[];let eventType='message';
   for(const line of block.split(/\r?\n/)){if(line.startsWith('data:'))values.push(line.slice(5).replace(/^ /,''));else if(line.startsWith('event:'))eventType=line.slice(6).trim();}
   if(values.length)frame(values.join('\n'),eventType);
  };
  const feed=(chunk,flush=false)=>{
   buffer+=chunk;
   if(buffer.length>MAX_PENDING){unsupported=true;return;}
   let match;
   while((match=/\r?\n\r?\n/.exec(buffer))){const block=buffer.slice(0,match.index);buffer=buffer.slice(match.index+match[0].length);eventBlock(block);if(ended||unsupported)return;}
   if(flush&&buffer.trim()){eventBlock(buffer);buffer='';}
  };
  const attach=()=>{
   if(!active())return observer.stop();
   attached=true;owner.matched=true;owner.observer=observer;owner.status=null;owner.text=text;
   emit(owner,'started');
   if(owner.status)emit(owner,owner.status,text);else if(text)emit(owner,'delta',text);
  };
  void (async()=>{
   try{
    const identity=await bodyFingerprint(authTask);
    if(!active()||identity!==owner.promptFingerprint){observer.stop();return;}
    attach();
    if(!response?.body||typeof response.body.getReader!=='function'){unsupported=true;return;}
    reader=response.body.getReader();const decoder=new NativeTextDecoder();
    while(active()&&!stopped&&!ended&&!unsupported){const part=await reader.read();if(part.done){feed(decoder.decode(),true);ended=true;break}feed(decoder.decode(part.value,{stream:true}));}
   }catch{transportError=true}
   finally{
    pending.delete(observer);
    if(stopped)return;
    if(unsupported){owner.status='error';if(attached&&active())emit(owner,'error',text);observer.stop();return;}
    if(transportError){owner.status='error';if(attached&&active())emit(owner,'error',text);return;}
    if(ended&&text&&complete&&!missingDelta){owner.status='done';owner.text=text;if(attached&&active())emit(owner,'done',text);}
    else if(ended){owner.status='error';if(attached&&active())emit(owner,'error',text);}
   }
  })();
  return observer;
 }

 window.fetch=function(...args){
  const owner=session,info=owner?requestInfo(args[0],args[1]):null;
  const result=Reflect.apply(nativeFetch,this,args);
  if(owner&&info)NativePromise.resolve(result).then(response=>{
   if(session!==owner)return;
   let copy;try{copy=response.clone()}catch{return}
   makeObserver(owner,copy,info.bodyTask);
  },()=>{});
  return result;
 };
})();
