const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),sub=(a,b)=>a.map((v,i)=>v-b[i]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const validReferenceNormal=n=>Array.isArray(n)&&n.length===3&&n.every(Number.isFinite)&&Math.hypot(...n)>1e-9;
const unit=v=>{const len=Math.hypot(...v);return len>1e-12?v.map(x=>Math.abs(x/len)<1e-14?0:x/len):null;};
export const REFERENCE_PLANES=[['xy+','XY 正面（+Z）',[0,0,1]],['xy-','XY 背面（−Z）',[0,0,-1]],['xz+','XZ 正面（−Y）',[0,-1,0]],['xz-','XZ 背面（+Y）',[0,1,0]],['yz+','YZ 正面（+X）',[1,0,0]],['yz-','YZ 背面（−X）',[-1,0,0]]];
function tangent(points,end){if(!points?.length)return null;const anchor=end?points.at(-1):points[0];for(let step=1;step<points.length;step++){const v=end?sub(anchor,points[points.length-1-step]):sub(points[step],anchor),t=unit(v);if(t)return t;}return null;}
function canonical(normal){const n=unit(normal);if(!n)return null;let axis=2;for(const i of [1,0])if(Math.abs(n[i])>Math.abs(n[axis])+1e-10)axis=i;return n[axis]<0?n.map(v=>v===0?0:-v):n;}
function stablePerpendicular(direction){for(const axis of [[0,0,1],[0,1,0],[1,0,0]]){const d=dot(axis,direction),n=unit(axis.map((v,i)=>v-d*direction[i]));if(n)return canonical(n);}return [0,0,1];}
function chooseNormal(normals,incoming,bend){
  const candidates=normals.filter(validReferenceNormal).map(unit).sort((a,b)=>{for(let i=0;i<3;i++)if(Math.abs(a[i]-b[i])>1e-10)return a[i]-b[i];return 0;});
  if(bend){return candidates.map(n=>({n,score:Math.abs(dot(n,bend))})).filter(v=>v.score>1e-8).sort((a,b)=>b.score-a.score)[0]?.n||null;}
  return candidates.find(n=>Math.abs(dot(n,incoming))<.999999)||null;
}
const normalsOf=s=>[s?.referenceNormal,s?.startReferenceNormal,s?.endReferenceNormal];
export function autoWeldReferenceNormal(segments=[]){
  const all=segments.flatMap(normalsOf),first=segments.map(s=>tangent(s.pathPoints,false)).find(Boolean)||[1,0,0];
  for(let i=0;i<segments.length-1;i++){const a=tangent(segments[i].pathPoints,true),b=tangent(segments[i+1].pathPoints,false);if(!a||!b)continue;const bend=unit(cross(a,b));if(bend)return chooseNormal(all,a,bend)||canonical(bend);}
  return chooseNormal(all,first,null)||stablePerpendicular(first);
}
function solveCorner(before,after,primary=[],fallback=[],measureCorner){
  const incoming=tangent(before?.pathPoints,true),outgoing=tangent(after?.pathPoints,false);
  if(!incoming||!outgoing)return {angle:null,angleSide:null,reason:'缺少有效的焊道切向'};
  const cosine=Math.max(-1,Math.min(1,dot(incoming,outgoing))),turn=Math.acos(cosine)*180/Math.PI,bend=unit(cross(incoming,outgoing));
  const model=chooseNormal(primary,incoming,bend)||chooseNormal(fallback,incoming,bend),normal=model||canonical(bend||[])||stablePerpendicular(incoming);
  const common={referenceNormal:normal,referenceSource:model?'model':bend?'path':'axis'};
  if(turn<1e-6)return {angle:180,angleSide:'straight',turn:0,...common};
  if(!bend)return {angle:0,angleSide:measureCorner?null:'inner',turn:180,boundaryTurn:true,...common,
    ...(measureCorner?{cornerSource:'solid',reason:'两段折返重合，无法区分开口扇区'}:{})};
  const left=dot(bend,normal)>0;
  const measured=measureCorner?.({before,after,normal,incoming,outgoing});
  const angleSide=measured===undefined?(left?'inner':'outer'):measured;
  return {...common,turn:left?turn:-turn,angleSide,
    angle:angleSide?Math.round((angleSide==='inner'?180-turn:180+turn)*10000)/10000:null,
    ...(measured!==undefined?{cornerSource:'solid',...(angleSide?{}:{reason:'转角两侧的实体与空域证据不足'})}:{})};
}
export function directedCorner(before,after,referenceNormal){return solveCorner(before,after,[referenceNormal]);}
const declared=a=>Number.isFinite(a)&&a>=0&&a<=360?{angle:a,angleSide:a===180?'straight':a>180?'outer':'inner',declared:true}:{angle:null,angleSide:null,reason:'缺少有效转角数据'};
export function measureDirectedConnection(w,before,after,measureCorner){
  if(before?.pathPoints?.length&&after?.pathPoints?.length)return solveCorner(before,after,[before.endReferenceNormal,before.referenceNormal,after.startReferenceNormal,after.referenceNormal],w.cornerReferenceMode==='auto'?[]:[w.cornerReferenceNormal],measureCorner);
  return null;
}
const reverseSegment=s=>({...s,pathPoints:s.pathPoints?.slice().reverse(),
  startReferenceNormal:s.endReferenceNormal,endReferenceNormal:s.startReferenceNormal,
  ...(s.endpointFacts?{endpointFacts:{...s.endpointFacts,start:s.endpointFacts.end,end:s.endpointFacts.start}}:{}),
  startWrapMode:s.endWrapMode,endWrapMode:s.startWrapMode,mainEdgeStart:s.mainEdgeEnd,mainEdgeEnd:s.mainEdgeStart});
const reverseEnds=w=>({completeStart:w.completeEnd,completeEnd:w.completeStart,startHole:w.endHole,endHole:w.startHole,
  startWrapMode:w.endWrapMode,endWrapMode:w.startWrapMode,
  ...(w.endpointFacts?{endpointFacts:{...w.endpointFacts,start:w.endpointFacts.end,end:w.endpointFacts.start}}:{})});
const reverseCorner=corner=>corner&&({...corner,turn:-corner.turn});

export function reverseWeldTraversal(w){
  return {...w,...reverseEnds(w),segments:w.segments.slice().reverse().map(reverseSegment),
    sourceSegmentIndices:w.sourceSegmentIndices?.slice().reverse(),cornerDirections:w.cornerDirections.slice().reverse().map(reverseCorner),
    cornerAngles:w.cornerAngles.slice().reverse(),closingCorner:reverseCorner(w.closingCorner)};
}

export function directedWeld(w,measureCorner){
  if(!w)return w;
  if(w.pathDirectionResolved){
    if(!measureCorner||w.cornerGeometryMeasured)return w;
    const {direction,sourceSegmentIndices,...resolved}=w;
    const measured=directedWeld({...resolved,pathDirectionResolved:false},measureCorner);
    return {...measured,direction,sourceSegmentIndices};
  }
  const original=w.segments||[],reverse=w.direction==='反向';
  const sourceSegmentIndices=original.map((_,i)=>i);if(reverse)sourceSegmentIndices.reverse();
  const segments=sourceSegmentIndices.map(i=>reverse?reverseSegment(original[i]):original[i]);
  const declaredAngles=reverse?[...(w.cornerAngles||[])].reverse().map(a=>Number.isFinite(a)?360-a:a):w.cornerAngles||[];
  const count=segments.every(s=>s.pathPoints?.length>=2)?Math.max(0,segments.length-1):declaredAngles.length;
  const cornerDirections=Array.from({length:count},(_,i)=>measureDirectedConnection(w,segments[i],segments[i+1],measureCorner)||declared(declaredAngles[i]));
  const closingCorner=(w.closure==='closed'||w.closed===true)&&segments.length>1?
    measureDirectedConnection(w,segments.at(-1),segments[0],measureCorner):null;
  return {...w,pathDirectionResolved:true,cornerGeometryMeasured:cornerDirections.some(c=>c.cornerSource==='solid'),sourceSegmentIndices,segments,cornerDirections,
    cornerAngles:cornerDirections.map((c,i)=>c.cornerSource==='solid'?c.angle:c.angle??declaredAngles[i]),closingCorner,
    cornerReferenceNormal:measureDirectedConnection(w,original[0],original[1])?.referenceNormal||autoWeldReferenceNormal(original),
    cornerReferenceMode:'auto',...(reverse?reverseEnds(w):{})};
}
export function directedClosingCorner(w){const v=directedWeld(w);return v.closingCorner||measureDirectedConnection(v,v.segments.at(-1),v.segments[0])||declared(v.cornerAngles[v.segments.length-1]);}
