import {BufferGeometry,DoubleSide,Float32BufferAttribute,Group,Matrix4,Mesh,MeshBasicMaterial,MeshStandardMaterial,Vector3} from 'three';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';
import {NANYANG_CAMERA_PREVIEW,NANYANG_TOOL_CALIBRATION,resolveWeldToolPose} from './weldToolPose.mjs';

const hinge=new Vector3(...NANYANG_TOOL_CALIBRATION.coverHinge);
const hingeAxis=new Vector3(-1,0,0);
const openAngle=NANYANG_TOOL_CALIBRATION.coverAngle;
const wireTip=new Vector3(...NANYANG_TOOL_CALIBRATION.wireTip);

export async function loadNanyangToolHead(){
 const loader=new STLLoader();
 const directory=import.meta.env.BASE_URL+'models/nanyang-head/';
 const results=await Promise.allSettled(['tool_body.stl','camera_cover.stl','camera_fov.stl'].map(file=>loader.loadAsync(directory+file)));
 if(results.some(result=>result.status==='rejected')){
  for(const result of results)if(result.status==='fulfilled')result.value.dispose();
  throw Error('机头模型加载失败');
 }
 const [bodyGeometry,coverGeometry,fovGeometry]=results.map(result=>result.value);
 const object=new Group(),assembly=new Group(),cover=new Group();
 const body=new Mesh(bodyGeometry,new MeshStandardMaterial({color:0xa8b2ba,roughness:.68}));
 const lid=new Mesh(coverGeometry,new MeshStandardMaterial({color:0x596773,roughness:.68}));
 // The two optical volumes from temp(1).stp (1/1/2), rigidly aligned to the preview camera face in mm.
 const field=new Mesh(fovGeometry,new MeshBasicMaterial({color:0x009dd2,transparent:true,opacity:.19,depthWrite:false,side:DoubleSide,forceSinglePass:true}));
 const {opticalOrigin:[x,y,z],laserViewDepth:depth,laserWorkingDistance,laserWidthAtWorkingDistance}=NANYANG_CAMERA_PREVIEW;
 const halfWidth=laserWidthAtWorkingDistance*depth/laserWorkingDistance/2;
 const laserGeometry=new BufferGeometry();
 laserGeometry.setAttribute('position',new Float32BufferAttribute([x,y,z,x,y-halfWidth,z-depth,x,y+halfWidth,z-depth],3));
 const laserField=new Mesh(laserGeometry,new MeshBasicMaterial({color:0x009dd2,transparent:true,opacity:.35,depthWrite:false,side:DoubleSide,forceSinglePass:true}));
 field.visible=laserField.visible=false;
 cover.position.copy(hinge);
 cover.add(lid);
 assembly.position.copy(wireTip).negate();
 assembly.add(body,cover,field,laserField);
 object.add(assembly);
 return {
  object,
  setCover(open){cover.quaternion.setFromAxisAngle(hingeAxis,open?openAngle:0);},
  setFieldOfView(show,camera){field.visible=!!show&&camera!=='laser';laserField.visible=!!show&&camera==='laser';},
  dispose(){for(const mesh of [body,lid,field,laserField]){mesh.geometry.dispose();mesh.material.dispose();}}
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
