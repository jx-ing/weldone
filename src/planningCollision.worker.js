import {loadWeldCollisionScene} from './weldCollision.mjs';
import {resolvePlanningCollisions} from './planningCollision.mjs';
import {createTemplateNeighborhoodMeasurer,loadDemoTemplateNeighborhood} from './templateNeighborhood.mjs';

let scene,measure;
self.onmessage=async({data})=>{
 try{
  if(data.type==='prepare'){
   const {model,stepModel,coverOpen}=data;
   [scene,measure]=await Promise.all([
    loadWeldCollisionScene({model,stepModel},{coverOpen}),
    stepModel?undefined:
     loadDemoTemplateNeighborhood()
   ]);
   self.postMessage({type:'ready'});
   return;
  }
  const {workspace,options,idBase,idStep,geometry}=data;
  if(geometry)measure=createTemplateNeighborhoodMeasurer(geometry);
  const result=await resolvePlanningCollisions(workspace,scene,{...options,measureTemplateNeighborhood:measure},
   done=>self.postMessage({type:'progress',done}),{idBase,idStep,assignOrder:false,yieldForProgress:false});
  self.postMessage({type:'result',result});
 }catch(error){self.postMessage({type:'error',message:error.message});}
};
