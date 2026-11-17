import {BufferGeometry,Color,DirectionalLight,DoubleSide,Float32BufferAttribute,Group,HemisphereLight,
 Mesh,MeshStandardMaterial,OrthographicCamera,Scene,Vector3,WebGLRenderer} from 'three';

export function captureWorkpieceCover(model,placement){
 const width=384,height=216;
 const renderer=new WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
 const scene=new Scene(),body=new Group(),material=new MeshStandardMaterial({color:0xaab4bf,side:DoubleSide,roughness:.7});
 try{
  scene.background=new Color('#f4f6f8');
  scene.add(body,new HemisphereLight(0xffffff,0x82919e,2.8));
  const light=new DirectionalLight(0xffffff,2);
  light.position.set(3,6,2);scene.add(light);
  if(placement?.quaternion)body.quaternion.fromArray(placement.quaternion);
  for(const mesh of model.meshes){
   const coordinates=new Float32Array(mesh.positions.length);
   for(let index=0;index<coordinates.length;index+=3){
    coordinates[index]=mesh.positions[index];coordinates[index+1]=mesh.positions[index+2];coordinates[index+2]=-mesh.positions[index+1];
   }
   const geometry=new BufferGeometry();
   geometry.setAttribute('position',new Float32BufferAttribute(coordinates,3));
   geometry.setIndex(Array.from(mesh.indices));
   geometry.computeVertexNormals();
   body.add(new Mesh(geometry,material));
  }
  const half=Math.hypot(...model.size)*.54||1;
  const camera=new OrthographicCamera(-half,half,half*height/width,-half*height/width,.1,half*12);
  camera.position.copy(new Vector3(1,.8,1).normalize().multiplyScalar(half*4));
  camera.lookAt(0,0,0);
  camera.updateMatrixWorld(true);body.updateWorldMatrix(true,true);
  const corner=new Vector3();
  let projectedWidth=0,projectedHeight=0;
  for(const x of [-.5,.5])for(const y of [-.5,.5])for(const z of [-.5,.5]){
   corner.set(x*model.size[0],y*model.size[2],z*model.size[1]).applyMatrix4(body.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
   projectedWidth=Math.max(projectedWidth,Math.abs(corner.x));
   projectedHeight=Math.max(projectedHeight,Math.abs(corner.y));
  }
  const horizontal=Math.max(projectedWidth,projectedHeight*width/height,1)*1.12;
  camera.left=-horizontal;camera.right=horizontal;camera.top=horizontal*height/width;camera.bottom=-camera.top;
  camera.updateProjectionMatrix();
  renderer.setSize(width,height,false);renderer.render(scene,camera);
  return renderer.domElement.toDataURL('image/jpeg',.84);
 }finally{
  for(const mesh of body.children)mesh.geometry.dispose();
  material.dispose();renderer.dispose();renderer.forceContextLoss();
 }
}
