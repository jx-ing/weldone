import {pathLength} from './manualWeldModel.mjs';

export const ALLOCATION_FIELDS=[
 ['blockX','区域 X','mm',1800,100,100000],
 ['blockY','区域 Y','mm',1800,100,100000],
 ['overlap','共享区宽度','mm',250,0,10000],
 ['speed','估算焊速','mm/s',6,.01,100],
 ['measureSeconds','测量权重','s',3,0,600],
 ['wrapSeconds','包角权重','s',2,0,600]
];
export const DEFAULT_ALLOCATION=Object.freeze(Object.fromEntries(ALLOCATION_FIELDS.map(([key,,,value])=>[key,value])));

export function allocationIssues(values){
 return ALLOCATION_FIELDS.flatMap(([key,label,unit,,min,max])=>{
  const value=values[key];
  return Number.isFinite(value)&&value>=min&&value<=max?[]:[{
   field:'allocationParameters.'+key,message:label+'须为 '+min+'–'+max+' '+unit
  }];
 });
}

function weldWork(weld,settings){
 const segments=weld.segments??[];
 const points=segments.flatMap(segment=>segment.pathPoints??[]);
 if(points.length<2||!points.every(point=>point.length===3&&point.every(Number.isFinite)))return;
 const length=segments.reduce((sum,segment)=>sum+pathLength(segment.pathPoints??[]),0);
 if(length<=1e-6)return;
 let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,centerX=0,centerY=0;
 for(const [x,y] of points){
  minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
  centerX+=x;centerY+=y;
 }
 centerX/=points.length;centerY/=points.length;
 const ends=weld.closure==='closed'?[]:[['start',segments[0]],['end',segments.at(-1)]];
 let seconds=length/settings.speed;
 for(const [side,segment] of ends){
  const facts=weld.endpointFacts?.[side]??segment.endpointFacts?.[side];
  const wrap=segment[side+'WrapKind'];
  if(facts?.free===true||facts?.boundaryKind==='free-edge'||facts?.type==='自由端'||facts?.type==='free')seconds+=settings.measureSeconds;
  if(facts?.wrap===true||['L','U','vertical','verticalL'].includes(wrap))seconds+=settings.wrapSeconds;
 }
 const key=(weld.sourceSha256??weld.model??'')+':'+(weld.processingKey??weld.id);
 return {weldId:weld.id,key,length,seconds,minX,maxX,minY,maxY,centerX,centerY};
}

function coveredLength(weld,low,high){
 let length=0;
 for(const {pathPoints=[]} of weld.segments)for(let index=1;index<pathPoints.length;index++){
  const a=pathPoints[index-1],b=pathPoints[index];
  const dx=b[0]-a[0],span=Math.hypot(dx,b[1]-a[1],b[2]-a[2]);
  if(Math.abs(dx)<1e-8){
   if(a[0]>=low&&a[0]<=high)length+=span;
   continue;
  }
  const enter=(low-a[0])/dx,exit=(high-a[0])/dx;
  const fraction=Math.min(1,Math.max(enter,exit))-Math.max(0,Math.min(enter,exit));
  length+=span*Math.max(0,fraction);
 }
 return length;
}

/** Whole-weld region, S-order and shared-zone workload algorithm from the simulation partition. */
export function partitionWelds(welds,robots,raw={}){
 const settings={...DEFAULT_ALLOCATION,...raw};
 if(!robots.length||allocationIssues(settings).length)return [];
 const tasks=welds.filter(weld=>weld.enabled&&!weld.mergedInto&&!weld.splitInto)
  .map(weld=>weldWork(weld,settings)).filter(Boolean);
 if(!tasks.length)return tasks;
 let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
 for(const task of tasks){
  minX=Math.min(minX,task.minX);maxX=Math.max(maxX,task.maxX);minY=Math.min(minY,task.minY);maxY=Math.max(maxY,task.maxY);
 }
 const columns=Math.max(1,Math.ceil((maxX-minX)/settings.blockX));
 const rows=Math.max(1,Math.ceil((maxY-minY)/settings.blockY));
 const laneWidth=Math.max(1,(maxX-minX)/robots.length);
 const halfOverlap=settings.overlap/2;
 const active=new Set(robots.map(robot=>robot.id));
 const byId=new Map(welds.map(weld=>[weld.id,weld]));
 const lanes=robots.map((robot,index)=>({id:robot.id,
  low:minX+index*laneWidth-halfOverlap,high:minX+(index+1)*laneWidth+halfOverlap}));
 const loads=new Map(robots.map(robot=>[robot.id,0]));
 for(const task of tasks){
  const column=Math.min(columns-1,Math.floor((task.centerX-minX)/settings.blockX));
  const row=Math.min(rows-1,Math.floor((task.centerY-minY)/settings.blockY));
  task.block=(row+1)+'-'+(column+1);
  task.order=row*columns+(row%2?columns-1-column:column);
  task.candidates=lanes.filter(({low,high})=>task.minX>=low-1e-6&&task.maxX<=high+1e-6).map(lane=>lane.id);
  const override=settings.overrides?.[task.key];
  task.manual=active.has(override);
  task.robotId=task.manual?override:null;
  if(task.manual)loads.set(override,loads.get(override)+task.seconds);
 }
 const priority=task=>task.candidates.length===1?0:task.candidates.length===0?1:2;
 const preferred=tasks.filter(task=>!task.manual)
  .sort((a,b)=>priority(a)-priority(b)||a.candidates.length-b.candidates.length||b.seconds-a.seconds||a.weldId.localeCompare(b.weldId));
 for(const task of preferred){
  let candidates=task.candidates;
  if(!candidates.length){
   const coverage=lanes.map(({id,low,high})=>({id,length:coveredLength(byId.get(task.weldId),low,high)}));
   const best=Math.max(...coverage.map(lane=>lane.length));
   candidates=coverage.filter(lane=>best-lane.length<=1e-6).map(lane=>lane.id);
  }
  const robot=[...candidates].sort((a,b)=>loads.get(a)-loads.get(b)||a.localeCompare(b))[0];
  task.robotId=robot;
  loads.set(robot,loads.get(robot)+task.seconds);
 }
 const average=tasks.reduce((sum,task)=>sum+task.seconds,0)/robots.length;
 for(let pass=0;pass<4;pass++){
  let changed=false;
  for(const task of preferred){
   if(task.candidates.length<2)continue;
   for(const next of task.candidates){
    if(next===task.robotId)continue;
    const previous=task.robotId,a=loads.get(previous),b=loads.get(next);
    const score=(x,y)=>Math.abs(x-average)+Math.abs(y-average);
    if(score(a-task.seconds,b+task.seconds)+1e-6>=score(a,b))continue;
    loads.set(previous,a-task.seconds);
    loads.set(next,b+task.seconds);
    task.robotId=next;
    changed=true;
    break;
   }
  }
  if(!changed)break;
 }
 return tasks.sort((a,b)=>a.order-b.order||a.weldId.localeCompare(b.weldId));
}
