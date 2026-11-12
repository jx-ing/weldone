import {measurePlanningAxial,measurePlanningBoundaries} from './vendor/geometry-engine.mjs';

const dimension = value => Number.isFinite(value) && value >= 0 ? value : null;
const vec = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite) ? [...value] : null;

export function extractedEndpointFacts(member, endpoint, plan) {
  const key = endpoint === 'start' ? '起点' : '终点';
  const weld = plan.baojiao?.byWeld?.get(member.weldId);
  const sub = plan.splits.get(member.weldId)?.subWelds[member.subIndex];
  const origin = sub?.[key+'来源'];
  const measured = weld?.bySubWeld?.[member.subIndex]?.[key] ??
    (origin?.类型 === '打断点' ? null : weld?.[key]);
  const info = measured?.unifiedInfo;
  const dimensions = [dimension(info?.openingWidthMm),dimension(info?.openingHeightMm)];
  const holeSize = dimensions.every(value=>value!==null) ? Math.min(...dimensions) : null;
  const hasHole = info?.kind === 'opening';
  const junctionType = info?.thirdPartClearance || info?.offsetSubplateContact ? '三面交' :
    ['free-edge','opening'].includes(info?.kind) ? '两面交' : null;
  const breakReason=origin?.类型==='打断点'?
    (origin.触发?.edgeBoundaryBreak?'边缘打断':hasHole?'过焊孔打断':'间隙打断'):null;
  return {
    junctionType, hasHole, holeSize, breakReason,
    ...(info?.kind?{boundaryKind:info.kind}:{}),
    type:breakReason ?? (junctionType ? junctionType + (hasHole?'过焊孔':'') : null),
    gap:dimension(info?.thirdPartClearance?.distance ?? info?.axialClearanceMm),
    plateThickness:dimension(info?.thicknessMm),
    offsetDirection:vec(measured?.offsetDir),
    mainEdgeDistance:Number.isFinite(info?.mainEdgeDistanceMm)?info.mainEdgeDistanceMm:null,
    openingBoundaryPoints:info?.openingBoundaryPoints?.filter(value=>vec(value)) ?? []
  };
}

export function measuredSegmentFacts(member,source,edges,settings={}){
 if(!source||!edges?.edges?.length)return {};
 const weld={...source,start:member.points[0],end:member.points.at(-1),segments:[{...source.segments[0],points:member.points}]};
 const axial=measurePlanningAxial(weld,edges);
 const searchDistance=settings.actionParameters?.edgeSearchDistance??15;
 const threshold=settings.trackingParameters?.minEdgeWidth??10;
 const distances=measurePlanningBoundaries(weld,edges,searchDistance)
  .flatMap(({spans})=>spans.map(span=>span.minDistance))
  .filter(value=>Number.isFinite(value)&&value>0.02);
 const blocked=threshold>0?measurePlanningBoundaries(weld,edges,threshold)
  .flatMap(({spans})=>spans.filter(span=>span.minDistance>0.02).map(span=>[
   span.startPoint.toArray(),span.endPoint.toArray()
  ])):[];
 return {
  edgeDistance:distances.length?Math.min(...distances):null,
  laserTrackingClearance:{threshold,blocked},
  mainEdgeStart:dimension(axial?.主板面?.起点距离),
  mainEdgeEnd:dimension(axial?.主板面?.终点距离)
 };
}
