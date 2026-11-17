import {Matrix4,Quaternion,Vector3} from 'three';
import {NANYANG_TOOL_CALIBRATION} from './weldToolPose.mjs';

export const DEFAULT_LASER_MOUNT_SIDE='negativeX';
export const LASER_MOUNT_SIDES=[['negativeX','焊枪筒身 −X 侧'],['positiveX','焊枪筒身 +X 侧']];
export const LASER_WORKING_DISTANCE=Object.freeze({min:292.5,nominal:403.5,max:630.5});
export const LASER_HORIZONTAL_OFFSET=40;
export const LASER_CAMERA_FILES=['camera-body.stl','camera-view.stl','laser-fan.stl'];

const vector=point=>new Vector3(...point);
const tip=vector(NANYANG_TOOL_CALIBRATION.wireTip);
const housingX=vector(NANYANG_TOOL_CALIBRATION.referenceX);
const housingZ=new Vector3(0,0,1);
const housingY=housingZ.clone().cross(housingX);
// The supplied optical and fan meshes share the source millimetre coordinates.
const emitter=vector([41.16387,-105.65117,164.77784]);
const receiver=vector([40.3868,-170.49897,169.1549]);
const left=vector([-175.9637,-62.5298,765.0911]),right=vector([38.3959,-62.5298,803.145]);
const sourceZ=emitter.clone().sub(left.clone().lerp(right,.5)).normalize();
const sourceY=right.clone().sub(left).normalize();
sourceY.addScaledVector(sourceZ,-sourceY.dot(sourceZ)).normalize();
const sourceX=sourceY.clone().cross(sourceZ);
const fromSource=new Matrix4().makeBasis(sourceX,sourceY,sourceZ).invert();
// Dimensions of the modeled side installation, relative to the head flange.
const sideOffset=150,housingCenterY=-80;

export function laserCameraMount(side=DEFAULT_LASER_MOUNT_SIDE){
 const sign=side==='positiveX'?1:-1;
 const x=housingX.clone().multiplyScalar(sign),y=housingY.clone().multiplyScalar(sign);
 const matrix=new Matrix4().makeBasis(x,y,housingZ).multiply(fromSource);
 const nominal=LASER_WORKING_DISTANCE.nominal;
 const laserOrigin=new Vector3(sign*sideOffset,housingCenterY,tip.z+nominal);
 matrix.setPosition(laserOrigin.clone().sub(emitter.clone().applyMatrix4(matrix)));
 const stripe=tip.clone().addScaledVector(x,LASER_HORIZONTAL_OFFSET);
 const dx=stripe.x-laserOrigin.x,dy=stripe.y-laserOrigin.y;
 stripe.z=laserOrigin.z-Math.sqrt(nominal*nominal-dx*dx-dy*dy);
 const beam=stripe.clone().sub(laserOrigin).normalize();
 // Rotate the optical assembly about the emitter, preserving the calibrated camera/laser baseline.
 const adjustment=new Matrix4().makeRotationFromQuaternion(new Quaternion().setFromUnitVectors(housingZ.clone().negate(),beam));
 adjustment.setPosition(laserOrigin.clone().sub(laserOrigin.clone().applyMatrix4(adjustment)));
 const opticalMatrix=adjustment.multiply(matrix);
 const fanNormal=sourceX.clone().transformDirection(opticalMatrix);
 return {matrix,opticalMatrix,stripe:stripe.toArray(),beam:beam.toArray(),emitter:laserOrigin.toArray(),
  fanNormal:fanNormal.toArray(),receiver:receiver.clone().applyMatrix4(opticalMatrix).toArray()};
}
