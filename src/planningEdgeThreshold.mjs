// Resolve for each source weld at extraction time; null remains an automatic
// setting in the saved project, rather than freezing one selected weld's leg.
export function resolveEdgeBreakThreshold(parameters={},weld={}){
 const explicit=parameters.edgeThreshold;
 if(explicit!==null&&explicit!==undefined&&explicit!==''){
  if(!Number.isInteger(explicit)||explicit<=0)throw Error('边缘打断阈值须为大于0的整数');
  return explicit;
 }
 const leg=weld.leg??weld.properties?.焊脚;
 return Number.isFinite(leg)&&leg>0?leg:null;
}
export function withPlanningEdgeThresholds(splitWeldsData,preparedWelds,parameters){
 // Drafts that predate this field retain the original extraction behavior.
 if(!parameters||!Object.hasOwn(parameters,'edgeThreshold'))return splitWeldsData;
 const sources=new Map(preparedWelds.map(weld=>[weld.id,weld]));
 return {...splitWeldsData,welds:splitWeldsData.welds.map(weld=>({...weld,planningEdgeBreakThreshold:resolveEdgeBreakThreshold(parameters,sources.get(weld.id)||weld)}))};
}
