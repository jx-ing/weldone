import {Matrix4,Quaternion,Vector3} from 'three';

export const TORCH_ANGLE_KEYS=['advance','work','rotation'];
const radians=Math.PI/180;
const finite=(value,fallback=0)=>Number.isFinite(value)?value:fallback;
const vector=value=>new Vector3(...value);
const triplet=value=>Array.isArray(value)&&value.length===3&&value.every(Number.isFinite);

export const NANYANG_TOOL_CALIBRATION=Object.freeze({
 // Wire tip and axis inferred from the supplied STL, in its source coordinates (mm).
 wireTip:Object.freeze([0,-130.96,-552]),
 wireAxis:Object.freeze([0,.36381,.93147]),
 referenceX:Object.freeze([1,0,0]),
 coverHinge:Object.freeze([-15,4.5,-149]),
 coverAngle:1.798713552887
});

export function weldTorchFrame(tangent,normal,sectionUp){
 const t=vector(tangent).normalize();
 const n=vector(normal);
 n.addScaledVector(t,-n.dot(t));
 if(n.lengthSq()<1e-12){
  n.set(Math.abs(t.x)<.9?1:0,Math.abs(t.x)<.9?0:1,0);
  n.addScaledVector(t,-n.dot(t));
 }
 n.normalize();
 const up=new Vector3().crossVectors(t,n).normalize();
 if(sectionUp?up.dot(vector(sectionUp))<0:up.z<0)up.negate();
 return {tangent:t.toArray(),normal:n.toArray(),up:up.toArray()};
}

export function weldTorchAxis(tangent,normal,angles,up){
 const frame=weldTorchFrame(tangent,normal,up);
 const advance=finite(angles?.advance)*radians,work=finite(angles?.work)*radians;
 return vector(frame.tangent).multiplyScalar(Math.sin(advance))
  .addScaledVector(vector(frame.normal),Math.cos(work)*Math.cos(advance))
  .addScaledVector(vector(frame.up),Math.sin(work)*Math.cos(advance)).normalize().toArray();
}

export function weldTorchBasis(tangent,normal,angles,up){
 const frame=weldTorchFrame(tangent,normal,up);
 const z=vector(weldTorchAxis(frame.tangent,frame.normal,angles,frame.up));
 const x=vector(frame.tangent);
 x.addScaledVector(z,-x.dot(z));
 if(x.lengthSq()<1e-8){
  // The projected travel direction vanishes at ±90° push/pull. Use its
  // limiting transverse direction so the roll reference is still defined.
  const work=finite(angles?.work)*radians;
  const sign=Math.sign(Math.sin(finite(angles?.advance)*radians))||1;
  x.copy(vector(frame.normal)).multiplyScalar(-sign*Math.cos(work))
   .addScaledVector(vector(frame.up),-sign*Math.sin(work));
 }
 x.normalize().applyAxisAngle(z,finite(angles?.rotation)*radians);
 return [x,new Vector3().crossVectors(z,x),z];
}

export function weldTorchOrientation(tangent,normal,angles,up){
 return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(...weldTorchBasis(tangent,normal,angles,up)));
}

export function weldTorchAngles({tangent,normal,up},orientation){
 const frame=weldTorchFrame(tangent,normal,up);
 const wire=new Vector3(0,0,1).applyQuaternion(orientation);
 const x=new Vector3(1,0,0).applyQuaternion(orientation);
 const along=wire.dot(vector(frame.tangent));
 const across=wire.dot(vector(frame.normal)),height=wire.dot(vector(frame.up));
 const advance=Math.atan2(along,Math.hypot(across,height))/radians;
 const work=Math.hypot(across,height)<1e-8?0:Math.atan2(height,across)/radians;
 const [zeroRoll]=weldTorchBasis(tangent,normal,{advance,work},up);
 const rotation=Math.atan2(wire.dot(zeroRoll.clone().cross(x)),zeroRoll.dot(x))/radians;
 return {advance,work,rotation};
}

const nanyangSourceBasis=new Matrix4().makeBasis(
 vector(NANYANG_TOOL_CALIBRATION.referenceX),
 vector(NANYANG_TOOL_CALIBRATION.wireAxis).normalize().cross(vector(NANYANG_TOOL_CALIBRATION.referenceX)),
 vector(NANYANG_TOOL_CALIBRATION.wireAxis).normalize()
).invert();

function sourceRotation(calibration){
 if(calibration===NANYANG_TOOL_CALIBRATION)return nanyangSourceBasis;
 const z=vector(calibration.wireAxis).normalize(),x=vector(calibration.referenceX);
 x.addScaledVector(z,-x.dot(z)).normalize();
 if(x.lengthSq()<1e-12||z.lengthSq()<1e-12)throw Error('机头标定轴无效');
 return new Matrix4().makeBasis(x,new Vector3().crossVectors(z,x),z).invert();
}

// All coordinates are in workpiece CAD coordinates (mm). TCP +Z points
// from the wire tip toward the torch body, matching the existing angle convention.
export function resolveWeldToolPose({position,tangent,normal,up,pose,distance,contactDistance},calibration=NANYANG_TOOL_CALIBRATION){
 const angles=Object.fromEntries(TORCH_ANGLE_KEYS.map(key=>[key,finite(pose?.[key])]));
 const frame=weldTorchFrame(tangent,normal,up);
 const basis=weldTorchBasis(frame.tangent,frame.normal,angles,frame.up);
 const tcpRotation=new Matrix4().makeBasis(...basis);
 const orientation=new Quaternion().setFromRotationMatrix(tcpRotation).normalize();
 const wireAxis=basis[2],target=vector(position);
 const rotation=new Quaternion().setFromRotationMatrix(tcpRotation.multiply(sourceRotation(calibration))).normalize();
 const calibrated=triplet(calibration.contactTip)&&Number.isFinite(contactDistance)&&contactDistance>=0;
 const headOrigin=calibrated?target.clone().addScaledVector(wireAxis,contactDistance)
  .sub(vector(calibration.contactTip).applyQuaternion(rotation)):
  target.clone().sub(vector(calibration.wireTip).applyQuaternion(rotation));
 const tcpPosition=calibrated?vector(calibration.wireTip).applyQuaternion(rotation).add(headOrigin).toArray():[...position];
 return {distance,position:[...position],angles,frame,wireAxis:wireAxis.toArray(),
  tcp:{position:tcpPosition,quaternion:orientation.toArray()},
  head:{position:headOrigin.toArray(),quaternion:rotation.toArray()},
  contactDistance:calibrated?contactDistance:null};
}
