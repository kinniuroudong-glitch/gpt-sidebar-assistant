const {spawnSync}=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');let failures=0;
for(const file of fs.readdirSync(path.join(root,'tests')).filter(f=>f.endsWith('.cjs')).sort()){
 const result=spawnSync(process.execPath,[path.join(root,'tests',file)],{cwd:root,encoding:'utf8',timeout:90000});
 process.stdout.write('\n'+file+'\n'+(result.stdout||''));if(result.stderr)process.stderr.write(result.stderr);
 if(result.error||result.status!==0){failures++;console.error(result.error?.message||'Exit '+result.status);}
}
if(failures){console.error(failures+' test(s) failed');process.exitCode=1;}else console.log('All tests passed');
