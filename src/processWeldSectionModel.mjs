import {processPasses} from './processParameterModel.mjs';

export function sectionCurve(distance,ratio){
 const bulge=distance*.08*4*ratio*(1-ratio);
 return [distance*ratio+bulge,distance*(1-ratio)+bulge];
}
export function processWeldSection(entry,selectedId,fit=false){
 const rows=processPasses(entry),layers=entry.processLayers||[{passes:[entry]}],active=rows.find(({pass})=>pass.id===selectedId)||rows[0];
 const leg=Number.isFinite(entry.leg)&&entry.leg>0?entry.leg:null,beads=[];
 if(leg)for(const [layerIndex,layer] of layers.entries())for(const [passIndex,pass] of layer.passes.entries()){
  const inner=leg*layerIndex/layers.length,outer=leg*(layerIndex+1)/layers.length,start=passIndex/layer.passes.length,end=(passIndex+1)/layer.passes.length;
  beads.push({id:pass.id,layerIndex,passIndex,inner,outer,start,end,center:sectionCurve((inner+outer)/2,(start+end)/2),label:`P${rows.findIndex(row=>row.pass.id===pass.id)+1} · ${layer.name||'第 1 层'} / ${pass.name||'第 1 道'}`});
 }
 const selected=beads.find(bead=>bead.id===active?.pass.id),angle=Number.isFinite(active?.pass.angles?.pitch)?active.pass.angles.pitch:null;
 const wire=selected&&angle!==null?{from:selected.center,to:selected.center.map((v,i)=>v+Math.max(16,leg*.9)*(i?Math.sin(angle*Math.PI/180):Math.cos(angle*Math.PI/180)))}:null;
 const points=[...beads.flatMap(bead=>[sectionCurve(bead.outer,bead.start),sectionCurve(bead.outer,bead.end)]),...(wire?[wire.from,wire.to]:[])];
 const min=axis=>Math.min(0,Math.floor(Math.min(0,...points.map(point=>point[axis]))/10)*10),max=axis=>Math.max(fit?10:100,Math.ceil(Math.max(0,...points.map(point=>point[axis]))*(fit?1.15:1)/10)*10);
 const xMin=min(0),yMin=min(1),span=Math.max(max(0)-xMin,max(1)-yMin);
 return {beads,active,angle,wire,leg,layerCount:layers.length,passCount:rows.length,domain:{x:[xMin,xMin+span],y:[yMin,yMin+span]}};
}
