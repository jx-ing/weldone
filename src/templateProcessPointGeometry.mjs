import {previewPath,previewPoint,samplePath} from './weldPathGeometry.mjs';
import {sampleManualWeldPath,horizontalWeldNormal} from './manualWeldModel.mjs';
import {resolvePassPoint} from './templatePassOffsets.mjs';

function position(template,point,path){
 return resolvePassPoint(template,point,template.points,template.passOffset,0,path).position;
}
function editablePoint(template,index){
 const point=template.points[index];if(!point)throw Error('请选择有效工艺点');
 if(point.kind==='control'&&!template.points.some(ref=>ref.id===point.referenceId&&ref.kind!=='control'))throw Error('请先为该控制点选择基准点');
 return point;
}
export function processPointDirection(template,index,axis){
 const point=editablePoint(template,index),at=resolvePassPoint(template,point,template.points,template.passOffset);
 if(axis==='x')return at.tangent;
 if(axis==='y')return horizontalWeldNormal(at.tangent,at.normal);
 if(axis==='z')return [0,0,1];
 throw Error('请选择沿焊缝、水平垂直焊缝或竖直方向');
}
export function moveTemplateProcessPointInDirection(template,index,axis,distance){
 const point=editablePoint(template,index);if(!['x','y','z'].includes(axis)||!Number.isFinite(distance))throw Error('请选择有效拖动方向和距离');
 const offset={...point.offset,[axis]:Math.round(((point.offset?.[axis]||0)+distance)*10000)/10000};
 return {...template,points:template.points.map((old,i)=>i===index?{...point,offset}:old)};
}
export function projectedDragDistance(delta,direction){
 const lengthSquared=direction[0]**2+direction[1]**2;
 if(lengthSquared<1e-12)throw Error('该方向与视线重合，请旋转视图后拖动');
 return (delta[0]*direction[0]+delta[1]*direction[1])/lengthSquared;
}
export function templateProcessNodes(template){
 const path=previewPath(template.segments,'xy',template.corners,template.closure);
 return template.points.map((point,index)=>({id:point.id,index,name:point.name,position:position(template,point,path),disabled:point.kind==='control'&&!template.points.some(ref=>ref.id===point.referenceId&&ref.kind!=='control')}));
}
function solve(matrix,values){
 const rows=matrix.map((row,i)=>[...row,values[i]]);
 for(let i=0;i<3;i++){let pivot=i;for(let j=i+1;j<3;j++)if(Math.abs(rows[j][i])>Math.abs(rows[pivot][i]))pivot=j;[rows[i],rows[pivot]]=[rows[pivot],rows[i]];if(Math.abs(rows[i][i])<1e-12)throw Error('当前点位的偏移方向无法到达该位置');const scale=rows[i][i];for(let k=i;k<4;k++)rows[i][k]/=scale;for(let j=0;j<3;j++)if(j!==i){const factor=rows[j][i];for(let k=i;k<4;k++)rows[j][k]-=factor*rows[i][k];}}
 return rows.map(row=>row[3]);
}
export function moveTemplateProcessPoint(template,index,target){
 const original=template.points[index];if(!original||target.length!==3||!target.every(Number.isFinite))throw Error('请选择有效工艺点并填写有限的XYZ坐标');
 if(original.kind==='control'&&!template.points.some(point=>point.id===original.referenceId&&point.kind!=='control'))throw Error('请先为该控制点选择基准点');
 const path=previewPath(template.segments,'xy',template.corners,template.closure),keys=['x','y','z'];let offsets=keys.map(key=>original.offset?.[key]||0);
 const evaluate=values=>{const point={...original,offset:{...original.offset,...Object.fromEntries(keys.map((key,i)=>[key,values[i]]))}},next={...template,points:template.points.map((old,i)=>i===index?point:old)};return position(next,point,path);};
 for(let iteration=0;iteration<12;iteration++){
  const current=evaluate(offsets),error=target.map((v,i)=>v-current[i]);if(Math.hypot(...error)<1e-5)break;
  const columns=keys.map((_,i)=>{const shifted=evaluate(offsets.map((v,j)=>v+(i===j?.01:0)));return shifted.map((v,j)=>(v-current[j])/.01);});
  const normal=keys.map((_,i)=>keys.map((_,j)=>columns[i].reduce((sum,v,k)=>sum+v*columns[j][k],0)+(i===j?1e-8:0))),right=columns.map(column=>column.reduce((sum,v,i)=>sum+v*error[i],0)),step=solve(normal,right);
  offsets=offsets.map((v,i)=>v+step[i]);
 }
 if(Math.hypot(...evaluate(offsets).map((v,i)=>v-target[i]))>.02)throw Error('该位置超出当前点位的偏移方向，请调整拖动方向');
 const offset={...original.offset,...Object.fromEntries(keys.map((key,i)=>[key,Math.round(offsets[i]*10000)/10000]))};
 return {...template,points:template.points.map((point,i)=>i===index?{...point,offset}:point)};
}
export const processPointSnapshot=template=>structuredClone(template.points.map(({id,offset,location})=>({id,offset,location})));
export function restoreProcessPointPositions(template,snapshot){return {...template,points:template.points.map(point=>{const saved=snapshot.find(old=>old.id===point.id);return saved?{...point,offset:structuredClone(saved.offset),...(saved.location!==undefined?{location:structuredClone(saved.location)}:{})}:point;})};}
