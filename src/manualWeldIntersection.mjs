import {BufferGeometry,Float32BufferAttribute,Line3,Matrix4,Vector3} from 'three';
import {MeshBVH} from 'three-mesh-bvh';
import {distance,pathLength} from './manualWeldModel.mjs';

const joinTolerance=.002;
const vector=point=>new Vector3(...point);
const pointKey=point=>point.join(',');
const edgeKey=(a,b)=>a<b?a+'|'+b:b+'|'+a;

export function surfaceTriangles(model,part){
 const {indices,positions,faces}=model.meshes[part];
 if(faces?.length)return faces.map(([first,last])=>Array.from({length:last-first+1},(_,index)=>first+index));

 // Older cached meshes still retain the tessellated boundaries of the original STEP faces.
 const boundaries=new Set();
 for(const edge of model.edges)if(edge.part===part){
  const {points}=edge;
  for(let i=1;i<points.length;i++)boundaries.add(edgeKey(pointKey(points[i-1]),pointKey(points[i])));
 }
 const count=indices.length/3,parents=Array.from({length:count},(_,i)=>i);
 const keys=Array.from({length:positions.length/3},(_,i)=>pointKey(positions.slice(i*3,i*3+3)));
 function find(index){
  while(parents[index]!==index){parents[index]=parents[parents[index]];index=parents[index];}
  return index;
 }
 const edges=new Map();
 for(let i=0;i<count;i++)for(let j=0;j<3;j++){
  const key=edgeKey(keys[indices[i*3+j]],keys[indices[i*3+(j+1)%3]]);
  if(boundaries.has(key))continue;
  const previous=edges.get(key);
  if(previous===undefined)edges.set(key,i);
  else parents[find(i)]=find(previous);
 }
 const groups=new Map();
 for(let i=0;i<count;i++){
  const root=find(i);
  if(!groups.has(root))groups.set(root,[]);
  groups.get(root).push(i);
 }
 return [...groups.values()];
}

function sectionGeometry(mesh,triangles){
 const geometry=new BufferGeometry();
 geometry.setAttribute('position',new Float32BufferAttribute(mesh.positions,3));
 geometry.setIndex(triangles?triangles.flatMap(i=>mesh.indices.slice(i*3,i*3+3)):mesh.indices);
 return geometry;
}

// Clip a coplanar triangle against the other triangle's three side planes.
function coplanarIntersection(a,b,normal){
 let points=[a.a,a.b,a.c];
 const vertices=[b.a,b.b,b.c];
 for(let i=0;i<3&&points.length;i++){
  const start=vertices[i],end=vertices[(i+1)%3];
  const inward=normal.clone().cross(end.clone().sub(start)).normalize();
  const plane=point=>inward.dot(point.clone().sub(start));
  const polygon=[];
  for(let j=0;j<points.length;j++){
   const p=points[j],q=points[(j+1)%points.length],d=plane(p),e=plane(q);
   if(d>=-1e-7)polygon.push(p);
   if(d>1e-7&&e< -1e-7||d< -1e-7&&e>1e-7)polygon.push(p.clone().lerp(q,d/(d-e)));
  }
  points=polygon;
 }
 const area=new Vector3();
 for(let i=1;i+1<points.length;i++)area.add(points[i].clone().sub(points[0]).cross(points[i+1].clone().sub(points[0])));
 if(area.length()>joinTolerance*joinTolerance)return {overlap:true};
 let edge,length=joinTolerance;
 for(const p of points)for(const q of points){
  const size=p.distanceTo(q);
  if(size>length){edge=[p,q];length=size;}
 }
 return {edge};
}

function connectedPaths(edges){
 const vertices=[],cells=new Map();
 const cell=point=>point.toArray().map(amount=>Math.floor(amount/joinTolerance));
 function index(point){
  const [x,y,z]=cell(point);
  for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)for(let k=-1;k<=1;k++){
   const matches=cells.get(pointKey([x+i,y+j,z+k]))??[];
   const match=matches.find(id=>vertices[id].distanceTo(point)<=joinTolerance);
   if(match!==undefined)return match;
  }
  const id=vertices.push(point.clone())-1,key=pointKey([x,y,z]);
  if(!cells.has(key))cells.set(key,[]);
  cells.get(key).push(id);
  return id;
 }
 const unique=new Map();
 for(const edge of edges){
  const a=index(edge.start),b=index(edge.end);
  if(a!==b)unique.set(edgeKey(a,b),{...edge,a,b});
 }
 // Split partially overlapping collinear edges at existing vertices before tracing.
 const coordinates=[0,1,2].map(axis=>vertices.map((p,id)=>({id,value:p.getComponent(axis)})).sort((a,b)=>a.value-b.value));
 const links=new Map();
 for(const edge of unique.values()){
  const a=vertices[edge.a],b=vertices[edge.b],delta=b.clone().sub(a),length=delta.length();
  const axis=Math.abs(delta.x)>=Math.max(Math.abs(delta.y),Math.abs(delta.z))?0:Math.abs(delta.y)>=Math.abs(delta.z)?1:2;
  const low=Math.min(a.getComponent(axis),b.getComponent(axis))-joinTolerance;
  const high=Math.max(a.getComponent(axis),b.getComponent(axis))+joinTolerance;
  const sorted=coordinates[axis];
  let first=0,last=sorted.length;
  while(first<last){const mid=(first+last)>>1;if(sorted[mid].value<low)first=mid+1;else last=mid;}
  const cuts=[{id:edge.a,at:0},{id:edge.b,at:1}];
  for(let i=first;i<sorted.length&&sorted[i].value<=high;i++){
   const {id}=sorted[i];
   if(id===edge.a||id===edge.b)continue;
   const offset=vertices[id].clone().sub(a),at=offset.dot(delta)/(length*length);
   if(at>0&&at<1&&offset.addScaledVector(delta,-at).length()<=joinTolerance)cuts.push({id,at});
  }
  cuts.sort((a,b)=>a.at-b.at);
  for(let i=1;i<cuts.length;i++){
   const a=cuts[i-1].id,b=cuts[i].id,key=edgeKey(a,b);
   if(!links.has(key))links.set(key,{a,b,key,normals:edge.normals});
  }
 }
 const incident=vertices.map(()=>[]);
 for(const edge of links.values()){incident[edge.a].push(edge);incident[edge.b].push(edge);}
 const paths=[];
 function trace(start,edge){
  const points=[vertices[start].toArray()],normals=edge.normals;
  let at=start;
  while(edge&&links.delete(edge.key)){
   at=edge.a===at?edge.b:edge.a;
   points.push(vertices[at].toArray());
   if(at===start||incident[at].length!==2)break;
   edge=incident[at].find(link=>links.has(link.key));
  }
  if(pathLength(points)>=.1)paths.push({points,normals});
 }
 for(const [id,edges] of incident.entries())if(edges.length!==2)for(const edge of edges)if(links.has(edge.key))trace(id,edge);
 for(const edge of links.values())trace(edge.a,edge);
 return paths;
}

export function manualWeldIntersections(model,first,second){
 const faceMode=first.triangles!==undefined;
 const a=sectionGeometry(model.meshes[first.part],first.triangles),b=sectionGeometry(model.meshes[second.part],second.triangles);
 const edges=[],line=new Line3();
 let overlappingFaces=false;
 try{
  const tree=new MeshBVH(a),other=new MeshBVH(b);
  tree.bvhcast(other,new Matrix4(),{intersectsTriangles(a,b){
   const na=a.getNormal(new Vector3()),nb=b.getNormal(new Vector3());
   if(!na.lengthSq()||!nb.lengthSq())return false;
   const coplanar=na.clone().cross(nb).lengthSq()<1e-14&&Math.abs(na.dot(b.a.clone().sub(a.a)))<1e-6;
   if(coplanar){
    if(faceMode){
     const {edge,overlap}=coplanarIntersection(a,b,nb);
     overlappingFaces||=!!overlap;
     if(edge)edges.push({start:edge[0].clone(),end:edge[1].clone(),normals:[na,nb]});
    }
   }else if(a.intersectsTriangle(b,line,true)&&line.distance()>joinTolerance){
    edges.push({start:line.start.clone(),end:line.end.clone(),normals:[na,nb]});
   }
   return false;
  }});
 }finally{a.dispose();b.dispose();}
 if(overlappingFaces)throw Error('所选两面有重叠区域，无法确定唯一交线');
 const paths=connectedPaths(edges);
 if(!paths.length)throw Error(faceMode?'所选两面没有可用交线':'所选两实体没有可用交线');
 return paths.map(({points,normals})=>{
  const [referenceNormal,subFaceNormal]=normals.sort((a,b)=>Math.abs(b.z)-Math.abs(a.z)).map(n=>n.toArray());
  return {points:points.map(point=>point.map((v,i)=>v+model.origin[i])),referenceNormal,subFaceNormal,part:first.part};
 });
}

export const manualPointCount=kind=>kind==='line'?2:3;

export function manualWeldSegments(path){
 const points=path.points;
 const breaks=[0];
 if(!path.shape)for(let i=1;i<points.length-1;i++){
  const before=vector(points[i]).sub(vector(points[i-1])).normalize();
  const after=vector(points[i+1]).sub(vector(points[i])).normalize();
  if(before.dot(after)<.8&&distance(points[breaks.at(-1)],points[i])>=.1&&pathLength(points.slice(i))>=.1)breaks.push(i);
 }
 breaks.push(points.length-1);
 return breaks.slice(1).map((end,i)=>{
  const section=points.slice(breaks[i],end+1),chord=distance(section[0],section.at(-1));
  const rise=Math.abs(section[0][2]-section.at(-1)[2]);
  const vertical=chord>0&&rise/chord>=Math.cos(Math.PI/18)&&pathLength(section)-chord<.01;
  return {...path,points:section,position:vertical?'PF · 立向上焊':'PB · 横角焊'};
 });
}

export function manualWeldThroughPoints(kind,points){
 if(points.length!==manualPointCount(kind))throw Error('请选择所需数量的点');
 if(points.some((p,i)=>points.slice(0,i).some(q=>distance(p,q)<.1)))throw Error('请选择不同的位置');
 if(kind==='line')return {points};
 const [start,middle,end]=points.map(vector);
 const a=middle.clone().sub(start),b=end.clone().sub(start),normal=a.clone().cross(b);
 const scale=Math.max(a.length(),b.length(),distance(points[1],points[2]));
 if(normal.length()/scale<joinTolerance)throw Error('三点在同一直线上，无法创建圆或圆弧');
 const center=start.clone().add(b.clone().cross(normal).multiplyScalar(a.lengthSq())
  .add(normal.clone().cross(a).multiplyScalar(b.lengthSq())).multiplyScalar(.5/normal.lengthSq()));
 const u=start.clone().sub(center),v=normal.normalize().cross(u.clone());
 const radius=u.length();
 const angle=point=>{
  const offset=point.clone().sub(center),value=Math.atan2(offset.dot(v),offset.dot(u));
  return value<0?value+2*Math.PI:value;
 };
 const atMiddle=angle(middle),atEnd=angle(end);
 const anchors=kind==='circle'?[[0,start],[atMiddle,middle],[atEnd,end],[2*Math.PI,start]]:[[0,start],[atMiddle,middle],[atEnd,end]];
 const path=[start.toArray()];
 for(let i=1;i<anchors.length;i++){
  const [from]=anchors[i-1],[to,anchor]=anchors[i],steps=Math.max(1,Math.ceil((to-from)/(.05)));
  for(let j=1;j<steps;j++){
   const t=from+(to-from)*j/steps;
   path.push(center.clone().addScaledVector(u,Math.cos(t)).addScaledVector(v,Math.sin(t)).toArray());
  }
  path.push(anchor.toArray());
 }
 return {points:path,geometry:kind==='circle'?'圆弧':'曲线',shape:{radius,arcAngle:anchors.at(-1)[0]*180/Math.PI,direction:'left'}};
}
