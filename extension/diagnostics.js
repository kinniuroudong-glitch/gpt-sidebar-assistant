(async()=>{
 const out=document.getElementById('log'),status=document.getElementById('status'),started=Date.now(),lines=[];
 const log=(stage,detail)=>{lines.push({ms:Date.now()-started,stage,...detail});out.textContent=JSON.stringify(lines,null,2)};
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 async function trial(stage,options){const start=Date.now();const before=await chrome.tabs.get(options.target.tabId).catch(()=>({}));log(stage+' start',{url:before.url,status:before.status});let timer;try{const result=await Promise.race([chrome.scripting.executeScript({...options,injectImmediately:true}),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('10s timeout')),10000))]);log(stage,{elapsed:Date.now()-start,documentId:result[0]?.documentId,result:result[0]?.result});return result[0]?.result;}catch(e){log(stage,{elapsed:Date.now()-start,error:e.message});return null;}finally{clearTimeout(timer)}}
 const source=Number(new URL(location.href).searchParams.get('source'));
 let helper;
 try{
  const tab=await chrome.tabs.get(source);const u=new URL(tab.url),videoId=u.searchParams.get('v')||u.pathname.match(/^\/(?:shorts|live)\/([^/]+)/)?.[1];if(!videoId)throw Error('Source is not a video');
  const url='https://www.youtube.com/watch?v='+videoId;log('source',{videoId,version:chrome.runtime.getManifest().version});
  helper=await chrome.tabs.create({windowId:tab.windowId,url:'https://downsub.com/?url='+encodeURIComponent(url),active:false});
  for(let i=0;i<20;i++){const t=await chrome.tabs.get(helper.id);if(t.url?.startsWith('https://downsub.com/')){log('initial tab',{status:t.status,url:t.url});break;}await wait(500);}
  const target={tabId:helper.id};
  await trial('MAIN async DOM probe',{target,world:'MAIN',func:async()=>({href:location.href,ready:document.readyState,raw:[...document.querySelectorAll('button.download-button[data-title^="[RAW]"]')].slice(0,5).map(e=>e.getAttribute('data-title'))})});
  const probe=()=>({ready:document.readyState,raw:[...document.querySelectorAll('button.download-button[data-title^="[RAW]"]')].slice(0,5).map(e=>e.getAttribute('data-title'))});
  await trial('ISOLATED sync probe',{target,world:'ISOLATED',func:probe});
  await trial('MAIN sync probe',{target,world:'MAIN',func:probe});
  await trial('MAIN async after initial probes',{target,world:'MAIN',func:async()=>({href:location.href,ready:document.readyState,raw:[...document.querySelectorAll('button.download-button[data-title^="[RAW]"]')].slice(0,5).map(e=>e.getAttribute('data-title'))})});
  let data;
  for(let i=0;i<40;i++){
   data=await trial('ISOLATED controls',{target,world:'ISOLATED',func:()=>{const buttons=[...document.querySelectorAll('button.download-button[data-title^="[RAW]"]')];const button=buttons.find(e=>/^\[RAW\]\s*Thai(?:\s*\(|$)/i.test(e.getAttribute('data-title'))&&e.closest('.layout')?.classList.contains('align-center'));return button?{title:button.getAttribute('data-title'),ready:document.readyState}:null;}});
   if(data)break;await wait(500);
  }
  if(!data)throw Error('No RAW controls');
  await trial('ISOLATED click',{target,world:'ISOLATED',args:[data.title],func:title=>{const b=[...document.querySelectorAll('button.download-button[data-title^="[RAW]"]')].find(e=>e.getAttribute('data-title')===title);if(!b)throw Error('button missing');b.click();return true;}});
  let raw;
  for(let i=0;i<30;i++){
   const t=await chrome.tabs.get(helper.id);if(t.url?.startsWith('https://subtitle.downsub.com/raw/')){
    raw=await trial('ISOLATED RAW text',{target,world:'ISOLATED',func:()=>{const value=document.querySelector('body > pre')?.textContent||'';return value?{characters:value.length,lines:value.split('\n').length,plainText:true,serviceError:/^(?:503|Service Unavailable|Bad Gateway|Gateway Timeout)/i.test(value.trim()),thai:/[\u0E00-\u0E7F]/.test(value)}:null;}});if(raw)break;
   }
   await wait(500);
  }
  if(!raw||raw.serviceError)throw Error('RAW text unavailable');status.textContent='已读取字幕';log('COMPLETE',raw);
 }catch(e){status.textContent='测试未通过';log('FAILED',{error:e.message});}
 finally{if(helper)await chrome.tabs.remove(helper.id).catch(()=>{});log('helper closed',{});}
})();
