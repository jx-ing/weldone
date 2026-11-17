import {Quaternion,Vector3} from 'three';
import {pathLength} from './manualWeldModel.mjs';
import {TORCH_ANGLE_KEYS,resolveWeldToolPose,weldTorchAngles,weldTorchAxis,weldTorchOrientation} from './weldToolPose.mjs';
import {prepareWeldSeamFrames} from './weldSeamFrames.mjs';
import {directedWeld,directedClosingCorner,normalizeVerticalWeld,verticalTraversal} from './weldDirectionGeometry.mjs';
import {FLAT_L_WRAP_LIMIT, settingsDefaults, trackingChoice} from './planningSettingsModel.mjs';
import {weldPositionCode} from './planningRequirements.mjs';
import {sharedCornerPoint} from './processFeaturePoints.mjs';
import {weldPointDistance} from './manualSplitModel.mjs';
import {configuredTracking} from './weldTracking.mjs';
import {LASER_DIRECTION_ISSUE,laserTravelDirection,laserLeadsTravel} from './laserTrackingDirection.mjs';
import {configuredWrapDistance,cornerPathDefaults,hasVerticalWrapLength,wrapDistanceRatio} from './planningConfiguration.mjs';
import {continuousOpeningWrapAt} from './weldWrapJunctions.mjs';

const EPS = 1e-6;
const FLAT_L_WRAP_TRANSITION = 8;
export const WELD_POSE_REVISION = 2;
const positive = value => Number.isFinite(value) && value > 0;
const vertical = position => weldPositionCode(position)==='PF';
const add = (position, axis, distance) => position.map((value, i) => value + axis[i] * distance);
const interpolatePose = (from,to,distance,span=1) => Object.fromEntries(TORCH_ANGLE_KEYS.map(axis=>[
  axis,(from[axis]??0)+((to[axis]??0)-(from[axis]??0))*distance/span
]));
const phaseName = {start:'起弧', weld:'焊接', end:'收弧', corner:'转角', wrap:'包角', travel:'空移'};

export function endpointStrategy(facts, settings, position, endpoint, dualRobot = false, weldLength, lookingForPair = false) {
  const wrap = settings.wrapParameters;
  if (!facts || facts.breakReason || facts.mainEdgeDistance < 0) return 'none';
  const size = facts.holeSize;
  if(settings.topologyVersion===1){
    const freeEnd=facts.boundaryKind?['free-edge','opening'].includes(facts.boundaryKind):['两面交','三面交'].includes(facts.junctionType);
    if(!freeEnd)return 'none';
    const upright=vertical(position);
    const minimum=upright?settings.mergeParameters.verticalContactGap:settings.mergeParameters.flatContactGap;
    if(positive(minimum)&&positive(facts.gap)&&facts.gap<minimum)return 'none';
    if(upright){
      return !lookingForPair&&endpoint==='end'&&wrap.verticalEnabled&&facts.mainEdgeDistance>0&&hasVerticalWrapLength(wrap)?'vertical':'none';
    }
    if(weldPositionCode(position)!=='PB'||!wrap.flatEnabled||weldLength>wrap.independentLength)return 'none';
    if(wrap.outerClearance>0&&(!Number.isFinite(facts.mainEdgeDistance)||facts.mainEdgeDistance<wrap.outerClearance))return 'none';
    if(facts.hasHole&&!(positive(size)&&size>=wrap.passHoleThreshold))return 'none';
    if(lookingForPair)return !dualRobot&&facts.junctionType==='两面交'?'U':'none';
    return wrapDistanceRatio(wrap)>0?'L':'none';
  }
  if (vertical(position)) {
    return endpoint==='end'&&wrap.verticalEnabled&&facts.mainEdgeDistance>0&&hasVerticalWrapLength(wrap)?'vertical':'none';
  }
  if (!wrap.flatEnabled || weldPositionCode(position) !== 'PB') return 'none';
  const largeHole = positive(size) && size >= wrap.passHoleThreshold;
  if (facts.junctionType === '三面交') {
    return largeHole && positive(facts.plateThickness) && facts.plateThickness < wrap.independentLength && wrapDistanceRatio(wrap)>0 ? 'L' : 'none';
  }
  if (facts.junctionType !== '两面交' || !positive(wrap.gapThreshold) || !Number.isFinite(facts.gap)) return 'none';
  if (facts.hasHole && !largeHole) return 'none';
  if (facts.gap > wrap.gapThreshold && !dualRobot) return 'U';
  if (largeHole && facts.gap < wrap.gapThreshold && wrapDistanceRatio(wrap)>0) return 'L';
  return 'none';
}

function motionPoint(frame, pass, at, phase, pose, parameters, wireOffset=0) {
  const position=add(add(add(frame.position,frame.offsetNormal,pass.offset?.y??0),[0,0,1],pass.offset?.z??0),
   weldTorchAxis(frame.tangent,frame.normal,pose,frame.up),(pass.offset?.wire??0)+wireOffset);
  const toolPose=resolveWeldToolPose({...frame,position,pose,distance:at});
  return {distance:at,kind:phase,name:phaseName[phase],position,...toolPose.frame,orientation:toolPose.tcp.quaternion,pose,
   pathOffset:frame.pathOffset,wireOffset,parameters:phase==='weld'?{...parameters,weave:pass.weave}:parameters};
}

function cornerFrame(frame, incoming, outgoing, offset) {
  if(!offset)return frame;
  const outward=new Vector3(...incoming).sub(new Vector3(...outgoing));
  if(outward.lengthSq()<=EPS)return frame;
  const pathOffset=outward.normalize().multiplyScalar(offset).toArray();
  return {...frame,pathOffset,position:add(frame.position,pathOffset,1)};
}

function flatLWrapOrientation(frame,standard,reference,incoming,outgoing,wrapAtStart=false){
  const up=new Vector3(0,0,1);
  const turn=new Vector3(...incoming).cross(new Vector3(...outgoing)).dot(up);
  const base=weldTorchOrientation(frame.tangent,frame.normal,standard,frame.up,frame.sectionRoll);
  if(Math.abs(turn)<EPS)return base;

  // At a left turn the short leg is 90 degrees ahead of an incoming main leg,
  // or 90 degrees behind an outgoing main leg. Reverse advance and roll
  // when the short leg comes first.
  const angle=(wrapAtStart?-1:1)*Math.PI/2;
  const rotated=axis=>new Vector3(...axis).applyAxisAngle(up,angle).toArray();
  const left={tangent:rotated(frame.tangent),normal:rotated(frame.normal),up:frame.up};
  const preferred=weldTorchAngles(left,base);
  for(const key of Object.keys(preferred))if(Number.isFinite(reference[key])){
    preferred[key]=wrapAtStart&&key!=='work'?-reference[key]:reference[key];
  }
  const delta=weldTorchOrientation(left.tangent,left.normal,preferred,left.up).multiply(base.clone().invert());
  if(turn<0){
    // Reflect the relative rotation across the plane spanned by the travel direction and up.
    const normal=up.cross(new Vector3(...frame.tangent)).normalize();
    const axis=new Vector3(delta.x,delta.y,delta.z);
    axis.multiplyScalar(-1).addScaledVector(normal,-2*axis.dot(normal));
    delta.set(axis.x,axis.y,axis.z,delta.w);
  }
  const target=delta.multiply(base);
  const limit=FLAT_L_WRAP_LIMIT*Math.PI/180;
  return base.slerp(target,Math.min(1,limit/(base.angleTo(target)||1)));
}

function cornerValues(pass, side) {
  const configured = sharedCornerPoint(pass, side);
  const values = configured?.enabled === false || !configured ? pass.weld : {...pass.weld, ...configured};
  return {...values,speed:pass.cornerSpeeds?.[side]??pass.weld.speed,weave:pass.cornerWeave??pass.weave};
}

export function plannedTracking(weld, rawSettings={}) {
  if(!weld)return weld;
  const capabilities=rawSettings.deviceCapabilities??{};
  const settings=settingsDefaults(rawSettings,capabilities);
  const {laserTrackingDirection,laserTrackingIssue,...source}=weld;
  const segments=weld.segments?.map(segment=>{
    const effectiveArcTracking=capabilities.arcTracking!==false&&(configuredTracking(segment,weld,'arc')??settings.trackingParameters.arcEnabled);
    const effectiveLaserTracking=!effectiveArcTracking&&capabilities.laserTracking!==false&&(configuredTracking(segment,weld,'laser')??(trackingChoice(segment,settings.trackingParameters,capabilities)==='激光跟踪'));
    return {...segment,effectiveArcTracking,effectiveLaserTracking};
  });
  const next={...source,segments};
  if(capabilities.laserPrecision!==true||!segments?.some(segment=>segment.effectiveLaserTracking))return next;
  const direction=laserTravelDirection(next,{...settings,measureTemplateNeighborhood:rawSettings.measureTemplateNeighborhood});
  return direction?{...next,laserTrackingDirection:direction}:{...next,laserTrackingIssue:LASER_DIRECTION_ISSUE};
}

export function generateBaseStrategyPlan(weld,settings={}) {
  const action=settings.actionParameters;
  // Use the same nominal pose as an unconfigured weld point for blank axes.
  const pose=value=>({advance:value?.advance??0,work:value?.work??45,rotation:value?.rotation??0});
  const plan=generateStrategyPlan(plannedTracking(weld,settings),{start:{},weld:{},end:{},angles:{pitch:45}},{
    ...settings,actionParameters:{...action,flatPose:{...pose(action?.flatPose),work:action?.flatPose?.work},verticalPose:pose(action?.verticalPose)}
  });
  return plan?{...plan,settingsOnly:true}:null;
}

export function defaultWeldPosePreview(weld,settings) {
  const plan=generateBaseStrategyPlan(weld,settings);
  return plan?{...plan,previewOnly:true}:null;
}

export function generateStrategyPlan(weld, process, rawSettings) {
  if (!weld.segments?.length || !weld.segments.every(segment => segment.pathPoints?.length >= 2)) return null;
  const settings = settingsDefaults(rawSettings);
  if(verticalTraversal(weld.segments,weld.position)==='conflict')return null;
  const directed = directedWeld(normalizeVerticalWeld(weld),rawSettings?.measureTemplateNeighborhood?.measureCorner);
  const segments = directed.segments;
  const ends = [directed.endpointFacts?.start, directed.endpointFacts?.end];
  const stations = [0];
  for (const segment of segments) stations.push(stations.at(-1) + pathLength(segment.pathPoints));
  const total = stations.at(-1);
  const closed = directed.closure === 'closed';
  const action = settings.actionParameters;
  const lineStep = positive(action.lineStep) ? action.lineStep : 5;
  const lineStepEnabled = action.lineStepEnabled !== false;
  const endpointsOnly = !lineStepEnabled && !closed && segments.length === 1 &&
    segments[0].geometry === '直线' && segments[0].strategyRole !== 'wrap';
  const baseStations = [];
  const blockedTracking=segments.map((segment,index)=>{
    const clearance=segment.laserTrackingClearance;
    if(!segment.effectiveLaserTracking||clearance?.threshold!==settings.trackingParameters.minEdgeWidth||!Array.isArray(clearance.blocked))return [];
    return clearance.blocked.filter(points=>Array.isArray(points)&&points.length===2&&points.every(position=>Array.isArray(position)&&position.length===3&&position.every(Number.isFinite))).map(points=>{
      const [start,end]=points.map(position=>stations[index]+weldPointDistance({segments:[segment]},position)).sort((a,b)=>a-b);
      if(!endpointsOnly)baseStations.push(start,Math.min(stations[index+1],end+.001));
      return [start,end];
    });
  });
  for (const [index, segment] of segments.entries()) {
    const length = stations[index + 1] - stations[index];
    const straight=segment.geometry==='直线'&&(settings.weldPreprocessing||segment.strategyRole!=='wrap');
    if (!straight || settings.topologyVersion===1&&lineStepEnabled) {
      const step=straight?lineStep:action.arcStep;
      const count=Math.min(256,Math.max(1,Math.ceil(length/step)));
      for (let step = 1; step < count; step++) baseStations.push(stations[index] + length * step / count);
    }
    if (index < segments.length - 1) baseStations.push(stations[index + 1]);
  }
  baseStations.sort((a,b)=>a-b);
  const verticalWeld = vertical(segments[0].position);
  const endSettings = settings.interferenceEndParameters;
  const cornerDefaults=Object.fromEntries(['inner','outer'].map(side=>[side,cornerPathDefaults(settings.cornerPathParameters,side)]));
  const layers = process.processLayers?.length ? process.processLayers : [{passes:[process]}];
  const passes = [];
  let laserTrackingIssue=weld.laserTrackingIssue;
  const segmentAt=at=>at>=total-EPS?segments.length-1:Math.max(0,stations.findIndex(value=>value>at+EPS)-1);
  if(stations.slice(1).some((station,index)=>station-stations[index]<=EPS))return null;
  const sample=prepareWeldSeamFrames(segments,directed.cornerReferenceNormal,closed,rawSettings?.measureTemplateNeighborhood?.referenceNormalAt);
  // A collision cut already has a checked path on its retained side. Keep
  // the welding posture at this new boundary instead of introducing a tilt.
  const isInterference = facts => facts && (['间隙打断','过焊孔打断'].includes(facts.breakReason??facts.type) ||
    facts.junctionType === '三面交' && (!facts.hasHole || facts.holeSize < settings.wrapParameters.passHoleThreshold));
  const flatInterference=[segments[0],segments.at(-1)].map((segment,index)=>weldPositionCode(segment.position)==='PB'&&isInterference(ends[index]));
  const endpointActions = closed ? ['none','none'] : ends.map((facts, index) => {
    const segment=segments[index ? segments.length - 1 : 0];
    if(settings.weldPreprocessing||settings.topologyVersion===1&&weld.topology==='U')return 'none';
    return endpointStrategy(facts,settings,segment.position,index?'end':'start',weld.machineCount===2,weld.length);
  });

  const corners=new Map();
  for(let index=0;index<segments.length-(closed&&settings.topologyVersion===1?0:1);index++){
    const next=(index+1)%segments.length,before=segments[index],after=segments[next];
    if(before.strategyRole==='wrap'||after.strategyRole==='wrap'||continuousOpeningWrapAt(before,after))continue;
    const measured=next===0?directedClosingCorner(directed):directed.cornerDirections?.[index];
    const flat=weldPositionCode(before.position)==='PB'&&weldPositionCode(after.position)==='PB';
    const upright=settings.topologyVersion===1&&vertical(before.position)&&vertical(after.position);
    if(!measured?.angleSide||measured.angleSide==='straight'||(!flat&&!upright))continue;
    corners.set(index,{index,next,at:stations[index+1],side:upright&&measured.cornerSource!=='solid'?'outer':measured.angleSide});
  }

  for (const [layerIndex, layer] of layers.entries()) for (const [passIndex, pass] of layer.passes.entries()) {
    const flatPose = {
      ...action.flatPose,
      advance:action.flatPose.advance??pass.angles?.pushPull??null,
      work:action.flatPose.work??pass.angles?.pitch??null
    };
    const standard = segment => vertical(segment.position) ? action.verticalPose : flatPose;
    const startStandard = standard(segments[0]), endStandard = standard(segments.at(-1));
    const wrapOrientations=new Map(),flatWraps=[],terminalWrapTransitions=new Map();
    for(const [index,segment] of segments.entries()){
      if(!['L','vertical'].includes(segment.strategyWrapKind))continue;
      const previous=index>0?index-1:closed?segments.length-1:null;
      const next=index+1<segments.length?index+1:closed?0:null;
      const before=previous!==null&&(segment.startWrapKind===segment.strategyWrapKind||
        segment.endWrapKind!==segment.strategyWrapKind&&segments[previous].strategyRole!=='wrap');
      const mainIndex=before?previous:next;
      if(mainIndex===null)continue;
      const boundary=before?stations[index]:stations[index+1];
      const main=sample(closed&&before&&index===0?total:closed&&!before&&next===0?0:boundary,mainIndex);
      const wrap=sample(boundary,index);
      if(segment.strategyWrapKind==='vertical'){
        const base=weldTorchAngles(wrap,weldTorchOrientation(main.tangent,main.normal,action.verticalPose,main.up));
        const configured=Object.fromEntries(Object.entries(settings.wrapParameters.verticalLPose).filter(([,value])=>value!==null));
        wrapOrientations.set(index,weldTorchOrientation(wrap.tangent,wrap.normal,{...base,...configured},wrap.up));
        continue;
      }
      if(weldPositionCode(segment.position)!=='PB'||weldPositionCode(segments[mainIndex].position)!=='PB')continue;
      const [incoming,outgoing]=before?[main.tangent,wrap.tangent]:[wrap.tangent,main.tangent];
      const standardOrientation=weldTorchOrientation(main.tangent,main.normal,flatPose,main.up,main.sectionRoll);
      const preferred=flatLWrapOrientation(main,flatPose,settings.wrapParameters.flatLPose,incoming,outgoing,!before);
      const adjusted=rawSettings.wrapPoseOverrides?.[directed.sourceSegmentIndices[index]];
      const orientation=adjusted?new Quaternion().fromArray(adjusted).normalize():preferred;
      const limit=FLAT_L_WRAP_LIMIT*Math.PI/180;
      if(standardOrientation.angleTo(orientation)>limit+1e-9)orientation.copy(preferred);
      wrapOrientations.set(index,orientation);
      const flatWrap={segment:directed.sourceSegmentIndices[index],from:stations[index],to:stations[index+1],
        reference:standardOrientation.toArray(),preferred:orientation.toArray(),frame:{tangent:main.tangent,normal:main.normal,up:main.up}};
      flatWraps.push(flatWrap);
      if(!closed&&segments[mainIndex].geometry==='直线'&&!segments[mainIndex].strategyRole&&
         (index===0&&!before||index===segments.length-1&&before)){
        const edge=before?Math.max(stations[mainIndex],boundary-FLAT_L_WRAP_TRANSITION):
          Math.min(stations[mainIndex+1],boundary+FLAT_L_WRAP_TRANSITION);
        if(Math.abs(boundary-edge)>EPS){
          const from=Math.min(edge,boundary),to=Math.max(edge,boundary);
          terminalWrapTransitions.set(before?mainIndex:index,{from,to,edge,boundary,standardOrientation,orientation,mainIndex,wrapIndex:index});
          flatWrap.transition={from,to};
        }
      }
    }
    const lWrapPose = (segment,base) => ({...base,...Object.fromEntries(Object.entries(vertical(segment.position)?settings.wrapParameters.verticalLPose:settings.wrapParameters.flatLPose).filter(([,v])=>v!==null))});
    const wrapPose=(index,frame)=>weldTorchAngles(frame,wrapOrientations.get(index));
    const verticalStart=endSettings.verticalStartPose;
    const startPose = wrapOrientations.has(0)?wrapPose(0,sample(0,0)):
      verticalWeld?{advance:verticalStart.advance??startStandard.advance,
        work:verticalStart.work??action.flatPose.work??startStandard.work,rotation:verticalStart.rotation??startStandard.rotation}:
      segments[0].strategyWrapKind==='L'?lWrapPose(segments[0],startStandard):
      isInterference(ends[0])?{...startStandard,advance:endSettings.startAngle??startStandard.advance}:startStandard;
    const startDistance = verticalWeld ? endSettings.verticalStartDistance : isInterference(ends[0]) ? endSettings.startDistance : 0;
    const hasStartTransition = !closed && positive(startDistance) && startDistance < total;
    const lastIndex=segments.length-1;
    const endPose = wrapOrientations.has(lastIndex)?wrapPose(lastIndex,sample(total,lastIndex)):segments.at(-1).strategyWrapKind==='L' ? lWrapPose(segments.at(-1),endStandard) : !verticalWeld && isInterference(ends[1]) ? {...endStandard,advance:endSettings.endAngle??endStandard.advance} : endStandard;
    const points = [];
    const beforeCorner=side=>pass.cornerDistances?.[side]?.before??cornerDefaults[side].before;
    const afterCorner=side=>pass.cornerDistances?.[side]?.after??cornerDefaults[side].after;
    const cornerOffset=side=>pass.cornerOffsets?.[side]??cornerDefaults[side].offset;
    const point = (at, kind, pose, parameters, frame = sample(at), flatLWrap = false) => {
      const index=segmentAt(at),segment=segments[index],laserBlocked=blockedTracking[index].some(([from,to])=>at>=from-EPS&&at<=to+EPS);
      const inVerticalStart=verticalWeld&&hasStartTransition&&kind==='weld'&&!flatLWrap&&at>0&&at<startDistance&&vertical(segment.position);
      if(inVerticalStart)pose=interpolatePose(startPose,startStandard,at,startDistance);
      const tracking=segment.effectiveArcTracking?'电弧跟踪':segment.effectiveLaserTracking&&!laserBlocked?'激光跟踪':'无跟踪';
      const fade=(distance,range)=>distance<=EPS?1:range>0?Math.max(0,1-distance/range):0;
      const wireOffset=!closed&&settings.topologyVersion===1?
       (flatInterference[0]?endSettings.startLineOffset*fade(at,endSettings.startDistance):0)+
       (flatInterference[1]?endSettings.endLineOffset*fade(total-at,endSettings.endDistance):0):0;
      const motion=motionPoint(frame,pass,at,kind,pose,parameters,wireOffset);
      if(rawSettings.deviceCapabilities?.laserPrecision===true&&tracking==='激光跟踪'&&
         !laserLeadsTravel(motion.orientation,sample(at,index).tangent,rawSettings.laserMountSide))
        laserTrackingIssue=LASER_DIRECTION_ISSUE;
      points.push({...motion,tracking,...(flatLWrap?{flatLWrap}: {})});
    };
    const emitWrap=(index,at,frame=sample(at,index))=>{
      point(at,'wrap',wrapPose(index,frame),cornerValues(pass,'outer'),frame,true);
      if(segments[index].strategyWrapKind==='vertical')points.at(-1).name='立焊上包角';
      else if(segments[index].endpointFacts?.start?.continuousOpeningWrap||segments[index].endpointFacts?.end?.continuousOpeningWrap)
        points.at(-1).name='L形包角';
    };
    const emitOpeningWrap=(index,next)=>{
      const before=segments[index],after=segments[next];
      const at=stations[index+1],out=next===0?0:at;
      const incoming=sample(at,index),outgoing=sample(out,next);
      const flat=weldPositionCode(before.position)==='PB'&&weldPositionCode(after.position)==='PB';
      const pose=flat?weldTorchAngles(outgoing,flatLWrapOrientation(incoming,standard(before),settings.wrapParameters.flatLPose,
        incoming.tangent,outgoing.tangent)):standard(after);
      point(out,'wrap',pose,cornerValues(pass,'outer'),outgoing,flat);
      points.at(-1).name='L形包角';
    };
    const cornerWindow=({index,next,at,side})=>[
      Math.max(stations[index],at-beforeCorner(side)),
      Math.min((next===0?total:0)+stations[next+1],at+afterCorner(side))
    ];
    const windows=settings.topologyVersion===1?[...corners.values()].map(cornerWindow):[];
    const inCornerWindow=at=>windows.some(([from,to])=>at>=from&&at<=to||closed&&at+total>=from&&at+total<=to);
    const emitCorner=corner=>{
      const {index,next,at,side}=corner,[approach,depart]=cornerWindow(corner);
      const incoming=sample(at,index),outgoing=sample(next===0?0:at,next);
      const bisect=new Vector3(...incoming.tangent).add(new Vector3(...outgoing.tangent));
      const tangent=bisect.lengthSq()>EPS?bisect.normalize():new Vector3(...outgoing.tangent);
      const up=new Vector3(...outgoing.up);
      const lateral=up.cross(tangent).normalize();
      if(lateral.dot(new Vector3(...outgoing.normal))<0)lateral.negate();
      const frame={...outgoing,tangent:tangent.toArray(),normal:lateral.toArray()};
      const params=cornerValues(pass,side);
      point(approach,'corner',standard(segments[index]),params,sample(approach,index));
      point(next===0?0:at,'corner',standard(segments[next]),params,cornerFrame(frame,incoming.tangent,outgoing.tangent,cornerOffset(side)));
      point(next===0?depart-total:depart,'corner',standard(segments[next]),params);
    };
    const transition=(from,to,initial,target,includeEnd)=>{
      const count=Math.min(128,Math.max(1,Math.ceil((to-from)/lineStep)));
      for(let index=1;index<count+(includeEnd?1:0);index++){
        const ratio=index/count;
        const pose=interpolatePose(initial,target,ratio);
        point(from+(to-from)*ratio,'weld',pose,pass.weld);
      }
    };
    const startShift = closed ? (passes.length * action.staggerDistance) % total : 0;
    const overlap = closed ? action.overlapDistance : 0;
    if (closed) {
      point(startShift, 'start', startStandard, pass.start);
      point(startShift, 'weld', startStandard, pass.weld);
      if(settings.topologyVersion===1){
        for(const at of baseStations)if(!inCornerWindow(at)&&at!==startShift)point(at,'weld',standard(segments[segmentAt(at)]),pass.weld);
        for(const corner of corners.values())emitCorner(corner);
        for(const [index,before] of segments.entries()){
          const next=(index+1)%segments.length,after=segments[next];
          if(before.strategyRole!=='wrap'&&after.strategyRole!=='wrap'&&continuousOpeningWrapAt(before,after))emitOpeningWrap(index,next);
        }
        if(settings.weldPreprocessing)for(const [index,segment] of segments.entries()){
          if(!segment.strategyWrapKind)continue;
          if(wrapOrientations.has(index)){
            const end=stations[index+1];
            for(const at of [stations[index],(stations[index]+end)/2,end])emitWrap(index,at%total,sample(at,index));
            continue;
          }
          const pose=segment.strategyWrapKind==='L'?lWrapPose(segment,standard(segment)):{...standard(segment),...Object.fromEntries(Object.entries(settings.wrapParameters.uPose).filter(([,value])=>value!==null))};
          for(const at of [stations[index],(stations[index]+stations[index+1])/2,stations[index+1]]){
            const station=at%total;
            if(stations.some((start,i)=>i<segments.length&&Math.abs(station-start)<EPS&&vertical(segments[i].position)))continue;
            point(station,'wrap',pose,cornerValues(pass,'outer'));
          }
        }
        const routeDistance=at=>(at-startShift+total)%total;
        points.sort((a,b)=>routeDistance(a.distance)-routeDistance(b.distance));
        point(startShift,'weld',standard(segments[segmentAt(startShift)]),pass.weld);
      }else for(const at of [...baseStations.filter(value=>value>startShift),total,...baseStations.filter(value=>value<startShift),startShift]){
        point(at,'weld',startStandard,pass.weld);
      }
      point((startShift + overlap) % total, 'end', endStandard, pass.end);
    } else {
      const first = sample(0), last = sample(total);
      point(0,'start',startPose,pass.start,first,wrapOrientations.has(0));
      if(!endpointsOnly)point(0,'weld',startPose,pass.weld,first,wrapOrientations.has(0));
      if (hasStartTransition&&!endpointsOnly)transition(0,startDistance,startPose,startStandard,true);
      for (const at of baseStations) {
        if(inCornerWindow(at)||stations.some(station=>Math.abs(station-at)<EPS))continue;
        const index = stations.findIndex(station=>station>at) - 1;
        if(segments[index].strategyRole==='wrap')continue;
        if([...terminalWrapTransitions.values()].some(({from,to})=>at>=from-EPS&&at<=to+EPS))continue;
        point(at,'weld',standard(segments[index]),pass.weld);
      }
      for (const [index, at] of stations.slice(1,-1).entries()) {
        const before=segments[index],after=segments[index+1],corner=corners.get(index);
        const atCorner = side => {
          const incoming=sample(at,index), outgoing=sample(at,index+1);
          return cornerFrame(outgoing,incoming.tangent,outgoing.tangent,cornerOffset(side));
        };
        const terminal=terminalWrapTransitions.get(index);
        if(terminal){
          const {edge,boundary,standardOrientation,orientation,mainIndex,wrapIndex}=terminal;
          const count=Math.min(128,Math.max(1,Math.ceil(Math.abs(edge-boundary)/lineStep)));
          for(let i=0;i<count;i++){
            const fraction=i/count,station=edge+(boundary-edge)*fraction;
            const frame=sample(station,mainIndex);
            const attitude=standardOrientation.clone().slerp(orientation,fraction);
            point(station,'weld',weldTorchAngles(frame,attitude),pass.weld,frame,true);
          }
          emitWrap(wrapIndex,boundary,atCorner('outer'));
          emitWrap(wrapIndex,(stations[wrapIndex]+stations[wrapIndex+1])/2);
          continue;
        }
        if(after.strategyRole==='wrap'&&!vertical(after.position)){
          const begin=Math.max(stations[index],at-beforeCorner('outer'));
          if(!vertical(before.position)||begin>stations[index]+EPS)point(begin,'wrap',standard(before),cornerValues(pass,'outer'));
          if(wrapOrientations.has(index+1)){
            emitWrap(index+1,at,atCorner('outer'));
            emitWrap(index+1,(at+stations[index+2])/2);
            continue;
          }
          point(at,'wrap',standard(before),cornerValues(pass,'outer'),atCorner('outer'));
          if(after.strategyWrapKind==='L'){
            if(settings.weldPreprocessing)point((at+stations[index+2])/2,'wrap',lWrapPose(after,standard(after)),cornerValues(pass,'outer'));
            continue;
          }
          const middle=(at+stations[index+2])/2;
          const pose={...standard(before),...Object.fromEntries(Object.entries(settings.wrapParameters.uPose).filter(([,v])=>v!==null))};
          point(middle,'wrap',pose,cornerValues(pass,'outer'));
          continue;
        }
        if(before.strategyRole==='wrap'&&!vertical(after.position)){
          if(wrapOrientations.has(index)){
            emitWrap(index,(stations[index]+at)/2);
            emitWrap(index,at,atCorner('outer'));
          }else point(at,'wrap',standard(after),cornerValues(pass,'outer'),atCorner('outer'));
          const depart=Math.min(stations[index+2],at+afterCorner('outer'));
          point(depart,'wrap',standard(after),cornerValues(pass,'outer'));
          continue;
        }
        if(continuousOpeningWrapAt(before,after))emitOpeningWrap(index,index+1);
        else if(corner)emitCorner(corner);
        else point(at,'weld',standard(after),pass.weld);
      }
      const endDistance = !vertical(segments.at(-1).position) && !segments.at(-1).strategyWrapKind && isInterference(ends[1]) ? endSettings.endDistance : 0;
      if (positive(endDistance) && endDistance < total && !endpointsOnly){
        point(total-endDistance,'weld',endStandard,pass.weld);
        transition(total-endDistance,total,endStandard,endPose,false);
      }
      point(total,'end',endPose,pass.end,last,wrapOrientations.has(lastIndex));
      if(segments[lastIndex].strategyWrapKind==='vertical')points.at(-1).name='立焊上包角 · 收弧';
      points.sort((a,b)=>a.distance-b.distance);
      for (const [index, choice] of endpointActions.entries()) {
        const facts = ends[index];
        if(!['L','vertical'].includes(choice)||!Array.isArray(facts.offsetDirection))continue;
        const frame=index?last:first;
        const distance=configuredWrapDistance(facts.plateThickness,settings.wrapParameters,choice);
        if(!positive(distance))continue;
        const offsetFrame = {...frame,position:add(frame.position,facts.offsetDirection,distance)};
        const standardPose=index?endStandard:startStandard;
        const offsetTravel=new Vector3(...facts.offsetDirection).normalize();
        const pose=choice==='vertical'?lWrapPose(segments.at(-1),standardPose):weldTorchAngles(frame,
          flatLWrapOrientation(frame,standardPose,settings.wrapParameters.flatLPose,
            index?frame.tangent:offsetTravel.clone().negate().toArray(),index?offsetTravel.toArray():frame.tangent));
        const wrapPoint = motionPoint({...offsetFrame,pathOffset:add([0,0,0],facts.offsetDirection,distance)},pass,index?total:0,'wrap',pose,cornerValues(pass,'outer'));
        if(choice==='L')wrapPoint.flatLWrap=true;
        if(settings.topologyVersion===1)wrapPoint.name=choice==='vertical'?'立焊上包角':'L形包角';
        const approachAt=index?Math.max(0,total-beforeCorner('outer')):Math.min(total,afterCorner('outer'));
        const transition=motionPoint(sample(approachAt),pass,approachAt,'wrap',index?endStandard:startStandard,cornerValues(pass,'outer'));
        const offset=cornerOffset('outer');
        const cornerPosition={...frame,pathOffset:add([0,0,0],facts.offsetDirection,offset),position:add(frame.position,facts.offsetDirection,offset)};
        const corner=motionPoint(cornerPosition,pass,index?total:0,'wrap',pose,cornerValues(pass,'outer'));
        if(choice==='L')corner.flatLWrap=true;
        if(index){
          const approach=choice==='vertical'&&approachAt<=stations[segments.length-1]+EPS?[]:[transition];
          points.splice(points.length-1,1,...approach,corner,wrapPoint);
        }else{points.splice(0,1,wrapPoint,corner,transition);}
        points.sort((a,b)=>a.distance-b.distance);
      }
    }
    const start = points[0]?.position, end = points.at(-1)?.position;
    const safePoint=(position,frame,offset)=>{
      if(!position)return undefined;
      const binormal=new Vector3().crossVectors(new Vector3(...frame.tangent),new Vector3(...frame.normal)).normalize().toArray();
      return add(add(add(position,frame.tangent,offset.x),frame.normal,offset.y),binormal,offset.z);
    };
    const startFrame=sample(points[0]?.distance??0),endFrame=sample(points.at(-1)?.distance??total);
    passes.push({layerIndex,passIndex,points,...(flatWraps.length?{flatWraps}:{}),approach:safePoint(start,startFrame,action.safeApproachOffset),
      transitionIn:safePoint(start,startFrame,action.safeTransitionOffset),
      retractNear:safePoint(end,endFrame,action.endSafeApproachOffset),
      retract:safePoint(end,endFrame,action.endSafeTransitionOffset)});
  }
  return {passes,endpointActions,poseRevision:WELD_POSE_REVISION,verticalUpOnly:true,externalAxis:total>action.externalAxisLength,collisionStatus:'未验证',
    ...(laserTrackingIssue?{laserTrackingIssue}:{})};
}
