import {DoubleSide,Group,Matrix4,Mesh,MeshBasicMaterial,MeshStandardMaterial,SphereGeometry,Vector3} from 'three';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';
import {NANYANG_TOOL_CALIBRATION,nanyangVisualAxesInWeldTcp,resolveWeldToolPose} from './weldToolPose.mjs';
import {LASER_CAMERA_FILES,laserCameraMount} from './laserCameraMount.mjs';

const hinge=new Vector3(...NANYANG_TOOL_CALIBRATION.coverHinge);
const hingeAxis=new Vector3(-1,0,0);
const openAngle=NANYANG_TOOL_CALIBRATION.coverAngle;
const wireTip=new Vector3(...NANYANG_TOOL_CALIBRATION.wireTip);
const reflectionAxes=nanyangVisualAxesInWeldTcp().invert();
const rightHandedAtTip=new Matrix4().makeTranslation(wireTip.x,wireTip.y,wireTip.z)
 .multiply(reflectionAxes).multiply(new Matrix4().makeScale(1,-1,1)).multiply(reflectionAxes.clone().invert())
 .multiply(new Matrix4().makeTranslation(-wireTip.x,-wireTip.y,-wireTip.z));

export async function loadWorkstationStructuredLight(){
 const loader=new STLLoader(),base=import.meta.env.BASE_URL+'models/nanyang-head/';
 const files=['structured_light_body.stl','camera_cover.stl','camera_fov.stl'];
 const results=await Promise.allSettled(files.map(file=>loader.loadAsync(base+file)));
 if(results.some(result=>result.status==='rejected')){
  for(const result of results)if(result.status==='fulfilled')result.value.dispose();
  throw Error('结构光相机模型加载失败');
 }
 const [body,lid,fov]=results.map(result=>result.value);
 const root=new Group(),cover=new Group();
 cover.name='structured-light-cover';
 cover.position.copy(hinge);
 cover.add(new Mesh(lid,new MeshStandardMaterial({color:0x596773,roughness:.68})));
 const view=new Mesh(fov,new MeshBasicMaterial({color:0x009dd2,transparent:true,opacity:.19,depthWrite:false,side:DoubleSide}));
 view.name='structured-light-field';
 view.visible=false;
 root.add(new Mesh(body,new MeshStandardMaterial({color:0xa8b2ba,roughness:.68})),cover,view);
 root.matrixAutoUpdate=false;
 root.matrix.makeScale(.001,.001,.001).multiply(nanyangVisualAxesInWeldTcp())
  .multiply(new Matrix4().makeTranslation(-wireTip.x,-wireTip.y,-wireTip.z));
 return root;
}

export function setWorkstationStructuredLight(object,open,visible){
 const view=object.getObjectByName('structured-light-field');
 const cover=object.getObjectByName('structured-light-cover');
 if(view)view.visible=visible;
 if(cover)cover.quaternion.setFromAxisAngle(hingeAxis,open?openAngle:0);
}

export async function loadNanyangToolHead(){
 const loader=new STLLoader();
 const directory=import.meta.env.BASE_URL+'models/';
 const files=[...['tool_body.stl','structured_light_body.stl','camera_cover.stl','camera_fov.stl'].map(file=>'nanyang-head/'+file),
  ...LASER_CAMERA_FILES.map(file=>'pf400-laser/'+file)];
 const results=await Promise.allSettled(files.map(file=>loader.loadAsync(directory+file)));
 if(results.some(result=>result.status==='rejected')){
  for(const result of results)if(result.status==='fulfilled')result.value.dispose();
  throw Error('机头模型加载失败');
 }
 const [bodyGeometry,structuredBodyGeometry,coverGeometry,fovGeometry,laserBodyGeometry,laserViewGeometry,laserFanGeometry]=results.map(result=>result.value);
 const object=new Group(),assembly=new Group(),structuredLight=new Group(),cover=new Group(),laserMount=new Group();
 const body=new Mesh(bodyGeometry,new MeshStandardMaterial({color:0xa8b2ba,roughness:.68}));
 const structuredBody=new Mesh(structuredBodyGeometry,body.material);
 const lid=new Mesh(coverGeometry,new MeshStandardMaterial({color:0x596773,roughness:.68}));
 // The two optical volumes from temp(1).stp (1/1/2), rigidly aligned to the preview camera face in mm.
 const field=new Mesh(fovGeometry,new MeshBasicMaterial({color:0x009dd2,transparent:true,opacity:.19,depthWrite:false,side:DoubleSide,forceSinglePass:true}));
 const laserBody=new Mesh(laserBodyGeometry,new MeshStandardMaterial({color:0x536478,roughness:.65}));
 const laserView=new Mesh(laserViewGeometry,new MeshBasicMaterial({color:0x009dd2,transparent:true,opacity:.16,depthWrite:false,side:DoubleSide,forceSinglePass:true}));
 const laserFan=new Mesh(laserFanGeometry,new MeshBasicMaterial({color:0xe66c32,transparent:true,opacity:.55,depthWrite:false,side:DoubleSide,forceSinglePass:true}));
 const laserSpot=new Mesh(new SphereGeometry(3,12,8),new MeshBasicMaterial({color:0xe66c32}));
 laserSpot.name='laser-measurement-point';
 field.visible=laserView.visible=laserFan.visible=laserSpot.visible=laserMount.visible=false;
 body.name='welding-torch';
 structuredLight.name='structured-light-camera';
 laserMount.name='line-laser-camera';
 for(const mesh of [laserBody,laserView,laserFan])mesh.matrixAutoUpdate=false;
 laserMount.add(laserBody,laserView,laserFan,laserSpot);
 cover.position.copy(hinge);
 cover.add(lid);
 assembly.position.copy(wireTip).negate();
 structuredLight.add(structuredBody,cover,field);
 assembly.add(body,structuredLight,laserMount);
 object.add(assembly);
 let installedSide,installedOptics;
 return {
  object,
  setCover(open){cover.quaternion.setFromAxisAngle(hingeAxis,open?openAngle:0);},
  setCameraMounts(structuredLightInstalled,side){
   structuredLight.visible=structuredLightInstalled;
   if(side===installedSide)return;
   installedSide=side;
   laserMount.visible=!!side;
   installedOptics=side?laserCameraMount(side):undefined;
   if(installedOptics){
    const {matrix,opticalMatrix,stripe}=installedOptics;
    laserBody.matrix.copy(matrix);
    laserView.matrix.copy(opticalMatrix);
    laserFan.matrix.copy(opticalMatrix);
    for(const mesh of [laserBody,laserView,laserFan])mesh.matrixWorldNeedsUpdate=true;
    laserSpot.position.fromArray(stripe);
   }
  },
  setFieldOfView(show,camera,showLaserLine=show,workingDistance){
   field.visible=!!show&&camera!=='laser';
   laserView.visible=!!show&&camera==='laser';
   laserFan.visible=!!showLaserLine&&camera==='laser';
   laserSpot.visible=laserView.visible||laserFan.visible;
   if(installedOptics&&laserSpot.visible){
    const {emitter,beam,stripe}=installedOptics;
    laserSpot.position.fromArray(workingDistance===undefined?stripe:emitter)
     .addScaledVector(new Vector3(...beam),workingDistance??0);
   }
  },
  dispose(){
   structuredBody.geometry.dispose();
   for(const mesh of [body,lid,field,laserBody,laserView,laserFan,laserSpot]){mesh.geometry.dispose();mesh.material.dispose();}
  }
 };
}

export function positionNanyangToolHead(object,point,world,direction,invertZ=false){
 const {head}=point.toolPose??resolveWeldToolPose(point);
 const rotation=new Matrix4().makeRotationFromQuaternion(object.quaternion.fromArray(head.quaternion));
 const basis=[0,1,2].map(index=>direction(new Vector3().setFromMatrixColumn(rotation,index).toArray()));
 object.position.copy(world(head.position));
 object.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(...basis));
 object.matrixAutoUpdate=!invertZ;
 if(invertZ){
  // Cancel the CAD display reflection without shifting the wire tip or
  // changing its wire axis and roll reference.
  object.updateMatrix();
  object.matrix.multiply(rightHandedAtTip);
 }
 // The device preview is centered on the wire tip. Restore the assembly's
 // source coordinates when using the calibrated model-origin transform.
 object.children[0].position.set(0,0,0);
}
