import {Matrix4,Vector3} from 'three';
import {NANYANG_TOOL_CALIBRATION} from './weldToolPose.mjs';

export const DEFAULT_LASER_MOUNT_SIDE='negativeX';
export const LASER_MOUNT_SIDES=[['negativeX','焊枪 TCP −X 侧'],['positiveX','焊枪 TCP +X 侧']];
export const LASER_CAMERA_FILES=['camera-body.stl','camera-view.stl','laser-fan.stl'];

const vector=point=>new Vector3(...point);
const tip=vector(NANYANG_TOOL_CALIBRATION.wireTip);
const toolX=vector(NANYANG_TOOL_CALIBRATION.referenceX);
const toolZ=vector(NANYANG_TOOL_CALIBRATION.wireAxis).normalize();
const toolY=toolZ.clone().cross(toolX);
// The supplied optical and fan meshes share the source millimetre coordinates.
const emitter=vector([41.16387,-105.65117,164.77784]);
const receiver=vector([40.3868,-170.49897,169.1549]);
const left=vector([-175.9637,-62.5298,765.0911]),right=vector([38.3959,-62.5298,803.145]);
const sourceZ=emitter.clone().sub(left.clone().lerp(right,.5)).normalize();
const sourceY=right.clone().sub(left).normalize();
sourceY.addScaledVector(sourceZ,-sourceY.dot(sourceZ)).normalize();
const sourceX=sourceY.clone().cross(sourceZ);
const fromSource=new Matrix4().makeBasis(sourceX,sourceY,sourceZ).invert();
// Preview fixture in TCP coordinates. The nominal stripe stays on the selected side.
const standOff=403.5,sideOffset=110;

export function laserCameraMount(side=DEFAULT_LASER_MOUNT_SIDE){
 const sign=side==='positiveX'?1:-1;
 const x=toolX.clone().multiplyScalar(sign),y=toolY.clone().multiplyScalar(sign);
 const matrix=new Matrix4().makeBasis(x,y,toolZ).multiply(fromSource);
 const stripe=tip.clone().addScaledVector(x,sideOffset);
 const position=stripe.clone().addScaledVector(toolZ,standOff).sub(emitter.clone().applyMatrix4(matrix));
 matrix.setPosition(position);
 return {matrix,stripe:stripe.toArray(),receiver:receiver.clone().applyMatrix4(matrix).toArray()};
}
