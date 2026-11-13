import {Box3,Matrix4,Quaternion,Vector3} from 'three';
import {ExtendedTriangle} from 'three-mesh-bvh';

const epsilon=1e-9;
const transform=new Matrix4();
const scale=new Vector3(1,1,1),rotation=new Quaternion();
const partBounds=new Box3(),moved=new Box3(),candidate=new Box3(),workBounds=new Box3();
const partTriangle=[new Vector3(),new Vector3(),new Vector3()];
const toolTriangle=[new Vector3(),new Vector3(),new Vector3()];
const edgesA=[new Vector3(),new Vector3(),new Vector3()],edgesB=[new Vector3(),new Vector3(),new Vector3()];
const axis=new Vector3(),normalA=new Vector3(),normalB=new Vector3();
const clip=[0,1];
const probe=new ExtendedTriangle(),closestPoint=new Vector3();
const clearanceSteps=[0,.25,.5,.75,1];
const mergeTolerance=1e-8;
const coordinates=['x','y','z'];

// Continuous SAT for one triangle translated at constant speed. Padding
// expands the projections when this is used to screen a rotating tool.
function overlapTime(a,b,velocity,padding){
 for(let i=0;i<3;i++){
  edgesA[i].subVectors(a[(i+1)%3],a[i]);
  edgesB[i].subVectors(b[(i+1)%3],b[i]);
 }
 normalA.crossVectors(edgesA[0],edgesA[1]);
 normalB.crossVectors(edgesB[0],edgesB[1]);
 clip[0]=0;clip[1]=1;
 function axisOverlap(axis){
  const length=axis.length();
  if(length<epsilon)return true;
  const margin=(epsilon+padding)*length;
  const a0=a[0].dot(axis),a1=a[1].dot(axis),a2=a[2].dot(axis);
  const b0=b[0].dot(axis),b1=b[1].dot(axis),b2=b[2].dot(axis);
  const lo=Math.min(a0,a1,a2)-Math.max(b0,b1,b2)-margin;
  const hi=Math.max(a0,a1,a2)-Math.min(b0,b1,b2)+margin;
  const d=axis.dot(velocity);
  if(Math.abs(d)<epsilon*length)return lo<=0&&hi>=0;
  const t0=lo/d,t1=hi/d;
  clip[0]=Math.max(clip[0],Math.min(t0,t1));
  clip[1]=Math.min(clip[1],Math.max(t0,t1));
  return clip[0]<=clip[1];
 }
 if(!axisOverlap(axis.copy(normalA))||!axisOverlap(axis.copy(normalB)))return false;
 for(let i=0;i<3;i++){
  for(let j=0;j<3;j++)if(!axisOverlap(axis.crossVectors(edgesA[i],edgesB[j])))return false;
  // Also cover coplanar triangles, where the edge cross-products are collinear.
  if(!axisOverlap(axis.crossVectors(normalA,edgesA[i]))||!axisOverlap(axis.crossVectors(normalB,edgesB[i])))return false;
 }
 return true;
}

function sweptBox(out,box,velocity){
 return out.copy(box).union(moved.copy(box).translate(velocity));
}

export function sweepLinearMeshes(parts,tools,origin,from,to,clearance,mergeRanges,rotationBound){
 const start=new Vector3().fromArray(from.position).sub(origin);
 transform.compose(start,rotation.fromArray(from.quaternion),scale);
 const worldMotion=new Vector3().fromArray(to.position).sub(start).sub(origin);
 const rangeBounds=new Box3(),raw=[];
 const timeBounds=[0,1];
 const proximity=[];
 const baseBounds=new Box3();
 const boundsOverlap=(a,b,padding=0)=>{
  let from=0,to=1;
  for(const key of coordinates){
   const lo=b.min[key]-a.max[key]-padding-epsilon,hi=b.max[key]-a.min[key]+padding+epsilon,d=worldMotion[key];
   if(Math.abs(d)<epsilon){if(lo>0||hi<0)return false;continue;}
   const t0=lo/d,t1=hi/d;
   from=Math.max(from,Math.min(t0,t1));to=Math.min(to,Math.max(t0,t1));
   if(from>to)return false;
  }
  timeBounds[0]=from;timeBounds[1]=to;
  return true;
 };
 const covered=()=>raw.some(([from,to])=>timeBounds[0]>=from-mergeTolerance&&timeBounds[1]<=to+mergeTolerance);
 const padding=box=>rotationBound?rotationBound.translation+rotationBound.angle*box.getCenter(point).distanceTo(rotationBound.pivot)+rotationBound.angle*box.getSize(point).length()/2:0;
 let closest;
 const point=new Vector3();
 let contact;
 const addRange=()=>{
  let [from,to]=clip;
  const overlaps=raw.some(range=>from>=range[0]-mergeTolerance&&to<=range[1]+mergeTolerance);
  if(overlaps)return;
  for(let i=raw.length-1;i>=0;i--){
   const [a,b]=raw[i];
   if(a>to+mergeTolerance||b<from-mergeTolerance)continue;
   from=Math.min(a,from);to=Math.max(b,to);raw.splice(i,1);
  }
  raw.push([from,to]);
 };
 for(const tool of tools){
  baseBounds.copy(tool.boundingBox).applyMatrix4(transform);
  sweptBox(rangeBounds,baseBounds,worldMotion).expandByScalar(clearance+padding(tool.boundingBox));
  for(const {name,geometry:part} of parts){
   if(!rangeBounds.intersectsBox(part.boundingBox)||
      !boundsOverlap(baseBounds,part.boundingBox,clearance+padding(tool.boundingBox))||covered())continue;
   partBounds.copy(part.boundingBox).expandByScalar(clearance);
   tool.boundsTree.shapecast({
    intersectsBounds:box=>{
     candidate.copy(box).applyMatrix4(transform);
     return boundsOverlap(candidate,partBounds,padding(box))&&!covered();
    },
    intersectsTriangle(triangle){
     const a=triangle.a,b=triangle.b,c=triangle.c;
     const deviation=rotationBound?rotationBound.translation+rotationBound.angle*Math.max(a.distanceTo(rotationBound.pivot),b.distanceTo(rotationBound.pivot),c.distanceTo(rotationBound.pivot)):0;
     toolTriangle[0].copy(a).applyMatrix4(transform);
     toolTriangle[1].copy(b).applyMatrix4(transform);
     toolTriangle[2].copy(c).applyMatrix4(transform);
     candidate.setFromPoints(toolTriangle);
     sweptBox(workBounds,candidate,worldMotion).expandByScalar(clearance+deviation);
     return part.boundsTree.shapecast({
      intersectsBounds:box=>workBounds.intersectsBox(box)&&boundsOverlap(candidate,box,clearance+deviation)&&!covered(),
      intersectsTriangle(triangle){
       for(const [i,point] of [triangle.a,triangle.b,triangle.c].entries())partTriangle[i].copy(point);
       if(!overlapTime(partTriangle,toolTriangle,worldMotion,deviation)){
        if(clearance&&!raw.length&&overlapTime(partTriangle,toolTriangle,worldMotion,clearance)){
         proximity.push({from:clip[0],to:clip[1],name,part:partTriangle.map(p=>p.clone()),tool:toolTriangle.map(p=>p.clone())});
        }
        return false;
       }
       if(rotationBound){raw.push([0,1]);return true;}
       addRange();
       if(!contact){
        point.copy(toolTriangle[0]).addScaledVector(worldMotion,clip[0]);
        triangle.closestPointToPoint(point,point).add(origin);
        contact={t:clip[0],part:name,point:point.toArray(),distance:0,collision:true};
       }
       return raw.at(-1)?.[0]===0&&raw.at(-1)?.[1]===1;
      }
     });
    }
   });
   if(raw.at(-1)?.[0]===0&&raw.at(-1)?.[1]===1)return {ranges:[[0,1]],contact,closest};
  }
 }
 if(!raw.length){
  const part=new ExtendedTriangle();
  for(const candidate of proximity){
   const {from,to,name}=candidate;
   [part.a,part.b,part.c].forEach((point,index)=>point.copy(candidate.part[index]));
   part.needsUpdate=true;
   for(const fraction of clearanceSteps){
    const t=from+(to-from)*fraction;
    probe.a.copy(candidate.tool[0]).addScaledVector(worldMotion,t);
    probe.b.copy(candidate.tool[1]).addScaledVector(worldMotion,t);
    probe.c.copy(candidate.tool[2]).addScaledVector(worldMotion,t);
    probe.needsUpdate=true;
    const distance=part.distanceToTriangle(probe,closestPoint);
    if(distance<=clearance&&distance<(closest?.distance??Infinity))closest={t,distance,part:name,point:closestPoint.clone().add(origin).toArray(),collision:false};
   }
  }
 }
 return {ranges:mergeRanges(raw),contact,closest};
}
