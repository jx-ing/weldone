import {Euler, Matrix4, Quaternion, Vector3} from 'three';
import {pathLength, sampleManualWeldPath} from './manualWeldModel.mjs';
import {directedWeld,directedClosingCorner} from './weldDirectionGeometry.mjs';
import {settingsDefaults, trackingChoice} from './planningSettingsModel.mjs';
import {weldPositionCode} from './planningRequirements.mjs';
import {sharedCornerPoint} from './processFeaturePoints.mjs';
import {weldPointDistance} from './manualSplitModel.mjs';

const EPS = 1e-6;
const radians = Math.PI / 180;
const positive = value => Number.isFinite(value) && value > 0;
const vertical = position => ['PF', 'PG'].includes(weldPositionCode(position));
const add = (position, axis, distance) => position.map((value, i) => value + axis[i] * distance);
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
      const upperEnd=weldPositionCode(position)==='PG'?'start':'end';
      return !lookingForPair&&endpoint===upperEnd&&wrap.verticalEnabled&&facts.mainEdgeDistance>0?'vertical':'none';
    }
    if(weldPositionCode(position)!=='PB'||!wrap.flatEnabled||weldLength>wrap.independentLength)return 'none';
    if(wrap.outerClearance>0&&(!Number.isFinite(facts.mainEdgeDistance)||facts.mainEdgeDistance<wrap.outerClearance))return 'none';
    if(facts.hasHole&&!(positive(size)&&size>=wrap.passHoleThreshold))return 'none';
    if(lookingForPair)return !dualRobot&&facts.junctionType==='两面交'?'U':'none';
    return 'L';
  }
  if (vertical(position)) {
    return endpoint === 'end' && weldPositionCode(position) === 'PF' && wrap.verticalEnabled && facts.mainEdgeDistance > 0 ? 'vertical' : 'none';
  }
  if (!wrap.flatEnabled || weldPositionCode(position) !== 'PB') return 'none';
  const largeHole = positive(size) && size >= wrap.passHoleThreshold;
  if (facts.junctionType === '三面交') {
    return largeHole && positive(facts.plateThickness) && facts.plateThickness < wrap.independentLength ? 'L' : 'none';
  }
  if (facts.junctionType !== '两面交' || !positive(wrap.gapThreshold) || !Number.isFinite(facts.gap)) return 'none';
  if (facts.hasHole && !largeHole) return 'none';
  if (facts.gap > wrap.gapThreshold && !dualRobot) return 'U';
  if (largeHole && facts.gap < wrap.gapThreshold) return 'L';
  return 'none';
}

function orientation(frame, pose) {
  const tangent = new Vector3(...frame.tangent).normalize();
  const normal = new Vector3(...frame.normal).normalize();
  const binormal = new Vector3().crossVectors(tangent, normal).normalize();
  const base = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(tangent, normal, binormal));
  return base.multiply(new Quaternion().setFromEuler(new Euler(
    (pose.work ?? 0) * radians, (pose.advance ?? 0) * radians, (pose.rotation ?? 0) * radians, 'XYZ'
  ))).toArray();
}

function motionPoint(frame, pass, at, phase, pose, parameters) {
  const binormal = new Vector3().crossVectors(new Vector3(...frame.tangent), new Vector3(...frame.normal)).normalize().toArray();
  const position = add(add(frame.position, frame.normal, pass.offset?.y ?? 0), binormal, pass.offset?.z ?? 0);
  return {distance:at,kind:phase,name:phaseName[phase],position,orientation:orientation(frame,pose),pose,parameters:phase==='weld'?{...parameters,weave:pass.weave}:parameters};
}

function cornerFrame(frame, incoming, outgoing, offset) {
  if(!offset)return frame;
  const outward=new Vector3(...incoming).sub(new Vector3(...outgoing));
  if(outward.lengthSq()<=EPS)return frame;
  return {...frame,position:add(frame.position,outward.normalize().toArray(),offset)};
}

function cornerValues(pass, side) {
  const configured = sharedCornerPoint(pass, side);
  const values = configured?.enabled === false || !configured ? pass.weld : {...pass.weld, ...configured};
  return {...values,speed:pass.cornerSpeeds?.[side]??pass.weld.speed,weave:pass.cornerWeave??pass.weave};
}

export function plannedTracking(weld, rawSettings) {
  const capabilities=rawSettings.deviceCapabilities??{};
  const settings=settingsDefaults(rawSettings,capabilities);
  return {...weld,segments:weld.segments?.map(segment=>{
    const configured=segment.tracking??weld.tracking;
    const unavailable=configured==='激光跟踪'&&capabilities.laserTracking===false||
      configured==='电弧跟踪'&&capabilities.arcTracking===false;
    const tracking=!unavailable&&configured!=null?configured:trackingChoice(segment,settings.trackingParameters,capabilities);
    return {...segment,tracking};
  })};
}

export function generateStrategyPlan(weld, process, rawSettings) {
  if (!weld.segments?.every(segment => segment.pathPoints?.length >= 2)) return null;
  const settings = settingsDefaults(rawSettings);
  const directed = directedWeld(weld);
  const segments = directed.segments;
  const ends = weld.direction === '反向' ? [weld.endpointFacts?.end, weld.endpointFacts?.start] : [weld.endpointFacts?.start, weld.endpointFacts?.end];
  const stations = [0];
  for (const segment of segments) stations.push(stations.at(-1) + pathLength(segment.pathPoints));
  const total = stations.at(-1);
  const baseStations = [];
  const blockedTracking=segments.map((segment,index)=>{
    const clearance=segment.laserTrackingClearance;
    if(segment.tracking!=='激光跟踪'||clearance?.threshold!==settings.trackingParameters.minEdgeWidth||!Array.isArray(clearance.blocked))return [];
    return clearance.blocked.filter(points=>Array.isArray(points)&&points.length===2&&points.every(position=>Array.isArray(position)&&position.length===3&&position.every(Number.isFinite))).map(points=>{
      const [start,end]=points.map(position=>stations[index]+weldPointDistance({segments:[segment]},position)).sort((a,b)=>a-b);
      baseStations.push(start,Math.min(stations[index+1],end+.001));
      return [start,end];
    });
  });
  for (const [index, segment] of segments.entries()) {
    const length = stations[index + 1] - stations[index];
    const straight=segment.geometry==='直线'&&segment.strategyRole!=='wrap';
    if (!straight || settings.topologyVersion===1) {
      const step=straight?settings.actionParameters.lineStep:settings.actionParameters.arcStep;
      const count=Math.min(256,Math.max(1,Math.ceil(length/step)));
      for (let step = 1; step < count; step++) baseStations.push(stations[index] + length * step / count);
    }
    if (index < segments.length - 1) baseStations.push(stations[index + 1]);
  }
  baseStations.sort((a,b)=>a-b);
  const closed = directed.closure === 'closed';
  const verticalWeld = vertical(segments[0].position);
  const action = settings.actionParameters;
  const endSettings = settings.interferenceEndParameters;
  const cornerDefaults=settings.cornerPathParameters??{before:30,after:30,offset:0};
  const layers = process.processLayers?.length ? process.processLayers : [{passes:[process]}];
  const passes = [];
  const segmentAt=at=>at>=total-EPS?segments.length-1:Math.max(0,stations.findIndex(value=>value>at+EPS)-1);
  const sample=at=>{
    const index=segmentAt(at),segment=segments[index];
    return sampleManualWeldPath([segment],at-stations[index],segment.referenceNormal);
  };
  const isInterference = facts => facts && (['间隙打断','过焊孔打断','避障打断'].includes(facts.breakReason??facts.type) ||
    facts.junctionType === '三面交' && (!facts.hasHole || facts.holeSize < settings.wrapParameters.passHoleThreshold));
  const flatInterference=[segments[0],segments.at(-1)].map((segment,index)=>weldPositionCode(segment.position)==='PB'&&isInterference(ends[index]));
  const endpointActions = closed ? ['none','none'] : ends.map((facts, index) => {
    const segment=segments[index ? segments.length - 1 : 0];
    if(settings.topologyVersion===1&&weld.topology==='U')return 'none';
    return endpointStrategy(facts,settings,segment.position,index?'end':'start',weld.machineCount===2,weld.length);
  });

  const corners=new Map();
  for(let index=0;index<segments.length-(closed&&settings.topologyVersion===1?0:1);index++){
    const next=(index+1)%segments.length,before=segments[index],after=segments[next];
    if(before.strategyRole==='wrap'||after.strategyRole==='wrap')continue;
    const measured=next===0?directedClosingCorner(directed):directed.cornerDirections?.[index];
    const flat=weldPositionCode(before.position)==='PB'&&weldPositionCode(after.position)==='PB';
    const upright=settings.topologyVersion===1&&vertical(before.position)&&vertical(after.position);
    if(!measured?.angleSide||measured.angleSide==='straight'||(!flat&&!upright))continue;
    corners.set(index,{index,next,at:stations[index+1],side:upright?'outer':measured.angleSide});
  }

  for (const [layerIndex, layer] of layers.entries()) for (const [passIndex, pass] of layer.passes.entries()) {
    const standard = segment => ({
      ...(vertical(segment.position) ? action.verticalPose : action.flatPose),
      ...(!vertical(segment.position)&&Number.isFinite(pass.angles?.pushPull)?{advance:pass.angles.pushPull}:{}),
      ...(!vertical(segment.position)&&Number.isFinite(pass.angles?.pitch)?{work:pass.angles.pitch}:{})
    });
    const startStandard = standard(segments[0]), endStandard = standard(segments.at(-1));
    const lWrapPose = (segment,base) => ({...base,...Object.fromEntries(Object.entries(vertical(segment.position)?settings.wrapParameters.verticalLPose:settings.wrapParameters.flatLPose).filter(([,v])=>v!==null))});
    const startPose = segments[0].strategyWrapKind==='L' ? lWrapPose(segments[0],startStandard) : verticalWeld ? action.flatPose : isInterference(ends[0]) ? {...startStandard,advance:endSettings.startAngle??startStandard.advance} : startStandard;
    const endPose = segments.at(-1).strategyWrapKind==='L' ? lWrapPose(segments.at(-1),endStandard) : !verticalWeld && isInterference(ends[1]) ? {...endStandard,advance:endSettings.endAngle??endStandard.advance} : endStandard;
    const points = [];
    const beforeCorner=side=>pass.cornerDistances?.[side]?.before??cornerDefaults.before;
    const afterCorner=side=>pass.cornerDistances?.[side]?.after??cornerDefaults.after;
    const cornerOffset=side=>pass.cornerOffsets?.[side]??cornerDefaults.offset;
    const point = (at, kind, pose, parameters, frame = sample(at)) => {
      const index=segmentAt(at),tracking=blockedTracking[index].some(([from,to])=>at>=from-EPS&&at<=to+EPS)?
        '无跟踪':segments[index].tracking;
      const planned=motionPoint(frame,pass,at,kind,pose,parameters);
      if(!closed&&settings.topologyVersion===1){
        const fade=(distance,range)=>distance<=EPS?1:range>0?Math.max(0,1-distance/range):0;
        const offset=(flatInterference[0]?endSettings.startLineOffset*fade(at,endSettings.startDistance):0)+
          (flatInterference[1]?endSettings.endLineOffset*fade(total-at,endSettings.endDistance):0);
        if(offset){
          const axis=new Vector3(0,0,1).applyQuaternion(new Quaternion(...planned.orientation));
          planned.position=add(planned.position,axis.toArray(),offset);
        }
      }
      points.push({...planned,tracking});
    };
    const cornerWindow=({index,next,at,side})=>[
      Math.max(stations[index],at-beforeCorner(side)),
      Math.min((next===0?total:0)+stations[next+1],at+afterCorner(side))
    ];
    const windows=settings.topologyVersion===1?[...corners.values()].map(cornerWindow):[];
    const inCornerWindow=at=>windows.some(([from,to])=>at>=from&&at<=to||closed&&at+total>=from&&at+total<=to);
    const emitCorner=corner=>{
      const {index,next,at,side}=corner,[approach,depart]=cornerWindow(corner);
      const incoming=sample(Math.max(stations[index],at-1e-4)),outgoing=sample(next===0?0:at);
      const bisect=new Vector3(...incoming.tangent).add(new Vector3(...outgoing.tangent));
      const frame={...outgoing,tangent:bisect.lengthSq()>EPS?bisect.normalize().toArray():outgoing.tangent};
      const params=cornerValues(pass,side);
      point(approach,'corner',standard(segments[index]),params);
      point(next===0?0:at,'corner',standard(segments[next]),params,cornerFrame(frame,incoming.tangent,outgoing.tangent,cornerOffset(side)));
      point(next===0?depart-total:depart,'corner',standard(segments[next]),params);
    };
    const transition=(from,to,initial,target,includeEnd)=>{
      const count=Math.min(128,Math.max(1,Math.ceil((to-from)/action.lineStep)));
      for(let index=1;index<count+(includeEnd?1:0);index++){
        const ratio=index/count;
        const pose=Object.fromEntries(['advance','work','rotation'].map(axis=>[
          axis,(initial[axis]??0)+((target[axis]??0)-(initial[axis]??0))*ratio
        ]));
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
        const routeDistance=at=>(at-startShift+total)%total;
        points.sort((a,b)=>routeDistance(a.distance)-routeDistance(b.distance));
        point(startShift,'weld',standard(segments[segmentAt(startShift)]),pass.weld);
      }else for(const at of [...baseStations.filter(value=>value>startShift),total,...baseStations.filter(value=>value<startShift),startShift]){
        point(at,'weld',startStandard,pass.weld);
      }
      point((startShift + overlap) % total, 'end', endStandard, pass.end);
    } else {
      const first = sample(0), last = sample(total);
      point(0, 'start', startPose, pass.start);
      point(0, 'weld', startPose, pass.weld);
      const startDistance = verticalWeld ? endSettings.verticalStartDistance : isInterference(ends[0]) ? endSettings.startDistance : 0;
      if (positive(startDistance) && startDistance < total)transition(0,startDistance,startPose,startStandard,true);
      for (const at of baseStations) {
        if(inCornerWindow(at)||stations.some(station=>Math.abs(station-at)<EPS))continue;
        const index = stations.findIndex(station=>station>at) - 1;
        if(segments[index].strategyRole==='wrap')continue;
        point(at,'weld',standard(segments[index]),pass.weld);
      }
      for (const [index, at] of stations.slice(1,-1).entries()) {
        const before=segments[index],after=segments[index+1],corner=corners.get(index);
        const atCorner = side => {
          const incoming=sample(Math.max(stations[index],at-1e-4)), outgoing=sample(at);
          return cornerFrame(outgoing,incoming.tangent,outgoing.tangent,cornerOffset(side));
        };
        if(after.strategyRole==='wrap'){
          const begin=Math.max(stations[index],at-beforeCorner('outer'));
          point(begin,'wrap',standard(before),cornerValues(pass,'outer'));
          point(at,'wrap',standard(before),cornerValues(pass,'outer'),atCorner('outer'));
          if(after.strategyWrapKind==='L')continue;
          const middle=(at+stations[index+2])/2;
          const pose={...standard(before),...Object.fromEntries(Object.entries(settings.wrapParameters.uPose).filter(([,v])=>v!==null))};
          point(middle,'wrap',pose,cornerValues(pass,'outer'));
          continue;
        }
        if(before.strategyRole==='wrap'){
          point(at,'wrap',standard(after),cornerValues(pass,'outer'),atCorner('outer'));
          const depart=Math.min(stations[index+2],at+afterCorner('outer'));
          point(depart,'wrap',standard(after),cornerValues(pass,'outer'));
          continue;
        }
        if(corner)emitCorner(corner);
        else point(at,'weld',standard(after),pass.weld);
      }
      const endDistance = !verticalWeld && isInterference(ends[1]) ? endSettings.endDistance : 0;
      if (positive(endDistance) && endDistance < total){
        point(total-endDistance,'weld',endStandard,pass.weld);
        transition(total-endDistance,total,endStandard,endPose,false);
      }
      point(total,'end',endPose,pass.end);
      points.sort((a,b)=>a.distance-b.distance);
      for (const [index, choice] of endpointActions.entries()) {
        const facts = ends[index];
        if(!['L','vertical'].includes(choice)||!Array.isArray(facts.offsetDirection))continue;
        const frame=index?last:first;
        const fallback=positive(facts.plateThickness)?facts.plateThickness*(settings.wrapParameters.lDistanceRatio==='1/2'?.5:2/3):0;
        const distance=choice==='vertical'?settings.wrapParameters.verticalDistance??fallback:fallback;
        if(!positive(distance))continue;
        const offsetFrame = {...frame,position:add(frame.position,facts.offsetDirection,distance)};
        const pose = {...(index?endStandard:startStandard),...Object.fromEntries(Object.entries(choice==='vertical'?settings.wrapParameters.verticalLPose:settings.wrapParameters.flatLPose).filter(([,v])=>v!==null))};
        const wrapPoint = motionPoint(offsetFrame,pass,index?total:0,'wrap',pose,cornerValues(pass,'outer'));
        if(settings.topologyVersion===1)wrapPoint.name=choice==='vertical'?'立焊上包角':'L形包角';
        const approachAt=index?Math.max(0,total-beforeCorner('outer')):Math.min(total,afterCorner('outer'));
        const transition=motionPoint(sample(approachAt),pass,approachAt,'wrap',index?endStandard:startStandard,cornerValues(pass,'outer'));
        const offset=cornerOffset('outer');
        const cornerPosition={...frame,position:add(frame.position,facts.offsetDirection,offset)};
        const corner=motionPoint(cornerPosition,pass,index?total:0,'wrap',pose,cornerValues(pass,'outer'));
        if(index){points.splice(points.length-1,1,transition,corner,wrapPoint);}else{points.splice(0,1,wrapPoint,corner,transition);}
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
    passes.push({layerIndex,passIndex,points,approach:safePoint(start,startFrame,action.safeApproachOffset),
      transitionIn:safePoint(start,startFrame,action.safeTransitionOffset),retract:safePoint(end,endFrame,action.safeTransitionOffset)});
  }
  return {passes,endpointActions,externalAxis:total>action.externalAxisLength,collisionStatus:'未验证'};
}
