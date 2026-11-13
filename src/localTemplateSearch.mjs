import {previewPath,previewPoint} from './templatePreviewGeometry.mjs';
import {reverseWeldTraversal} from './weldDirectionGeometry.mjs';
export const DEFAULT_LOCAL_MATCH_DISTANCE=100;
export const localMatchDistance=options=>Number.isFinite(options?.localMatchDistance)&&options.localMatchDistance>0?options.localMatchDistance:DEFAULT_LOCAL_MATCH_DISTANCE;
export function windowJunctionKeys(window){const ids=window.segmentIndices;return ids.slice(0,-1).map((id,i)=>id+'>'+ids[i+1]);}
export function withinLocalSearch(window,options){
  const distance=localMatchDistance(options),target=window.match?.reversed?reverseWeldTraversal(window.target):window.target;
  const segments=target.segments,n=segments.length;
  if(n<2)return true;
  const path=previewPath(segments,'xy',window.template.corners,window.target.closure),first=path.frames[0].length,last=path.frames[n-1].distance;
  if(n===3&&path.frames[1].length>distance+1e-6)return false;
  const min=Math.max(0,first-distance),max=Math.min(path.totalLength,last+distance);
  return (window.template.layers?.flatMap(l=>l.passes)||[{points:window.template.points}]).every(pass=>pass.points.every(p=>{const at=previewPoint(p,path,'xy',false,pass.points).distance;return at>=min-1e-6&&at<=max+1e-6;}));
}
export function preferLocalWindows(windows){
  const ordered=windows.map((w,i)=>({...w,order:i})).sort((a,b)=>b.segmentIndices.length-a.segmentIndices.length||a.order-b.order),covered=new Set(),seen=new Set(),selected=[];
  for(const window of ordered){const keys=windowJunctionKeys(window),id=window.segmentIndices.join(',');if(seen.has(id)||keys.some(k=>covered.has(k)))continue;selected.push(window);seen.add(id);keys.forEach(k=>covered.add(k));}
  return selected;
}
