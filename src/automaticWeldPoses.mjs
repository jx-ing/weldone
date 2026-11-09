import {Matrix4,Quaternion,Vector3} from 'three';
import {targetFromWeld} from './templateModel.mjs';
import {previewPath,samplePath} from './templatePreviewGeometry.mjs';
import {sampleManualWeldPath} from './manualWeldModel.mjs';
import {windowJunctionKeys} from './localTemplateSearch.mjs';
export function automaticWeldPoses(w,windows=[]){
  const target=targetFromWeld(w),segments=target.segments;if(!segments?.length)return [];
  const path=previewPath(segments,'xy',(target.cornerAngles||[]).map(standard=>({standard})),target.closure),ids=target.sourceSegmentIndices||segments.map((_,i)=>i),covered=new Set(windows.flatMap(windowJunctionKeys));
  const stations=[{distance:0,kind:'start'},...path.frames.slice(1).map((f,i)=>({distance:f.distance,kind:'junction',junction:ids[i]+'>'+ids[i+1]})),{distance:path.totalLength,kind:'end'}];
  if(target.closure==='closed'){stations.splice(0,1);stations[stations.length-1]={distance:path.totalLength,kind:'junction',junction:ids.at(-1)+'>'+ids[0]};}
  return stations.filter(s=>!s.junction||!covered.has(s.junction)).map(s=>{
    const native=segments.every(v=>v.pathPoints?.length>=2),at=native?sampleManualWeldPath(segments,s.distance,target.cornerReferenceNormal):samplePath(path,s.distance),x=new Vector3(...(native?at.tangent:[at.tangent.x,at.tangent.y,0])).normalize(),hint=new Vector3(...(native?at.normal:[-at.tangent.y,at.tangent.x,0])),z=new Vector3().crossVectors(x,hint).normalize(),y=new Vector3().crossVectors(z,x).normalize(),rotation=new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x,y,z));
    return {...s,source:'automatic-geometry',position:native?{x:at.position[0],y:at.position[1],z:at.position[2]}:{x:at.position.x,y:at.position.y,z:0},orientation:{quaternion:rotation.toArray(),tangent:x.toArray(),normal:y.toArray(),binormal:z.toArray()}};
  });
}
