import {Box3,BufferGeometry,Float32BufferAttribute,Matrix4,Quaternion,Ray,Vector3,DoubleSide} from 'three';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';
import {MeshBVH} from 'three-mesh-bvh';
import {sweepLinearMeshes} from './weldLinearSweep.mjs';
import {loadStepMesh} from './stepModelStore.mjs';
import {NANYANG_TOOL_CALIBRATION} from './weldToolPose.mjs';

const clearance=.25;
const tolerance=.1;
const epsilon=1e-8;

export function excludeWireTip(geometry,calibration=NANYANG_TOOL_CALIBRATION){
 const tip=new Vector3(...calibration.wireTip),axis=new Vector3(...calibration.wireAxis).normalize();
 const positions=geometry.attributes.position,indices=geometry.index,result=[];
 const along=point=>point.clone().sub(tip).dot(axis);
 for(let i=0;i<(indices?.count??positions.count);i+=3){
  const points=[0,1,2].map(offset=>new Vector3().fromBufferAttribute(positions,indices?indices.getX(i+offset):i+offset));
  const lengths=points.map(along);
  const wire=points.every((point,index)=>lengths[index]>=-2&&lengths[index]<30&&
   point.clone().sub(tip).addScaledVector(axis,-lengths[index]).length()<1);
  let polygon=points;
  if(wire){
   polygon=[];
   for(let j=0;j<3;j++){
    const k=(j+1)%3,a=lengths[j]-1,b=lengths[k]-1;
    if(a>=0)polygon.push(points[j]);
    if((a<0)!==(b<0))polygon.push(points[j].clone().lerp(points[k],a/(a-b)));
   }
  }
  for(let j=1;j+1<polygon.length;j++)result.push(...polygon[0].toArray(),...polygon[j].toArray(),...polygon[j+1].toArray());
 }
 return new BufferGeometry().setAttribute('position',new Float32BufferAttribute(result,3));
}

export async function loadWeldCollisionScene(workspace,{coverOpen=false}={}){
 const directory=import.meta.env.BASE_URL+'models/nanyang-head/';
 const loader=new STLLoader();
 const results=await Promise.allSettled([
  loadStepMesh(workspace.model,workspace.stepModel),
  loader.loadAsync(directory+'tool_body.stl'),
  loader.loadAsync(directory+'camera_cover.stl')
 ]);
 try{
  const failed=results.find(result=>result.status==='rejected');
  if(failed)throw failed.reason;
  const [model,body,cover]=results.map(result=>result.value);
  if(coverOpen)cover.rotateX(-NANYANG_TOOL_CALIBRATION.coverAngle);
  cover.translate(...NANYANG_TOOL_CALIBRATION.coverHinge);
  return createWeldCollisionScene(model,[excludeWireTip(body),cover.clone()]);
 }finally{
  for(const result of results.slice(1))if(result.status==='fulfilled')result.value.dispose();
 }
}

export function createWeldCollisionScene(model,toolParts){
 const origin=new Vector3(...model.origin);
 const position=new Vector3(),rotation=new Quaternion(),scale=new Vector3(1,1,1);
 const transform=new Matrix4(),inverse=new Matrix4(),bounds=new Box3(),delta=new Vector3();
 const ray=new Ray(new Vector3(),new Vector3(.58,.73,.36).normalize());
 const index=geometry=>{
  geometry.computeBoundingBox();
  geometry.boundsTree=new MeshBVH(geometry);
  return geometry;
 };
 const parts=model.meshes.filter(mesh=>mesh.indices.length>=3).map((mesh,i)=>{
  const geometry=new BufferGeometry();
  geometry.setAttribute('position',new Float32BufferAttribute(mesh.positions,3));
  geometry.setIndex(Array.from(mesh.indices));
  return {name:mesh.name||'零件 '+(i+1),geometry:index(geometry)};
 });
 if(!parts.length||!toolParts.length)throw Error('缺少碰撞检测网格');
 const tools=toolParts.map(index);
 const contains=(geometry,point)=>{
  if(!geometry.boundingBox.containsPoint(point))return false;
  ray.origin.copy(point);
  const hit=geometry.boundsTree.raycastFirst(ray,DoubleSide,.0001);
  return !!hit?.face&&hit.face.normal.dot(ray.direction)>0;
 };
 const vertex=geometry=>new Vector3().fromBufferAttribute(geometry.attributes.position,0);
 const toolExtent=Math.max(...tools.map(geometry=>Math.max(geometry.boundingBox.min.length(),geometry.boundingBox.max.length(),
  geometry.boundingBox.getCenter(new Vector3()).length()+geometry.boundingBox.getSize(new Vector3()).length()/2)));
 return {
  toolExtent,
  sweep:(from,to)=>sweepLinearMeshes(parts,tools,origin,from,to,clearance,mergeCollisionRanges),
  contact({position:xyz,quaternion}){
   position.fromArray(xyz).sub(origin);
   transform.compose(position,rotation.fromArray(quaternion),scale);
   const point=new Vector3();
   for(const tool of tools){
    bounds.copy(tool.boundingBox).applyMatrix4(transform);
    for(const {name,geometry:part} of parts){
     if(!bounds.intersectsBox(part.boundingBox))continue;
     const intersectsTriangles=(partFace,toolFace)=>{
      if(!partFace.intersectsTriangle(toolFace))return false;
      partFace.closestPointToPoint(toolFace.a,point);
      return true;
     };
     if(part.boundsTree.bvhcast(tool.boundsTree,transform,{intersectsTriangles}))
      return {distance:0,part:name,point:point.add(origin).toArray(),collision:true};
    }
   }
   return this.containment({position:xyz,quaternion});
  },
  containment({position:xyz,quaternion}){
   position.fromArray(xyz).sub(origin);
   transform.compose(position,rotation.fromArray(quaternion),scale);
   inverse.copy(transform).invert();
   for(const tool of tools){
    const toolVertex=vertex(tool).applyMatrix4(transform);
    bounds.copy(tool.boundingBox).applyMatrix4(transform);
    for(const {name,geometry:part} of parts){
     if(!bounds.intersectsBox(part.boundingBox))continue;
     if(contains(part,toolVertex))return {distance:0,part:name,point:toolVertex.add(origin).toArray(),collision:true};
     const partVertex=vertex(part);
     if(contains(tool,partVertex.clone().applyMatrix4(inverse)))return {distance:0,part:name,point:partVertex.add(origin).toArray(),collision:true};
    }
   }
   return null;
  },
  sweptCandidate(from,middle,to,interior){
   const a=from.position??from.head.position,b=to.position??to.head.position,c=middle.position??middle.head.position;
   const q=new Quaternion().fromArray(middle.head.quaternion);
   const samples=[from,...interior,to];
   const sampleQ=new Quaternion();
   const angle=Math.max(...samples.map(pose=>q.angleTo(sampleQ.fromArray(pose.head.quaternion))));
   const deviation=(pose,t)=>Math.hypot(...(pose.position??pose.head.position).map((value,i)=>value-(a[i]+(b[i]-a[i])*t)));
   const translation=Math.max(deviation(middle,.5),deviation(interior[0],.25),deviation(interior[1],.75));
   const pivot=new Vector3(...c).sub(new Vector3(...middle.head.position)).applyQuaternion(q.invert());
   const at=point=>({quaternion:middle.head.quaternion,position:middle.head.position.map((value,i)=>value+point[i]-c[i])});
   const result=sweepLinearMeshes(parts,tools,origin,at(a),at(b),0,mergeCollisionRanges,
    {angle:angle*1.01+1e-8,pivot,translation:translation*1.1+1e-7});
   return result.ranges.length>0;
  },
  query({position:xyz,quaternion},searchRadius=clearance){
   position.fromArray(xyz).sub(origin);
   transform.compose(position,rotation.fromArray(quaternion),scale);
   let best={distance:Infinity};
   for(const tool of tools){
    bounds.copy(tool.boundingBox).applyMatrix4(transform);
    for(const {name,geometry:part} of parts){
     const box=part.boundingBox;
     delta.set(Math.max(0,box.min.x-bounds.max.x,bounds.min.x-box.max.x),
      Math.max(0,box.min.y-bounds.max.y,bounds.min.y-box.max.y),
      Math.max(0,box.min.z-bounds.max.z,bounds.min.z-box.max.z));
     const limit=Math.min(searchRadius,best.distance);
     if(delta.lengthSq()>limit*limit)continue;
     const closest=part.boundsTree.closestPointToGeometry(tool,transform,{},null,epsilon,limit+epsilon);
     if(closest?.distance<epsilon)return {distance:0,part:name,point:closest.point.add(origin).toArray(),collision:true};
     if(bounds.intersectsBox(box)){
      const toolPoint=vertex(tool).applyMatrix4(transform);
      if(contains(part,toolPoint))return {distance:0,part:name,point:toolPoint.add(origin).toArray(),collision:true};
      const partPoint=vertex(part);
      if(contains(tool,partPoint.clone().applyMatrix4(inverse.copy(transform).invert())))
       return {distance:0,part:name,point:partPoint.add(origin).toArray(),collision:true};
     }
     if(closest&&closest.distance<best.distance){
      best={distance:closest.distance,part:name,point:closest.point.add(origin).toArray(),collision:false};
     }
    }
   }
   return best;
  },
  dispose(){for(const {geometry} of parts)geometry.dispose();for(const tool of tools)tool.dispose();}
 };
}

export function mergeCollisionRanges(ranges){
 const merged=[];
 for(const [from,to] of ranges.slice().sort((a,b)=>a[0]-b[0])){
  const previous=merged.at(-1);
  if(previous&&from<=previous[1]+epsilon)previous[1]=Math.max(previous[1],to);
  else merged.push([from,to]);
 }
 return merged;
}

export function detectWeldCollision(paths,scene){
 const passes=[];
 for(const pass of paths){
  const stations=[...new Set([pass.startStation,...(pass.stations??pass.toolPoses.map(pose=>pose.distance)),pass.endStation])]
   .filter(at=>at>=pass.startStation&&at<=pass.endStation).sort((a,b)=>a-b);
  const cache=new Map(),distances=new WeakMap(),contacts=new WeakMap(),ranges=[],uncertain=[];
  let closest=null,contact=null;
  const at=distance=>{
   if(!cache.has(distance))cache.set(distance,pass.posesAt(distance));
   return cache.get(distance);
  };
  const query=(pose,limit)=>{
   const known=distances.get(pose);
   if(known&&(known.hit.distance<Infinity||known.limit>=limit))return known.hit;
   const hit=scene.query(pose.head,limit);
   distances.set(pose,{limit,hit});
   if(hit.collision)contact??={station:pose.distance,...hit};
   if(hit.distance<=clearance&&(!closest||hit.distance<closest.distance))closest={station:pose.distance,...hit};
   return hit;
  };
  const intersects=pose=>{
   if(!scene.contact)return query(pose,clearance).collision;
   if(!contacts.has(pose))contacts.set(pose,scene.contact(pose.head));
   const hit=contacts.get(pose);
   if(hit)contact??={station:pose.distance,...hit};
   return !!hit;
  };
  const first=new Quaternion(),last=new Quaternion();
  const motion=(a,b)=>{
   const angle=first.fromArray(a.head.quaternion).angleTo(last.fromArray(b.head.quaternion));
   const length=Math.hypot(...a.head.position.map((value,index)=>value-b.head.position[index]));
   return length+scene.toolExtent*angle;
  };
  function visit(a,b,depth=0){
   const from=a.distance,to=b.distance,mid=(from+to)/2;
   const m=at(mid)[0];
   if(!m){uncertain.push([from,to]);return;}
   // Use a distance bound about the middle pose to discard swept intervals.
   // Limit the span of each accepted interval so curved trajectories are also sampled.
   const halfMotion=Math.max(motion(a,m),motion(m,b));
   const bound=Math.max(halfMotion,(to-from)/2);
   const margin=closest?0:clearance;
   if(scene.sweptCandidate&&to-from<=12){
    const quarter=at((from+mid)/2)[0],threeQuarter=at((mid+to)/2)[0];
    if(quarter&&threeQuarter&&!scene.sweptCandidate(a,m,b,[quarter,threeQuarter])){
     const contained=scene.containment?.(m.head);
     if(contained){contact??={station:mid,...contained};ranges.push([from,to]);}
     return;
    }
   }
   const leaf=to-from<=tolerance||depth>=24;
   const sample=scene.sweptCandidate?null:query(m,bound+margin);
   if(sample?.distance>bound+margin&&to-from<=12)return;
   if(leaf){
    if(intersects(m)||intersects(a)||intersects(b))ranges.push([from,to]);
    else if(scene.sweptCandidate||!sample||sample.distance<=bound)uncertain.push([from,to]);
    return;
   }
   visit(a,m,depth+1);
   visit(m,b,depth+1);
  }
  function linearRun(begin,end,sweep=true){
   const a=at(stations[begin]).at(-1),b=at(stations[end])[0];
   if(!scene.sweep||!a||!b)return false;
   const from=a.distance,to=b.distance;
   first.fromArray(a.head.quaternion);last.fromArray(b.head.quaternion);
   if(1-Math.abs(first.dot(last))>1e-13||to-from<epsilon)return false;
   const linear=pose=>{
    const t=(pose.distance-from)/(to-from);
    last.fromArray(pose.head.quaternion);
    return 1-Math.abs(first.dot(last))<1e-13&&pose.head.position.every((v,i)=>
     Math.abs(v-(a.head.position[i]+(b.head.position[i]-a.head.position[i])*t))<1e-5);
   };
   for(let i=begin;i<end;i++){
    if(i>begin&&(at(stations[i]).length!==1||!linear(at(stations[i])[0])))return false;
    const span=stations[i+1]-stations[i];
    for(const fraction of [.25,.5,.75]){
     const pose=at(stations[i]+span*fraction)[0];
     if(!pose||!linear(pose))return false;
    }
   }
   if(!sweep)return true;
   const result=scene.sweep(a.head,b.head);
   for(const [lo,hi] of result.ranges){
    ranges.push([Math.max(from,from+(to-from)*lo-tolerance),Math.min(to,from+(to-from)*hi+tolerance)]);
   }
   if(result.contact&&!contact)contact={...result.contact,station:from+(to-from)*result.contact.t};
   // A fully contained tool may have no surface intersections.
   // Surface crossings alone omit the interior of closed solids.
   let start=from;
   for(const [lo,hi] of [...result.ranges,[1,1]]){
    const end=from+(to-from)*lo;
    if(end>start+tolerance){
     const station=(start+end)/2,pose=at(station)[0];
     const hit=pose&&scene.containment(pose.head);
     if(hit){contact??={...hit,station};ranges.push([start,end]);}
    }
    start=from+(to-from)*hi;
   }
   if(result.closest&&result.closest.distance<(closest?.distance??Infinity))closest={...result.closest,station:from+(to-from)*result.closest.t};
   return true;
  }
  for(let i=0;i<stations.length;i++){
   const current=at(stations[i]);
   if(current.length>1||stations.length===1){
    for(const pose of current){
     if(query(pose,clearance).collision)ranges.push([Math.max(pass.startStation,pose.distance-tolerance),Math.min(pass.endStation,pose.distance+tolerance)]);
    }
   }
   if(current.length>1){
    // Equal-station controls may rotate through a collision. Check the
    // shortest rigid transition without inventing weld distance.
    for(let j=1;j<current.length;j++){
     const a=current[j-1],b=current[j],travel=motion(a,b);
     if(travel<epsilon)continue;
     const q1=new Quaternion().fromArray(a.head.quaternion),q2=new Quaternion().fromArray(b.head.quaternion);
     const at=t=>({...a,position:undefined,head:{position:a.head.position.map((v,index)=>v+(b.head.position[index]-v)*t),
      quaternion:q1.clone().slerp(q2,t).toArray()}});
     function testTransition(from,to){
      const m=(from+to)/2,mid=at(m);
      if(scene.sweptCandidate&&!scene.sweptCandidate(at(from),mid,at(to),[at((from+m)/2),at((m+to)/2)]))return false;
      if(intersects(mid))return true;
      if((to-from)*travel<=tolerance)return false;
      return testTransition(from,m)||testTransition(m,to);
     }
     if(testTransition(0,1))ranges.push([Math.max(pass.startStation,a.distance-tolerance),Math.min(pass.endStation,a.distance+tolerance)]);
    }
   }
   if(i===stations.length-1)break;
   const next=at(stations[i+1]);
   if(!current.length||!next.length){uncertain.push([stations[i],stations[i+1]]);continue;}
   if(i===0&&current.length===1&&linearRun(0,stations.length-1))break;
   if(!linearRun(i,i+1,false)){visit(current.at(-1),next[0]);continue;}
   let end=i+1;
   // Expand geometrically so checking a long fixed-pose run stays linear.
   let step=1;
   while(end<stations.length-1){
    const candidate=Math.min(stations.length-1,end+step);
    if(!linearRun(i,candidate,false)){
     if(step===1)break;
     step=Math.floor(step/2);
    }else{end=candidate;step*=2;}
   }
   linearRun(i,end);
   i=end-1;
  }
  passes.push({id:pass.id,ranges:mergeCollisionRanges(ranges),uncertain:mergeCollisionRanges(uncertain),contact,closest});
 }
 return {passes,ranges:mergeCollisionRanges(passes.flatMap(pass=>pass.ranges)),uncertain:mergeCollisionRanges(passes.flatMap(pass=>pass.uncertain))};
}
