import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable,Writable} from 'node:stream';
import localStepExtraction from '../scripts/local-step-extraction.mjs';
import localReverseModel from '../scripts/local-reverse-model.mjs';
import {createCadJobDirectory,removeCadJobDirectory} from '../scripts/local-cad-job.mjs';
import {prepareSitesBuild} from '../scripts/prepare-sites-build.mjs';

async function isolated(t,prefix){
 const root=await createCadJobDirectory(tmpdir(),prefix);
 t.after(()=>removeCadJobDirectory(root,tmpdir(),prefix));
 return root;
}

test('本机 CAD 中间件的作业单独保存、可读取、失败和完成后清理',async t=>{
 const jobRoot=await isolated(t,'weldone-cad-test-');
 const routes=new Map(),middleware={middlewares:{use:(path,handler)=>routes.set(path,handler)}};
 let cancelResponse,aborted=false;
 localStepExtraction({jobRoot,async extract(source,result,signal){
  const input=await readFile(source,'utf8');
  if(input==='invalid')throw Error('提取样本无效');
  if(input==='cancel')await new Promise((resolve,reject)=>{
   signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);},{once:true});
   cancelResponse.destroy();
  });
  await mkdir(result);
  await writeFile(join(result,'analysis.json'),'{"parts":1}');
 }}).configureServer(middleware);
 localReverseModel({jobRoot,async reconstruct(input,output,type){
  assert.equal(await readFile(input,'utf8'),'cloud');
  await writeFile(output,'STEP');
  return {type,parts:1,timing:{}};
 }}).configureServer(middleware);
 async function send(method,url,body=''){
  const route=[...routes.keys()].find(path=>url.startsWith(path));
  const request=Object.assign(Readable.from([Buffer.from(body)]),{method,url:url.slice(route.length)||'/',
   headers:{'content-type':'application/octet-stream'},socket:{remoteAddress:'127.0.0.1'}});
  const chunks=[],headers={};
  const response=Object.assign(new Writable({write(chunk,encoding,done){chunks.push(chunk);done();}}),{
   statusCode:200,setHeader(key,value){headers[key]=value;},
   writeHead(status,values={}){this.statusCode=status;this.headersSent=true;Object.assign(headers,values);return this;}
  });
  if(body==='cancel')cancelResponse=response;
  await routes.get(route)(request,response);
  return {status:response.statusCode,headers,text:Buffer.concat(chunks).toString()};
 }
 const invalid=await send('POST','/api/step-extraction','invalid');
 assert.equal(invalid.status,500);
 assert.equal(JSON.parse(invalid.text).error,'提取样本无效');
 const response=await send('POST','/api/step-extraction','step');
 assert.equal(response.status,201);
 const {dataPath}=JSON.parse(response.text);
 assert.deepEqual(JSON.parse((await send('GET',dataPath+'/analysis.json')).text),{parts:1});
 assert.equal((await send('DELETE',dataPath)).status,204);
 await send('POST','/api/step-extraction','cancel');
 assert.equal(aborted,true);
 const unsupported=await send('POST','/api/reverse-model/?workpieceType=unknown','cloud');
 assert.equal(unsupported.status,400);
 const model=await send('POST','/api/reverse-model/?workpieceType=heavy-plate','cloud');
 assert.equal(model.status,200);
 assert.equal(model.headers['X-Weldone-Part-Count'],'1');
 assert.equal(model.text,'STEP');
 assert.deepEqual(await readdir(jobRoot),[]);
});

test('Sites 打包从独立目录生成部署清单与 Worker，不依赖已有 dist',async t=>{
 const target=await isolated(t,'weldone-sites-test-');
 assert.throws(()=>prepareSitesBuild(target),/Missing Sites build input/);
 await mkdir(join(target,'client'));
 await writeFile(join(target,'client','index.html'),'<main>WeldOne</main>');
 prepareSitesBuild(target);
 assert.match(await readFile(join(target,'server','index.js'),'utf8'),/env\.ASSETS/);
 assert.deepEqual(JSON.parse(await readFile(join(target,'.openai','hosting.json'),'utf8')),{d1:null,r2:null});
});
