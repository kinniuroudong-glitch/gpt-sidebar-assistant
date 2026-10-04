const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),ext=path.join(root,'extension');let failed=false;
const manifest=JSON.parse(fs.readFileSync(path.join(ext,'manifest.json'),'utf8'));
for(const file of fs.readdirSync(ext).filter(f=>f.endsWith('.js'))){const r=spawnSync(process.execPath,['--check',path.join(ext,file)],{encoding:'utf8'});if(r.status!==0){failed=true;console.error(r.stderr);}}
const refs=[manifest.background.service_worker,manifest.side_panel.default_path,...manifest.content_scripts.flatMap(x=>x.js)];
for(const file of refs)if(!fs.existsSync(path.join(ext,file))){failed=true;console.error('Missing '+file);}
if(failed)process.exitCode=1;else console.log('Extension syntax and manifest references passed: '+manifest.version);
