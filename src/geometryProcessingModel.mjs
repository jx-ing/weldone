import {extractedEndpointFacts,measuredSegmentFacts} from './extractedWeldFacts.mjs';
import {MAX_PLANNING_WELDS,legacyWeldForm,roundWeldLeg,weldPositionCode} from './planningRequirements.mjs';
import {normalizeWeldGroove,sameGroove,noGroove} from './grooveModel.mjs';
import {CONFIRMED_NON_WELD_IDS,excludeConfirmedNonWelds,isConfirmedNonWeldKey} from './confirmedNonWelds.mjs';
import {connectSegmentIntersections,intersectSegmentEnds,INTERSECTION_TOLERANCE,mergeCornerAngles} from './mergeIntersectionGeometry.mjs';
import {pathLength,pathGeometry,distance,EXAMPLE_MODEL} from './manualWeldModel.mjs';
import {normalizeVerticalWeld,weldTravelReversed} from './weldDirectionGeometry.mjs';
import {POSITIONS} from './templateModel.mjs';
import {DEFAULT_MERGE_ANGLE_RANGE,DEFAULT_MERGE_GAP} from './planningConfiguration.mjs';
export const DEMO_SOURCE_SHA256='c85056ed9022210cd93e48bc4d09b97615c57a70235f4f55d986e6a2bdec4fc8';
export const DEFAULT_GEOMETRY_OPTIONS={mergeGapCheck:false,offset:50,extendThreshold:50,offsetThreshold:50,thicknessWeldThresholdMm:50,mergeParams:{最小通过高度:25,最长通过距离:45,夹角阈值下限:DEFAULT_MERGE_ANGLE_RANGE.angleMin,夹角阈值上限:DEFAULT_MERGE_ANGLE_RANGE.angleMax,长度阈值下限:0,长度阈值上限:99999,最大合并距离:DEFAULT_MERGE_GAP}};
const metric=v=>Math.round(v*10000)/10000;
const measuredLength=points=>{const length=pathLength(points);return metric(length)||length;};
function grooveOf(source){const raw=source.properties?.坡口||{},v=raw.参数||{};if(raw.类型==='无坡口')return {type:'无坡口',angle:0,depth:0};return normalizeWeldGroove({type:raw.类型,angle:Number.isFinite(v.坡口角度)?v.坡口角度:null,depth:Number.isFinite(v.坡口深度)?v.坡口深度:null,...(Number.isFinite(v.钝边长度)?{rootFace:v.钝边长度}:{}),...(Number.isFinite(v.根部间隙)?{rootGap:v.根部间隙}:{}),...(Number.isFinite(v.根部半径)?{rootRadius:v.根部半径}:{})});}
function angle(a,b){const before=a.pathPoints,after=b.pathPoints,u=before.at(-2).map((v,i)=>v-before.at(-1)[i]),v=after[1].map((n,i)=>n-after[0][i]),den=Math.hypot(...u)*Math.hypot(...v);return metric(Math.acos(Math.max(-1,Math.min(1,u.reduce((s,n,i)=>s+n*v[i],0)/(den||1))))*180/Math.PI);}
function splitMergeByLimits(row,{maxMergeLength:maximum=Infinity,maxMergeCount:count=Infinity},forceSplit=false){
  const chunks=[];let current=[];
  for(const member of row.members){
    const candidate=[...current,member];let length=Infinity;
    if(Number.isFinite(maximum))try{length=connectSegmentIntersections(candidate.map(value=>({geometry:pathGeometry(value.points).geometry,pathPoints:value.points}))).length;}catch{}
    if(current.length&&(candidate.length>count||length>maximum+1e-9)){chunks.push(current);current=[member];}else current=candidate;
  }
  if(current.length)chunks.push(current);
  if(chunks.length===1&&!forceSplit)return [row];
  if(chunks.length===1){chunks.splice(0,1,row.members.slice(0,-1),row.members.slice(-1));}
  return chunks.map(members=>({...row,key:members.length>1?'merge:'+members.map(member=>member.key).sort().join(';'):'unit:'+members[0].key,label:members.length>1?row.label:'处理 '+members[0].id,members,closed:false,ruleLength:members.reduce((sum,member)=>sum+member.length,0),connections:[],...(Number.isFinite(maximum)?{rejectedMergeKey:row.rejectedMergeKey||row.key,rejectedMergeReason:'合并长度或数量超过限制，已停止继续合并'}:{})}));
}
function cornerConnectionAllowed(before,after,rules){
  const position=weldPositionCode(before.weldingPosition);
  const vertical=position==='PF';
  if(position!==weldPositionCode(after.weldingPosition)||(!vertical&&position!=='PB'))return false;
  const left={pathPoints:before.points};
  const right={pathPoints:after.points};
  try{
    const connection=intersectSegmentEnds(left,right);
    const minimum=vertical?rules.verticalContactGap:rules.flatContactGap;
    if(connection.gap>INTERSECTION_TOLERANCE){
      if(connection.gap<minimum||connection.beforeExtension< -INTERSECTION_TOLERANCE||connection.afterExtension< -INTERSECTION_TOLERANCE)return false;
      if(rules.maxGroove!==null&&Math.max(connection.beforeExtension,connection.afterExtension)>=rules.maxGroove)return false;
    }
    const included=angle(left,right),range=rules.angleRange;
    return !range||(included>=range.angleMin&&included<=range.angleMax);
  }catch{return false;}
}

function splitAtRejectedCorners(row,rules){
  const count=row.members.length;
  const breaks=row.members.map((member,index)=>index===count-1&&!row.closed?false:
    !cornerConnectionAllowed(member,row.members[(index+1)%count],rules));
  const first=breaks.indexOf(true);
  if(first===-1)return [row];
  const start=row.closed?(first+1)%count:0,groups=[];
  let members=[];
  for(let offset=0;offset<count;offset++){
    const index=(start+offset)%count;
    members.push(row.members[index]);
    if(breaks[index]||offset===count-1){groups.push(members);members=[];}
  }
  return groups.map(part=>({...row,members:part,closed:false,connections:[],
    key:part.length===1?'unit:'+part[0].key:'merge:'+part.map(member=>member.key).sort().join(';'),
    label:part.length===1?'处理 '+part[0].id:row.label,
    ruleLength:part.reduce((sum,member)=>sum+member.length,0),
    rejectedMergeKey:row.key,rejectedMergeReason:'相接板端不满足间隙、交点或角度条件'}));
}

export function validateGeometryOptions(c){const errors=[];if(c.maxMergeLength!==undefined&&(!Number.isFinite(c.maxMergeLength)||c.maxMergeLength<=0))errors.push('合并长度应为大于0的有效数值');if(c.maxMergeCount!==undefined&&(!Number.isInteger(c.maxMergeCount)||c.maxMergeCount<2))errors.push('合并个数应为2–30的整数');if(c.mergeGapCheck!==undefined&&typeof c.mergeGapCheck!=='boolean')errors.push('合并间隙检查状态无效');for(const key of ['offset','thicknessWeldThresholdMm'])if(!Number.isFinite(c[key])||c[key]<0)errors.push('处理距离和阈值应为非负数');for(const key of ['extendThreshold','offsetThreshold'])if(c[key]!==null&&(!Number.isFinite(c[key])||c[key]<0))errors.push('打断阈值应为非负数，留空表示关闭距离阈值');const m=c.mergeParams;if(!m||Object.values(m).some(v=>!Number.isFinite(v)||v<0)||m.夹角阈值下限>m.夹角阈值上限||m.夹角阈值上限>180||m.长度阈值下限>m.长度阈值上限)errors.push('合并参数范围无效');return [...new Set(errors)];}
export function convertGeometryPlan(data,plan,options={}, {model=EXAMPLE_MODEL,sourceSha256=DEMO_SOURCE_SHA256}={}){
  const raw=new Map(data.weldsData.welds.map(w=>[w.id,w]));
  const legFor=member=>options.calculatedLegs?.get(member.weldId)??(options.planningRevision===3?roundWeldLeg(member.焊脚):member.焊脚);
  const isClosed=unit=>plan.splits.get(unit.weldId)?.subWelds[unit.subIndex]?.closed??distance(unit.points[0],unit.points.at(-1))<1e-8;
  const rows=options.automaticMerge===false?plan.merges.units.map(u=>({key:'unit:'+u.key,label:'处理 '+u.id,members:[u],closed:isClosed(u),ruleLength:u.length,connections:[]})):[...plan.merges.groups.map(g=>({key:'merge:'+g.members.map(m=>m.key).sort().join(';'),label:'合并 '+g.id,members:g.members,closed:g.closed,ruleLength:g.totalLength,connections:g.connections})),...plan.merges.units.filter(u=>!plan.merges.mergedUnitKeys.has(u.key)).map(u=>({key:'unit:'+u.key,label:'处理 '+u.id,members:[u],closed:isClosed(u),ruleLength:u.length,connections:[]}))];
  if(options.cornerMerge){for(let i=0;i<rows.length;i++){
    if(rows[i].members.length<2)continue;
    const pieces=splitAtRejectedCorners(rows[i],options.cornerMerge);
    rows.splice(i,1,...pieces);
    i+=pieces.length-1;
  }}
  if(Number.isFinite(options.maxMergeLength)||Number.isInteger(options.maxMergeCount)){for(let i=0;i<rows.length;i++){if(rows[i].members.length<2)continue;const chunks=splitMergeByLimits(rows[i],options);rows.splice(i,1,...chunks);i+=chunks.length-1;}}
  const build=row=>{
    if(row.members.length>1&&!isConfirmedNonWeldKey(sourceSha256,row.key)&&row.members.some(member=>isConfirmedNonWeldKey(sourceSha256,'unit:'+member.key))){
      return row.members.flatMap(member=>build({key:'unit:'+member.key,label:'处理 '+member.id,members:[member],closed:isClosed(member),ruleLength:member.length,connections:[]}));
    }
    if(options.planningRevision===3&&row.members.length>1&&row.members.some(member=>roundWeldLeg(member.焊脚)!==roundWeldLeg(row.members[0].焊脚)||legacyWeldForm(member.jointType)!==legacyWeldForm(row.members[0].jointType)||(!options.cornerMerge&&member.weldingPosition!=='PB'))){
      return row.members.flatMap(member=>build({key:'unit:'+member.key,label:'处理 '+member.id,members:[member],closed:isClosed(member),ruleLength:member.length,connections:[],rejectedMergeKey:row.key,rejectedMergeReason:'焊脚、焊接位置或焊缝形式不同'}));
    }
    if(row.members.length>1&&Number.isFinite(options.mergePassHoleSize)){
      const pairs=row.members.slice(1).map((member,i)=>[row.members[i].endFeatureProp,member.startFeatureProp]);
      if(row.closed)pairs.push([row.members.at(-1).endFeatureProp,row.members[0].startFeatureProp]);
      if(pairs.some(pair=>pair.some(feature=>!mergeFeatureWithinSize(feature,options.mergePassHoleSize,options.mergePassHoleInclusive!==false,options.planningRevision===3))))return row.members.flatMap(member=>build({key:'unit:'+member.key,label:'处理 '+member.id,members:[member],closed:isClosed(member),ruleLength:member.length,connections:[],rejectedMergeKey:row.key,rejectedMergeReason:'过焊孔尺寸超过合并上限或尺寸待确认'}));
    }
    const gapLimit=options.maxMergeGap??(options.continuousOnly ? .001 : Infinity);
    if(row.members.length>1){
      const starts=row.members.slice(1).map(member=>member.points[0]);
      if(row.closed)starts.push(row.members[0].points[0]);
      const exceedsGap=starts.some((start,i)=>distance(row.members[i].points.at(-1),start)>gapLimit+1e-9);
      const invalidPosition=options.mergePosition==='flat-flat'&&row.members.some(member=>member.weldingPosition!=='PB');
      if(exceedsGap||invalidPosition){
        const reason=exceedsGap&&Number.isFinite(options.maxMergeGap)?'端点间隙超过合并阈值':'仅允许连续的平角焊合并';
        return row.members.flatMap(member=>build({key:'unit:'+member.key,label:'处理 '+member.id,members:[member],closed:isClosed(member),ruleLength:member.length,connections:[],rejectedMergeKey:row.key,rejectedMergeReason:reason}));
      }
    }
    let segments=[];
    for(const member of row.members){const source=raw.get(member.weldId),points=structuredClone(member.points),position=POSITIONS.find(p=>p.startsWith(weldPositionCode(member.weldingPosition)+' · '))||'待确认';
      const shape=pathGeometry(points),weldLeg=legFor(member);segments.push({...shape,geometry:!row.closed&&shape.geometry==='圆弧'?'曲线':shape.geometry,length:measuredLength(points),pathPoints:points,position,sourceWeldId:member.weldId,sourceUnitKey:member.key,...(Number.isFinite(weldLeg)&&weldLeg>0?{weldLeg}:{}),mainPartId:member.mainPartId,subPartId:member.subPartId,...(options.planningRevision===3?{plateThickness:structuredClone(source?.properties?.厚度??null),...(options.weldPreprocessing?{terminalThicknessWeld:member.板厚形成===true,subplateThickness:data.partsData?.parts.find(part=>part.id===member.subPartId)?.thickness??null}:{}),jointAngle:source?.properties?.主板面与副板面夹角??null,...measuredSegmentFacts(member,source,data.edgesData,options),endpointFacts:{start:extractedEndpointFacts(member,'start',plan),end:extractedEndpointFacts(member,'end',plan)}}:{}),referenceNormal:source?.properties?.焊缝段?.find(s=>s.主板面?.法向)?.主板面.法向,subFaceNormal:source?.properties?.焊缝段?.find(s=>s.副板面?.法向)?.副板面.法向,sourceGeometry:source?.segments?.map(s=>s.type)});
    }
    let joined;try{joined=connectSegmentIntersections(segments,{closed:row.closed});segments=joined.segments;}catch(error){if(row.members.length<2)throw error;return row.members.flatMap(member=>build({key:'unit:'+member.key,label:'处理 '+member.id,members:[member],closed:isClosed(member),ruleLength:member.length,connections:[],rejectedMergeKey:row.key,rejectedMergeReason:error.message}));}
    if(row.members.length>1&&Number.isFinite(options.maxMergeLength)&&joined.length>options.maxMergeLength+1e-9)return splitMergeByLimits(row,options,true).flatMap(build);
    const sources=row.members.map(u=>raw.get(u.weldId)),grooves=sources.map(grooveOf),groove=grooves.every(g=>sameGroove(g,grooves[0]))?grooves[0]:noGroove();
    const legs=[...new Set(row.members.map(legFor))],leg=legs.length===1&&Number.isFinite(legs[0])&&legs[0]>0?legs[0]:null;
    const endpointFacts=options.planningRevision===3&&!row.closed?{start:extractedEndpointFacts(row.members[0],'start',plan),end:extractedEndpointFacts(row.members.at(-1),'end',plan)}:null;
    if(endpointFacts){endpointFacts.start.mainEdgeDistance??=segments[0].mainEdgeStart;endpointFacts.end.mainEdgeDistance??=segments.at(-1).mainEdgeEnd;}
    const edgeDistances=segments.map(segment=>segment.edgeDistance).filter(Number.isFinite);
    const issues=(data.analysis?.processGeometryIssues||[]).filter(issue=>sources.some(s=>s.id===issue.weldId));
    return [{id:'',name:options.cornerMerge&&row.members.length>1?'转角 · '+row.label:row.label,...(options.cornerMerge&&row.members.length>1?{topology:'corner'}:{}),source:'extracted',model,processingKey:row.key,sourceSha256,enabled:true,planned:false,completeStart:true,completeEnd:true,closure:row.closed?'closed':'open',length:measuredLength(segments.flatMap(s=>s.pathPoints)),leg,...(leg!==null&&row.members.every(member=>options.calculatedLegs?.has(member.weldId))?{calculatedLeg:true}:{}),position:segments.every(s=>s.position===segments[0].position)?segments[0].position:'待确认',weldType:legacyWeldForm(row.members[0].jointType),segments,cornerAngles:mergeCornerAngles(segments),groove,...(endpointFacts?{endpointFacts,edgeDistance:edgeDistances.length?Math.min(...edgeDistances):null}:{}),startHole:!!endpointFacts?.start.hasHole,endHole:!!endpointFacts?.end.hasHole,atConnection:segments.length>1,current:null,voltage:null,speed:null,template:'',direction:weldTravelReversed({segments})?'反向':'正向',mergeIntersections:joined.connections,gapConnectionMode:'intersection',sourceEvidence:{mergeIntersections:joined.connections,...(row.rejectedMergeKey?{rejectedMergeKey:row.rejectedMergeKey,rejectedMergeReason:row.rejectedMergeReason}:{}),candidateIds:[...new Set(row.members.map(u=>u.weldId))],unitKeys:row.members.map(u=>u.key),partPairs:row.members.map(u=>[u.mainPartId,u.subPartId]),ruleLengthMm:row.ruleLength,mergeConnections:row.connections,originalPositions:sources.map(s=>s.properties?.焊接位置?.代号||'—'),grooves:sources.map(s=>({type:s.properties?.坡口?.类型,parameters:s.properties?.坡口?.参数})),legBasis:'沿用工艺规划平台的板厚计算规则，非源文件给定焊脚',geometryIssues:issues.map(v=>({type:v.类型,state:v.状态,explanation:v.说明})),endpoints:row.members.map(u=>{const sub=plan.splits.get(u.weldId)?.subWelds[u.subIndex];return {unitKey:u.key,start:sub?.起点来源,end:sub?.终点来源};})}}];
  };
  return rows.flatMap(build).map((w,i)=>({...w,id:'W'+String(10001+i)}));
}
export function mergeFeatureWithinSize(feature,maximum,inclusive=true,minimumDimension=false){
  if(!feature||!Number.isFinite(maximum))return true;
  const circle=feature.特征类型==='圆',corner=feature.特征类型==='角'&&!['直角','锐角','平角'].includes(feature.角类型);
  if(!circle&&!corner)return true;
  if(feature.尺寸待确认)return false;
  const sizes=circle?[feature.L1,feature.L2]:[feature.长,feature.高];
  if(!sizes.every(size=>Number.isFinite(size)&&size>=0))return false;
  const value=minimumDimension?Math.min(...sizes):Math.max(...sizes);
  return inclusive?value<=maximum:value<maximum;
}
export function removablePlanningWeld(weld){
  return !weld.mergedInto&&!weld.splitInto;
}

export function removePlanningWelds(workspace,ids){
  const requested=new Set(ids),removed=workspace.welds.filter(weld=>requested.has(weld.id)&&removablePlanningWeld(weld));
  if(!removed.length)return workspace;
  const removedIds=new Set(removed.map(weld=>weld.id));
  const welds=workspace.welds.filter(weld=>!removedIds.has(weld.id));
  const removedExtracted=removed.filter(weld=>weld.source==='extracted');
  const invalidSplits=new Set((workspace.manualSplitHistory??[]).filter(record=>
    record.childIds.some(id=>removedIds.has(id))).map(record=>record.original.id));
  return {...workspace,welds,selected:removedIds.has(workspace.selected)?
    (welds.find(removablePlanningWeld)?.id??''):workspace.selected,
    ...(removedExtracted.length?{rejectedGeometryWelds:[...(workspace.rejectedGeometryWelds??[]),
      ...removedExtracted.map(weld=>({...weld,rejectionReason:'用户删除'}))]}:{}),
    ...(workspace.manualSplitHistory?{manualSplitHistory:workspace.manualSplitHistory.filter(record=>!invalidSplits.has(record.original.id))}:{}),
    ...(workspace.manualEditHistory?{manualEditHistory:workspace.manualEditHistory.filter(record=>
      !removedIds.has(record.id)&&!(record.kind==='split'&&invalidSplits.has(record.id)))}:{})
  };
}

export function installGeometryResult(d,result){
  if(result.sourceSha256!==(d.stepModel?.sourceSha256??DEMO_SOURCE_SHA256))throw Error('提取结果与当前 STEP 文件指纹不一致');
  const manual=d.welds.filter(w=>!w.collisionFragment&&(w.source!=='extracted'||w.mergedInto||w.splitInto)),old=[...d.welds.filter(w=>w.source==='extracted'&&!w.mergedInto&&!w.splitInto&&!w.collisionFragment),...(d.collisionOriginals??[]).filter(w=>w.source==='extracted')],reserved=new Set(manual.filter(w=>w.source==='extracted').map(w=>w.processingKey)),used=new Set(d.welds.map(w=>w.id)),oldByKey=new Map(old.map(w=>[w.processingKey,w]));let next=10001;
  if(!d.stepModel)for(const id of CONFIRMED_NON_WELD_IDS)used.add(id);
  for(const rejected of d.rejectedGeometryWelds||[]){used.add(rejected.id);if(!oldByKey.has(rejected.processingKey))oldByKey.set(rejected.processingKey,rejected);}
  const generated=result.welds.filter(w=>!reserved.has(w.processingKey)).map(w=>{const previous=oldByKey.get(w.processingKey);if(previous)return {...w,id:previous.id,enabled:previous.enabled,...structuredClone(previous.attributeOverrides||{}),segments:w.segments.map((segment,index)=>({...segment,...Object.fromEntries(Object.entries(previous.attributeOverrides?.segments?.[index]??{}).filter(([,value])=>value!==undefined))})),...(previous.attributeOverrides?{attributeOverrides:structuredClone(previous.attributeOverrides)}:{})};while(used.has('W'+next))next++;const id='W'+next++;used.add(id);return {...w,id};});
  if(manual.length+generated.length>MAX_PLANNING_WELDS)throw Error('处理结果与已有人工焊道数量超过工作区上限，请先另存工作区');
  return excludeConfirmedNonWelds({...d,collisionOriginals:(d.collisionOriginals??[]).filter(w=>w.source!=='extracted'),welds:[...manual,...generated].map(normalizeVerticalWeld),selected:[...manual,...generated].some(w=>w.id===d.selected)?d.selected:generated[0]?.id||manual[0]?.id||'',previousGeometryProcessing:{welds:old,selected:d.selected,geometryProcessing:d.geometryProcessing||null},geometryProcessing:{sourceSha256:result.sourceSha256,summary:result.summary,config:result.config,extraction:result.extraction,sourcePlatform:d.stepModel?'本机 STEP 几何提取':'工艺规划平台 · 5216',splitAlgorithmRevision:9,geometryPlanRevision:5}});
}
export function restoreGeometryResult(d){const backup=d.previousGeometryProcessing;if(!backup)return d;const welds=[...d.welds.filter(w=>w.source!=='extracted'||w.mergedInto||w.splitInto),...backup.welds];return excludeConfirmedNonWelds({...d,welds,selected:welds.some(w=>w.id===backup.selected)?backup.selected:welds[0]?.id||'',geometryProcessing:backup.geometryProcessing,collisionOriginals:(d.collisionOriginals??[]).filter(weld=>weld.source!=='extracted'),previousGeometryProcessing:null});}
export function validExtractedWeld(w,workspace){return w.source!=='extracted'||w.model===(workspace?.model??EXAMPLE_MODEL)&&w.sourceSha256===(workspace?.stepModel?.sourceSha256??DEMO_SOURCE_SHA256)&&typeof w.processingKey==='string'&&Array.isArray(w.segments)&&w.segments.length>0&&w.segments.length<=30&&w.segments.every(s=>Array.isArray(s.pathPoints)&&s.pathPoints.length>=2&&s.pathPoints.length<=20000&&s.pathPoints.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite))&&Number.isFinite(s.length)&&s.length>0&&pathLength(s.pathPoints)>0&&Math.abs(pathLength(s.pathPoints)-s.length)<.01);}
