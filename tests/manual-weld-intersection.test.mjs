import assert from 'node:assert/strict';
import {test} from 'node:test';
import {BoxGeometry} from 'three';
import {createManualWeld,distance,pathLength,validManualWeldPath} from '../src/manualWeldModel.mjs';
import {manualWeldIntersections,manualWeldSegments,manualWeldThroughPoints,surfaceTriangles} from '../src/manualWeldIntersection.mjs';

const plane=(points)=>({positions:points.flat(),indices:[0,1,2,0,2,3],faces:[[0,1]]});
const horizontal=plane([[0,0,0],[3,0,0],[3,3,0],[0,3,0]]);
const vertical=plane([[1,1,-1],[1,4,-1],[1,4,1],[1,1,1]]);

test('two trimmed STEP faces yield only their finite CAD intersection',()=>{
 const model={origin:[100,200,300],meshes:[horizontal,vertical],edges:[]};
 const selection=part=>({part,triangles:surfaceTriangles(model,part)[0]});
 const [path,...others]=manualWeldIntersections(model,selection(0),selection(1));
 assert.deepEqual(others,[]);
 assert.equal(pathLength(path.points),2);
 assert.deepEqual(path.points.filter(p=>p[1]===201||p[1]===203).sort((a,b)=>a[1]-b[1]),[[101,201,300],[101,203,300]]);
 assert.equal(manualWeldSegments(path).length,1);
 assert.throws(()=>manualWeldIntersections({...model,meshes:[horizontal,horizontal]},selection(0),selection(1)),/重叠/);
});

test('old STEP cache groups triangulation using stored B-rep edges',()=>{
 const {faces,...mesh}=horizontal;
 const edge={part:0,points:[[0,0,0],[3,3,0]]};
 assert.deepEqual(surfaceTriangles({meshes:[mesh],edges:[{...edge,part:1}]},0),[[0,1]]);
 assert.deepEqual(surfaceTriangles({meshes:[mesh],edges:[edge]},0),[[0],[1]]);
});

test('two coplanar trimmed faces can meet along an edge',()=>{
 const touching=plane([[3,0,0],[5,0,0],[5,3,0],[3,3,0]]);
 const model={origin:[0,0,0],meshes:[horizontal,touching],edges:[]};
 const [path]=manualWeldIntersections(model,{part:0,triangles:[0,1]},{part:1,triangles:[0,1]});
 assert.ok(Math.abs(pathLength(path.points)-3)<1e-6);
});

test('two solids create a perimeter without triangulation diagonals',()=>{
 function box(offset){
  const geometry=new BoxGeometry(2,2,2).translate(offset,0,0);
  const mesh={positions:Array.from(geometry.attributes.position.array),indices:Array.from(geometry.index.array)};
  geometry.dispose();
  return mesh;
 }
 const model={origin:[0,0,0],meshes:[box(0),box(2)],edges:[]};
 const paths=manualWeldIntersections(model,{part:0},{part:1});
 assert.equal(paths.length,1);
 assert.equal(pathLength(paths[0].points),8);
 assert.deepEqual(paths[0].points[0],paths[0].points.at(-1));
 assert.throws(()=>manualWeldIntersections({...model,meshes:[box(0),box(3)]},{part:0},{part:1}),/没有可用交线/);
});

test('point creation preserves three defining points and the chosen closure',()=>{
 const points=[[1,0,10],[0,-1,10],[0,1,10]];
 const arc=manualWeldThroughPoints('arc',points);
 assert.equal(arc.shape.arcAngle,270);
 for(const pick of points)assert.ok(arc.points.some(point=>distance(point,pick)<1e-12));
 assert.deepEqual(arc.points.at(-1),points[2]);
 const circle=manualWeldThroughPoints('circle',points);
 assert.equal(circle.shape.arcAngle,360);
 assert.deepEqual(circle.points.at(-1),points[0]);
 assert.throws(()=>manualWeldThroughPoints('circle',[[0,0,0],[1,1,1],[2,2,2]]),/同一直线/);
 const weld=createManualWeld([],manualWeldSegments(arc),{name:'手动焊缝',position:'PB · 横角焊',model:'local.stp',withoutProcess:true,leg:null,closed:false});
 assert.equal(weld.closure,'open');
 assert.equal(weld.current,null);
 assert.ok(validManualWeldPath(weld,'local.stp'));
});
