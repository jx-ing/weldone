export function templateProjectName(template, currentProject = '本地项目') {
  return typeof template.project === 'string' && template.project.trim()
    ? template.project.trim()
    : currentProject?.trim() || '本地项目';
}

export function templateProjectGroups(templates, currentProject, names) {
  const current = templateProjectName({}, currentProject);
  const groups = new Map((names??[current]).map(name=>[name,{name,count:0}]));
  for (const template of templates) {
    if (template.type !== 'whole') continue;
    const name = templateProjectName(template, current);
    if (!groups.has(name)) groups.set(name, {name, count: 0});
    groups.get(name).count++;
  }
  return [...groups.values()];
}

function projectName(value,names,original){
  const name=value.trim();
  if(!name||name.length>80)throw Error('项目名称请输入 1–80 个字符');
  if(names.some(n=>n===name&&n!==original))throw Error('项目名称已存在');
  return name;
}
export function createTemplateProject(templates,currentProject,names,value){
  const groups=templateProjectGroups(templates,currentProject,names).map(p=>p.name),name=projectName(value,groups);
  return {templateProjects:[...groups,name],templates:assignLegacyProjects(templates,currentProject),project:name};
}
function assignLegacyProjects(templates,currentProject){return templates.map(t=>t.type==='whole'&&!t.project?.trim()?{...t,project:templateProjectName(t,currentProject)}:t);}
export function selectTemplateProject(templates,currentProject,names,name){
  const groups=templateProjectGroups(templates,currentProject,names).map(p=>p.name);
  if(!groups.includes(name))throw Error('项目已不存在');
  return {templateProjects:groups,templates:assignLegacyProjects(templates,currentProject),project:name};
}
export function renameTemplateProject(templates,currentProject,names,original,value){
  const groups=templateProjectGroups(templates,currentProject,names).map(p=>p.name);
  if(!groups.includes(original))throw Error('项目已不存在');
  const name=projectName(value,groups,original);
  return {templateProjects:groups.map(p=>p===original?name:p),templates:templates.map(t=>t.type==='whole'&&templateProjectName(t,currentProject)===original?{...t,project:name}:t),...(currentProject===original?{project:name}:{})};
}
export function deleteTemplateProject(templates,currentProject,names,name,clearTemplates=false){
  const groups=templateProjectGroups(templates,currentProject,names),group=groups.find(p=>p.name===name);
  if(!group)throw Error('项目已不存在');
  if(group.count&&!clearTemplates)throw Error('项目包含模板，请先确认清空模板并删除');
  const remaining=groups.filter(p=>p.name!==name).map(p=>p.name);
  return {templateProjects:remaining,templates:templates.filter(t=>!(t.type==='whole'&&templateProjectName(t,currentProject)===name)),...(currentProject===name?{project:remaining[0]||'本地项目'}:{})};
}
