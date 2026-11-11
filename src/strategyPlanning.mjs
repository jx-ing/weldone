import {Euler, Matrix4, Quaternion, Vector3} from 'three';
import {pathLength, sampleManualWeldPath} from './manualWeldModel.mjs';
import {directedWeld} from './weldDirectionGeometry.mjs';
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

export function endpointStrategy(facts, settings, position, endpoint, dualRobot = false) {
  const wrap = settings.wrapParameters;
  if (!facts || facts.breakReason || facts.mainEdgeDistance < 0) return 'none';
  const size = facts.holeSize;
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

function motionPoint(frame, pass, at, phase, pose, parameters, displacement = {}) {
  const binormal = new Vector3().crossVectors(new Vector3(...frame.tangent), new Vector3(...frame.normal)).normalize().toArray();
  let position = add(frame.position, frame.tangent, displacement.x ?? 0);
  position = add(position, frame.normal, (pass.offset?.y ?? 0) + (displacement.y ?? 0));
  position = add(position, binormal, (pass.offset?.z ?? 0) + (displacement.z ?? 0));
  return {distance:at,kind:phase,name:phaseName[phase],position,orientation:orientation(frame,pose),pose,parameters:phase==='weld'?{...parameters,weave:pass.weave}:parameters};
}

function cornerValues(pass, side) {
  const configured = sharedCornerPoint(pass, side);
  const values = configured?.enabled === false || !configured ? pass.weld : {...pass.weld, ...configured};
  return {...values,speed:pass.cornerSpeeds?.[side]??pass.weld.speed,weave:pass.cornerWeave??pass.weave};
}

export function plannedTracking(weld, rawSettings) {
  const settings = settingsDefaults(rawSettings);
  return {
    ...weld,
    segments:weld.segments?.map(segment => ({
      ...segment, tracking:segment.tracking ?? weld.tracking ?? trackingChoice(segment, settings.trackingParameters, rawSettings.deviceCapabilities)
    }))
  };
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
    if (segment.geometry !== '直线' || segment.strategyRole==='wrap') {
      const count=Math.min(256,Math.max(1,Math.ceil(length/settings.actionParameters.arcStep)));
      for (let step = 1; step < count; step++) baseStations.push(stations[index] + length * step / count);
    }
    if (index < segments.length - 1) baseStations.push(stations[index + 1]);
  }
  baseStations.sort((a,b)=>a-b);
  const closed = directed.closure === 'closed';
  const verticalWeld = vertical(segments[0].position);
  const action = settings.actionParameters;
  const endSettings = settings.interferenceEndParameters;
  const layers = process.processLayers?.length ? process.processLayers : [{passes:[process]}];
  const passes = [];
  const segmentAt=at=>at>=total-EPS?segments.length-1:Math.max(0,stations.findIndex(value=>value>at+EPS)-1);
  const sample=at=>{
    const index=segmentAt(at),segment=segments[index];
    return sampleManualWeldPath([segment],at-stations[index],segment.referenceNormal);
  };
  const isInterference = facts => facts && (['间隙打断','过焊孔打断','避障打断'].includes(facts.breakReason??facts.type) ||
    facts.junctionType === '三面交' && (!facts.hasHole || facts.holeSize < settings.wrapParameters.passHoleThreshold));
  const endpointActions = closed ? ['none','none'] : ends.map((facts, index) =>
    endpointStrategy(facts, settings, segments[index ? segments.length - 1 : 0].position, index ? 'end' : 'start', weld.machineCount === 2));

  for (const [layerIndex, layer] of layers.entries()) for (const [passIndex, pass] of layer.passes.entries()) {
    const standard = segment => ({
      ...(vertical(segment.position) ? action.verticalPose : action.flatPose),
      ...(!vertical(segment.position) && pass.angles ? {advance:pass.angles.pushPull, work:pass.angles.pitch} : {})
    });
    const startStandard = standard(segments[0]), endStandard = standard(segments.at(-1));
    const lWrapPose = (segment,base) => ({...base,...Object.fromEntries(Object.entries(vertical(segment.position)?settings.wrapParameters.verticalLPose:settings.wrapParameters.flatLPose).filter(([,v])=>v!==null))});
    const startPose = segments[0].strategyWrapKind==='L' ? lWrapPose(segments[0],startStandard) : verticalWeld ? action.flatPose : isInterference(ends[0]) ? {...startStandard,advance:endSettings.startAngle??startStandard.advance} : startStandard;
    const endPose = segments.at(-1).strategyWrapKind==='L' ? lWrapPose(segments.at(-1),endStandard) : !verticalWeld && isInterference(ends[1]) ? {...endStandard,advance:endSettings.endAngle??endStandard.advance} : endStandard;
    const points = [];
    const point = (at, kind, pose, parameters, displacement, frame = sample(at)) => {
      const index=segmentAt(at),tracking=blockedTracking[index].some(([from,to])=>at>=from-EPS&&at<=to+EPS)?
        '无跟踪':segments[index].tracking;
      points.push({...motionPoint(frame,pass,at,kind,pose,parameters,displacement),tracking});
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
      for (const at of [...baseStations.filter(value=>value>startShift),total,...baseStations.filter(value=>value<startShift),startShift]) {
        point(at, 'weld', startStandard, pass.weld);
      }
      point((startShift + overlap) % total, 'end', endStandard, pass.end);
    } else {
      const first = sample(0), last = sample(total);
      point(0, 'start', startPose, pass.start);
      point(0, 'weld', startPose, pass.weld);
      const startDistance = verticalWeld ? endSettings.verticalStartDistance : isInterference(ends[0]) ? endSettings.startDistance : 0;
      if (positive(startDistance) && startDistance < total)transition(0,startDistance,startPose,startStandard,true);
      for (const at of baseStations) {
        if (stations.some(station=>Math.abs(station-at)<EPS)) continue;
        const index = stations.findIndex(station=>station>at) - 1;
        if(segments[index].strategyRole==='wrap')continue;
        point(at,'weld',standard(segments[index]),pass.weld);
      }
      for (const [index, at] of stations.slice(1,-1).entries()) {
        const before = segments[index], after = segments[index + 1], corner = directed.cornerDirections?.[index];
        if(after.strategyRole==='wrap'){
          const begin=Math.max(stations[index],at-(pass.cornerDistances?.outer?.before??30));
          point(begin,'wrap',standard(before),cornerValues(pass,'outer'));
          point(at,'wrap',standard(before),cornerValues(pass,'outer'),pass.cornerOffsets?.outer);
          if(after.strategyWrapKind==='L')continue;
          const middle=(at+stations[index+2])/2;
          const pose={...standard(before),...Object.fromEntries(Object.entries(settings.wrapParameters.uPose).filter(([,v])=>v!==null))};
          point(middle,'wrap',pose,cornerValues(pass,'outer'));
          continue;
        }
        if(before.strategyRole==='wrap'){
          point(at,'wrap',standard(after),cornerValues(pass,'outer'),pass.cornerOffsets?.outer);
          const depart=Math.min(stations[index+2],at+(pass.cornerDistances?.outer?.after??30));
          point(depart,'wrap',standard(after),cornerValues(pass,'outer'));
          continue;
        }
        if (corner?.angleSide && corner.angleSide !== 'straight' && weldPositionCode(before.position)==='PB' && weldPositionCode(after.position)==='PB') {
          const side = corner.angleSide === 'outer' ? 'outer' : 'inner';
          const distances = pass.cornerDistances?.[side] ?? {};
          const approach = Math.max(stations[index], at - (distances.before ?? 30));
          const depart = Math.min(stations[index + 2], at + (distances.after ?? 30));
          const a = sample(Math.max(stations[index],at - 1e-4)), b = sample(at);
          const bisect = new Vector3(...a.tangent).add(new Vector3(...b.tangent));
          const frame = {...b,tangent:bisect.lengthSq()>EPS?bisect.normalize().toArray():b.tangent};
          point(approach,'corner',standard(before),cornerValues(pass,side));
          point(at,'corner',standard(after),cornerValues(pass,side),pass.cornerOffsets?.[side],frame);
          point(depart,'corner',standard(after),cornerValues(pass,side));
        } else point(at,'weld',standard(after),pass.weld);
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
        if (!['L','vertical'].includes(choice) || !positive(facts.plateThickness) || !Array.isArray(facts.offsetDirection)) continue;
        const frame = index ? last : first;
        const distance = facts.plateThickness * (settings.wrapParameters.lDistanceRatio==='1/2'?.5:2/3);
        const offsetFrame = {...frame,position:add(frame.position,facts.offsetDirection,distance)};
        const pose = {...(index?endStandard:startStandard),...Object.fromEntries(Object.entries(choice==='vertical'?settings.wrapParameters.verticalLPose:settings.wrapParameters.flatLPose).filter(([,v])=>v!==null))};
        const wrapPoint = motionPoint(offsetFrame,pass,index?total:0,'wrap',pose,cornerValues(pass,'outer'),pass.cornerOffsets?.outer);
        const approachAt=index?Math.max(0,total-(pass.cornerDistances?.outer?.before??30)):Math.min(total,pass.cornerDistances?.outer?.after??30);
        const transition=motionPoint(sample(approachAt),pass,approachAt,'wrap',index?endStandard:startStandard,cornerValues(pass,'outer'));
        const corner=motionPoint(frame,pass,index?total:0,'wrap',pose,cornerValues(pass,'outer'),pass.cornerOffsets?.outer);
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
