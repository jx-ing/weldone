import {processDemoGeometry,processImportedStep} from './geometryProcessing.mjs';

self.onmessage=async({data:{options,model,reference}})=>{
 try{
  const progress=progress=>self.postMessage({type:'progress',progress});
  const result=reference?await processImportedStep(model,reference,options,progress):await processDemoGeometry(options,progress);
  const transfer=result.neighborhood?[result.neighborhood.mesh.buffer]:[];
  self.postMessage({type:'result',result},transfer);
 }catch(error){self.postMessage({type:'error',message:error.message,code:error.code});}
};
