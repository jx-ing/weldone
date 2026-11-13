import {validGroove} from './grooveModel.mjs';
import {weldForm} from './planningRequirements.mjs';
import {autoWeldReferenceNormal} from './weldDirectionGeometry.mjs';
export const EXAMPLE_MODEL='111.step';
export function useStepExample(draft){
  if(draft.model!==''&&draft.model!=='肋板组件 A')return draft;
  return {...draft,...(draft.model?{previousExample:{model:draft.model,welds:draft.welds,selected:draft.selected}}:{}),model:EXAMPLE_MODEL,welds:[],selected:''};
}
export const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const unit=v=>{const l=Math.hypot(...v);return v.map(n=>n/(l||1));};
const sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const pathLength=points=>points.reduce((n,p,i)=>n+(i?distance(points[i-1],p):0),0);
// Keep lateral control-point movement horizontal, even on an inclined weld face.
export function horizontalWeldNormal(tangent,preferred=[0,1,0]){
  let normal=[-tangent[1],tangent[0],0];
  if(Math.hypot(...normal)<1e-8){normal=[preferred[0],preferred[1],0];if(Math.hypot(...normal)<1e-8)normal=[1,0,0];}
  normal=unit(normal);return dot(normal,preferred)<0?normal.map(v=>-v):normal;
}
function manualWeldFrame(point,next,offset,reference){
  const tangent=unit(sub(next,point)),position=point.map((value,i)=>value+tangent[i]*offset);
  let normal=cross(reference,tangent);
  if(Math.hypot(...normal)<1e-6)normal=cross([0,1,0],tangent);
  return {position,tangent,normal:unit(normal)};
}
const fallbackFrame=point=>({position:point,tangent:[1,0,0],normal:[0,1,0]});
export function prepareManualWeldPath(segments,referenceNormal){
  const points=segments.flatMap(s=>s.pathPoints),total=pathLength(points);
  const closed=distance(points[0],points.at(-1))<.5;
  const reference=referenceNormal||segments.find(s=>s.referenceNormal)?.referenceNormal||[0,0,1];
  const edges=[];
  let start=0;
  for(let i=1;i<points.length;i++){
    const length=distance(points[i-1],points[i]);
    if(length<1e-8)continue;
    edges.push({point:points[i-1],next:points[i],start,end:start+length,last:i===points.length-1});
    start+=length;
  }
  return at=>{
    if(!edges.length)return fallbackFrame(points[0]);
    const station=closed&&total&&(at<0||at>total)?((at%total)+total)%total:at;
    let lo=0,hi=edges.length-1;
    while(lo<hi){
      const mid=Math.floor((lo+hi)/2);
      if(station<edges[mid].end-1e-8)hi=mid;
      else lo=mid+1;
    }
    const edge=edges[lo];
    return edge.last||station<edge.end-1e-8?manualWeldFrame(edge.point,edge.next,station-edge.start,reference):fallbackFrame(points[0]);
  };
}
export function sampleManualWeldPath(segments,at,referenceNormal){
  const points=segments.flatMap(s=>s.pathPoints),total=pathLength(points);
  let left=distance(points[0],points.at(-1))<.5&&total&&(at<0||at>total)?((at%total)+total)%total:at;
  for(let i=1;i<points.length;i++){
    const length=distance(points[i-1],points[i]);
    if(length<1e-8)continue;
    if(left<length-1e-8||i===points.length-1){
      const reference=referenceNormal||segments.find(s=>s.referenceNormal)?.referenceNormal||[0,0,1];
      return manualWeldFrame(points[i-1],points[i],left,reference);
    }
    left-=length;
  }
  return fallbackFrame(points[0]);
}
export function pathGeometry(points){
  const chord=sub(points.at(-1),points[0]),length=pathLength(points);
  if(length-distance(points[0],points.at(-1))<.01)return {geometry:'直线'};
  if(points.length>=3){const a=points[0],b=points[Math.floor((points.length-1)/3)],c=points[Math.floor((points.length-1)*2/3)],u=sub(b,a),v=sub(c,a),n=cross(u,v),nn=dot(n,n);
    if(nn>1e-8){const center=a.map((x,i)=>x+(dot(u,u)*cross(v,n)[i]+dot(v,v)*cross(n,u)[i])/(2*nn)),radius=distance(a,center),normal=unit(n);
      if(points.every(p=>Math.abs(distance(p,center)-radius)<.25&&Math.abs(dot(sub(p,a),normal))<.1))return {geometry:'圆弧',shape:{radius,arcAngle:Math.min(360,length/radius*180/Math.PI),direction:'left'}};
    }
  }
  return {geometry:'曲线',shape:{bend:30,direction:'left'}};
}
export function appendPickedEdge(segments,edge){
  if(segments.length>=30)throw Error('每条焊道最多支持 30 个焊缝段');
  let points=edge.points.map(p=>[...p]);if(points.length<2||pathLength(points)<.1)throw Error('所选边线过短');
  if(segments.length){const end=segments.at(-1).points.at(-1);if(distance(end,points[0])>.5){if(distance(end,points.at(-1))<=.5)points.reverse();else throw Error('请选择与当前终点相接的模型边线');}points[0]=[...end];}
  return [...segments,{edgeId:edge.id,part:edge.part,points,...(edge.referenceNormal?{referenceNormal:edge.referenceNormal}:{})}];
}
export function appendPickedPoint(segments,point,start){
  const end=segments.at(-1)?.points.at(-1)||start;
  if(!end)return {segments,start:point};
  if(distance(end,point)<.1)throw Error('请选择与当前点不同的位置');
  if(segments.length>=30)throw Error('每条焊道最多支持 30 个焊缝段');
  return {segments:[...segments,{points:[[...end],[...point]]}],start:start||end};
}
export function createManualWeld(existing,segments,settings){
  if(!segments.length)throw Error('请先在模型上选择边线或至少两个点');
  if(settings.groove&&!validGroove(settings.groove))throw Error('请完善坡口角度、深度、根部间隙和根部半径，尺寸必须为非负数');
  if(!settings.name.trim())throw Error('请输入焊道名称');
  if(!Number.isFinite(settings.leg)||settings.leg<.5||!Number.isInteger(settings.leg*2))throw Error('焊脚应为正数，步长 0.5 mm');
  let number=1;while(existing.some(w=>w.id===`W${String(number).padStart(3,'0')}`))number++;
  const metric=v=>Math.round(v*10000)/10000;
  const seq=segments.map(s=>{const shape=pathGeometry(s.points);return {position:s.position||settings.position,...shape,length:metric(pathLength(s.points)),pathPoints:structuredClone(s.points),...(s.edgeId?{edgeId:s.edgeId}:{}),...(s.part!==undefined?{part:s.part}:{}),...(s.referenceNormal?{referenceNormal:structuredClone(s.referenceNormal)}:{}),...(s.startReferenceNormal?{startReferenceNormal:structuredClone(s.startReferenceNormal)}:{}),...(s.endReferenceNormal?{endReferenceNormal:structuredClone(s.endReferenceNormal)}:{})};});
  const closed=distance(seq[0].pathPoints[0],seq.at(-1).pathPoints.at(-1))<.5;
  if(!closed&&seq.some(s=>s.geometry==='圆弧'))seq.forEach(s=>{if(s.geometry==='圆弧')s.geometry='曲线';});
  const cornerAngles=seq.slice(1).map((s,i)=>{const before=seq[i].pathPoints,after=s.pathPoints,a=unit(sub(before.at(-2),before.at(-1))),b=unit(sub(after[1],after[0]));return metric(Math.acos(Math.max(-1,Math.min(1,dot(a,b))))*180/Math.PI);});
  return {id:`W${String(number).padStart(3,'0')}`,name:settings.name.trim(),source:'manual',model:EXAMPLE_MODEL,cornerReferenceNormal:autoWeldReferenceNormal(seq),cornerReferenceMode:'auto',enabled:true,planned:false,completeStart:true,completeEnd:true,closure:closed?'closed':'open',length:metric(seq.reduce((n,s)=>n+s.length,0)),leg:settings.leg,position:settings.position,weldType:weldForm(settings),segments:seq,cornerAngles,groove:structuredClone(settings.groove||{type:'无坡口',angle:0,depth:0}),startHole:!!settings.startHole,endHole:!!settings.endHole,atConnection:seq.length>1,current:210,voltage:24.5,speed:340,template:'',direction:'正向',arcDelay:.3};
}
export function validManualWeldPath(w,model=EXAMPLE_MODEL){return !['manual','manual-merge'].includes(w.source)||w.model===model&&Array.isArray(w.segments)&&w.segments.length>0&&w.segments.length<=30&&w.segments.every(s=>Array.isArray(s.pathPoints)&&s.pathPoints.length>=2&&s.pathPoints.length<=20000&&s.pathPoints.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite))&&Number.isFinite(s.length)&&s.length>=.1&&Math.abs(pathLength(s.pathPoints)-s.length)<.01);}
