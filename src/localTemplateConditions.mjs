import {validateProcessEntry,matchProcessEntry} from './processParameterModel.mjs';

export function bindLocalProcess(template,process){
  return {...template,baseProcessId:process?.id||'',leg:process?.leg??null};
}
export function localProcessBindingIssues(template,library){
  const process=library.find(p=>p.id===template.baseProcessId);
  if(!process)return ['局部模板必须挂载已有的工艺参数方案，请选择方案以带入焊脚'];
  const invalid=validateProcessEntry(process);
  if(invalid.length)return ['挂载的工艺参数尚未完善',...invalid];
  if(template.leg!==process.leg)return [`焊脚必须与挂载工艺一致（工艺 ${process.leg} mm / 模板 ${template.leg??'未选择'} mm）`];
  return matchProcessEntry(process,{...template,enabled:true}).reasons;
}
