import {execFile} from 'node:child_process';
import {createReadStream,createWriteStream,existsSync} from 'node:fs';
import {stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {delimiter,join,resolve} from 'node:path';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {cadJobSignal,createCadJobDirectory,localCadRequest,removeCadJobDirectory} from './local-cad-job.mjs';

const run=promisify(execFile);
const project=fileURLToPath(new URL('../',import.meta.url));
const script=join(project,'scripts','reverse-model','reconstruct.py');
const cache=join(project,'node_modules','.cache');
const endpoint='/api/reverse-model';
const supported=new Set(['auto','heavy-plate','subassembly']);
const prefix='weldone-reverse-';
const uploadLimit=120_000_032;

const error=(res,status,message)=>{
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify({error:message}));
};

async function build(input,output,type,signal){
  const python=process.env.WELDONE_REVERSE_PYTHON||process.env.WELDONE_STEP_PYTHON;
  const venv=resolve(project,'../step2pc/.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  const env={...process.env};
  delete env.PYTHONHOME;
  env.PYTHONPATH=[join(cache,'reverse-python'),process.env.WELDONE_REVERSE_SITE_PACKAGES].filter(Boolean).join(delimiter);
  try{
    const {stdout}=await run(python||(existsSync(venv)?venv:'python'),['-B','-X','utf8',script,input,output,'--type',type],{
      cwd:project,env,windowsHide:true,signal,timeout:5*60_000,maxBuffer:512*1024
    });
    const line=stdout.split(/\r?\n/).find(value=>value.startsWith('REVERSE_RESULT '));
    if(!line)throw Error('逆向建模未生成有效的 STEP 装配体');
    return JSON.parse(line.slice('REVERSE_RESULT '.length));
  }catch(failure){
    const message=failure.stderr?.match(/REVERSE_ERROR ([^\r\n]+)/)?.[1];
    if(message)throw Error(message);
    if(failure.code==='ENOENT'||/No module named|DLL load failed/i.test(failure.stderr??'')){
      throw Error('本机逆向建模需要 Python、NumPy、SciPy、Shapely 和 OCP 环境');
    }
    if(failure.killed&&!signal.aborted)throw Error('逆向建模超时');
    throw Error('无法从当前点云闭合并验证 STEP 实体');
  }
}

export default function localReverseModel({jobRoot=join(tmpdir(),'weldone-cad'),reconstruct=build}={}){
  let busy=false;
  const install=server=>{
  server.middlewares.use(endpoint,async(request,response)=>{
    if(!localCadRequest(request)){
      error(response,403,'逆向建模仅供本机使用');return;
    }
    const url=new URL(request.url||'/','http://localhost');
    const type=url.searchParams.get('workpieceType')??'auto';
    if(request.method!=='POST'||url.pathname!=='/'||request.headers['content-type']!=='application/octet-stream'){
      error(response,404,'无效的逆向建模请求');return;
    }
    if(!supported.has(type)){error(response,400,'未知的逆向建模工件类型');return;}
    if(Number(request.headers['content-length'])>uploadLimit){
      error(response,413,'点云超过 500 万点');return;
    }
    if(busy){error(response,409,'正在处理另一份点云');return;}
    busy=true;
    const signal=cadJobSignal(response);
    let directory;
    try{
      directory=await createCadJobDirectory(jobRoot,prefix);
      const input=join(directory,'input.cloud'),output=join(directory,'result.step');
      let bytes=0;
      const limit=new Transform({transform(chunk,encoding,done){
        bytes+=chunk.length;
        done(bytes>uploadLimit?Error('点云超过 500 万点'):null,chunk);
      }});
      await pipeline(request,limit,createWriteStream(input,{flags:'wx'}),{signal});
      const {type:selected,parts,timing}=await reconstruct(input,output,type,signal);
      if(signal.aborted)return;
      response.writeHead(200,{
        'Content-Type':'model/step','Cache-Control':'no-store',
        'Content-Length':(await stat(output)).size,
        'X-Weldone-Workpiece-Type':selected,'X-Weldone-Part-Count':String(parts),
        'Server-Timing':Object.entries(timing).map(([name,seconds])=>name+';dur='+(seconds*1000).toFixed(2)).join(', ')
      });
      await pipeline(createReadStream(output),response);
    }catch(failure){
      if(!response.destroyed&&!response.headersSent)error(response,422,failure.message);
    }finally{
      busy=false;
      if(directory)await removeCadJobDirectory(directory,jobRoot,prefix).catch(()=>{});
    }
  });
  };
  return {name:'weldone-local-reverse-model',configureServer:install,configurePreviewServer:install};
}
