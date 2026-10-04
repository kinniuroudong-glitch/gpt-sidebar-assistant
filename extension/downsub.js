// One short DOM probe per injection; waiting belongs to the background worker.
function readDownsubExport(videoUrl,preferredLanguageCode) {
 const wanted=new URL(videoUrl).searchParams.get('v');
 if(location.hostname!=='downsub.com')throw Error('DownSub 页面发生跳转，已停止读取。');
 const input=document.querySelector('input');
 if(input?.value){let found;try{const u=new URL(input.value);found=u.searchParams.get('v')||u.pathname.split('/').pop()}catch{}if(found&&found!==wanted)throw Error('DownSub 返回了其他视频，已停止读取。');}
 const buttons=[...document.querySelectorAll('button.download-button[data-title^="[RAW]"]')].filter(e=>!e.disabled);
 // DownSub renders original tracks in align-center rows; translated rows omit
 // that marker. Never select a translated row or guess between languages.
 const originals=buttons.filter(e=>e.closest('.layout')?.classList.contains('align-center'));
 const languageCode=value=>{const s=String(value||'').trim().toLowerCase().replace(/_/g,'-');if(/^th(?:-|$)/.test(s)||/^thai(?:\s|$)/.test(s)||/^ไทย(?:\s|$)/.test(s))return 'th';if(/^ja(?:-|$)/.test(s)||/^japanese(?:\s|$)/.test(s)||/^日本語(?:\s|$)/.test(s))return 'ja';if(/^en(?:-|$)/.test(s)||/^english(?:\s|$)/.test(s)||/^英語(?:\s|$)/.test(s))return 'en';return null};
 const entries=originals.map(button=>{const label=button.getAttribute('data-title')||'';return {button,label,languageCode:languageCode(label.replace(/^\[RAW\]\s*/i,'')),automatic:/auto.generated/i.test(label)}});
 let chosen;
 if(preferredLanguageCode&&entries.length){const wanted=languageCode(preferredLanguageCode)||String(preferredLanguageCode).toLowerCase().split('-')[0];const matches=entries.filter(e=>e.languageCode===wanted);if(!matches.length)throw Error('DownSub 没有找到所需语言的原字幕。');chosen=matches.find(e=>!e.automatic)||matches[0];}
 else {
  const unknown=entries.some(e=>!e.languageCode),asrUnknown=entries.some(e=>e.automatic&&!e.languageCode);
  const asr=[...new Set(entries.filter(e=>e.automatic&&e.languageCode).map(e=>e.languageCode))];
  const all=[...new Set(entries.filter(e=>e.languageCode).map(e=>e.languageCode))];
  const wanted=!unknown&&!asrUnknown&&(asr.length===1?asr[0]:asr.length>1?null:all.length===1?all[0]:null);
  if(!wanted){if(entries.length)throw Error('DownSub 找到多个语言的原字幕，无法安全选择。');}
  else chosen=entries.find(e=>e.languageCode===wanted&&!e.automatic)||entries.find(e=>e.languageCode===wanted);
 }
 if(chosen){const {label,button,automatic}=chosen;return {language:label.replace(/^\[RAW\]\s*/i,''),languageCode:chosen.languageCode,rawTitle:label,automatic,source:'DownSub',complete:true,timestamps:false};}
 const alerts=[...document.querySelectorAll('[role="alert"],.v-alert')].map(e=>e.textContent).join('\n');
 if(/captcha|验证码|机器人|verify you are human/i.test(alerts))throw Error('DownSub 需要人工验证，已停止，不会发送空字幕。');
 if(/no subtitles|no caption|没有字幕|未找到字幕|could not extract|unable to extract/i.test(alerts))throw Error('DownSub 没有找到该视频的字幕。');
 if(/503|service unavailable|temporarily unavailable/i.test(alerts))return {pending:true,serviceError:true};
 if(originals.length)throw Error(preferredLanguageCode?'DownSub 没有找到所需语言的原字幕。':'DownSub 没有找到可安全选择的原字幕。');
 return {pending:true};
}
