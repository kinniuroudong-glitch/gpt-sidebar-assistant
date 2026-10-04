(()=>{
 const KEY='__gptSidebarBackgroundFramesV1',VERSION='1.0.0';
 const previous=globalThis[KEY];
 if(previous?.version===VERSION&&previous.requestAnimationFrame===globalThis.requestAnimationFrame&&previous.cancelAnimationFrame===globalThis.cancelAnimationFrame)return;
 try{previous?.dispose?.()}catch{}

 const root=globalThis,doc=document;
 const nativeRequest=root.requestAnimationFrame,nativeCancel=root.cancelAnimationFrame;
 const nativeSetTimeout=root.setTimeout,nativeClearTimeout=root.clearTimeout;
 if(typeof nativeRequest!=='function'||typeof nativeCancel!=='function'||typeof nativeSetTimeout!=='function'||typeof nativeClearTimeout!=='function')return;

 const CONTROL='gpt-sidebar-frames-control-v1';
 const FALLBACK_MS=200,MAX_BATCH=100,MAX_PENDING=4096;
 const records=new Map();
 let session=null,race=null,nextVirtual=-1,epoch=0,disposed=false,passthroughDepth=0;

 const identity=value=>value&&typeof value.requestId==='string'&&value.requestId.length>0&&value.requestId.length<=256&&typeof value.token==='string'&&value.token.length>0&&value.token.length<=512;
 const matches=(value,owner)=>identity(value)&&!!owner&&value.requestId===owner.requestId&&value.token===owner.token;
 const now=()=>{try{return root.performance?.now?.()??Date.now()}catch{return Date.now()}};
 const report=error=>{
  try{if(typeof root.reportError==='function'){root.reportError(error);return}}catch{}
  nativeSetTimeout.call(root,()=>{throw error},0);
 };
 const invoke=(record,timestamp,transferred=false)=>{
  if(transferred)passthroughDepth++;
  try{Reflect.apply(record.callback,root,[timestamp])}catch(error){report(error)}
  finally{if(transferred)passthroughDepth--}
 };
 const queuedFor=owner=>{
  const result=[];
  for(const [id,record] of records)if(record.state==='queued'&&record.owner===owner)result.push(id);
  return result;
 };
 const stopRace=()=>{
  const current=race;if(!current)return;
  race=null;epoch++;
  if(current.nativeId!==null)try{Reflect.apply(nativeCancel,root,[current.nativeId])}catch{}
  if(current.timerId!==null)try{Reflect.apply(nativeClearTimeout,root,[current.timerId])}catch{}
 };
 const transfer=record=>{
  if(record.state!=='queued')return;
  record.state='native';
  try{
   record.nativeId=Reflect.apply(nativeRequest,root,[timestamp=>{
    if(records.get(record.id)!==record||record.state!=='native')return;
    records.delete(record.id);invoke(record,timestamp,true);
   }]);
  }catch(error){records.delete(record.id);report(error)}
 };
 const transferOwner=owner=>{for(const id of queuedFor(owner)){const record=records.get(id);if(record)transfer(record)}};
 const runBatch=(owner,timestamp)=>{
  const batch=queuedFor(owner).slice(0,MAX_BATCH);
  for(const id of batch){
   const record=records.get(id);
   if(!record||record.state!=='queued'||record.owner!==owner)continue;
   records.delete(id);invoke(record,timestamp);
  }
 };
 const winRace=(owner,id,timestamp)=>{
  if(!race||race.epoch!==id||race.owner!==owner||session!==owner)return;
  stopRace();runBatch(owner,Number.isFinite(timestamp)?timestamp:now());ensureRace();
 };
 function ensureRace(){
  if(disposed||race||!session||!queuedFor(session).length)return;
  const owner=session,id=++epoch,current={owner,epoch:id,nativeId:null,timerId:null};race=current;
  try{current.nativeId=Reflect.apply(nativeRequest,root,[timestamp=>winRace(owner,id,timestamp)])}catch{}
  try{current.timerId=Reflect.apply(nativeSetTimeout,root,[()=>winRace(owner,id,now()),FALLBACK_MS])}catch{}
 }
 const allocate=()=>{
  let id=nextVirtual--;
  if(nextVirtual<Number.MIN_SAFE_INTEGER+1)nextVirtual=-1;
  while(records.has(id)){id=nextVirtual--;if(nextVirtual<Number.MIN_SAFE_INTEGER+1)nextVirtual=-1}
  return id;
 };

 function wrappedRequest(callback){
  if(disposed||!session||passthroughDepth)return Reflect.apply(nativeRequest,this,arguments);
  if(typeof callback!=='function')throw new TypeError("Failed to execute 'requestAnimationFrame': callback must be a function");
  const id=allocate(),record={id,callback,owner:session,state:'queued',nativeId:null};records.set(id,record);
  // Keep the virtual namespace even under an abusive queue; overflow returns
  // to the browser scheduler and cannot enlarge the fallback batch.
  if(queuedFor(session).length>MAX_PENDING)transfer(record);else ensureRace();
  return id;
 }
 function wrappedCancel(handle){
  const record=records.get(handle);
  if(record){
   records.delete(handle);
   if(record.state==='native')try{Reflect.apply(nativeCancel,this,[record.nativeId])}catch{}
   if(record.state==='queued'&&session===record.owner&&!queuedFor(record.owner).length)stopRace();
   return;
  }
  if(typeof handle==='number'&&handle<0)return;
  return Reflect.apply(nativeCancel,this,arguments);
 }

 const drainOnDisarm=owner=>{
  stopRace();
  // Clear ownership before invoking callbacks. A callback that queues another
  // frame therefore receives the browser's native handle and is not drained
  // recursively as part of the completed assistant request.
  session=null;
  runBatch(owner,now());
  transferOwner(owner);
 };
 const onControl=event=>{
  if(disposed||typeof event.detail!=='string')return;
  let value;try{value=JSON.parse(event.detail)}catch{return}
  if(!identity(value))return;
  if(value.action==='arm'){
   if(matches(value,session))return;
   const old=session;if(old){session=null;stopRace();transferOwner(old)}
   session={requestId:value.requestId,token:value.token};
   return;
  }
  if(value.action==='pulse'){
   if(!matches(value,session)||!queuedFor(session).length)return;
   const owner=session;stopRace();runBatch(owner,now());ensureRace();
   return;
  }
  if(value.action==='disarm'&&matches(value,session))drainOnDisarm(session);
 };

 root.requestAnimationFrame=wrappedRequest;
 root.cancelAnimationFrame=wrappedCancel;
 doc.addEventListener(CONTROL,onControl,false);

 const controller=Object.freeze({
  version:VERSION,requestAnimationFrame:wrappedRequest,cancelAnimationFrame:wrappedCancel,
  dispose(){
   if(disposed)return;
   disposed=true;doc.removeEventListener(CONTROL,onControl,false);stopRace();
   const owner=session;session=null;if(owner)transferOwner(owner);
   if(root.requestAnimationFrame===wrappedRequest)root.requestAnimationFrame=nativeRequest;
   if(root.cancelAnimationFrame===wrappedCancel)root.cancelAnimationFrame=nativeCancel;
   try{if(root[KEY]===controller)delete root[KEY]}catch{}
  }
 });
 try{Object.defineProperty(root,KEY,{value:controller,writable:true,configurable:true})}catch{try{root[KEY]=controller}catch{}}
})();
