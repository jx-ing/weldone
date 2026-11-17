import {loadStepMesh} from './stepModelStore.mjs';
import {COARSE_CAPTURE_SPACING_MM,sampleVisibleWorkpiece} from './virtualCameraSampling.mjs';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';
import {NANYANG_CAMERA_PREVIEW} from './weldToolPose.mjs';

let photoVolume;
function photoDimensions(){
 photoVolume??=new STLLoader().loadAsync(import.meta.env.BASE_URL+'models/nanyang-head/camera_fov.stl').then(geometry=>{
  const [x,y,z]=NANYANG_CAMERA_PREVIEW.opticalOrigin;
  const points=geometry.getAttribute('position');
  let range=0,across=0,vertical=0;
  for(let index=0;index<points.count;index++){
   const depth=z-points.getZ(index);
   if(depth<100)continue;
   range=Math.max(range,depth);
   across=Math.max(across,Math.abs(points.getX(index)-x)/depth);
   vertical=Math.max(vertical,Math.abs(points.getY(index)-y)/depth);
  }
  geometry.dispose();
  return {range,across,vertical};
 });
 return photoVolume;
}

self.onmessage=async({data})=>{
 try{
  const mesh=await loadStepMesh(data.model,data.stepModel);
  const captures=[];
  for(const {kind,frames} of data.captures){
   let prepared=frames;
   if(frames.some(frame=>frame.kind==='photo')){
    const {range,across,vertical}=await photoDimensions();
    prepared=frames.map(frame=>({...frame,range,width:2*across*frame.distance,height:2*vertical*frame.distance}));
   }
   const spacing=kind==='coarse'?COARSE_CAPTURE_SPACING_MM:undefined;
   captures.push({kind,points:sampleVisibleWorkpiece(mesh,prepared,spacing)});
  }
  self.postMessage({captures},captures.map(({points})=>points.buffer));
 }catch(error){self.postMessage({error:error.message});}
};
