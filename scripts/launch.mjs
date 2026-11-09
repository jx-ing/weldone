import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const url='http://localhost:5236/';
function open(){spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{windowsHide:true,stdio:'ignore'}).unref()}
async function health(){try{const r=await fetch(url+'platform-health.json',{signal:AbortSignal.timeout(1500)});return r.ok&&(await r.json()).app==='weldone-ui-replica'}catch{return false}}
if(process.argv.includes('--check')){const ready=await health();console.log(ready?'ready':'not ready');process.exit(ready?0:1)}
if(await health()){console.log('Weldone UI platform is already running: '+url);open();process.exit(0)}
const available=await new Promise(resolve=>{const s=createServer();s.once('error',()=>resolve(false));s.listen(5236,'127.0.0.1',()=>s.close(()=>resolve(true)))});
if(!available){console.error('Port 5236 is used by another service. No process was stopped.');process.exit(1)}
const child=spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','5236','--strictPort'],{cwd:root,windowsHide:true,stdio:'inherit'});
child.once('error',e=>{console.error(e.message);process.exit(1)});
child.once('exit',code=>process.exit(code??1));
let opened=false;for(let i=0;i<60&&!opened;i++){if(await health()){open();opened=true;console.log('Keep this window open while using the platform.')}else await new Promise(r=>setTimeout(r,500))}
if(!opened){console.error('Preview did not become ready.');child.kill();process.exit(1)}
process.on('SIGINT',()=>{child.kill();process.exit(0)});
