import createOcct from 'occt-import-js';
import wasmUrl from 'occt-import-js/dist/occt-import-js.wasm?url';
import {stepMeshFromResult} from './stepMesh.mjs';

self.onmessage=async({data:file})=>{
 try{
  const buffer=await file.arrayBuffer();
  const header=new TextDecoder().decode(new Uint8Array(buffer,0,Math.min(buffer.byteLength,4096)));
  if(!/ISO-10303-21\s*;/i.test(header))throw Error('文件不是可读取的 STEP 格式');
  const digest=await crypto.subtle.digest('SHA-256',buffer);
  const sourceSha256=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
  const occt=await createOcct({locateFile:()=>new URL(wasmUrl,self.location.href).href});
  const result=occt.ReadStepFile(new Uint8Array(buffer),{
   linearUnit:'millimeter',linearDeflectionType:'bounding_box_ratio',linearDeflection:.001,angularDeflection:.15
  });
  self.postMessage({model:stepMeshFromResult(result,file.name,sourceSha256)});
 }catch(error){self.postMessage({error:error.message});}
};
