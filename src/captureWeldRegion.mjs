import {weldCapturePlanes} from './weldCapturePlanes.mjs';
import * as THREE from 'three';
import {Line2} from 'three/examples/jsm/lines/Line2.js';
import {LineGeometry} from 'three/examples/jsm/lines/LineGeometry.js';
import {LineMaterial} from 'three/examples/jsm/lines/LineMaterial.js';
import {weldRegionBounds} from './templateCoverModel.mjs';

export function captureWeldRegion({renderer,camera,body,edges,model,weld,modelName,range}){
 const width=640,height=400,region=weldRegionBounds(weld,model.origin,Math.max(...model.size),range);
 const box=new THREE.Box3(new THREE.Vector3(...region.world.min),new THREE.Vector3(...region.world.max));
 const world=p=>new THREE.Vector3(p[0]-model.origin[0],p[2]-model.origin[2],model.origin[1]-p[1]);
 const planes=weldCapturePlanes(region,world);
 const scene=new THREE.Scene(),materials=[],geometries=[],parts=[];
 const addClipped=object=>{const copy=object.clone();copy.material=object.material.clone();copy.material.clippingPlanes=planes;copy.material.clipIntersection=false;copy.material.transparent=false;copy.material.opacity=1;copy.material.depthWrite=true;materials.push(copy.material);scene.add(copy);};
 body.children.forEach((part,index)=>{if(new THREE.Box3().setFromObject(part).intersectsBox(box)){addClipped(part);parts.push(index);}});
 if(!parts.length)throw Error('所选焊缝附近没有模型表面，无法生成封面');
 edges.children.forEach(edge=>{if(new THREE.Box3().setFromObject(edge).intersectsBox(box))addClipped(edge);});
 scene.add(new THREE.HemisphereLight(0xffffff,0x8996a1,2.8));const light=new THREE.DirectionalLight(0xffffff,2.8);light.position.set(8000,14000,10000);scene.add(light);
 const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()).length(),direction=new THREE.Vector3();camera.getWorldDirection(direction).negate();
 const view=new THREE.OrthographicCamera(-1,1,1,-1,.1,Math.max(size*20,100));view.up.copy(camera.up);view.position.copy(center).addScaledVector(direction,size*3);view.lookAt(center);view.updateMatrixWorld(true);
 const projected=new THREE.Box3();for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])projected.expandByPoint(new THREE.Vector3(x,y,z).applyMatrix4(view.matrixWorldInverse));
 const extent=Math.max(projected.max.y-projected.min.y,(projected.max.x-projected.min.x)/(width/height))*.56;
 view.left=-extent*width/height;view.right=extent*width/height;view.top=extent;view.bottom=-extent;view.updateProjectionMatrix();
 for(const segment of weld.segments){const points=segment.pathPoints.map(p=>[p[0]-model.origin[0],p[2]-model.origin[2],model.origin[1]-p[1]]);const geometry=new LineGeometry().setPositions(points.flat()),material=new LineMaterial({color:0xfa8c16,linewidth:3.5,depthTest:false});material.resolution.set(width,height);const path=new Line2(geometry,material);path.renderOrder=3;path.computeLineDistances();scene.add(path);materials.push(material);geometries.push(geometry);}
 const target=new THREE.WebGLRenderTarget(width,height,{depthBuffer:true});
 const previous={target:renderer.getRenderTarget(),viewport:renderer.getViewport(new THREE.Vector4()),scissor:renderer.getScissor(new THREE.Vector4()),scissorTest:renderer.getScissorTest(),color:renderer.getClearColor(new THREE.Color()).clone(),alpha:renderer.getClearAlpha(),clipping:renderer.localClippingEnabled};
 try{
  renderer.localClippingEnabled=true;renderer.setRenderTarget(target);renderer.setScissorTest(false);renderer.setClearColor('#f4f6f8',1);renderer.render(scene,view);
  const pixels=new Uint8Array(width*height*4);renderer.readRenderTargetPixels(target,0,0,width,height,pixels);
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const context=canvas.getContext('2d');if(!context)throw Error('无法生成焊缝封面');const data=context.createImageData(width,height);
  for(let y=0;y<height;y++)data.data.set(pixels.subarray((height-y-1)*width*4,(height-y)*width*4),y*width*4);context.putImageData(data,0,0);
  return {kind:'weld-model-region',dataUrl:canvas.toDataURL('image/png'),width,height,model:modelName,weldId:weld.id,bounds:region.cad,parts,capturedAt:new Date().toISOString()};
 }finally{
  renderer.setRenderTarget(previous.target);renderer.setViewport(previous.viewport);renderer.setScissor(previous.scissor);renderer.setScissorTest(previous.scissorTest);renderer.setClearColor(previous.color,previous.alpha);renderer.localClippingEnabled=previous.clipping;target.dispose();materials.forEach(material=>material.dispose());geometries.forEach(geometry=>geometry.dispose());
 }
}
