const assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const code=fs.readFileSync('extension/captions.js','utf8');
(async()=>{
 const dom=new JSDOM('<div id="movie_player"></div>',{url:'https://www.youtube.com/watch?v=abcdefghijk',runScripts:'outside-only'}),w=dom.window;
 w.eval(code);w.AbortSignal={timeout:()=>undefined};
 const track={baseUrl:'https://www.youtube.com/api/timedtext?v=abcdefghijk&sig=retain',languageCode:'th',kind:'asr'};
 const player=w.document.querySelector('#movie_player');
 const response={videoDetails:{videoId:'abcdefghijk'},captions:{playerCaptionsTracklistRenderer:{captionTracks:[track]}}};
 player.getPlayerResponse=()=>response;
 let urls=[];w.fetch=async url=>{urls.push(String(url));return {ok:true,text:async()=>JSON.stringify({events:[{tStartMs:1000,segs:[{utf8:'สวัสดี '},{utf8:'ครับ'}]},{tStartMs:3601000,segs:[{utf8:'最后一句'}]}]})}};
 let result=await w.readYoutubeCaptions(w.location.href);assert.equal(result.complete,true);assert.equal(result.automatic,true);assert.match(result.text,/\[00:01\] สวัสดี ครับ/);assert.match(result.text,/\[01:00:01\] 最后一句/);assert.match(urls[0],/sig=retain/);
 w.fetch=async()=>({ok:true,text:async()=>'<transcript><text start="2.5">A &amp; B</text><text start="61">End</text></transcript>'});result=await w.readYoutubeCaptions(w.location.href);assert.equal(result.text,'[00:02] A & B\n[01:01] End');
 // Empty signed response falls back to JSON3 rather than claiming no subtitles.
 urls=[];w.fetch=async url=>{urls.push(String(url));return {ok:true,text:async()=>urls.length===1?'':JSON.stringify({events:[{tStartMs:0,segs:[{utf8:'fallback'}]}]})}};result=await w.readYoutubeCaptions(w.location.href);assert.match(result.text,/fallback/);assert.match(urls[1],/fmt=json3/);
 // Reject stale SPA metadata and use canonical watch-page metadata.
 player.getPlayerResponse=()=>({...response,videoDetails:{videoId:'other'}});w.ytInitialPlayerResponse=undefined;
 w.fetch=async url=>({ok:true,text:async()=>String(url).startsWith('/watch')?`<script>var ytInitialPlayerResponse = ${JSON.stringify(response)};</script>`:JSON.stringify({events:[{segs:[{utf8:'canonical'}]}]})});result=await w.readYoutubeCaptions(w.location.href);assert.match(result.text,/canonical/);
 // A non-Thai default and translated Thai do not replace a Thai original.
 const english={...track,languageCode:'en',baseUrl:track.baseUrl+'&lang=en'};
 player.getPlayerResponse=()=>({videoDetails:{videoId:'abcdefghijk'},captions:{playerCaptionsTracklistRenderer:{captionTracks:[english,track],audioTracks:[{defaultCaptionTrackIndex:0}]}}});
 urls=[];w.fetch=async url=>{urls.push(String(url));return {ok:true,text:async()=>JSON.stringify({events:[{segs:[{utf8:'ไทย'}]}]})}};
 result=await w.readYoutubeCaptions(w.location.href,25000,'th');assert.equal(result.language,'th');assert(!urls.some(u=>u.includes('lang=en')));
 player.getPlayerResponse=()=>({videoDetails:{videoId:'abcdefghijk'},captions:{playerCaptionsTracklistRenderer:{captionTracks:[english]}}});urls=[];
 result=await w.readYoutubeCaptions(w.location.href);assert.equal(result.language,'en');assert.equal(urls.length,1);
 result=await w.readYoutubeCaptions(w.location.href,25000,'ja');assert.match(result.error,/所需语言/);assert.equal(urls.length,1);
 const japanese={...track,languageCode:'ja',kind:'asr',baseUrl:track.baseUrl+'&lang=ja'};player.getPlayerResponse=()=>({videoDetails:{videoId:'abcdefghijk'},captions:{playerCaptionsTracklistRenderer:{captionTracks:[japanese]}}});urls=[];result=await w.readYoutubeCaptions(w.location.href);assert.equal(result.language,'ja');
 player.getPlayerResponse=()=>({videoDetails:{videoId:'abcdefghijk'},captions:{playerCaptionsTracklistRenderer:{captionTracks:[{...track,baseUrl:track.baseUrl+'&tlang=th'}]}}});urls=[];
 result=await w.readYoutubeCaptions(w.location.href);assert.ok(result.error);assert.equal(urls.length,0);
 // Untrusted caption URLs must never be fetched.
 player.getPlayerResponse=()=>({videoDetails:{videoId:'abcdefghijk'},captions:{playerCaptionsTracklistRenderer:{captionTracks:[{...track,baseUrl:'https://evil.test/api/timedtext'}]}}});let fetched=false;w.fetch=async()=>{fetched=true;throw Error()};result=await w.readYoutubeCaptions(w.location.href);assert.ok(result.error);assert.equal(fetched,false);
 result=await w.readYoutubeCaptions('https://www.youtube.com/watch?v=different');assert.match(result.error,/切换/);
 player.getPlayerResponse=()=>({videoDetails:{videoId:'abcdefghijk'},captions:{playerCaptionsTracklistRenderer:{captionTracks:[{...track,languageCode:'ja',kind:'asr'},{...track,languageCode:'en',kind:'asr'}],audioTracks:[{captionTrackIndices:[0,1],defaultCaptionTrackIndex:0},{captionTrackIndices:[0,1],defaultCaptionTrackIndex:0}],defaultAudioTrackIndex:0}},streamingData:{adaptiveFormats:[{audioTrack:{id:'en-US.10',displayName:'English (US)',isAutoDubbed:true}},{audioTrack:{id:'ja.4',displayName:'Japanese original',isAutoDubbed:false}}]}});assert.equal(w.readYoutubeCaptionLanguage(w.location.href).languageCode,'ja');
 const unlabelledOriginal=player.getPlayerResponse();unlabelledOriginal.streamingData.adaptiveFormats[1].audioTrack.displayName='日本語';delete unlabelledOriginal.streamingData.adaptiveFormats[1].audioTrack.isAutoDubbed;unlabelledOriginal.captions.playerCaptionsTracklistRenderer.audioTracks[0].defaultCaptionTrackIndex=1;player.getPlayerResponse=()=>unlabelledOriginal;assert.equal(w.readYoutubeCaptionLanguage(w.location.href).languageCode,'ja','absent isAutoDubbed on sole original audio remains valid when the other is explicitly dubbed');w.fetch=async()=>({ok:true,text:async()=>JSON.stringify({events:[{segs:[{utf8:'こんにちは'}]}]})});result=await w.readYoutubeCaptions(w.location.href);assert.equal(result.language,'ja');
 dom.window.close();console.log('PASS captions: full JSON3/XML, timestamps, signed URLs, empty-response fallback, SPA mismatch, URL validation and cancellation');
})().catch(e=>{console.error(e);process.exitCode=1});
