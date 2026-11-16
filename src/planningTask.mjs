export const PLANNING_TASK_FORMAT='weldone-planning-task';

export function planningTaskDocument(workspace){
 const {format,version,deviceControl,deviceCapabilities,planningDevice,...task}=workspace;
 return {...task,format:PLANNING_TASK_FORMAT,version:1};
}

export function readPlanningTask(text){
 const task=JSON.parse(text.replace(/^\uFEFF/,''));
 if(task?.format!==PLANNING_TASK_FORMAT||task.version!==1)throw Error('PF 文件格式不受支持，请选择本平台导出的任务文件。');
 const {format,version,deviceControl,deviceCapabilities,planningDevice,...workspace}=task;
 return workspace;
}
