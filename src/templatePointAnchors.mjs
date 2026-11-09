const makeAnchor=(kind,segment,percent,name)=>({id:crypto.randomUUID(),kind,segment,percent,name,offset:{x:0,y:0,z:0},angles:{advance:0,rotation:0,work:45},tracking:'无跟踪',overrides:{}});
export const isAnchor=p=>['start','end','junction','midpoint'].includes(p.kind);
export function initializeLocalControlPoints(t){return syncControlPoints({...t,localControlPointsVersion:1});}
export function syncControlPoints(t,migrateLegacy=false,layoutOnly=false) {
  const n=t.segments.length,old=t.points||[];
  if(old.some(p=>!['start','end','junction','midpoint','control'].includes(p.kind)))throw Error('存在不支持的点位类型');
  const local=t.type==='local'||t.type===undefined&&old.some(p=>p.anchorRole!==undefined);
  const start={...(old.find(p=>p.kind==='start'||p.anchorRole==='leading')||makeAnchor('start',1,0,'起点')),segment:1,percent:0};
  const end={...(old.find(p=>p.kind==='end'||p.anchorRole==='trailing')||makeAnchor('end',n,100,'终点')),segment:n,percent:100};
  const joints=Array.from({length:n-1},(_,i)=>({...old.find(p=>p.kind==='junction'&&!['leading','trailing'].includes(p.anchorRole)&&p.segment===i+1)||makeAnchor('junction',i+1,100,'段连接点'+(i+1)),segment:i+1,percent:100,name:'段连接点'+(i+1)}));
  let anchors=(local?joints:[start,...joints,end]).map((p,i)=>{const next={...p,kind:local?'junction':i===0?'start':i===n?'end':'junction',name:local?'段连接点'+(i+1):i===0?'起点':i===n?'终点':'段连接点'+i};if(local){next.anchorRole='connection';next.referenceId=p.referenceId??p.id;}else delete next.anchorRole;return next;});
  if(local&&n===3&&(t.localControlPointsVersion===1||old.some(p=>p.kind==='midpoint')))anchors.splice(1,0,{...(old.find(p=>p.kind==='midpoint')||makeAnchor('midpoint',2,50,'中间段中间点')),segment:2,percent:50,name:'中间段中间点',anchorRole:'midpoint'});
  anchors=anchors.map(p=>({...p,...(local?{referenceId:p.referenceId??p.id}:{})}));
  const first=anchors[0],connections=local?anchors:anchors.slice(1,-1);
  let controls=old.filter(p=>p.kind==='control'&&(!p.autoRole||local&&n>=2)).map(p=>{
    if(migrateLegacy&&p.referenceId===undefined&&!local){const ref=p.segment<=1?first:connections[Math.min(n-2,p.segment-2)]||first,along=(t.segments[Math.min(n-1,p.segment-1)].length||100)*p.percent/100;
      const migrated={...p,referenceId:ref.id,segment:ref.segment,percent:ref.percent,location:layoutOnly?{normal:0,height:0,...p.location,along}:undefined,...(!layoutOnly?{offset:{x:(p.offset?.x||0)+along,y:(p.offset?.y||0)+(p.location?.normal||0),z:(p.offset?.z||0)+(p.location?.height||0)}}:{})};if(!layoutOnly)delete migrated.location;return migrated;}
    const found=anchors.find(a=>a.id===p.referenceId),ref=p.autoRole==='after'&&old.filter(a=>a.kind==='junction'&&!['leading','trailing'].includes(a.anchorRole)).length!==n-1?anchors.find(a=>a.kind==='junction'&&a.segment===n-1):found;
    return {...p,referenceId:ref?.id||'',segment:ref?.segment||Math.min(n,p.segment),percent:ref?.percent??p.percent};
  });
  if(local&&n>=2&&t.localControlPointsVersion===1){
    for(const [role,ref,sign,name] of [['before',joints[0],-1,'首连接点前控制点'],['after',joints.at(-1),1,'末连接点后控制点']]){
      if(!controls.some(p=>p.autoRole===role)){const p=makeAnchor('control',ref.segment,100,name);p.referenceId=ref.id;p.autoRole=role;p.offset.x=sign*Math.min(10,t.segments[role==='before'?0:n-1].length/2);controls.push(p);}
    }
  }
  return {...t,points:[...anchors,...controls]};
}
