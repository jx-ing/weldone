// The user explicitly rejected these four records in the current 111.step.
// Older drafts can lack extraction metadata or contain a manually merged
// record, so the explicit record IDs must not depend on those optional fields.
const MODEL_SHA='c85056ed9022210cd93e48bc4d09b97615c57a70235f4f55d986e6a2bdec4fc8';
export const CONFIRMED_NON_WELD_IDS=['W10001','W10011','W10012','W10034'];
const rejectedIds=new Set(CONFIRMED_NON_WELD_IDS);
const rejectedKeys=new Set(['merge:W0034|0;W0035|0','unit:W0034|0','unit:W0035|0','unit:W0002|1','unit:W0002|2','unit:W0079|0']);
export function isConfirmedNonWeld(weld){return rejectedIds.has(weld.id)||weld.source==='extracted'&&!weld.mergedInto&&weld.sourceSha256===MODEL_SHA&&rejectedKeys.has(weld.processingKey);}
export function excludeConfirmedNonWelds(draft){
  if(draft.stepModel?.sourceSha256&&draft.stepModel.sourceSha256!==MODEL_SHA)return draft;
  const modelName=typeof draft.model==='string'?draft.model.replace(/\\/g,'/').split('/').at(-1).toLowerCase():'';
  if(modelName!=='111.step'&&draft.geometryProcessing?.sourceSha256!==MODEL_SHA)return draft;
  const rejected=draft.welds.filter(isConfirmedNonWeld);
  if(!rejected.length)return draft;
  const welds=draft.welds.filter(w=>!isConfirmedNonWeld(w)),archive=new Map((draft.rejectedGeometryWelds||[]).map(w=>[w.id,w]));
  for(const weld of rejected)archive.set(weld.id,{...weld,rejectionReason:'用户确认非焊缝',rejectionRevision:2});
  return {...draft,welds,rejectedGeometryWelds:[...archive.values()],selected:welds.some(w=>w.id===draft.selected)?draft.selected:welds[0]?.id||'',geometryProcessing:draft.geometryProcessing?{...draft.geometryProcessing,summary:{...draft.geometryProcessing.summary,processedWeldCount:welds.filter(w=>w.source==='extracted'&&!w.mergedInto).length,confirmedNonWeldCount:archive.size}}:draft.geometryProcessing};
}

// Correct the saved draft independently of the live editor, so an open tab's
// other unsaved edits are neither lost nor silently saved by this migration.
export function repairConfirmedNonWeldStorage(storage,key='weldone.replica.draft.v1'){
  const json=storage.getItem(key);
  if(!json)return false;
  const saved=JSON.parse(json);
  if(!Array.isArray(saved?.welds))return false;
  const corrected=excludeConfirmedNonWelds(saved);
  if(corrected===saved)return false;
  storage.setItem(key,JSON.stringify(corrected));
  return true;
}
