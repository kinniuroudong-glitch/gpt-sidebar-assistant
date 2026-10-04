// Installed with the extension, so a loading page never waits for a dynamic
// scripting injection to finish. Only the worker can request extraction.
chrome.runtime.onMessage.addListener((m,s,reply)=>{
 if(s.id!==chrome.runtime.id||s.tab||!['downsub:probe','downsub:click'].includes(m.type))return;
 try{
  if(m.type==='downsub:probe'){
   if(m.phase==='entry'){reply({data:readDownsubExport(m.videoUrl,m.languageCode)});return;}
   if(location.hostname!=='subtitle.downsub.com'||!location.pathname.startsWith('/raw/'))throw Error('字幕正文页面已变化。');
   const pre=document.querySelector('body > pre');
   reply({data:pre?pre.textContent:document.contentType==='text/plain'?document.body?.innerText:null});return;
  }
  const data=readDownsubExport(m.videoUrl,m.languageCode);
  if(!data.rawTitle||data.rawTitle!==m.rawTitle)throw Error('字幕入口已变化。');
  const button=[...document.querySelectorAll('button.download-button[data-title^="[RAW]"]')].find(e=>e.getAttribute('data-title')===m.rawTitle&&e.closest('.layout')?.classList.contains('align-center'));
  if(!button||button.disabled)throw Error('字幕按钮已消失。');
  // Reply before the RAW navigation destroys this document's message channel.
  reply({data:true});setTimeout(()=>button.click(),0);
 }catch(e){reply({error:e.message});}
});
