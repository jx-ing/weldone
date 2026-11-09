import {MAX_PLANNING_WELDS,weldForm} from './planningRequirements.mjs';
import {sameGroove} from './grooveModel.mjs';
import {connectSegmentIntersections,mergeCornerAngles} from './mergeIntersectionGeometry.mjs';
import {distance,EXAMPLE_MODEL} from './manualWeldModel.mjs';
function boundarySegment(w,end,previous){const list=w.segments.filter(s=>!s.connectionGap),segment=structuredClone(end?list.at(-1):list[0]);if(previous?!end:!!end)segment.pathPoints.reverse();return segment;}
const endpoint=(w,e)=>e?w.segments.at(-1).pathPoints.at(-1):w.segments[0].pathPoints[0];
export function mergeWeldPreview(welds,ids,maxGap=.001,settings){
  const modern=settings?.planningRevision===3;
  const selected=ids.map(id=>welds.find(w=>w.id===id)),errors=[];
  if(ids.length<2||new Set(ids).size!==ids.length)return {ok:false,errors:['请至少选择两条不同焊道']};
  if(ids.length>30)return {ok:false,errors:['一次最多合并30条焊道']};
  if(selected.some(w=>!w||!w.enabled||w.mergedInto||w.splitInto))return {ok:false,errors:['仅可合并当前启用且未被合并的焊道']};
  if(selected.some(w=>w.model!==EXAMPLE_MODEL||!w.segments?.length||w.segments.some(s=>!s.pathPoints?.length)))return {ok:false,errors:['所选焊道必须来自同一模型并具有真实路径']};
  if(selected.some(w=>w.closure==='closed'))errors.push('闭合焊道不能再与其他焊道串接');
  const requiresTemplate=selected.some(w=>w.leg!==selected[0].leg||w.position!==selected[0].position||w.joint!==selected[0].joint||weldForm(w)!==weldForm(selected[0]));
  if(!modern&&selected.some(w=>w.leg!==selected[0].leg))errors.push('所选焊道焊脚不一致');
  if(errors.length)return {ok:false,errors};
  for(let i=0;i<selected.length;i++)for(let j=i+1;j<selected.length;j++){const a=selected[i].segments.flatMap(s=>s.pathPoints),b=selected[j].segments.flatMap(s=>s.pathPoints);if(a.length===b.length&&(a.every((p,k)=>distance(p,b[k])<.01)||a.every((p,k)=>distance(p,b[b.length-1-k])<.01)))return {ok:false,errors:['所选焊道包含重叠的重复路径，不能合并']};}
  const links=new Map(),neighbors=selected.map(()=>new Set()),candidates=[],endpointHits=new Map();
  const parent=selected.map((_,i)=>i),root=i=>parent[i]===i?i:(parent[i]=root(parent[i]));
  for(let i=0;i<selected.length;i++)for(let j=i+1;j<selected.length;j++)for(let a=0;a<2;a++)for(let b=0;b<2;b++){
    const gap=distance(endpoint(selected[i],a),endpoint(selected[j],b));if(maxGap!==null&&gap>maxGap){
      const maxHole=settings?.mergeParameters?.passHoleSize??15;
      const facts=[selected[i].endpointFacts?.[a?'end':'start'],selected[j].endpointFacts?.[b?'end':'start']];
      if(!modern||gap>=maxHole||!facts.some(value=>Number.isFinite(value?.holeSize)&&value.holeSize<maxHole)||facts.some(value=>value?.hasHole&&(!Number.isFinite(value.holeSize)||value.holeSize>=maxHole)))continue;
    }
    if(gap<.001){for(const k of [`${i}:${a}`,`${j}:${b}`]){endpointHits.set(k,(endpointHits.get(k)||0)+1);if(endpointHits.get(k)>1)return {ok:false,errors:['所选焊道端点存在分叉或重叠，无法确定唯一连接顺序，请减少选择']};}}
    candidates.push({i,j,a,b,gap});
  }
  const failures=[];
  candidates.sort((a,b)=>a.gap-b.gap||a.i-b.i||a.j-b.j||a.a-b.a||a.b-b.b);
  for(const {i,j,a,b,gap} of candidates){const ka=`${i}:${a}`,kb=`${j}:${b}`;if(links.has(ka)||links.has(kb)||root(i)===root(j))continue;try{connectSegmentIntersections([boundarySegment(selected[i],a,true),boundarySegment(selected[j],b,false)]);}catch(error){failures.push(error.message);continue;}links.set(ka,{index:j,end:b,gap});links.set(kb,{index:i,end:a,gap});neighbors[i].add(j);neighbors[j].add(i);parent[root(i)]=root(j);}
  const reached=new Set(),visit=i=>{if(reached.has(i))return;reached.add(i);neighbors[i].forEach(visit);};visit(0);
  if(reached.size!==selected.length)return {ok:false,errors:[`不允许非连续焊缝合并：所选焊缝未首尾相接${maxGap===null?'；'+(failures[0]||'无法确定唯一端点连接顺序'):''}`]};
  let free=[];selected.forEach((w,i)=>{for(let e=0;e<2;e++)if(!links.has(`${i}:${e}`))free.push({index:i,end:e});});
  if(free.length===2&&distance(endpoint(selected[free[0].index],free[0].end),endpoint(selected[free[1].index],free[1].end))<.001){const a=free[0],b=free[1];links.set(`${a.index}:${a.end}`,{index:b.index,end:b.end,gap:0});links.set(`${b.index}:${b.end}`,{index:a.index,end:a.end,gap:0});free=[];}
  if(free.length!==0&&free.length!==2)return {ok:false,errors:['所选焊道不能形成连续路径']};
  const closed=free.length===0,order=[],seen=new Set();let current=free[0]||{index:0,end:0};
  while(!seen.has(current.index)){seen.add(current.index);order.push({weld:selected[current.index],reverse:current.end===1});const next=links.get(`${current.index}:${1-current.end}`);if(!next)break;current={index:next.index,end:next.end};}
  if(order.length!==selected.length)return {ok:false,errors:['所选焊道包含独立环路，不能合并']};
  let segments=[];
  for(const row of order){let next=structuredClone(row.weld.segments).map(s=>({...s,...(!s.referenceNormal&&row.weld.cornerReferenceNormal?{referenceNormal:row.weld.cornerReferenceNormal}:{})}));if(row.reverse)next=next.reverse().map(s=>({...s,pathPoints:s.pathPoints.reverse(),startReferenceNormal:s.endReferenceNormal,endReferenceNormal:s.startReferenceNormal}));segments.push(...next);}
  let joined;try{joined=connectSegmentIntersections(segments,{closed});}catch(error){return {ok:false,errors:[error.message]};}
  segments=joined.segments;if(segments.length>30)return {ok:false,errors:['合并后超过30段，请减少选择']};
  return {ok:true,errors:[],requiresTemplate:modern&&requiresTemplate,order,...joined,closed,gapCheckEnabled:maxGap!==null,cornerAngles:mergeCornerAngles(segments)};
}
export function mergeSelectedWelds(d,ids,settings){
  const preview=mergeWeldPreview(d.welds,ids,.001,settings);if(!preview.ok)throw Error(preview.errors.join('；'));
  if(d.welds.length>=MAX_PLANNING_WELDS)throw Error('工作区已达到焊道上限，请先另存');
  let n=settings?.planningRevision===3?Math.max(0,...d.welds.map(w=>Number(w.id.slice(1))||0))+1:1;const used=new Set(d.welds.map(w=>w.id));while(used.has('W'+String(n).padStart(3,'0')))n++;
  const id='W'+String(n).padStart(3,'0'),first=preview.order[0],last=preview.order.at(-1),grooves=preview.order.map(r=>r.weld.groove),groove=grooves.every(g=>sameGroove(g,grooves[0]))?structuredClone(grooves[0]):{type:'待确认',angle:null,depth:null};
  const merged={id,name:`多选合并 ${ids.length} 条`,...(settings?.planningRevision===3?{templateRequired:preview.requiresTemplate,weldType:weldForm(first.weld),machineCount:first.weld.machineCount,endpointFacts:{start:first.weld.endpointFacts?.[first.reverse?'end':'start'],end:last.weld.endpointFacts?.[last.reverse?'start':'end']}}:{}),source:'manual-merge',model:d.model,enabled:true,planned:false,completeStart:true,completeEnd:true,closure:preview.closed?'closed':'open',length:preview.length,leg:first.weld.leg,position:preview.segments.every(s=>s.position===preview.segments[0].position)?preview.segments[0].position:'混合位置（逐段设置）',mergeIntersections:preview.connections,gapConnectionMode:'intersection',joint:preview.segments.every(s=>s.joint===preview.segments[0].joint)?preview.segments[0].joint:'待确认',segments:preview.segments,cornerAngles:preview.cornerAngles,groove,startHole:!!first.weld[first.reverse?'endHole':'startHole'],endHole:!!last.weld[last.reverse?'startHole':'endHole'],atConnection:true,current:null,voltage:null,speed:null,template:'',direction:'正向',mergedFrom:preview.order.map(r=>({id:r.weld.id,name:r.weld.name,reversed:r.reverse})),mergeHistory:{originals:structuredClone(preview.order.map(r=>r.weld)),selected:d.selected}};
  return {...d,welds:[...d.welds.map(w=>ids.includes(w.id)?{...w,enabled:false,planned:false,mergedInto:id}:w),merged],selected:id,...(settings?.planningRevision===3?{manualEditHistory:[...(d.manualEditHistory??[]),{kind:'merge',id}]}:{})};
}
export function undoManualMerge(d,id){const merged=d.welds.find(w=>w.id===id);if(!merged?.mergeHistory)throw Error('未找到可撤销的合并记录');if(merged.mergedInto||merged.splitInto)throw Error('请先撤销包含此焊道的后续合并或打断');const originals=merged.mergeHistory.originals,restored=new Map(originals.map(w=>[w.id,w]));const welds=d.welds.filter(w=>w.id!==id).map(w=>restored.get(w.id)||w);for(const w of originals)if(!welds.some(x=>x.id===w.id))welds.push(w);return {...d,welds,selected:originals[0].id};}
