import {loadWeldCollisionScene} from './weldCollision.mjs';
import {resolvePlanningCollisions} from './planningCollision.mjs';
import {createTemplateNeighborhoodMeasurer,loadDemoTemplateNeighborhood} from './templateNeighborhood.mjs';
import {loadStepNeighborhood} from './stepModelStore.mjs';

let scene,measure;
self.onmessage=async({data})=>{
 try{
  if(data.type==='prepare'){
   const {model,stepModel,coverOpen,laserMountSide}=data;
   [scene,measure]=await Promise.all([
    loadWeldCollisionScene({model,stepModel},{coverOpen,laserMountSide}),
    stepModel?loadStepNeighborhood(stepModel.sourceSha256).then(value=>value?createTemplateNeighborhoodMeasurer(value):undefined).catch(()=>undefined):
     loadDemoTemplateNeighborhood()
   ]);
   self.postMessage({type:'ready'});
   return;
  }
  const {workspace,options,idBase,idStep,geometry,checkOnly}=data;
  if(geometry)measure=createTemplateNeighborhoodMeasurer(geometry);
  const result=await resolvePlanningCollisions(workspace,scene,{...options,measureTemplateNeighborhood:measure},
   done=>self.postMessage({type:'progress',done}),{idBase,idStep,assignOrder:false,yieldForProgress:false,checkOnly});
  self.postMessage({type:'result',result});
 }catch(error){self.postMessage({type:'error',message:error.message});}
};
