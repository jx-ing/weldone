export const PLANNING_TASK_FORMAT='weldone-planning-task';

export function planningTaskDocument(workspace){
 const {format,version,deviceControl,deviceCapabilities,planningDevice,workstationSettings,...task}=workspace;
 return {...task,format:PLANNING_TASK_FORMAT,version:1};
}

export function readPlanningTask(text){
 const task=JSON.parse(text.replace(/^\uFEFF/,''));
 if(task?.format!==PLANNING_TASK_FORMAT||task.version!==1)throw Error('PF 文件格式不受支持，请选择本平台导出的任务文件。');
 const {format,version,deviceControl,deviceCapabilities,planningDevice,workstationSettings,...workspace}=task;
 return workspace;
}

export function productionTaskSnapshot(workspace,options,source,updatedAt=new Date().toISOString()){
 const {measureTemplateNeighborhood,...planningOptions}=options;
 if(!workspace?.model||!Array.isArray(workspace.welds))throw Error('生产执行任务缺少工件或焊缝数据');
 return structuredClone({workspace:planningTaskDocument(workspace),planningOptions,source,updatedAt});
}

export function validProductionTaskSnapshot(value){
 const workspace=value?.workspace;
 return workspace?.format===PLANNING_TASK_FORMAT&&workspace.version===1&&!!workspace.model&&
  Array.isArray(workspace.welds)&&typeof value.planningOptions==='object'&&value.planningOptions!==null&&
  typeof value.source==='string'&&Number.isFinite(Date.parse(value.updatedAt));
}
