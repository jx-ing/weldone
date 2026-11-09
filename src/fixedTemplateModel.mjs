import {newTemplate,migrateTemplate,fixedLayout,reuseLayout} from './templateModel.mjs';

function placementLayout(template,points){
  return fixedLayout({...template,points:points.map(p=>({...p,location:{along:(p.location?.along||0)+(p.offset?.x||0),normal:(p.location?.normal||0)+(p.offset?.y||0),height:(p.location?.height||0)+(p.offset?.z||0)}}))}).points;
}
export function fixedTemplateRecord(template){
  const definition=migrateTemplate(structuredClone({...template,type:'local',name:template.name.trim()}));
  const layers=definition.layers.map(l=>({id:l.id,name:l.name,height:l.height,passes:l.passes.map(p=>({id:p.id,name:p.name,offset:structuredClone(p.offset),points:placementLayout(definition,p.points)}))}));
  return {id:definition.id,name:definition.name,segmentCount:definition.segments.length,points:layers[0].passes[0].points,layers,definition};
}
export function fixedTemplateDraft(record){
  if(record.definition)return migrateTemplate(structuredClone(record.definition));
  return {...reuseLayout(newTemplate('local'),record),id:record.id,name:record.name};
}
