import {resolveWeldToolPose,weldTorchAxis} from './weldToolPose.mjs';
export {weldTorchAxis,weldTorchBasis,weldTorchOrientation} from './weldToolPose.mjs';
import {previewPath,previewPoint,samplePath} from './weldPathGeometry.mjs';
import {sampleManualWeldPath,horizontalWeldNormal} from './manualWeldModel.mjs';

export const PASS_OFFSET_FIELDS=[['y','偏移值Y','mm'],['z','偏移值Z','mm'],['start','起弧偏移','mm'],['end','收弧偏移','mm'],['wire','焊丝方向偏移','mm'],['advance','前进角偏移','°'],['work','工作角偏移','°'],['rotation','旋转角偏移','°']];
const value=n=>Number.isFinite(n)?n:0;
export const passOffsetValues=offset=>Object.fromEntries(PASS_OFFSET_FIELDS.map(([key])=>[key,offset?.[key]??0]));
export const passOffsetWithLayer=(offset,layer)=>({
 ...offset,y:value(offset?.y)+value(layer.offsetY),z:value(offset?.z)+value(layer.height)
});
export function validPassOffsets(offset){return !!offset&&['y','z'].every(k=>Number.isFinite(offset[k]))&&PASS_OFFSET_FIELDS.every(([key,,unit])=>offset[key]===undefined||Number.isFinite(offset[key])&&(unit!=='°'||Math.abs(offset[key])<=360));}
export function effectivePassPoints(points,offset={}){
  return points.map(p=>({...p,offset:{...p.offset,x:value(p.offset?.x)+(p.kind==='start'?value(offset.start):p.kind==='end'?value(offset.end):0)},angles:{...p.angles,...Object.fromEntries(['advance','work','rotation'].map(key=>[key,value(p.angles?.[key])+value(offset[key])]))}}));
}
export function resolvePassPoint(template,point,points=template.points,offset={},layerHeight=0,pathOverride,poseAt,frameAt){
  const effective=effectivePassPoints(points,offset),p=effective.find(p=>p.id===point.id)||point;
  const path=pathOverride||previewPath(template.segments,'xy',template.corners,template.closure),resolved=previewPoint(p,path,'xy',false,effective);
  const spatial=frameAt?.(resolved.distance);
  let position,tangent,normal;
  if(template.segments.every(s=>s.pathPoints?.length>=2)){
    const at=spatial??sampleManualWeldPath(template.segments,resolved.distance,template.cornerReferenceNormal);
    const base=samplePath(path,resolved.distance);
    tangent=at.tangent;normal=at.offsetNormal??horizontalWeldNormal(tangent,at.normal);
    const across=(resolved.position.x-base.position.x)*resolved.frame.normal.x+(resolved.position.y-base.position.y)*resolved.frame.normal.y+value(offset.y),height=resolved.height+value(layerHeight)+value(offset.z);
    position=at.position.map((n,i)=>n+normal[i]*across+(i===2?height:0));
  }else{
    tangent=[resolved.frame.tangent.x,resolved.frame.tangent.y,0];normal=[resolved.frame.normal.x,resolved.frame.normal.y,0];
    position=[resolved.position.x+normal[0]*value(offset.y),resolved.position.y+normal[1]*value(offset.y),resolved.height+value(layerHeight)+value(offset.z)];
  }
  const pose=poseAt?.(p,resolved.distance);
  const angles=pose?.angles??p.angles;
  const frame=pose?.tangent&&pose?.normal?pose:spatial??{tangent,normal};
  const wireAxis=weldTorchAxis(frame.tangent,frame.normal,angles,frame.up);
  const adjustment=pose?.pathOffset,wireOffset=value(offset.wire)+value(pose?.wireOffset);
  position=position.map((n,i)=>n+wireAxis[i]*wireOffset+(adjustment?.[i]??0));
  const toolPose=resolveWeldToolPose({...frame,position,pose:angles,distance:resolved.distance});
  return {...resolved,position,...toolPose.frame,wireAxis,angles,toolPose};
}
