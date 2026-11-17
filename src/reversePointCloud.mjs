const workpieceTypes=new Map([['重磅板','heavy-plate'],['小组立','subassembly'],
  ['heavy-plate','heavy-plate'],['subassembly','subassembly']]);

function cloudPayload(cloud){
  const count=cloud.points.length/3;
  const includeNormals=cloud.normals?.length===cloud.points.length;
  const header=new DataView(new ArrayBuffer(32));
  for(let axis=0;axis<3;axis++)header.setFloat64(axis*8,cloud.origin[axis],true);
  header.setUint32(24,count,true);
  header.setUint32(28,Number(includeNormals),true);
  return new Blob([header.buffer,cloud.points,...(includeNormals?[cloud.normals]:[])],{type:'application/octet-stream'});
}

export async function reversePointCloud(cloud,workpieceType,signal){
  const type=workpieceTypes.get(workpieceType)??'auto';
  if(type==='subassembly'&&!cloud.normals)throw Error('小组立需要带法向的 PLY 或 PCD，请重新导入点云');
  let response;
  try{
    response=await fetch('/api/reverse-model?workpieceType='+type,{method:'POST',body:cloudPayload(cloud),signal});
  }catch(error){
    if(signal.aborted)throw error;
    throw Error('无法连接本机逆向建模服务');
  }
  if(!response.ok){
    const result=await response.json().catch(()=>null);
    throw Error(result?.error??'本机逆向建模服务不可用');
  }
  if(!response.headers.get('content-type')?.startsWith('model/step'))throw Error('服务未返回 STEP 文件');
  const blob=await response.blob();
  const filename=cloud.name.replace(/\.(txt|xyz|ply|pcd)$/i,'')+'-逆向模型.step';
  return {file:new File([blob],filename,{type:'model/step'}),
    parts:Number(response.headers.get('X-Weldone-Part-Count')),
    type:response.headers.get('X-Weldone-Workpiece-Type')};
}
