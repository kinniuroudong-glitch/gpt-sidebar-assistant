/* Runs only when the sidebar requests the active document. Never reads forms. */
function extractPage() {
  const url = location.href;
  const youtube = /(^|\.)youtube\.com$/.test(location.hostname) && /^\/(watch|shorts\/|live\/)/.test(location.pathname);
  const roots = [...document.querySelectorAll('article,main,[role="main"]')];
  const root = roots.sort((a,b)=>(b.innerText||'').length-(a.innerText||'').length)[0] || document.body;
  const copy = root.cloneNode(true);
  copy.querySelectorAll('script,style,noscript,nav,header,footer,aside,form,input,textarea,select,[contenteditable],button,[hidden],[aria-hidden="true"]').forEach(n=>n.remove());
  const text = (copy.innerText || copy.textContent || '').replace(/\n[ \t]+/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  const tracks = [...document.querySelectorAll('video')].flatMap(v=>[...v.textTracks].flatMap(t=>[...(t.cues||[])].map(c=>c.text))).join('\n');
  return {url,title:document.title,type:youtube?'youtube':document.querySelector('video')?'video':'page',text:text.slice(0,60000),truncated:text.length>60000,captions:tracks.slice(0,60000)};
}
