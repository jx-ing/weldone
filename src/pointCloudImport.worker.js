import {parsePointCloud} from './pointCloudModel.mjs';

self.onmessage=async({data:file})=>{
 try{
  const buffer=await file.arrayBuffer();
  const [hash,cloud]=await Promise.all([crypto.subtle.digest('SHA-256',buffer),parsePointCloud(file.name,buffer)]);
  const sourceSha256=Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');
  const transfer=[cloud.points.buffer];
  if(cloud.vertexColors)transfer.push(cloud.vertexColors.buffer);
  if(cloud.normals)transfer.push(cloud.normals.buffer);
  self.postMessage({model:{...cloud,name:file.name,kind:'pointCloud',sourceSha256,meshes:[],edges:[]}},transfer);
 }catch(error){self.postMessage({error:error.message});}
};
