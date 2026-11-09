import {pathLength} from './manualWeldModel.mjs';
import {splitWeldPreview} from './manualSplitModel.mjs';
import {mergeCornerAngles} from './mergeIntersectionGeometry.mjs';
import {MAX_PLANNING_WELDS,weldPositionCode} from './planningRequirements.mjs';
const EPS=1e-7,MIN=.1,MAX=500;
// All stations are measured along the actual model polyline, including curves.
export function intermittentRanges(total,{mode,weldLength,gapLength,distributionVersion},phase=0){
 if(distributionVersion>=2){
  if(!Number.isFinite(total)||total<MIN||![weldLength,gapLength].every(v=>Number.isFinite(v)&&v>=0))throw Error('间断焊长度须为非负数');
  if(weldLength===0||gapLength===0)return [[0,total]];
 }
 if(![total,weldLength,gapLength].every(v=>Number.isFinite(v)&&v>=MIN))throw Error('间断焊长度须至少为0.1 mm');
 if(total<=weldLength+EPS)return [[0,total]];
 const ranges=[];
 if(mode==='endWeld'){
  const count=Math.max(2,Math.floor((total+gapLength)/(weldLength+gapLength)));
  if(count>MAX)throw Error('间断焊分段超过500条，请增大长度');
  if(total<2*weldLength+MIN)return [[0,total]];
  const gap=(total-count*weldLength)/(count-1);
  for(let i=0;i<count;i++){const start=i*(weldLength+gap);ranges.push([start,i===count-1?total:start+weldLength]);}
 }else{
  const count=Math.max(1,Math.floor((total+gapLength)/(weldLength+gapLength)));
  if(count>MAX)throw Error('间断焊分段超过500条，请增大长度');
  const margin=distributionVersion>=2?0:(total-(count*weldLength+(count-1)*gapLength))/2;
  for(let start=margin+phase;start<total-MIN;start+=weldLength+gapLength){if(distributionVersion>=2&&start+weldLength>total+EPS)break;const end=Math.min(total,start+weldLength);if(end-start>=MIN)ranges.push([start,end]);}
 }
 return ranges;
}
// A corner must lie inside a welded run or its gap, never at a run boundary.
// Join neighboring runs across such a boundary; if no neighbor exists, leave it empty.
export function avoidIntermittentCornerBoundaries(ranges,segments){
 const result=ranges.map(range=>[...range]);let distance=0;
 for(const [part,segment] of segments.slice(0,-1).entries()){
  distance+=pathLength(segment.pathPoints);
  const before=segment.pathPoints,after=segments[part+1].pathPoints,u=before.at(-1).map((v,i)=>v-before.at(-2)[i]),v=after[1].map((n,i)=>n-after[0][i]),den=Math.hypot(...u)*Math.hypot(...v);
  if(den&&u.reduce((sum,n,i)=>sum+n*v[i],0)/den>1-1e-8)continue;
  let index=result.findIndex(([start,end])=>Math.abs(start-distance)<EPS||Math.abs(end-distance)<EPS);
  if(index<0)continue;
  const atStart=Math.abs(result[index][0]-distance)<EPS,neighbor=atStart?index-1:index+1;
  if(neighbor>=0&&neighbor<result.length){const first=Math.min(index,neighbor),last=Math.max(index,neighbor);result.splice(first,2,[result[first][0],result[last][1]]);}
  else result.splice(index,1);
 }
 return result;
}
export function sliceWeldSegments(weld,start,end){
 let current={...weld,closure:'open',enabled:true};
 if(end<weld.length-EPS)current={...current,segments:splitWeldPreview(current,end).pieces[0]};
 if(start>EPS)current={...current,segments:splitWeldPreview(current,start).pieces[1]};
 return structuredClone(current.segments);
}
export function retainIntermittentWeld(weld,intermittent){
 if(!intermittent?.enabled||!intermittent.weldLength||!intermittent.gapLength||
    !weld.segments.every(segment=>weldPositionCode(segment.position??weld.position)==='PB'))return weld;
 const total=weld.segments.reduce((sum,segment)=>sum+pathLength(segment.pathPoints),0);
 const phase=intermittent.layout==='staggered'&&weld.intermittentPairId&&weld.intermittentSide===2?
   (intermittent.weldLength+intermittent.gapLength)/2:0;
 let ranges=intermittentRanges(total,{...intermittent,distributionVersion:3},phase);
 let at=0;
 const angles=mergeCornerAngles(weld.segments);
 for(const [index,segment] of weld.segments.slice(0,-1).entries()){
  at+=pathLength(segment.pathPoints);
  if(Math.abs(angles[index]-180)<1e-4)continue;
  ranges=ranges.filter(([,end])=>Math.abs(end-at)>EPS);
  const left=ranges.findLastIndex(([,end])=>end<at);
  const right=left+1;
  if(left>=0&&ranges[right]?.[0]>=at&&ranges[right][0]-ranges[left][1]<30)ranges.splice(left,2,[ranges[left][0],ranges[right][1]]);
 }
 return {...weld,intermittentRanges:ranges};
}
export function applyPlanningPathSettings(welds,options={}){
 const split=options.splitParameters||{},intermittent=options.intermittentParameters||{};
 if(!split.enabled&&!intermittent.enabled)return welds;
 if(options.planningRevision===3){
  const cut=split.enabled?applyPlanningPathSettings(welds,{splitParameters:split,modernLimit:true}):welds;
  return cut.map(weld=>{
   const range=weld.sourceEvidence?.pathSettings;
   const lengthBreak={type:'长度打断',breakReason:'长度打断'};
   const endpoints=range?{start:range.start>EPS?lengthBreak:weld.endpointFacts?.start,end:range.end<range.total-EPS?lengthBreak:weld.endpointFacts?.end}:weld.endpointFacts;
   return retainIntermittentWeld({...weld,endpointFacts:endpoints},intermittent);
  });
 }
 const limit=options.modernLimit?MAX_PLANNING_WELDS:MAX;
 const result=[];
 for(const weld of welds){
  const total=weld.segments.reduce((n,s)=>n+pathLength(s.pathPoints),0),source={...weld,length:total};
  const applyIntermittent=intermittent.enabled&&weld.segments.every(s=>['PB','PB · 横角焊','PB · 平角焊','平角焊','横角焊'].includes(s.position??weld.position));
  // A single side always uses chain layout. A staggered phase needs explicit side identity.
  const staggered=intermittent.layout==='staggered'&&weld.intermittentPairId&&weld.intermittentSide===2;
  let ranges=applyIntermittent?intermittentRanges(total,intermittent,staggered?(intermittent.weldLength+intermittent.gapLength)/2:0):[[0,total]];
  if(applyIntermittent&&intermittent.distributionVersion===2&&intermittent.avoidCorners)ranges=avoidIntermittentCornerBoundaries(ranges,weld.segments);
  const pieces=[];
  for(const [start,end] of ranges){
   if(split.enabled){
    if(!Number.isFinite(split.length)||split.length<MIN)throw Error('焊缝分段长度须至少为0.1 mm');
    if(Math.ceil((end-start)/split.length)>limit)throw Error('焊缝分段超过'+limit+'条，请增大长度');
    for(let at=start;at<end-EPS;){let next=Math.min(end,at+split.length);if(end-next<MIN)next=end;pieces.push([at,next]);at=next;}
   }else pieces.push([start,end]);
  }
  if(pieces.length===1&&pieces[0][0]===0&&Math.abs(pieces[0][1]-total)<EPS){result.push(weld);if(result.length>limit)throw Error('处理结果超过'+limit+'条，请增大分段或间断焊长度');continue;}
  pieces.forEach(([start,end],index)=>{
   const segments=sliceWeldSegments(source,start,end),length=segments.reduce((n,s)=>n+s.length,0);
   result.push({...weld,processingKey:`${weld.processingKey}:range:${start.toFixed(4)}:${end.toFixed(4)}`,name:`${weld.name} · ${applyIntermittent?'间断焊':'分段'}${index+1}`,closure:'open',segments,length,cornerAngles:mergeCornerAngles(segments),planned:false,startHole:start<EPS&&weld.startHole,endHole:end>total-EPS&&weld.endHole,sourceEvidence:{...weld.sourceEvidence,pathSettings:{sourceKey:weld.processingKey,start,end,total,split:structuredClone(split),intermittent:structuredClone(intermittent),intermittentApplied:!!applyIntermittent,effectiveLayout:staggered?'staggered':'chain'}}});
  });
  if(result.length>limit)throw Error('处理结果超过'+limit+'条，请增大分段或间断焊长度');
 }
 return result.map((w,i)=>({...w,id:'W'+(10001+i)}));
}
