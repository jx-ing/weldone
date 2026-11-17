import {DoubleSide,Group,Matrix4,Mesh,MeshBasicMaterial,MeshStandardMaterial,Vector3} from 'three';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';
import {NANYANG_TOOL_CALIBRATION,resolveWeldToolPose} from './weldToolPose.mjs';
import {LASER_CAMERA_FILES,laserCameraMount} from './laserCameraMount.mjs';

const hinge=new Vector3(...NANYANG_TOOL_CALIBRATION.coverHinge);
const hingeAxis=new Vector3(-1,0,0);
const openAngle=NANYANG_TOOL_CALIBRATION.coverAngle;
const wireTip=new Vector3(...NANYANG_TOOL_CALIBRATION.wireTip);

export async function loadNanyangToolHead(){
 const loader=new STLLoader();
 const directory=import.meta.env.BASE_URL+'models/';
 const files=[...['tool_body.stl','camera_cover.stl','camera_fov.stl'].map(file=>'nanyang-head/'+file),
  ...LASER_CAMERA_FILES.map(file=>'pf400-laser/'+file)];
 const results=await Promise.allSettled(files.map(file=>loader.loadAsync(directory+file)));
 if(results.some(result=>result.status==='rejected')){
  for(const result of results)if(result.status==='fulfilled')result.value.dispose();
  throw Error('机头模型加载失败');
 }
 const [bodyGeometry,coverGeometry,fovGeometry,laserBodyGeometry,laserViewGeometry,laserFanGeometry]=results.map(result=>result.value);
 const object=new Group(),assembly=new Group(),cover=new Group(),laserMount=new Group();
 const body=new Mesh(bodyGeometry,new MeshStandardMaterial({color:0xa8b2ba,roughness:.68}));
 const lid=new Mesh(coverGeometry,new MeshStandardMaterial({color:0x596773,roughness:.68}));
 // The two optical volumes from temp(1).stp (1/1/2), rigidly aligned to the preview camera face in mm.
 const field=new Mesh(fovGeometry,new MeshBasicMaterial({color:0x009dd2,transparent:true,opacity:.19,depthWrite:false,side:DoubleSide,forceSinglePass:true}));
 const laserBody=new Mesh(laserBodyGeometry,new MeshStandardMaterial({color:0x536478,roughness:.65}));
 const laserView=new Mesh(laserViewGeometry,new MeshBasicMaterial({color:0x009dd2,transparent:true,opacity:.16,depthWrite:false,side:DoubleSide,forceSinglePass:true}));
 const laserFan=new Mesh(laserFanGeometry,new MeshBasicMaterial({color:0xe66c32,transparent:true,opacity:.55,depthWrite:false,side:DoubleSide,forceSinglePass:true}));
 field.visible=laserView.visible=laserFan.visible=laserMount.visible=false;
 laserMount.matrixAutoUpdate=false;
 laserMount.add(laserBody,laserView,laserFan);
 cover.position.copy(hinge);
 cover.add(lid);
 assembly.position.copy(wireTip).negate();
 assembly.add(body,cover,field,laserMount);
 object.add(assembly);
 let installedSide;
 return {
  object,
  setCover(open){cover.quaternion.setFromAxisAngle(hingeAxis,open?openAngle:0);},
  setLaserMount(side){
   if(side===installedSide)return;
   installedSide=side;
   laserMount.visible=!!side;
   if(side)laserMount.matrix.copy(laserCameraMount(side).matrix);
   laserMount.matrixWorldNeedsUpdate=true;
  },
  setFieldOfView(show,camera,showLaserLine=show){
   field.visible=!!show&&camera!=='laser';
   laserView.visible=!!show&&camera==='laser';
   laserFan.visible=!!showLaserLine&&camera==='laser';
  },
  dispose(){for(const mesh of [body,lid,field,laserBody,laserView,laserFan]){mesh.geometry.dispose();mesh.material.dispose();}}
 };
}

export function positionNanyangToolHead(object,point,world,direction){
 const {head}=point.toolPose??resolveWeldToolPose(point);
 const rotation=new Matrix4().makeRotationFromQuaternion(object.quaternion.fromArray(head.quaternion));
 const basis=[0,1,2].map(index=>direction(new Vector3().setFromMatrixColumn(rotation,index).toArray()));
 object.position.copy(world(head.position));
 object.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(...basis));
 // The device preview is centered on the wire tip. Restore the assembly's
 // source coordinates when using the calibrated model-origin transform.
 object.children[0].position.set(0,0,0);
}
