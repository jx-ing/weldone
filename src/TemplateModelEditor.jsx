import React,{useEffect,useRef,useState} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {Line2} from 'three/examples/jsm/lines/Line2.js';
import {LineGeometry} from 'three/examples/jsm/lines/LineGeometry.js';
import {LineMaterial} from 'three/examples/jsm/lines/LineMaterial.js';
import {captureWeldRegion} from './captureWeldRegion.mjs';
import {weldRegionBounds} from './templateCoverModel.mjs';
import {weldCapturePlanes} from './weldCapturePlanes.mjs';
import {loadStepMesh} from './stepModelStore.mjs';
import {templatePathNodes,moveTemplatePathNode,templateGeometrySnapshot,restoreTemplateGeometry} from './templateModelEditing.mjs';
import {templateProcessNodes,moveTemplateProcessPoint,processPointSnapshot,restoreProcessPointPositions} from './templateProcessPointGeometry.mjs';

const vector=p=>new THREE.Vector3(p[0],p[2],-p[1]);
export default function TemplateModelEditor({template,onChange,onCaptureReady,pointMode=false,selectedPointId,onSelectPoint,compactToolbar=false,historyKey,previewOnly=false,highlight,fallbackCover}){
 const root=useRef(),host=useRef(),labels=useRef(),api=useRef(),latest=useRef(),focused=useRef(null);
 const [expanded,setExpanded]=useState(false),[selected,setSelected]=useState(0),[status,setStatus]=useState('正在加载三维焊缝域…'),[error,setError]=useState(''),[history,setHistory]=useState([]),[coordinates,setCoordinates]=useState(['','','']);
 const preview=previewOnly;
 const nodes=preview?[]:(pointMode?templateProcessNodes(template):templatePathNodes(template)),selectedIndex=pointMode?Math.max(0,nodes.findIndex(node=>node.id===selectedPointId)):selected,active=nodes.find(node=>node.index===selectedIndex)||nodes[0],pointLabel=pointMode?'三维工艺点':'三维焊缝点';
 latest.current={template,onChange,onCaptureReady,selected:selectedIndex,nodes,onSelectPoint,pointMode,highlight};
 const moveNode=(base,index,position)=>pointMode?moveTemplateProcessPoint(base,index,position):moveTemplatePathNode(base,index,position);
 function selectNode(index){setSelected(index);if(latest.current.pointMode)latest.current.onSelectPoint?.(latest.current.nodes.find(node=>node.index===index)?.id);}
 useEffect(()=>{if(active)setCoordinates(previous=>active.position.map((v,i)=>focused.current===i?previous[i]:String(Math.round(v*10000)/10000)));},[template.segments,pointMode?template.points:null,pointMode?template.passOffset:null,selectedIndex]);
 useEffect(()=>{setHistory([]);setError('');},[historyKey]);
 const record=()=>setHistory(previous=>[...previous.slice(-19),(pointMode?processPointSnapshot(latest.current.template):templateGeometrySnapshot(latest.current.template))]);
 function edit(position,base=latest.current.template,remember=true){try{const next=moveNode(base,latest.current.selected,position);if(remember)record();onChange(next);setError('');return true;}catch(error){setError(error.message);return false;}}
 useEffect(()=>{
  const element=host.current;let renderer,model,closed=false,box;
  try{renderer=new THREE.WebGLRenderer({antialias:true});}catch{setStatus('WebGL不可用，无法显示三维模型');return;}
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.8));renderer.setClearColor('#f4f6f8');renderer.localClippingEnabled=true;element.appendChild(renderer.domElement);renderer.domElement.setAttribute('aria-label',preview?'局部焊缝三维模型，可旋转缩放':pointMode?'三维工艺点模型，可旋转缩放和选择控制点':'三维焊缝域模型，可旋转缩放和选择焊缝点');
  const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,200000),controls=new OrbitControls(camera,renderer.domElement);
  const body=new THREE.Group(),edges=new THREE.Group(),paths=new THREE.Group(),markers=new THREE.Group();scene.add(body,edges,paths,markers,new THREE.HemisphereLight(0xffffff,0x8996a1,2.8));const light=new THREE.DirectionalLight(0xffffff,2.8);light.position.set(8000,14000,10000);scene.add(light);
  const world=point=>vector(point.map((v,i)=>v-(model?.origin?.[i]||0)));
  function clear(group){for(const object of [...group.children]){object.geometry.dispose();object.material.dispose();group.remove(object);}}
  function render(){if(!element.clientWidth||!model)return;renderer.render(scene,camera);const occupied=[];for(const label of labels.current?.querySelectorAll('[data-node]')||[]){const node=latest.current.nodes.find(node=>node.index===+label.dataset.node);if(!node)continue;const p=world(node.position).project(camera);const x=(p.x+1)*element.clientWidth/2;let y=(1-p.y)*element.clientHeight/2;for(let i=0;i<8&&occupied.some(q=>Math.abs(q.x-x)<60&&Math.abs(q.y-y)<22);i++)y-=24;occupied.push({x,y});label.style.left=`${x}px`;label.style.top=`${y}px`;label.style.visibility=p.z>1?'hidden':'visible';}}
  function fit(){if(!box)return;const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()).length();camera.position.copy(center).add(new THREE.Vector3(1,.85,1).normalize().multiplyScalar(size*2));camera.lookAt(center);controls.target.copy(center);camera.zoom=1;controls.update();resize();}
  function resize(){const width=element.clientWidth,height=element.clientHeight;if(!width||!height||!box)return;camera.updateMatrixWorld(true);const projected=new THREE.Box3();for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])projected.expandByPoint(new THREE.Vector3(x,y,z).applyMatrix4(camera.matrixWorldInverse));const extent=Math.max(projected.max.y-projected.min.y,(projected.max.x-projected.min.x)/(width/height))*.58;camera.left=-extent*width/height;camera.right=extent*width/height;camera.top=extent;camera.bottom=-extent;camera.updateProjectionMatrix();renderer.setSize(width,height);render();}
  function rebuild(){
   if(!model)return;
   const t=latest.current.template,range=t.requirementsMatch?.captureRange;
   const region=weldRegionBounds(t,model.origin,Math.max(...model.size),range),original=t.cover?.bounds;
   const min=range&&preview?region.cad.min:region.cad.min.map((v,i)=>Math.min(v,original?.min?.[i]??v,...latest.current.nodes.map(node=>node.position[i]-10))),max=range&&preview?region.cad.max:region.cad.max.map((v,i)=>Math.max(v,original?.max?.[i]??v,...latest.current.nodes.map(node=>node.position[i]+10)));
   box=new THREE.Box3(world([min[0],max[1],min[2]]),world([max[0],min[1],max[2]]));
   const planes=weldCapturePlanes(range?region:{world:{min:box.min.toArray(),max:box.max.toArray()}},world);
   for(const object of [...body.children,...edges.children]){object.visible=new THREE.Box3().setFromObject(object).intersectsBox(box);object.material.clippingPlanes=planes;}
   clear(paths);
   const addPath=(points,color,linewidth,order)=>{
    if(points.length<2||points.every((p,index)=>index===0||p.every((v,i)=>v===points[0][i])))return;
    const geometry=new LineGeometry().setPositions(points.flatMap(point=>world(point).toArray()));
    const material=new LineMaterial({color,linewidth,depthTest:false});
    material.resolution.set(element.clientWidth||500,element.clientHeight||300);
    const path=new Line2(geometry,material);
    path.renderOrder=order;
    path.computeLineDistances();
    paths.add(path);
   };
   for(const segment of t.segments)addPath(segment.pathPoints,preview?0xa7723f:0xfa8c16,preview?2:3,3);
   for(const points of latest.current.highlight?.paths??[])addPath(points,0x007cad,5,5);
   clear(markers);
   const radius=box.getSize(new THREE.Vector3()).length()*.012;
   const mark=(position,color,order)=>{
    const marker=new THREE.Mesh(new THREE.SphereGeometry(radius,12,12),new THREE.MeshBasicMaterial({color,depthTest:false}));
    marker.position.copy(world(position));
    marker.renderOrder=order;
    markers.add(marker);
   };
   for(const node of latest.current.nodes)mark(node.position,node.index===latest.current.selected?0xf08814:0x19a8db,4);
   for(const point of latest.current.highlight?.points??[])mark(point,0x007cad,6);
   render();
  }
  api.current={rebuild,fit};controls.addEventListener('change',render);const observer=new ResizeObserver(resize);observer.observe(element);
  loadStepMesh(template.sourceWeld.model,template.sourceWeld.stepModel).then(data=>{if(closed)return;model=data;for(const [index,part] of data.meshes.entries()){const geometry=new THREE.BufferGeometry(),positions=[];for(let i=0;i<part.positions.length;i+=3)positions.push(part.positions[i],part.positions[i+2],-part.positions[i+1]);geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(part.indices);if(part.normals){const normals=[];for(let i=0;i<part.normals.length;i+=3)normals.push(part.normals[i],part.normals[i+2],-part.normals[i+1]);geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));}else geometry.computeVertexNormals();const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:0xaab4bf,metalness:.35,roughness:.6,side:THREE.DoubleSide}));mesh.userData.part=index;body.add(mesh);}for(const edge of data.edges)edges.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(edge.points.map(vector)),new THREE.LineBasicMaterial({color:0x65727f})));rebuild();fit();setStatus('');latest.current.onCaptureReady?.(weld=>captureWeldRegion({renderer,camera,body,edges,model,weld,modelName:latest.current.template.sourceWeld.model,range:latest.current.template.requirementsMatch?.captureRange}));}).catch(error=>{if(!closed)setStatus(error.message);});
  return()=>{closed=true;observer.disconnect();controls.dispose();latest.current.onCaptureReady?.(null);scene.traverse(object=>{object.geometry?.dispose();object.material?.dispose();});renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();api.current=null;};
 },[]);
 const captureRange=template.requirementsMatch?.captureRange;
 useEffect(()=>{api.current?.rebuild();api.current?.fit();},[captureRange]);
 useEffect(()=>{api.current?.rebuild();},[template.segments,pointMode?template.points:null,pointMode?template.passOffset:null,selectedIndex,highlight]);
 return <div ref={root} className={'tpl-model-editor '+(expanded?'is-expanded':'')} onKeyDownCapture={event=>{if(!expanded)return;if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setExpanded(false);}if(event.key==='Tab'){const elements=[...root.current.querySelectorAll('button,input,select')].filter(el=>!el.disabled),first=elements[0],last=elements.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();event.stopPropagation();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();event.stopPropagation();first.focus();}}}}><div className="tpl-model-toolbar">{!preview&&!compactToolbar&&<label>{pointMode?'工艺点':'焊缝点'}<select aria-label={pointLabel} value={active?.index??0} onChange={event=>selectNode(+event.target.value)}>{nodes.map(node=><option key={node.index} value={node.index} disabled={node.disabled}>{node.name}</option>)}</select></label>}<button type="button" onClick={()=>api.current?.fit()}>适应视图</button><button type="button" aria-label={expanded?'收起三维视图':'放大三维视图'} onClick={()=>setExpanded(value=>!value)}>{expanded?'收起':'放大'}</button>{!preview&&!pointMode&&<button type="button" disabled={!history.length} onClick={()=>{onChange(pointMode?restoreProcessPointPositions(template,history.at(-1)):restoreTemplateGeometry(template,history.at(-1)));setHistory(previous=>previous.slice(0,-1));setError('');}}>撤销</button>}</div><div className="tpl-model-viewport" ref={host}><div className="tpl-model-labels" ref={labels}>{nodes.map(node=><button key={node.index} type="button" data-node={node.index} className={active?.index===node.index?'selected':''} aria-label={`${pointLabel} ${node.name}`} disabled={node.disabled} onClick={()=>selectNode(node.index)}>{node.name}</button>)}</div>{status&&fallbackCover&&<img className="tpl-model-fallback" src={fallbackCover} alt="局部焊缝模型截图"/>}{status&&<p className="tpl-model-status" role="status">{status}</p>}</div>{!preview&&!pointMode&&<div className="tpl-model-coordinates">{['X','Y','Z'].map((name,i)=><label key={name}>{name}<input aria-label={`${pointLabel} ${name}`} disabled={active?.disabled} type="number" step="any" value={coordinates[i]} onFocus={()=>{focused.current=i;}} onChange={event=>{const raw=event.target.value;setCoordinates(previous=>previous.map((v,j)=>i===j?raw:v));if(raw!==''&&Number.isFinite(+raw))edit(active.position.map((v,j)=>i===j?+raw:v));}} onBlur={()=>{focused.current=null;setCoordinates(active.position.map(v=>String(Math.round(v*10000)/10000)));}}/><span>mm</span></label>)}</div>}{error&&<p className="tpl-reference-warning" role="alert">{error}</p>}</div>;
}
