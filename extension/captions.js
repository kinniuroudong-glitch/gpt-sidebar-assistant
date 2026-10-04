// Runs in the page's MAIN world so the site's current player metadata is readable.
function readYoutubeCaptionLanguage(expectedUrl) {
 const idOf=value=>{try{const u=new URL(value),id=u.searchParams.get('v')||u.pathname.match(/^\/(?:shorts|live)\/([^/]+)/)?.[1];return id||null}catch{return null}};
 const expected=idOf(expectedUrl),current=idOf(location.href);if(!expected||expected!==current)return {languageCode:null};
 const candidates=[];for(const player of document.querySelectorAll('#movie_player, .html5-video-player')){try{candidates.push(player.getPlayerResponse?.())}catch{}}candidates.push(window.ytInitialPlayerResponse);
 const response=candidates.find(p=>p?.videoDetails?.videoId===expected&&p.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length);const list=response?.captions?.playerCaptionsTracklistRenderer,tracks=list?.captionTracks||[];
 const code=t=>String(t?.languageCode||'').toLowerCase().split('-')[0],original=t=>{try{const u=new URL(t.baseUrl);return u.protocol==='https:'&&(u.hostname==='youtube.com'||u.hostname.endsWith('.youtube.com'))&&u.pathname==='/api/timedtext'&&!u.searchParams.has('tlang')}catch{return false}};
 const usable=tracks.filter(original),unique=xs=>[...new Set(xs.filter(Boolean))];const originalAudio=()=>{const formats=[...(response?.streamingData?.adaptiveFormats||[]),...(response?.streamingData?.formats||[])],seen=new Map();for(const f of formats){const a=f?.audioTrack;if(!a)continue;const id=a.id||a.audioTrackId;if(!id||seen.has(id))continue;seen.set(id,a)}const audios=[...seen.values()],labelled=audios.filter(a=>/original|原始|オリジナル|ต้นฉบับ/i.test(String(a.displayName||a.name||''))),nonDubbed=audios.filter(a=>a.isAutoDubbed!==true),pick=labelled.length===1?labelled:labelled.length>1?[]:(audios.some(a=>a.isAutoDubbed===true)&&nonDubbed.length===1?nonDubbed:[]);if(pick.length!==1)return null;const candidate=String(pick[0].id||pick[0].audioTrackId||'').split('.')[0].toLowerCase().split('-')[0];return usable.some(t=>code(t)===candidate)?candidate:null};const sourceAudio=originalAudio();if(sourceAudio)return {languageCode:sourceAudio,evidence:'original audio'};const asr=unique(usable.filter(t=>t.kind==='asr').map(code));
 if(asr.length===1)return {languageCode:asr[0],evidence:'unique automatic original track'};
 const audio=String(response?.videoDetails?.defaultAudioLanguage||'').toLowerCase().split('-')[0];if(audio&&usable.some(t=>code(t)===audio))return {languageCode:audio,evidence:'videoDetails.defaultAudioLanguage'};
 const audioTracks=list?.audioTracks||[],defaultAudio=Number.isInteger(list?.defaultAudioTrackIndex)&&list.defaultAudioTrackIndex>=0&&list.defaultAudioTrackIndex<audioTracks.length?list.defaultAudioTrackIndex:audioTracks.length===1?0:null,index=defaultAudio===null?null:audioTracks[defaultAudio]?.defaultCaptionTrackIndex;if(Number.isInteger(index)&&original(tracks[index]))return {languageCode:code(tracks[index]),evidence:'default caption track index'};
 const all=unique(usable.map(code));if(all.length===1)return {languageCode:all[0],evidence:'unique original track'};return {languageCode:null};
}
async function readYoutubeCaptions(expectedUrl,budgetMs=25000,preferredLanguageCode) {
 const expires=Date.now()+budgetMs;
 const sameVideo=()=>{try{const u=new URL(expectedUrl),id=u.searchParams.get('v')||u.pathname.match(/^\/(?:shorts|live)\/([^/]+)/)?.[1];return id===(new URL(location.href).searchParams.get('v')||location.pathname.match(/^\/(?:shorts|live)\/([^/]+)/)?.[1]);}catch{return false}};
 if(!sameVideo())return {error:'网页已切换，字幕读取已取消。'};
 const videoId=new URL(location.href).searchParams.get('v')||location.pathname.match(/^\/(?:shorts|live)\/([^/]+)/)?.[1];
 if(!videoId)return {error:'当前页面不是可读取的视频。'};
 const candidates=[];
 for(const player of document.querySelectorAll('#movie_player, .html5-video-player')){
  try{candidates.push(player.getPlayerResponse?.())}catch{}
 }
 candidates.push(window.ytInitialPlayerResponse);
 let response=candidates.find(p=>p?.videoDetails?.videoId===videoId&&p.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length);
 // Shorts and SPA navigation may not expose a matching player response. Read the
 // canonical watch page without navigating or changing playback.
 if(!response){
  try{
   const r=await fetch(`/watch?v=${encodeURIComponent(videoId)}`,{credentials:'include',signal:AbortSignal.timeout(Math.max(1,Math.min(8000,expires-Date.now())))});
   const html=await r.text();
   const match=html.match(/(?:var\s+ytInitialPlayerResponse\s*=|window\["ytInitialPlayerResponse"\]\s*=)\s*/);
   if(match){
    const start=match.index+match[0].length;let depth=0,string=false,escape=false,end=start;
    for(;end<html.length;end++){const c=html[end];if(string){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')string=false}else{if(c==='"')string=true;else if(c==='{')depth++;else if(c==='}'&&!--depth){end++;break}}}
    const parsed=JSON.parse(html.slice(start,end));if(parsed.videoDetails?.videoId===videoId)response=parsed;
   }
  }catch{}
 }
 if(!sameVideo())return {error:'网页已切换，字幕读取已取消。'};
 const list=response?.captions?.playerCaptionsTracklistRenderer;
 const tracks=list?.captionTracks||[];
 if(!tracks.length)return {error:'这个视频没有可读取的字幕轨道，或 YouTube 未向当前账号提供字幕。'};
 const code=t=>{const s=String(t?.languageCode||'').trim().toLowerCase().replace(/_/g,'-');if(/^th(?:-|$)/.test(s)||/^thai(?:\s|$)/.test(s)||/^ไทย(?:\s|$)/.test(s))return 'th';if(/^ja(?:-|$)/.test(s)||/^japanese(?:\s|$)/.test(s)||/^日本語(?:\s|$)/.test(s))return 'ja';if(/^en(?:-|$)/.test(s)||/^english(?:\s|$)/.test(s)||/^英語(?:\s|$)/.test(s))return 'en';return s.split('-')[0]||null};
 const original=t=>{try{const u=new URL(t.baseUrl);return u.protocol==='https:'&&(u.hostname==='youtube.com'||u.hostname.endsWith('.youtube.com'))&&u.pathname==='/api/timedtext'&&!u.searchParams.has('tlang')}catch{return false}};
 const usable=tracks.filter(original);let wanted=preferredLanguageCode?code({languageCode:preferredLanguageCode}):null;const formats=[...(response?.streamingData?.adaptiveFormats||[]),...(response?.streamingData?.formats||[])],seenAudio=new Map();for(const f of formats){const a=f?.audioTrack;if(!a)continue;const id=a.id||a.audioTrackId;if(id&&!seenAudio.has(id))seenAudio.set(id,a)}const audios=[...seenAudio.values()],labelled=audios.filter(a=>/original|原始|オリジナル|ต้นฉบับ/i.test(String(a.displayName||a.name||''))),nonDubbed=audios.filter(a=>a.isAutoDubbed!==true),audioPick=labelled.length===1?labelled:labelled.length>1?[]:(audios.some(a=>a.isAutoDubbed===true)&&nonDubbed.length===1?nonDubbed:[]);let sourceAudio=null;if(audioPick.length===1){const candidate=String(audioPick[0].id||audioPick[0].audioTrackId||'').split('.')[0].toLowerCase().split('-')[0];if(usable.some(t=>code(t)===candidate))sourceAudio=candidate;}
 if(preferredLanguageCode&&!wanted)return {error:'字幕语言偏好无效。'};
 if(wanted&&!usable.some(t=>code(t)===wanted))return {error:'这个视频没有所需语言的原字幕轨道。'};
 if(!wanted&&sourceAudio)wanted=sourceAudio;
 if(!wanted){const unique=xs=>[...new Set(xs.filter(Boolean))];const asr=unique(usable.filter(t=>t.kind==='asr').map(code));if(asr.length===1)wanted=asr[0];const audio=String(response?.videoDetails?.defaultAudioLanguage||'').toLowerCase().split('-')[0];if(!wanted&&audio&&usable.some(t=>code(t)===audio))wanted=audio;const audioTracks=list?.audioTracks||[],defaultAudio=Number.isInteger(list?.defaultAudioTrackIndex)&&list.defaultAudioTrackIndex>=0&&list.defaultAudioTrackIndex<audioTracks.length?list.defaultAudioTrackIndex:audioTracks.length===1?0:null,index=defaultAudio===null?null:audioTracks[defaultAudio]?.defaultCaptionTrackIndex;if(!wanted&&Number.isInteger(index)&&original(tracks[index]))wanted=code(tracks[index]);const all=unique(usable.map(code));if(!wanted&&all.length===1)wanted=all[0];if(!wanted)return {error:all.length?'找到多个原字幕语言，无法安全选择。':'这个视频没有可安全选择的原字幕轨道。'};}
 const selected=usable.filter(t=>code(t)===wanted);const ordered=[...selected.filter(t=>t.kind!=='asr'),...selected.filter(t=>t.kind==='asr')];
 let failure='字幕文件为空，YouTube 可能限制了字幕请求。';
 for(const track of ordered.slice(0,3)){
  let url;try{url=new URL(track.baseUrl);if(!original(track))continue}catch{continue}
  // Preserve the signed URL; request JSON3 only as a second format fallback.
  for(const format of ['original','json3']){
   if(Date.now()>=expires)return {error:'YouTube 字幕读取超时，请重试。'};
   const target=new URL(url);if(format==='json3')target.searchParams.set('fmt','json3');
   try{
    const result=await fetch(target.href,{credentials:'include',signal:AbortSignal.timeout(Math.max(1,Math.min(8000,expires-Date.now())))});
    if(!result.ok){failure=`字幕读取失败（HTTP ${result.status}）。`;continue}
    const body=await result.text();
    if(body.trim()){
     const transcript=captionText(body);
     if(transcript){
      if(!sameVideo())return {error:'网页已切换，字幕读取已取消。'};
      return {text:transcript,language:track.languageCode,automatic:track.kind==='asr',source:'YouTube 字幕轨道',complete:true};
     }
    }
   }catch(e){failure=e.name==='TimeoutError'?'字幕读取超时，请重试。':'YouTube 字幕请求失败，请重试。'}
  }
 }
 return {error:failure};
 // This helper is deliberately embedded: executeScript serializes the function.
 function captionText(raw){
  const stamp=ms=>{const s=Math.floor(Number(ms)/1000);return `${Math.floor(s/3600)?String(Math.floor(s/3600)).padStart(2,'0')+':':''}${String(Math.floor(s/60)%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`};
  const clean=s=>String(s).replace(/\s+/g,' ').trim();let lines=[];
  if(raw.trim().startsWith('{')){
   try{const data=JSON.parse(raw);lines=(data.events||[]).filter(e=>e.segs).map(e=>({start:e.tStartMs||0,text:clean(e.segs.map(s=>s.utf8||'').join(''))}))}catch{return ''}
  }else{
   const doc=new DOMParser().parseFromString(raw,'text/xml');if(doc.querySelector('parsererror'))return '';
   lines=[...doc.querySelectorAll('text,p')].map(n=>({start:n.hasAttribute('start')?Number(n.getAttribute('start'))*1000:Number(n.getAttribute('t')||0),text:clean(n.textContent)}));
  }
  return lines.filter(l=>l.text).map(l=>`[${stamp(l.start)}] ${l.text}`).join('\n');
 }
}
