export function stepMeshFromResult(result,name,sourceSha256){
if(!result.success||!result.meshes?.length)throw Error('STEP 模型转换失败');
const low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity],round=v=>Math.round(v*10000)/10000;
for(const m of result.meshes)for(let i=0;i<m.attributes.position.array.length;i++){const v=m.attributes.position.array[i];low[i%3]=Math.min(low[i%3],v);high[i%3]=Math.max(high[i%3],v);}
const origin=low.map((v,i)=>(v+high[i])/2),size=low.map((v,i)=>high[i]-v),edges=[];
const meshes=result.meshes.map((m,part)=>{
  const a=m.attributes.position.array,positions=a.map((v,i)=>round(v-origin[i%3])),indices=m.index.array;
  const vertex=i=>positions.slice(i*3,i*3+3),key=p=>p.join(','),links=new Map(),vertices=new Map();
  for(const face of m.brep_faces??[]){
    const boundary=new Map();
    for(let t=face.first;t<=face.last;t++){const ids=indices.slice(t*3,t*3+3);for(let j=0;j<3;j++){const p=vertex(ids[j]),q=vertex(ids[(j+1)%3]),pk=key(p),qk=key(q);if(pk===qk)continue;const id=[pk,qk].sort().join('|');const old=boundary.get(id);boundary.set(id,{p,q,pk,qk,count:(old?.count||0)+1});}}
    for(const [id,e] of boundary)if(e.count===1){links.set(id,{...e,id});vertices.set(e.pk,e.p);vertices.set(e.qk,e.q);}
  }
  const adjacency=new Map();for(const e of links.values())for(const k of [e.pk,e.qk]){if(!adjacency.has(k))adjacency.set(k,[]);adjacency.get(k).push(e);}
  const other=(e,k)=>e.pk===k?e.qk:e.pk,used=new Set();
  function sharp(k){const es=adjacency.get(k);if(es.length!==2)return true;const p=vertices.get(k),a=vertices.get(other(es[0],k)).map((v,i)=>v-p[i]),b=vertices.get(other(es[1],k)).map((v,i)=>v-p[i]);return a.reduce((s,v,i)=>s+v*b[i],0)/(Math.hypot(...a)*Math.hypot(...b))>-.94;}
  function trace(e,k){const points=[vertices.get(k)];let current=e,at=k;while(current&&!used.has(current.id)){used.add(current.id);at=other(current,at);points.push(vertices.get(at));if(at===k||sharp(at))break;current=adjacency.get(at).find(n=>!used.has(n.id));}if(points.length>=2)edges.push({id:`E${String(edges.length+1).padStart(4,'0')}`,part,points});}
  for(const [k,es] of adjacency)if(sharp(k))for(const e of es)if(!used.has(e.id))trace(e,k);
  for(const e of links.values())if(!used.has(e.id))trace(e,e.pk);
  return {name:m.name||`零件 ${part+1}`,positions,indices,normals:m.attributes.normal?.array.map(round),color:m.color};
});
return {version:1,name,unit:'mm',sourceSha256,origin:origin.map(round),size:size.map(round),meshes,edges};
}
