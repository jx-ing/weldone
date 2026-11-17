import {DEMO_SOURCE_SHA256} from './bundledModels.mjs';
import {isBundledStartupStep,isDemoModel,isPointCloudWorkspace,loadStepMesh,loadStepNeighborhood,switchStepWorkspace} from './stepModelStore.mjs';
import {updateProjectPlanning} from './planningSettingsModel.mjs';
import {weldTemplateIds} from './weldMatchAnalysis.mjs';

const modelFields=['model','stepModel','workpiecePose','welds','selected','geometryProcessing',
 'rejectedGeometryWelds','collisionOriginals','manualSplitHistory','manualEditHistory',
 'previousGeometryProcessing','planningSettingsDirty','planningSettings','workpieceType'];

export const workpieceFingerprint=workspace=>isPointCloudWorkspace(workspace)?undefined:
 workspace.stepModel?.sourceSha256??(isDemoModel(workspace)?DEMO_SOURCE_SHA256:undefined);

export const canSaveWorkpieceTemplate=workspace=>!!workpieceFingerprint(workspace)&&workspace.welds.length>0;

export async function createWorkpieceTemplate(workspace,{name,project,id=crypto.randomUUID(),updatedAt=new Date().toISOString()}){
 name=name.trim();
 if(!name||name.length>80)throw Error('工件模板名称请输入 1–80 个字符');
 if(!project)throw Error('请选择项目');
 if(!canSaveWorkpieceTemplate(workspace))throw Error('请先载入 STEP 工件并完成焊缝规划');
 const fingerprint=workpieceFingerprint(workspace);
 const planning=Object.fromEntries(modelFields.filter(key=>Object.hasOwn(workspace,key)).map(key=>[key,workspace[key]]));
 const welds=[...workspace.welds,...(workspace.collisionOriginals??[])];
 const templateIds=new Set(welds.flatMap(weldTemplateIds));
 const templates=(workspace.templates??[]).filter(template=>templateIds.has(template.id));
 const processIds=new Set([...welds.flatMap(weld=>[weld.processId,weld.matchPlan?.processId,weld.processParameters?.id]),
  ...templates.flatMap(template=>[template.processId,template.baseProcessId,template.baseProcessSnapshot?.id])]);
 const processes=(workspace.processLibrary??[]).filter(process=>processIds.has(process.id));
 const snapshot=structuredClone({planning,templates,processes});
 const [mesh,neighborhood]=await Promise.all([loadStepMesh(planning.model,planning.stepModel),
  planning.stepModel?loadStepNeighborhood(fingerprint):null]);
 let sourceFile=mesh.sourceFile;
 if(!sourceFile&&(isDemoModel(planning)||isBundledStartupStep(planning.model,planning.stepModel))){
  const response=await fetch(`/models/${encodeURIComponent(planning.model)}`);
  if(!response.ok)throw Error('无法读取原始 STEP 文件');
  sourceFile=new File([await response.blob()],planning.model,{type:'application/step'});
 }
 if(!sourceFile)throw Error('本机缺少原始 STEP 文件，请重新导入后保存工件模板');
 return {summary:{id,name,project,model:planning.model,fingerprint,weldCount:planning.welds.length,updatedAt},
  snapshot:{...snapshot,mesh:{...mesh,sourceSha256:fingerprint,sourceFile},neighborhood}};
}

export function workpieceWorkspace(current,summary,snapshot){
 if(snapshot?.planning?.model!==summary.model||workpieceFingerprint(snapshot.planning)!==summary.fingerprint||
  snapshot.mesh?.sourceSha256!==summary.fingerprint||!snapshot.mesh.sourceFile||!Array.isArray(snapshot.planning.welds)){
  throw Error('工件模板的模型或规划数据不完整');
 }
 const includeMissing=(items,saved)=>{
  const ids=new Set(items.map(item=>item.id));
  return [...items,...saved.filter(item=>!ids.has(item.id))];
 };
 const {planning,templates,processes}=structuredClone({planning:snapshot.planning,templates:snapshot.templates,processes:snapshot.processes});
 const project=summary.project;
 const catalog=[...new Set([...(current.templateProjects??[current.project||'本地项目']),project])];
 const target=updateProjectPlanning(current,{project,templateProjects:catalog,planningSettings:planning.planningSettings??{},
  workpieceType:planning.workpieceType??''});
 return {...switchStepWorkspace(target,planning.model,planning.stepModel),...planning,
  templates:includeMissing(current.templates??[],templates),processLibrary:includeMissing(current.processLibrary??[],processes)};
}
