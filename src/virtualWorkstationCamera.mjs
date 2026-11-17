import {Box3,BufferGeometry,DoubleSide,EdgesGeometry,Float32BufferAttribute,LineBasicMaterial,LineSegments,Mesh,MeshBasicMaterial,Vector3} from 'three';
import {workstationCadPosition,workstationForward} from './workstationSimulation.mjs';
import {NANYANG_CAMERA_PREVIEW,NANYANG_TOOL_CALIBRATION} from './weldToolPose.mjs';

const nominalPhotoDistance=NANYANG_CAMERA_PREVIEW.opticalOrigin[2]-NANYANG_TOOL_CALIBRATION.wireTip[2];

const valueList=(camera,name)=>String(camera.properties?.find(property=>property.name===name)?.value??'')
 .split(',').map(Number).filter(value=>value>0);

function coarseOptics(root,camera){
 const binding=role=>camera.bindings.find(item=>item.role===role);
 const point=role=>root.getObjectByName(binding(role)?.link)?.getWorldPosition(new Vector3());
 const origin=point('laser_origin'),left=point('left_imager'),right=point('right_imager');
 const fan=binding('laser_plane');
 const node=root.getObjectByName(fan?.link)?.getObjectByName(fan?.visual);
 const width=valueList(camera,'scan_widths'),distance=valueList(camera,'working_distances');
 if(!origin||!left||!right||!node||!width.length||!distance.length)return null;
 const bound=new Box3().setFromObject(node);
 const forward=bound.getCenter(new Vector3()).sub(origin).normalize();
 const across=right.clone().sub(left).projectOnPlane(forward).normalize();
 return {origin,receivers:[left,right],forward,across,distance,width};
}

export function addCoarseCameraPyramids(root,devices){
 for(const camera of devices.filter(device=>device.kind==='coarse'&&!device.configured)){
  const visual=role=>{
   const binding=camera.bindings.find(item=>item.role===role);
   return binding?.visual&&root.getObjectByName(binding.link)?.getObjectByName(binding.visual);
  };
  const pyramids=['left_field_of_view','right_field_of_view'].map(role=>visual(role));
  if(!pyramids.every(Boolean)){
   const optics=coarseOptics(root,camera);
   if(optics)for(const [index,receiver] of optics.receivers.entries()){
    if(pyramids[index])continue;
    const pyramid=legacyCoarsePyramid(root,optics,receiver,index);
    root.add(pyramid);
    pyramids[index]=pyramid;
   }
  }
  if(pyramids.every(Boolean)){
   const old=visual('field_of_view');
   if(old)old.visible=false;
  }
  for(const pyramid of pyramids.filter(Boolean)){
   pyramid.userData.coarseCameraId=camera.id;
   if(pyramid.isMesh&&!pyramid.children.some(child=>child.isLineSegments)){
    const edges=new LineSegments(new EdgesGeometry(pyramid.geometry),
     new LineBasicMaterial({color:pyramid.material.color,transparent:true,opacity:.9,depthWrite:false}));
    pyramid.add(edges);
   }
  }
  const laser=visual('laser_plane');
  if(laser)laser.userData.coarseCameraId=camera.id;
 }
}

function legacyCoarsePyramid(root,{origin,forward,across,distance,width},receiver,index){
 const center=origin.clone().addScaledVector(forward,distance.at(-1)*.001);
 const depth=new Vector3().crossVectors(forward,across).normalize();
 const half=width.at(-1)*.0005;
 const vertices=[receiver.clone(),center.clone().addScaledVector(across,-half),
  center.clone().addScaledVector(across,half),center.addScaledVector(depth,index?-half:half)];
 const geometry=new BufferGeometry().setAttribute('position',new Float32BufferAttribute(
  vertices.flatMap(point=>root.worldToLocal(point).toArray()),3));
 geometry.setIndex([0,1,2,0,2,3,0,3,1,1,3,2]);
 const material=new MeshBasicMaterial({color:index?0x00a6a6:0x387dce,side:DoubleSide,
  transparent:true,opacity:.10,depthWrite:false});
 const pyramid=new Mesh(geometry,material);
 pyramid.name=index?'粗定位右目视野':'粗定位左目视野';
 return pyramid;
}

function captureAxes(frame,toCad){
 const origin=toCad(frame.origin);
 const vector=axis=>toCad(frame.origin.clone().add(axis)).sub(origin).normalize().toArray();
 return {...frame,origin:origin.toArray(),forward:vector(frame.forward),right:vector(frame.right),
  up:frame.up&&vector(frame.up),receivers:frame.receivers?.map(receiver=>toCad(receiver).toArray())};
}

function laserDimensions(camera,distance){
 const widths=camera.widths,distances=camera.workingDistances;
 if(!widths?.some(value=>value>0)||widths.length!==distances?.length)return {width:distance*136/403.5,range:Math.max(distance,630.5)};
 const index=distances.findIndex(value=>value>=distance);
 const width=index<=0?widths[index===0?0:widths.length-1]:
  widths[index-1]+(widths[index]-widths[index-1])*(distance-distances[index-1])/(distances[index]-distances[index-1]);
 return {width,range:distances.at(-1)};
}

export function virtualFineCaptureFrames(cycle,robot,modelOrigin,placement,invertZ){
 const toCad=point=>workstationCadPosition(point,modelOrigin,placement,invertZ);
 const camera=cycle.camera==='structuredLight'?robot.structuredLight:robot.laser;
 if(!camera)return [];
 return cycle.frames.filter(frame=>frame.capture).flatMap(frame=>{
  const tcp=workstationForward(robot,frame.values);
  const direction=axis=>axis.clone().applyQuaternion(tcp.quaternion);
  const point=local=>tcp.position.clone().add(direction(local));
  const {group,distance}=frame.capture;
  if(cycle.camera==='structuredLight'){
   const axis=values=>direction(new Vector3(...values).applyQuaternion(camera.rotation));
   return [captureAxes({kind:'photo',group,distance:distance||nominalPhotoDistance,origin:point(camera.origin),
    forward:axis([0,0,-1]),right:axis([1,0,0]),up:axis([0,1,0])},toCad)];
  }
  if(!camera.trackingPlane)return [];
  const across=new Vector3(...camera.trackingPlane.normal).cross(camera.beam).normalize();
  return [captureAxes({kind:'laser',group,distance,origin:point(camera.emitter),forward:direction(camera.beam),
   right:direction(across),receivers:camera.receiver?[point(camera.receiver)]:[],...laserDimensions(camera,distance)},toCad)];
 });
}

export function planVirtualCoarseScan(workstation,model,placement,invertZ){
 const device=workstation?.devices.find(item=>item.id===workstation.coarseCameraId&&item.kind==='coarse')??
  workstation?.devices.find(item=>item.kind==='coarse'&&!item.configured);
 if(!device||!model?.origin||!model.size)return null;
 const optics=coarseOptics(workstation.object,device);
 if(!optics)return null;
 const {origin,forward,across,receivers,width,distance}=optics;
 const at=Math.floor(distance.length/2);
 const toCad=point=>workstationCadPosition(point,model.origin,placement,invertZ);
 const profile=captureAxes({kind:'laser',origin,forward,right:across,receivers,
  distance:distance[at],range:distance.at(-1),width:width[at]},toCad);
 const lateral=new Vector3(...profile.right),depth=new Vector3(...profile.forward);
 const sceneSweep=new Vector3().crossVectors(forward,across).normalize();
 const sweep=toCad(origin.clone().add(sceneSweep)).sub(new Vector3(...profile.origin)).normalize();
 if(!lateral.lengthSq()||!depth.lengthSq()||!sweep.lengthSq())return null;
 const relative=new Vector3(...model.origin).sub(new Vector3(...profile.origin));
 const limits=axis=>{
  const center=axis.dot(relative);
  const half=model.size.reduce((sum,value,index)=>sum+Math.abs(axis.getComponent(index))*value/2,0);
  return [center-half,center+half];
 };
 const [start,end]=limits(sweep),[left,right]=limits(lateral),[near,far]=limits(depth);
 if(!(far>0&&near<profile.range))return null;
 const margin=50;
 const recommended=[Math.floor((start-margin)/10)*10,Math.ceil((end+margin)/10)*10];
 const span=right-left+2*margin;
 const slope=profile.width/(2*profile.distance);
 const stripCount=Math.ceil(span/Math.max(2*slope*near-2*margin,profile.width/4));
 const stripWidth=span/stripCount;
 const scanning=(start,end)=>{
  if(!Number.isFinite(start)||!Number.isFinite(end)||start===end)return [];
  return Array.from({length:stripCount},(_,group)=>{
   const offset=left-margin+(group+.5)*stripWidth;
   const shift=(point,station)=>new Vector3(...point).addScaledVector(sweep,station).addScaledVector(lateral,offset).toArray();
   return [start,end].map(station=>({...profile,group,stripHalfWidth:stripWidth/2,sampleDistance:Math.min(far,profile.range),
    origin:shift(profile.origin,station),receivers:profile.receivers.map(point=>shift(point,station))}));
  }).flat();
 };
 return {recommended,stripCount,depthCovered:near>0&&far<=profile.range,scanning};
}
