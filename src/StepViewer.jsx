import React,{useEffect,useRef,useState} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {Line2} from 'three/examples/jsm/lines/Line2.js';
import {LineGeometry} from 'three/examples/jsm/lines/LineGeometry.js';
import {LineMaterial} from 'three/examples/jsm/lines/LineMaterial.js';
import {pathLength,sampleManualWeldPath} from './manualWeldModel.mjs';
import {loadStepMesh} from './stepModelStore.mjs';
import {captureWeldRegion} from './captureWeldRegion.mjs';
import {weldPassMeshGeometry} from './weldPassMesh.mjs';
const vec=p=>new THREE.Vector3(p[0],p[2],-p[1]);
const line=(points,color)=>new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color}));
const passColors=[0x176cba,0xa54bd4,0x00846c,0xbf4e2c,0x6964d5,0x007e9a];
function clear(group){for(const o of [...group.children]){o.traverse(c=>{c.geometry?.dispose();c.material?.dispose();});group.remove(o);}}
export default function StepViewer(props){
  const host=useRef(),labels=useRef(),pointLabels=useRef(),api=useRef(),latest=useRef(props);latest.current=props;
  const [status,setStatus]=useState('正在加载 '+props.model+'…'),[ready,setReady]=useState(false);
  useEffect(()=>{
    const el=host.current;let renderer,closed=false;
    try{renderer=new THREE.WebGLRenderer({antialias:true});}catch{setStatus('WebGL 不可用，请启用硬件加速。');return;}
    renderer.setPixelRatio(Math.min(devicePixelRatio,1.8));renderer.setClearColor('#f4f6f8');el.appendChild(renderer.domElement);renderer.domElement.setAttribute('aria-label',props.model+' 三维模型，可旋转、缩放和选择焊缝');
    const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-8000,8000,5000,-5000,.1,200000);camera.position.set(10000,9000,10000);
    const controls=new OrbitControls(camera,renderer.domElement);controls.update();scene.add(new THREE.HemisphereLight(0xffffff,0x8996a1,2.8));const light=new THREE.DirectionalLight(0xffffff,2.8);light.position.set(8000,14000,10000);scene.add(light);
    const body=new THREE.Group(),edges=new THREE.Group(),welds=new THREE.Group(),passMeshes=new THREE.Group(),passLines=new THREE.Group(),planningMarkers=new THREE.Group();scene.add(body,edges,welds,passMeshes,passLines,planningMarkers);
    const marker=new THREE.Mesh(new THREE.SphereGeometry(25,12,12),new THREE.MeshBasicMaterial({color:0xff4b40,depthTest:false}));marker.visible=false;scene.add(marker);
    let grid,model,span=10000,down;
    const origin=()=>model?.origin||[0,0,0],world=p=>vec(p.map((v,i)=>v-origin()[i])),cad=p=>[p.x+origin()[0],-p.z+origin()[1],p.y+origin()[2]];
    function pathLine(points,color,width=3,order=2){const geometry=new LineGeometry().setPositions(points.flatMap(p=>[p.x,p.y,p.z])),material=new LineMaterial({color,linewidth:width,depthTest:false,depthWrite:false});material.resolution.set(el.clientWidth,el.clientHeight);const shape=new Line2(geometry,material);shape.computeLineDistances();shape.renderOrder=order;return shape;}
    function projectedBounds(points){
      camera.updateMatrixWorld(true);
      return new THREE.Box3().setFromPoints(points.map(point=>point.clone().applyMatrix4(camera.matrixWorldInverse)));
    }
    function focusPasses(){
      const passes=latest.current.passPaths??[];
      if(!model||!passes.length||!el.clientWidth||!el.clientHeight)return;
      const sampleAtHalf=positions=>{
        const half=pathLength(positions)/2;
        let length=0;
        for(let i=1;i<positions.length;i++){
          const before=world(positions[i-1]),after=world(positions[i]),step=before.distanceTo(after);
          if(step&&length+step>=half)return {
            position:before.clone().lerp(after,(half-length)/step),
            tangent:after.sub(before).normalize()
          };
          length+=step;
        }
        return {position:world(positions[0]),tangent:new THREE.Vector3(1,0,0)};
      };
      const samples=passes.map(pass=>sampleAtHalf(pass.positions));
      const section=samples.map(sample=>sample.position);
      const center=new THREE.Box3().setFromPoints(section).getCenter(new THREE.Vector3());
      const tangent=samples[0].tangent;
      const side=new THREE.Vector3().crossVectors(camera.up,tangent).normalize();
      if(side.lengthSq()<1e-6)side.set(1,0,0);
      const direction=tangent.clone().addScaledVector(side,1.2).addScaledVector(camera.up,.65).normalize();
      const distance=Math.max(camera.position.distanceTo(controls.target),span);
      camera.position.copy(center).addScaledVector(direction,distance);
      controls.target.copy(center);
      camera.lookAt(center);
      const size=projectedBounds(section).getSize(new THREE.Vector3());
      const maxLeg=Math.max(...passes.map(pass=>pass.leg??0));
      const extent=Math.max(size.x+maxLeg*2,size.y+maxLeg*2,8)*2.8;
      camera.zoom=Math.max(1,Math.min((camera.right-camera.left)/extent,(camera.top-camera.bottom)/extent));
      camera.updateProjectionMatrix();
      controls.update();
      render();
    }
    function orient(){const views={iso:[1,.85,1],top:[0,1,.0001],front:[0,.02,1],right:[1,.02,0]},v=views[latest.current.camera]||views.iso;camera.position.set(...v.map(n=>n*span*1.5));camera.zoom=1;controls.target.set(0,0,0);controls.update();}
    function render(){if(!el.clientWidth||!el.clientHeight)return;const scale=(camera.top-camera.bottom)/(el.clientHeight*camera.zoom);for(const marker of planningMarkers.children)marker.scale.setScalar(scale*marker.userData.pixelRadius);
      for(const path of passLines.children)path.visible=(path.userData.leg??0)<3*scale;
      renderer.render(scene,camera);const occupied=[];labels.current?.querySelectorAll('[data-label]').forEach(label=>{const w=latest.current.welds.find(w=>w.id===label.dataset.label),points=w?.segments?.flatMap(s=>s.pathPoints||[]);if(!points?.length){label.style.visibility='hidden';return;}const p=world(points[Math.floor(points.length/2)]);p.project(camera);const x=Math.max(28,Math.min(el.clientWidth-28,(p.x+1)*el.clientWidth/2));let y=(-p.y+1)*el.clientHeight/2-15;for(let i=0;i<8&&occupied.some(q=>Math.abs(q.x-x)<50&&Math.abs(q.y-y)<22);i++)y-=23;y=Math.max(24,Math.min(el.clientHeight-25,y));occupied.push({x,y});label.style.left=`${x}px`;label.style.top=`${y}px`;label.style.visibility=p.z>1?'hidden':'visible';});
      pointLabels.current?.querySelectorAll('[data-planning-point]').forEach(label=>{const point=(latest.current.planningPoints||[]).find(point=>point.id===label.dataset.planningPoint);if(!point?.position){label.style.visibility='hidden';return;}const p=world(point.position).project(camera),x=(p.x+1)*el.clientWidth/2;let y=(1-p.y)*el.clientHeight/2-8;for(let i=0;i<10&&occupied.some(q=>Math.abs(q.x-x)<65&&Math.abs(q.y-y)<22);i++)y-=23;occupied.push({x,y});label.style.left=`${x}px`;label.style.top=`${y}px`;label.style.visibility=Math.abs(p.x)>1||Math.abs(p.y)>1||Math.abs(p.z)>1?'hidden':'visible';});
    }
    function resize(){const w=el.clientWidth,h=el.clientHeight;if(!w||!h)return;let extent=span*.62;if(model){camera.updateMatrixWorld();const box=new THREE.Box3().setFromObject(body),projected=new THREE.Box3();for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])projected.expandByPoint(new THREE.Vector3(x,y,z).applyMatrix4(camera.matrixWorldInverse));extent=Math.max(projected.max.y-projected.min.y,(projected.max.x-projected.min.x)/(w/h))*.58;}camera.left=-extent*w/h;camera.right=extent*w/h;camera.top=extent;camera.bottom=-extent;camera.far=span*25;camera.updateProjectionMatrix();renderer.setSize(w,h);render();}
    function rebuild(){if(!model)return;const p=latest.current;body.visible=!!p.model&&p.view.model;edges.visible=body.visible;welds.visible=p.view.welds&&!!p.model;if(grid)grid.visible=p.view.grid;body.children.forEach(m=>{m.material.transparent=p.view.transparent;m.material.opacity=p.view.transparent?.28:1;m.material.depthWrite=!p.view.transparent;});
      clear(welds);for(const w of p.welds){if(!w.enabled||!['manual','extracted','manual-merge'].includes(w.source))continue;for(const s of w.segments){if(!s.pathPoints)continue;const hasPasses=w.id===p.selected&&p.passPaths?.length;const shape=pathLine(s.pathPoints.map(world),hasPasses?0x687781:(p.mergeIds||[]).includes(w.id)?0x52b788:w.id===p.selected?0x14a4e4:0xfa8c16,hasPasses?1:3);shape.userData.id=w.id;welds.add(shape);}}
      clear(passMeshes);clear(passLines);
      passMeshes.visible=passLines.visible=welds.visible;
      const passes=p.passPaths??[],hasSelection=passes.some(pass=>pass.active);
      for(const pass of passes){
        const color=passColors[(pass.layerIndex+pass.passIndex*2)%passColors.length];
        const geometry=weldPassMeshGeometry(pass,world);
        if(geometry){
          const surfaceColor=new THREE.Color(color);
          if(hasSelection&&!pass.active)surfaceColor.lerp(new THREE.Color(0x8e979e),.45);
          const material=new THREE.MeshStandardMaterial({color:surfaceColor,roughness:.75,side:THREE.DoubleSide,
            polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
          const mesh=new THREE.Mesh(geometry,material);
          mesh.userData.passId=pass.id;
          mesh.renderOrder=pass.active?2:1;
          passMeshes.add(mesh);
        }
        const shape=pathLine(pass.positions.map(world),color,pass.active?2.5:1.5,pass.active?4:3);
        shape.material.transparent=true;
        shape.material.opacity=hasSelection&&!pass.active ? .46 : 1;
        shape.userData.passId=pass.id;
        shape.userData.leg=geometry?pass.leg:0;
        passLines.add(shape);
      }
      clear(planningMarkers);planningMarkers.visible=p.view.welds&&!!p.model;
      for(const point of p.planningPoints||[]){if(!point.position)continue;const selected=point.id===p.selectedPlanningPointId,dot=new THREE.Mesh(new THREE.SphereGeometry(1,12,12),new THREE.MeshBasicMaterial({color:selected?0xfa8c16:point.source==='template'?0x54ad85:0x1fa6d5,depthTest:false}));dot.position.copy(world(point.position));dot.userData.pixelRadius=selected?3:2.5;dot.renderOrder=5;planningMarkers.add(dot);}
      if(p.splitPoint){const weld=p.welds.find(w=>w.id===p.splitPoint.id);if(weld?.enabled&&Number.isFinite(p.splitPoint.distance)&&p.splitPoint.distance>0&&p.splitPoint.distance<weld.length){const position=sampleManualWeldPath(weld.segments,p.splitPoint.distance).position,dot=new THREE.Mesh(new THREE.SphereGeometry(1,12,12),new THREE.MeshBasicMaterial({color:0xff4b40,depthTest:false}));dot.position.copy(world(position));dot.userData.pixelRadius=5;dot.renderOrder=6;planningMarkers.add(dot);}}
      marker.visible=false;const selected=p.welds.find(w=>w.id===p.selected);if(['manual','extracted','manual-merge'].includes(selected?.source)&&selected.enabled&&selected.planned&&p.progress>0){const planned=selected.strategyPlan?.passes[0]?.points.map(point=>point.position);const all=planned?.length>1?planned:selected.segments.flatMap(s=>s.pathPoints);let at=pathLength(all)*(!planned&&selected.direction==='反向'?1-p.progress/100:p.progress/100);for(let i=1;i<all.length;i++){const a=world(all[i-1]),b=world(all[i]),d=a.distanceTo(b);if(at<=d||i===all.length-1){marker.position.copy(a.lerp(b,d?Math.min(1,at/d):0));marker.visible=true;break;}at-=d;}}
      render();
    }
    const ray=new THREE.Raycaster(),mouse=new THREE.Vector2();
    function setRay(e){const r=renderer.domElement.getBoundingClientRect();mouse.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);ray.setFromCamera(mouse,camera);ray.params.Line.threshold=(camera.top-camera.bottom)/(Math.max(100,r.height)*camera.zoom)*7;}
    const pd=e=>{down=[e.clientX,e.clientY];};
    const hitOffset=hit=>hit.point.distanceToSquared(hit.pointOnLine);
    const pu=e=>{if(!model||!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>4)return;down=null;const p=latest.current;setRay(e);if(p.onSelectFace){const hit=ray.intersectObjects(body.children,false)[0];if(hit?.face){const n=hit.face.normal.clone().transformDirection(hit.object.matrixWorld);p.onSelectFace(cad(hit.point),[n.x,-n.z,n.y]);}return;}if(p.view.welds){
      const surfaces=p.editMode?[]:ray.intersectObjects(passMeshes.children,false);
      const surface=surfaces[0];
      const bodyHit=surface&&body.visible&&!p.view.transparent?ray.intersectObjects(body.children,false)[0]:null;
      if(surface&&(!bodyHit||surface.distance<=bodyHit.distance+.001)){
        p.onSelectPass?.(surface.object.userData.passId);return;
      }
      const hits=p.editMode?[]:ray.intersectObjects(passLines.children.filter(path=>path.visible),false);
      const pass=hits.sort((a,b)=>hitOffset(a)-hitOffset(b)||Number(b.object.userData.passId===p.activePassId)-Number(a.object.userData.passId===p.activePassId))[0];
      if(pass){p.onSelectPass?.(pass.object.userData.passId);return;}
      const hit=ray.intersectObjects(welds.children,false)[0];if(hit)p.onSelect(hit.object.userData.id,cad(hit.pointOnLine||hit.point));
    }};
    renderer.domElement.addEventListener('pointerdown',pd);renderer.domElement.addEventListener('pointerup',pu);controls.addEventListener('change',render);const observer=new ResizeObserver(resize);observer.observe(el);api.current={rebuild,resize,orient,focusPasses};
    loadStepMesh(props.model,props.stepModel).then(data=>{if(closed)return;model=data;span=Math.max(...data.size);for(const [i,m] of data.meshes.entries()){const g=new THREE.BufferGeometry(),a=[];for(let j=0;j<m.positions.length;j+=3)a.push(m.positions[j],m.positions[j+2],-m.positions[j+1]);g.setAttribute('position',new THREE.Float32BufferAttribute(a,3));g.setIndex(m.indices);if(m.normals){const n=[];for(let j=0;j<m.normals.length;j+=3)n.push(m.normals[j],m.normals[j+2],-m.normals[j+1]);g.setAttribute('normal',new THREE.Float32BufferAttribute(n,3));}else g.computeVertexNormals();const mesh=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:0xaab4bf,metalness:.35,roughness:.6,side:THREE.DoubleSide}));mesh.userData.part=i;body.add(mesh);}for(const edge of data.edges){const shape=line(edge.points.map(vec),0x65727f);shape.material.transparent=true;shape.material.opacity=.7;shape.userData.edge=edge;edges.add(shape);}grid=new THREE.GridHelper(span*2,40,0xc2c9cf,0xe0e5e9);grid.position.y=-data.size[2]/2-span*.004;scene.add(grid);marker.scale.setScalar(span/10000);orient();resize();rebuild();latest.current.onCoverCaptureReady?.((weld,range)=>{if(!model)throw Error('模型尚未加载完成');try{return captureWeldRegion({renderer,camera,body,edges,model,weld,modelName:latest.current.model,range});}finally{render();}});setStatus('');setReady(true);latest.current.onModelInfo?.({name:data.name,parts:data.meshes.map(m=>m.name),size:data.size,edgeCount:data.edges.length});}).catch(e=>{if(!closed)setStatus(`模型加载失败：${e.message}`);});
    resize();return()=>{closed=true;observer.disconnect();controls.dispose();renderer.domElement.removeEventListener('pointerdown',pd);renderer.domElement.removeEventListener('pointerup',pu);scene.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});renderer.dispose();renderer.domElement.remove();api.current=null;latest.current.onCoverCaptureReady?.(null);};
  },[]);
  useEffect(()=>{api.current?.rebuild();},[props.model,props.welds,props.selected,props.view,props.progress,props.planningPoints,props.selectedPlanningPointId,props.mergeIds,props.splitPoint,props.passPaths,ready]);
  useEffect(()=>{api.current?.orient();api.current?.resize();},[props.camera,props.reset]);
  useEffect(()=>{if(props.passFocus)api.current?.focusPasses();},[props.passFocus]);
  return <><div ref={host} className="three-host" data-pass-paths={props.passPaths?.length||undefined}/>{status&&<div className="model-loading" role="status">{status}</div>}<div className="weld-labels" ref={labels} hidden={!props.model||!props.view.labels||!props.view.welds}>{props.welds.filter(w=>props.welds.length<=25||w.id===props.selected).map(w=><button key={w.id} data-label={w.id} hidden={!w.enabled} className={w.id===props.selected?'selected':''} onClick={()=>props.onSelect(w.id)}>{w.id}</button>)}</div><div className="planning-point-labels" ref={pointLabels} hidden={!props.model||!props.view.welds}>{(props.planningPoints||[]).filter(point=>point.position).map(point=><button type="button" key={point.id} data-planning-point={point.id} className={point.source+(point.id===props.selectedPlanningPointId?' selected':'')} aria-label={'模型规划点 '+point.name+' '+point.id} title={point.templateName?point.templateName+' · 第'+(point.layerIndex+1)+'层 / 第'+(point.passIndex+1)+'道':'当前焊道'} onClick={()=>props.onPlanningPointSelect?.(point.id)}>{point.name}</button>)}</div></>;
}
