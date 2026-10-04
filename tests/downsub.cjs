const fs=require('node:fs'),assert=require('node:assert/strict');const {JSDOM}=require('jsdom');
(async()=>{
 const d=new JSDOM('<input value="https://www.youtube.com/watch?v=wBRSLzkMqfg"><div class="layout align-center"><button class="download-button" data-title="[RAW] Thai (auto-generated)">RAW</button></div>',{url:'https://downsub.com/?url=video',runScripts:'outside-only'}),w=d.window;
 w.eval(fs.readFileSync('extension/downsub.js','utf8'));
 let clicks=0;w.document.querySelector('button').onclick=()=>clicks++;
 let result=await w.readDownsubExport('https://www.youtube.com/watch?v=wBRSLzkMqfg');assert.equal(result.language,'Thai (auto-generated)');assert.equal(result.languageCode,'th');assert.equal(result.automatic,true);assert.equal(result.source,'DownSub');assert.equal(clicks,0,'background must own the navigation');
 w.document.querySelector('input').value='https://www.youtube.com/watch?v=otherVideo0';assert.throws(()=>w.readDownsubExport('https://www.youtube.com/watch?v=wBRSLzkMqfg'),/其他视频/);
 // The English original and translated Thai must never win by ordering.
 w.document.querySelector('input').value='https://www.youtube.com/watch?v=wBRSLzkMqfg';
 w.document.body.insertAdjacentHTML('afterbegin','<div class="layout align-center"><button class="download-button" data-title="[RAW] English">RAW</button></div><div class="layout"><button class="download-button" data-title="[RAW] Thai">RAW</button></div>');
 assert.equal(w.readDownsubExport('https://www.youtube.com/watch?v=wBRSLzkMqfg').rawTitle,'[RAW] Thai (auto-generated)');
 w.document.body.insertAdjacentHTML('beforeend','<div class="layout align-center"><button class="download-button" data-title="[RAW] Thai">RAW</button></div>');
 assert.equal(w.readDownsubExport('https://www.youtube.com/watch?v=wBRSLzkMqfg').automatic,false);
 [...w.document.querySelectorAll('.align-center button')].filter(e=>e.getAttribute('data-title').includes('Thai')).forEach(e=>e.remove());
 assert.equal(w.readDownsubExport('https://www.youtube.com/watch?v=wBRSLzkMqfg').languageCode,'en');
 [...w.document.querySelectorAll('.align-center button')].forEach(e=>e.remove());
 assert.equal(w.readDownsubExport('https://www.youtube.com/watch?v=wBRSLzkMqfg','ja').pending,true);
 w.document.body.insertAdjacentHTML('beforeend','<div class="layout align-center"><button class="download-button" data-title="[RAW] English">RAW</button></div>');
 assert.throws(()=>w.readDownsubExport('https://www.youtube.com/watch?v=wBRSLzkMqfg','ja'),/所需语言/);
 w.document.body.insertAdjacentHTML('beforeend','<div class="layout align-center"><button class="download-button" data-title="[RAW] Japanese (auto-generated)">RAW</button></div>');
 result=w.readDownsubExport('https://www.youtube.com/watch?v=wBRSLzkMqfg','ja');assert.equal(result.languageCode,'ja');assert.equal(result.automatic,true);
 w.document.body.insertAdjacentHTML('beforeend','<div class="layout align-center"><button class="download-button" data-title="[RAW] Korean (auto-generated)">RAW</button></div>');
 assert.throws(()=>w.readDownsubExport('https://www.youtube.com/watch?v=wBRSLzkMqfg'),/多个语言/);
 d.window.close();console.log('PASS DownSub: public RAW metadata, original language, no premature navigation, mismatched video refused');
})().catch(e=>{console.error(e);process.exitCode=1});
