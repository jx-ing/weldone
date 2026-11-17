// The user explicitly rejected these four records in the current 111.step.
// Older drafts can lack extraction metadata or contain a manually merged
// record, so the explicit record IDs must not depend on those optional fields.
import {bundledModelIdentity,DEMO_SOURCE_SHA256 as MODEL_SHA} from './bundledModels.mjs';
export const CONFIRMED_NON_WELD_IDS=['W10001','W10011','W10012','W10034'];
const rejectedIds=new Set(CONFIRMED_NON_WELD_IDS);
const rejectedKeys=new Set(['merge:W0034|0;W0035|0','unit:W0034|0','unit:W0035|0','unit:W0002|1','unit:W0002|2','unit:W0079|0']);
export function isConfirmedNonWeldKey(sourceSha256,key){return sourceSha256===MODEL_SHA&&rejectedKeys.has(key);}
export function isConfirmedNonWeld(weld){return rejectedIds.has(weld.id)||weld.source==='extracted'&&!weld.mergedInto&&isConfirmedNonWeldKey(weld.sourceSha256,weld.processingKey);}
export function excludeConfirmedNonWelds(draft){
  const modelSha=draft.stepModel?.sourceSha256??draft.geometryProcessing?.sourceSha256??bundledModelIdentity(draft)?.sha;
  const isDemo=!draft.stepModel&&modelSha===MODEL_SHA;
  const deletedKeys=new Set((draft.rejectedGeometryWelds??[]).filter(weld=>weld.rejectionReason==='用户删除'&&weld.sourceSha256===modelSha).map(weld=>weld.processingKey));
  if(!isDemo&&!deletedKeys.size)return draft;
  const rejected=draft.welds.filter(weld=>isDemo&&isConfirmedNonWeld(weld)||weld.source==='extracted'&&weld.sourceSha256===modelSha&&deletedKeys.has(weld.processingKey));
  if(!rejected.length)return draft;
  const ids=new Set(rejected.map(weld=>weld.id));
  const welds=draft.welds.filter(weld=>!ids.has(weld.id)),archive=new Map((draft.rejectedGeometryWelds||[]).map(w=>[w.id,w]));
  for(const weld of rejected)if(!archive.has(weld.id))archive.set(weld.id,{...weld,rejectionReason:'用户确认非焊缝',rejectionRevision:2});
  const nonWeldCount=[...archive.values()].filter(weld=>weld.rejectionReason!=='用户删除').length;
  return {...draft,welds,rejectedGeometryWelds:[...archive.values()],selected:welds.some(w=>w.id===draft.selected)?draft.selected:welds[0]?.id||'',geometryProcessing:draft.geometryProcessing?{...draft.geometryProcessing,summary:{...draft.geometryProcessing.summary,processedWeldCount:welds.filter(w=>w.source==='extracted'&&!w.mergedInto).length,confirmedNonWeldCount:nonWeldCount}}:draft.geometryProcessing};
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
