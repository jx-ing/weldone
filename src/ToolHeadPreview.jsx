import React,{useEffect,useRef,useState} from 'react';
import {Box3,DirectionalLight,HemisphereLight,OrthographicCamera,Scene,Vector3,WebGLRenderer} from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {loadNanyangToolHead} from './nanyangToolHead.mjs';

export default function ToolHeadPreview({coverOpen=false,fieldOfView,camera:cameraType,structuredLightInstalled,laserMountSide,laserLine}){
 const host=useRef(null),api=useRef(null),latest=useRef(null);
 const [status,setStatus]=useState('正在加载机头模型…');
 latest.current={coverOpen,fieldOfView,cameraType,structuredLightInstalled,laserMountSide,laserLine};
 useEffect(()=>{
  const el=host.current;
  let renderer,head,disposed=false;
  try{renderer=new WebGLRenderer({antialias:true});}
  catch{setStatus('WebGL 不可用');return;}
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.8));
  renderer.setClearColor(0xf4f6f8);
  renderer.domElement.setAttribute('aria-label','焊枪与'+(cameraType==='laser'?'线激光':'结构光')+'相机三维模型');
  el.append(renderer.domElement);
  const scene=new Scene(),camera=new OrthographicCamera(-300,300,300,-300,.1,6000);
  camera.up.set(0,0,1);
  const controls=new OrbitControls(camera,renderer.domElement);
  const light=new DirectionalLight(0xffffff,2.5);
  light.position.set(-600,500,700);
  scene.add(new HemisphereLight(0xffffff,0xa1a9b1,2.4),light);
  const render=()=>renderer.render(scene,camera);
  let span=660;
  function resize(){
   if(!el.clientWidth||!el.clientHeight)return;
   const width=el.clientWidth,height=el.clientHeight;
   const ratio=width/height;
   const half=span/2/Math.min(1,ratio);
   camera.left=-half*ratio;camera.right=half*ratio;camera.top=half;camera.bottom=-half;
   camera.updateProjectionMatrix();
   renderer.setSize(width,height,false);
   render();
  }
  controls.addEventListener('change',render);
  const observer=new ResizeObserver(resize);
  observer.observe(el);
  loadNanyangToolHead().then(model=>{
   if(disposed){model.dispose();return;}
   head=model;
   scene.add(head.object);
   let previousField;
   api.current=({coverOpen,fieldOfView,cameraType,structuredLightInstalled,laserMountSide,laserLine})=>{
    head.setCover(coverOpen);
    head.setCameraMounts(structuredLightInstalled,laserMountSide);
    head.setFieldOfView(fieldOfView,cameraType,laserLine);
    const visibleParts=JSON.stringify([fieldOfView,structuredLightInstalled,laserMountSide,laserLine]);
    if(previousField!==visibleParts){
     const orbit=previousField===undefined?new Vector3(800,600,380):camera.position.clone().sub(controls.target).normalize().multiplyScalar(1800);
     previousField=visibleParts;
     const bounds=new Box3();
     head.object.updateMatrixWorld(true);
     head.object.traverseVisible(node=>{if(node.isMesh){
      if(!node.geometry.boundingBox)node.geometry.computeBoundingBox();
      bounds.union(node.geometry.boundingBox.clone().applyMatrix4(node.matrixWorld));
     }});
     const center=bounds.getCenter(new Vector3());
     span=bounds.getSize(new Vector3()).length()*1.12;
     camera.zoom=1;
     camera.position.copy(center).add(orbit);
     controls.target.copy(center);
     controls.update();
     resize();
    }else render();
   };
   api.current(latest.current);
   setStatus('');
  }).catch(error=>{if(!disposed)setStatus(error.message);});
  return ()=>{
   disposed=true;
   observer.disconnect();
   controls.dispose();
   head?.dispose();
   renderer.dispose();
   renderer.domElement.remove();
   api.current=null;
  };
 },[]);
 useEffect(()=>{api.current?.(latest.current);},[coverOpen,fieldOfView,cameraType,structuredLightInstalled,laserMountSide,laserLine]);
 return <div className="dc-tool-preview" data-cover={coverOpen?'open':'closed'} data-field-of-view={fieldOfView?'visible':'hidden'}>
  <div className="dc-tool-canvas" ref={host}/>
  {status&&<p role="status">{status}</p>}
 </div>;
}
