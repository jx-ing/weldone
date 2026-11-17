import {PCDLoader} from 'three/examples/jsm/loaders/PCDLoader.js';
import {PLYLoader} from 'three/examples/jsm/loaders/PLYLoader.js';

export const POINT_CLOUD_EXTENSIONS='.txt,.xyz,.ply,.pcd';

function parseTextPoints(text){
 const positions=[],lines=text.replace(/^\uFEFF/,'').split(/\r\n|\n|\r/);
 for(let index=0;index<lines.length;index++){
  const line=lines[index].trim();
  if(!line||line.startsWith('#'))continue;
  const cells=line.includes(',')?line.split(',').map(cell=>cell.trim()):line.split(/\s+/);
  const point=cells.map(Number);
  if(cells.length!==3||cells.some(cell=>!cell)||!point.every(Number.isFinite))throw Error('第 '+(index+1)+' 行应包含三个有效的 X、Y、Z 坐标');
  positions.push(...point);
 }
 return positions;
}

function centeredPointCloud(positions,colors,normalAttribute){
 const low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];
 let count=0;
 for(let i=0;i<positions.length;i+=3){
  if(!Number.isFinite(positions[i])||!Number.isFinite(positions[i+1])||!Number.isFinite(positions[i+2]))continue;
  for(let axis=0;axis<3;axis++){
   low[axis]=Math.min(low[axis],positions[i+axis]);high[axis]=Math.max(high[axis],positions[i+axis]);
  }
  count++;
 }
 if(!count)throw Error('文件中没有可显示的点');
 const size=high.map((value,i)=>value-low[i]),origin=low.map((value,i)=>value+size[i]/2);
 if(size.some(value=>!Number.isFinite(value)||value>3e38))throw Error('点云的坐标范围超出显示限制');
 const points=new Float32Array(count*3),vertexColors=colors?.count*3===positions.length?new Float32Array(count*3):undefined;
 const normals=normalAttribute?.count*3===positions.length?new Float32Array(count*3):undefined;
 let next=0;
 for(let i=0;i<positions.length;i+=3){
  if(!Number.isFinite(positions[i])||!Number.isFinite(positions[i+1])||!Number.isFinite(positions[i+2]))continue;
  for(let axis=0;axis<3;axis++){
   points[next+axis]=positions[i+axis]-origin[axis];
   if(normals)normals[next+axis]=normalAttribute.getComponent(i/3,axis);
   if(vertexColors){
    const value=colors.getComponent(i/3,axis);
    vertexColors[next+axis]=Number.isFinite(value)?Math.max(0,Math.min(1,value)):.5;
   }
  }
  next+=3;
 }
 return {origin,size,points,vertexColors,count,...(normals&&{normals})};
}

export function parsePointCloud(name,buffer){
 const format=name.split('.').at(-1).toLowerCase();
 if(format==='txt'||format==='xyz')return centeredPointCloud(parseTextPoints(new TextDecoder().decode(buffer)));
 if(format!=='pcd'&&format!=='ply')throw Error('请选择 TXT、XYZ、PLY 或 PCD 点云文件');
 const cloud=format==='pcd'?new PCDLoader().parse(buffer):null;
 const geometry=cloud?.geometry??new PLYLoader().parse(buffer);
 try{
  return centeredPointCloud(geometry.getAttribute('position')?.array??[],geometry.getAttribute('color'),geometry.getAttribute('normal'));
 }finally{
  geometry.dispose();cloud?.material.dispose();
 }
}
