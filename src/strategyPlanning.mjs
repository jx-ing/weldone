import {Vector3} from 'three';
import {pathLength} from './manualWeldModel.mjs';
import {TORCH_ANGLE_KEYS,resolveWeldToolPose,weldTorchAngles,weldTorchAxis,weldTorchOrientation} from './weldToolPose.mjs';
import {prepareWeldSeamFrames} from './weldSeamFrames.mjs';
import {directedWeld,directedClosingCorner,normalizeVerticalWeld,verticalTraversal} from './weldDirectionGeometry.mjs';
import {settingsDefaults, trackingChoice} from './planningSettingsModel.mjs';
import {weldPositionCode} from './planningRequirements.mjs';
import {sharedCornerPoint} from './processFeaturePoints.mjs';
import {weldPointDistance} from './manualSplitModel.mjs';
import {configuredTracking} from './weldTracking.mjs';
import {LASER_DIRECTION_ISSUE,laserTravelDirection,laserLeadsTravel,laserTrackingGeometry,laserTrackingSignature} from './laserTrackingDirection.mjs';
import {configuredWrapDistance,cornerPathDefaults,hasVerticalWrapLength,planningOuterClearance,wrapDistanceRatio} from './planningConfiguration.mjs';
import {continuousOpeningWrapAt,uWrapStartStation} from './weldWrapJunctions.mjs';

const EPS = 1e-6;
export const WELD_POSE_REVISION = 7;
const positive = value => Number.isFinite(value) && value > 0;
const vertical = position => weldPositionCode(position)==='PF';
const add = (position, axis, distance) => position.map((value, i) => value + axis[i] * distance);
const interpolatePose = (from,to,distance,span=1) => Object.fromEntries(TORCH_ANGLE_KEYS.map(axis=>[
  axis,(from[axis]??0)+((to[axis]??0)-(from[axis]??0))*distance/span
]));
const phaseName = {start:'起弧', weld:'焊接', end:'收弧', corner:'转角', wrap:'包角', travel:'空移'};

export function endpointStrategy(facts, settings, position, endpoint, dualRobot = false, segmentLength, lookingForPair = false) {
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
    if(weldPositionCode(position)!=='PB'||!wrap.flatEnabled||segmentLength>wrap.independentLength)return 'none';
    const clearance=planningOuterClearance(settings);
    if(clearance>0&&Number.isFinite(facts.gap)&&facts.gap>=0&&facts.gap<clearance)return 'none';
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
    const arc=configuredTracking(segment,weld,'arc'),laser=configuredTracking(segment,weld,'laser');
    const effectiveLaserTracking=capabilities.laserTracking!==false&&(laser??(arc!==true&&
      trackingChoice(segment,settings.trackingParameters,capabilities)==='激光跟踪'));
    const effectiveArcTracking=!effectiveLaserTracking&&capabilities.arcTracking!==false&&(arc??settings.trackingParameters.arcEnabled);
    return {...segment,effectiveArcTracking,effectiveLaserTracking};
  });
  const next={...source,segments};
  if(capabilities.laserPrecision!==true||!segments?.some(segment=>segment.effectiveLaserTracking))return next;
  const direction=laserTravelDirection(next,{...rawSettings,actionParameters:settings.actionParameters});
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
  const hasU=segments.some(segment=>segment.strategyWrapKind==='U');
  const hasClosedU=closed&&hasU;
  if(!closed&&hasU&&uWrapStartStation(segments,stations,0,false)===null)return null;
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
  const laserGeometry=laserTrackingGeometry(weld,rawSettings);
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
    return endpointStrategy(facts,settings,segment.position,index?'end':'start',weld.machineCount===2,pathLength(segment.pathPoints));
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
    const flatWrapPose=(base,atStart)=>Object.fromEntries(TORCH_ANGLE_KEYS.map(key=>[
      key,(base[key]??0)+(atStart&&key!=='work'?-1:1)*(settings.wrapParameters.flatLPoseOffset[key]??0)
    ]));
    const flatWrapOrientation=(frame,base,atStart)=>
      weldTorchOrientation(frame.tangent,frame.normal,flatWrapPose(base,atStart),frame.up,frame.sectionRoll);
    const wrapOrientations=new Map();
    const continuousU=new Map();
    const orientation=(frame,pose)=>weldTorchOrientation(frame.tangent,frame.normal,pose,frame.up,frame.sectionRoll);
    for(const [index,segment] of segments.entries()){
      if(segment.strategyWrapKind!=='U'||!closed&&(index===0||index===segments.length-1))continue;
      const before=(index+segments.length-1)%segments.length,after=(index+1)%segments.length;
      if(segments[before].strategyWrapKind==='U'||segments[after].strategyWrapKind==='U')continue;
      const from=stations[index],to=stations[index+1],mid=(from+to)/2;
      const incoming=sample(index===0?total:from,before),outgoing=sample(after===0?0:to,after),middle=sample(mid,index);
      const enter=orientation(incoming,standard(segments[before])),leave=orientation(outgoing,standard(segments[after]));
      const midpoint=weldTorchAngles(middle,enter.clone().slerp(leave,.5));
      for(const key of TORCH_ANGLE_KEYS){
        const configured=settings.wrapParameters.uPose[key];
        if(Number.isFinite(configured))midpoint[key]=configured;
      }
      continuousU.set(index,{from,to,mid,before,after,incoming,outgoing,middle,enter,leave,midpoint});
    }
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
      if(segment.strategyWrapKind==='vertical'){
        const wrap=sample(boundary,index);
        const base=weldTorchAngles(wrap,weldTorchOrientation(main.tangent,main.normal,action.verticalPose,main.up));
        const configured=Object.fromEntries(Object.entries(settings.wrapParameters.verticalLPose).filter(([,value])=>value!==null));
        wrapOrientations.set(index,weldTorchOrientation(wrap.tangent,wrap.normal,{...base,...configured},wrap.up));
        continue;
      }
      if(weldPositionCode(segment.position)!=='PB'||weldPositionCode(segments[mainIndex].position)!=='PB')continue;
      wrapOrientations.set(index,flatWrapOrientation(main,flatPose,!before));
    }
    const verticalWrapPose=base=>({...base,...Object.fromEntries(Object.entries(settings.wrapParameters.verticalLPose).filter(([,value])=>value!==null))});
    const lWrapPose=(segment,base,atStart)=>vertical(segment.position)?verticalWrapPose(base):flatWrapPose(base,atStart);
    const wrapPose=(index,frame)=>weldTorchAngles(frame,wrapOrientations.get(index));
    const wrapFlags=index=>wrapOrientations.has(index)?
      (segments[index].strategyWrapKind==='vertical'?{verticalWrap:true}:{flatLWrap:index+1}):undefined;
    const verticalStart=endSettings.verticalStartPose;
    const startPose = wrapOrientations.has(0)?wrapPose(0,sample(0,0)):
      verticalWeld?{advance:verticalStart.advance??startStandard.advance,
        work:verticalStart.work??action.flatPose.work??startStandard.work,rotation:verticalStart.rotation??startStandard.rotation}:
      segments[0].strategyWrapKind==='L'?lWrapPose(segments[0],startStandard,true):
      isInterference(ends[0])?{...startStandard,advance:endSettings.startAngle??startStandard.advance}:startStandard;
    const startDistance = verticalWeld ? endSettings.verticalStartDistance : isInterference(ends[0]) ? endSettings.startDistance : 0;
    const hasStartTransition = !closed && positive(startDistance) && startDistance < total;
    const lastIndex=segments.length-1;
    const endPose = wrapOrientations.has(lastIndex)?wrapPose(lastIndex,sample(total,lastIndex)):segments.at(-1).strategyWrapKind==='L' ? lWrapPose(segments.at(-1),endStandard) : !verticalWeld && isInterference(ends[1]) ? {...endStandard,advance:endSettings.endAngle??endStandard.advance} : endStandard;
    const points = [];
     const cornerWindows = [];
    const beforeCorner=side=>pass.cornerDistances?.[side]?.before??cornerDefaults[side].before;
    const afterCorner=side=>pass.cornerDistances?.[side]?.after??cornerDefaults[side].after;
    const cornerOffset=side=>pass.cornerOffsets?.[side]??cornerDefaults[side].offset;
    const point = (at, kind, pose, parameters, frame = sample(at), motionFlags) => {
      const index=segmentAt(at),segment=segments[index],laserBlocked=blockedTracking[index].some(([from,to])=>at>=from-EPS&&at<=to+EPS);
      const inVerticalStart=verticalWeld&&hasStartTransition&&kind==='weld'&&!motionFlags&&at>0&&at<startDistance&&vertical(segment.position);
      if(inVerticalStart)pose=interpolatePose(startPose,startStandard,at,startDistance);
      const tracking=segment.effectiveArcTracking?'电弧跟踪':segment.effectiveLaserTracking&&!laserBlocked?'激光跟踪':'无跟踪';
      const fade=(distance,range)=>distance<=EPS?1:range>0?Math.max(0,1-distance/range):0;
      const wireOffset=!closed&&settings.topologyVersion===1?
       (flatInterference[0]?endSettings.startLineOffset*fade(at,endSettings.startDistance):0)+
       (flatInterference[1]?endSettings.endLineOffset*fade(total-at,endSettings.endDistance):0):0;
      const motion=motionPoint(frame,pass,at,kind,pose,parameters,wireOffset);
      if(rawSettings.deviceCapabilities?.laserPrecision===true&&tracking==='激光跟踪'&&
         !laserLeadsTravel(motion.orientation,sample(at,index).tangent,laserGeometry))
        laserTrackingIssue=LASER_DIRECTION_ISSUE;
      points.push({...motion,tracking,...motionFlags});
    };
    const emitWrap=(index,at,frame=sample(at,index))=>{
      point(at,'wrap',wrapPose(index,frame),cornerValues(pass,'outer'),frame,wrapFlags(index));
      if(segments[index].strategyWrapKind==='vertical')points.at(-1).name='立焊上包角';
      else if(segments[index].endpointFacts?.start?.continuousOpeningWrap||segments[index].endpointFacts?.end?.continuousOpeningWrap)
        points.at(-1).name='L形包角';
    };
    const emitU=index=>{
      const {from,to,mid,before,after,incoming,outgoing,middle,enter,leave,midpoint}=continuousU.get(index);
      const start=from%total,end=to%total;
      const first=sample(from,index),last=sample(to,index);
      const offset=closed?0:cornerOffset('outer');
      const entryFrame=cornerFrame(first,incoming.tangent,first.tangent,offset);
      const exitFrame=cornerFrame(last,last.tangent,outgoing.tangent,offset);
      const flags={uWrap:index+1};
      point(start,'weld',standard(segments[before]),pass.weld,incoming);
      point(end,'weld',standard(segments[after]),pass.weld,outgoing);
      point(start,'wrap',weldTorchAngles(entryFrame,enter),cornerValues(pass,'outer'),entryFrame,flags);
      point(mid,'wrap',midpoint,cornerValues(pass,'outer'),middle,flags);
      point(end,'wrap',weldTorchAngles(exitFrame,leave),cornerValues(pass,'outer'),exitFrame,flags);
    };
    const emitOpeningWrap=(index,next)=>{
      const before=segments[index],after=segments[next];
      const at=stations[index+1],out=next===0?0:at;
      const incoming=sample(at,index),outgoing=sample(out,next);
      const flat=weldPositionCode(before.position)==='PB'&&weldPositionCode(after.position)==='PB';
      const pose=flat?weldTorchAngles(outgoing,flatWrapOrientation(incoming,standard(before))):standard(after);
      point(out,'wrap',pose,cornerValues(pass,'outer'),outgoing,flat?{flatLWrap:true}:undefined);
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
      cornerWindows.push({segment:index+1,from:approach,at,to:depart});
      const incoming=sample(at,index),outgoing=sample(next===0?0:at,next);
      const bisect=new Vector3(...incoming.tangent).add(new Vector3(...outgoing.tangent));
      const tangent=bisect.lengthSq()>EPS?bisect.normalize():new Vector3(...outgoing.tangent);
      const up=new Vector3(...outgoing.up);
      const lateral=up.cross(tangent).normalize();
      if(lateral.dot(new Vector3(...outgoing.normal))<0)lateral.negate();
      const frame={...outgoing,tangent:tangent.toArray(),normal:lateral.toArray()};
      const params=cornerValues(pass,side);
      point(approach,'corner',standard(segments[index]),params,sample(approach,index),approach===at?{cornerBoundary:'entry'}:undefined);
      point(next===0?0:at,'corner',standard(segments[next]),params,cornerFrame(frame,incoming.tangent,outgoing.tangent,cornerOffset(side)),{cornerCenter:true});
      point(next===0?depart-total:depart,'corner',standard(segments[next]),params,undefined,depart===at?{cornerBoundary:'exit'}:undefined);
    };
    const transition=(from,to,initial,target,includeEnd)=>{
      const count=Math.min(128,Math.max(1,Math.ceil((to-from)/lineStep)));
      for(let index=1;index<count+(includeEnd?1:0);index++){
        const ratio=index/count;
        const pose=interpolatePose(initial,target,ratio);
        point(from+(to-from)*ratio,'weld',pose,pass.weld);
      }
    };
    const stagger=closed?(passes.length*action.staggerDistance)%total:0;
    const startShift=hasClosedU?uWrapStartStation(segments,stations,stagger,true):stagger;
    if(startShift===null)return null;
    const overlap = closed ? action.overlapDistance : 0;
    if (closed) {
      const startIndex=segmentAt(startShift),startFrame=sample(startShift,startIndex);
      const startAngles=hasClosedU&&wrapOrientations.has(startIndex)?wrapPose(startIndex,startFrame):
        hasClosedU?standard(segments[startIndex]):startStandard;
      point(startShift, 'start', startAngles, pass.start,startFrame,hasClosedU?wrapFlags(startIndex):undefined);
      point(startShift, 'weld', startAngles, pass.weld,startFrame,hasClosedU?wrapFlags(startIndex):undefined);
      if(settings.topologyVersion===1){
        for(const at of baseStations)if(!inCornerWindow(at)&&at!==startShift&&!continuousU.has(segmentAt(at)))
          point(at,'weld',standard(segments[segmentAt(at)]),pass.weld);
        for(const corner of corners.values())emitCorner(corner);
        for(const [index,before] of segments.entries()){
          const next=(index+1)%segments.length,after=segments[next];
          if(before.strategyRole!=='wrap'&&after.strategyRole!=='wrap'&&continuousOpeningWrapAt(before,after))emitOpeningWrap(index,next);
        }
        for(const [index,segment] of segments.entries()){
          if(!segment.strategyWrapKind)continue;
          if(continuousU.has(index)){emitU(index);continue;}
          if(!settings.weldPreprocessing)continue;
          if(wrapOrientations.has(index)){
            const end=stations[index+1];
            for(const at of [stations[index],(stations[index]+end)/2,end])emitWrap(index,at%total,sample(at,index));
            continue;
          }
          const pose=segment.strategyWrapKind==='L'?lWrapPose(segment,standard(segment),segment.endWrapKind==='L'&&segment.startWrapKind!=='L'):{...standard(segment),...Object.fromEntries(Object.entries(settings.wrapParameters.uPose).filter(([,value])=>value!==null))};
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
      point(0,'start',startPose,pass.start,first,wrapFlags(0));
      if(!endpointsOnly)point(0,'weld',startPose,pass.weld,first,wrapFlags(0));
      if (hasStartTransition&&!endpointsOnly)transition(0,startDistance,startPose,startStandard,true);
      for (const at of baseStations) {
        if(inCornerWindow(at)||stations.some(station=>Math.abs(station-at)<EPS))continue;
        const index = stations.findIndex(station=>station>at) - 1;
        if(segments[index].strategyRole==='wrap')continue;
        point(at,'weld',standard(segments[index]),pass.weld);
      }
      for (const [index, at] of stations.slice(1,-1).entries()) {
        const before=segments[index],after=segments[index+1],corner=corners.get(index);
        if(continuousU.has(index+1)){
          const begin=Math.max(stations[index],at-beforeCorner('outer'));
          if(begin<at)point(begin,'wrap',standard(before),cornerValues(pass,'outer'));
          emitU(index+1);
          continue;
        }
        if(continuousU.has(index)){
          const depart=Math.min(stations[index+2],at+afterCorner('outer'));
          if(depart>at)point(depart,'wrap',standard(after),cornerValues(pass,'outer'));
          continue;
        }
        const atCorner = side => {
          const incoming=sample(at,index), outgoing=sample(at,index+1);
          return cornerFrame(outgoing,incoming.tangent,outgoing.tangent,cornerOffset(side));
        };
        const wrapIndex=wrapFlags(index)?.flatLWrap?index:wrapFlags(index+1)?.flatLWrap?index+1:null;
        if(wrapIndex!==null){
          const mainIndex=wrapIndex===index?index+1:index;
          const boundary=at;
          point(boundary,'weld',standard(segments[mainIndex]),pass.weld,sample(boundary,mainIndex));
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
      point(total,'end',endPose,pass.end,last,wrapFlags(lastIndex));
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
        const pose=choice==='vertical'?verticalWrapPose(standardPose):flatWrapPose(standardPose,index===0);
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
    passes.push({layerIndex,passIndex,points,...(cornerWindows.length?{cornerWindows}:{}),...(hasClosedU?{loopStartStation:startShift}:{}),approach:safePoint(start,startFrame,action.safeApproachOffset),
      transitionIn:safePoint(start,startFrame,action.safeTransitionOffset),
      retractNear:safePoint(end,endFrame,action.endSafeApproachOffset),
      retract:safePoint(end,endFrame,action.endSafeTransitionOffset)});
  }
  return {passes,endpointActions,poseRevision:WELD_POSE_REVISION,verticalUpOnly:true,externalAxis:total>action.externalAxisLength,collisionStatus:'未验证',
    laserTrackingSignature:laserTrackingSignature(weld,rawSettings),...(laserTrackingIssue?{laserTrackingIssue}:{})};
}
