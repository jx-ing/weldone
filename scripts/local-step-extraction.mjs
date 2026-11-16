import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createReadStream,createWriteStream,existsSync} from 'node:fs';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const run=promisify(execFile);
const root=fileURLToPath(new URL('../',import.meta.url));
const extractor=resolve(root,'scripts/vendor-extraction/analyze_step_model.py');
const cache=resolve(root,'node_modules/.cache');
const prefix='weldone-step-extraction-';
const files=new Set(['parts.json','mesh.bin','edges.json','contacts.json','analysis.json','welds.json']);
const endpoint='/api/step-extraction';
const loopback=new Set(['127.0.0.1','::1','::ffff:127.0.0.1']);

async function analyze(source,out,signal){
 const venv=resolve(root,'../step2pc/.venv');
 const packages=join(venv,'Lib/site-packages');
 const bundledPython=join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
 const venvPython=join(venv,process.platform==='win32'?'Scripts/python.exe':'bin/python');
 const useBundled=process.platform==='win32'&&existsSync(bundledPython)&&existsSync(join(packages,'OCP'));
 const python=process.env.WELDONE_STEP_PYTHON||(useBundled?bundledPython:existsSync(venvPython)?venvPython:'python');
 const args=['-E','-B','-X','utf8'];
 if(useBundled&&!process.env.WELDONE_STEP_PYTHON){
  args.push('-c',"import runpy,sys; sys.path[:0]=sys.argv[1:3]; sys.argv=sys.argv[3:]; runpy.run_path(sys.argv[0],run_name='__main__')",packages,dirname(extractor));
 }
 try{
  await run(python,[...args,extractor,source,'--out',out,'--model-id','local-step','--workpiece-type','other'],{
   cwd:root,windowsHide:true,signal,timeout:10*60*1000,maxBuffer:2*1024*1024
  });
 }catch(error){
  if(error.code==='ENOENT'||/No module named ['"]OCP|DLL load failed/.test(error.stderr??'')){
   throw Error('本机 STEP 几何提取需要可用的 Python 和 OCP 环境');
  }
  if(error.killed&&!signal.aborted)throw Error('STEP 几何提取超时');
  throw Error('STEP 几何提取失败，请检查模型文件');
 }
}

function send(response,status,value){
 response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
 response.end(JSON.stringify(value));
}

export default function localStepExtraction(){
 const jobs=new Map();
 const discard=async directory=>{
  if(dirname(directory)===cache&&basename(directory).startsWith(prefix)){
   await rm(directory,{recursive:true,force:true});
  }
 };
 const release=async id=>{
  const job=jobs.get(id);
  if(!job)return;
  jobs.delete(id);
  clearTimeout(job.expiry);
  await discard(job.directory);
 };
 const install=server=>{
  server.middlewares.use(endpoint,async(request,response)=>{
   const origin=request.headers.origin;
   if(!loopback.has(request.socket.remoteAddress)||origin&&origin!==`http://${request.headers.host}`){
    send(response,403,{error:'STEP 几何提取仅供本机使用'});return;
   }
   const segments=request.url.split('?')[0].split('/').filter(Boolean);
   const [id,file]=segments,job=jobs.get(id);
   if(request.method==='GET'&&segments.length===2&&job&&files.has(file)){
    response.setHeader('Cache-Control','no-store');
    response.setHeader('Content-Type',file.endsWith('.json')?'application/json':'application/octet-stream');
    try{await pipeline(createReadStream(join(job.directory,'result',file)),response);}
    catch{response.destroy();}
    return;
   }
   if(request.method==='DELETE'&&segments.length===1&&job){
    await release(id).catch(()=>{});
    response.writeHead(204).end();
    return;
   }
   if(request.method!=='POST'||segments.length||request.headers['content-type']!=='application/octet-stream'){
    send(response,404,{error:'无效的 STEP 提取请求'});return;
   }
   const abort=new AbortController();
   response.once('close',()=>abort.abort());
   let directory;
   try{
    await mkdir(cache,{recursive:true});
    directory=await mkdtemp(join(cache,prefix));
    const source=join(directory,'model.step'),output=join(directory,'result');
    await pipeline(request,createWriteStream(source,{flags:'wx'}),{signal:abort.signal});
    await analyze(source,output,abort.signal);
    if(abort.signal.aborted)return;
    const key=randomUUID();
    const expiry=setTimeout(()=>release(key).catch(()=>{}),5*60*1000).unref();
    jobs.set(key,{directory,expiry});
    directory=undefined;
    send(response,201,{dataPath:endpoint+'/'+key});
   }catch(error){
    if(!response.destroyed)send(response,500,{error:error.message});
   }finally{
    if(directory)await discard(directory).catch(()=>{});
   }
  });
 };
 return {name:'weldone-local-step-extraction',configureServer:install,configurePreviewServer:install};
}
