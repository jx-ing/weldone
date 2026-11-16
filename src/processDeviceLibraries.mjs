import {belongsToDevice,processWeldForms,weldPositionCode} from './planningRequirements.mjs';
import {grooveType,grooveFieldsFor,grooveValue} from './grooveModel.mjs';

function configKey(recipe) {
  const position = weldPositionCode(recipe.position);
  const layers = recipe.processLayers ?? [{passes:[recipe]}];
  const groove = grooveType(recipe.groove?.type);
  const applicability = recipe.applicability ?? {};
  return JSON.stringify([
    applicability.deviceProfileId ?? [applicability.welderModel,applicability.robotModel,applicability.material,applicability.wireType,applicability.wireDiameter,applicability.gas],
    position==='PF'?'vertical':position,recipe.leg,recipe.arcTracking ?? false,groove,
    groove==='无坡口'?[]:grooveFieldsFor(groove).map(([key])=>grooveValue(recipe.groove,key)),
    layers.map(layer=>layer.passes.map(pass=>pass.machineMode))
  ]);
}

export function recipeConflicts(entries, recipe) {
  const config = configKey(recipe);
  const candidates = entries.filter(entry=>entry.id!==recipe.id&&configKey(entry)===config);
  return processWeldForms(recipe).flatMap(form => {
    const existing = candidates.find(entry=>processWeldForms(entry).includes(form));
    return existing ? [{form,existing}] : [];
  });
}

export function normalizeActiveDevices(profiles) {
  const active = profiles.findLast(profile=>profile.enabled) ?? profiles[0];
  return profiles.map(profile=>({...profile,enabled:profile.id===active?.id}));
}

export function deviceLibraryUpdates(workspace, values) {
  if (!values.processDeviceProfiles) return values;
  const profiles = normalizeActiveDevices(values.processDeviceProfiles);
  if (values.deletedProcessDevices) return {...values,processDeviceProfiles:profiles};
  const ids = new Set(profiles.map(profile=>profile.id));
  const removed = (workspace.processDeviceProfiles??[]).filter(profile=>!ids.has(profile.id));
  if (!removed.length) return {...values,processDeviceProfiles:profiles};
  const archive = removed.map(profile=>({
    profile:structuredClone(profile),
    entries:workspace.processLibrary.filter(recipe=>belongsToDevice(recipe,profile)).map(recipe=>structuredClone(recipe))
  }));
  return {
    ...values,processDeviceProfiles:profiles,
    processLibrary:(values.processLibrary??workspace.processLibrary).filter(recipe=>!removed.some(profile=>belongsToDevice(recipe,profile))),
    deletedProcessDevices:[...archive,...(workspace.deletedProcessDevices??[])].slice(0,3)
  };
}

export function restoreDeviceLibrary(workspace, id) {
  const archived = (workspace.deletedProcessDevices??[]).find(item=>item.profile.id===id);
  if (!archived) throw Error('这项设备配置已不在最近删除记录中');
  if (workspace.processDeviceProfiles?.some(profile=>profile.id===id)) throw Error('设备配置已存在');
  const ids = new Set(workspace.processLibrary.map(recipe=>recipe.id));
  return {
    processDeviceProfiles:normalizeActiveDevices([...(workspace.processDeviceProfiles??[]),{...archived.profile,enabled:false}]),
    processLibrary:[...workspace.processLibrary,...archived.entries.filter(recipe=>!ids.has(recipe.id))],
    deletedProcessDevices:workspace.deletedProcessDevices.filter(item=>item!==archived)
  };
}

export function clearRemovedProcess(weld, removed) {
  if (!removed.has(weld.processId) && !removed.has(weld.processParameters?.id)) return weld;
  const {processId,processName,processParameters,strategyPlan,matchPlan,automaticPoses,...keep} = weld;
  return {...keep,planned:false,current:null,voltage:null,speed:null};
}
