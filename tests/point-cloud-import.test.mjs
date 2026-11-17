import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parsePointCloud} from '../src/pointCloudModel.mjs';

const buffer=text=>new TextEncoder().encode(text).buffer;

test('three-column TXT accepts common delimiters and preserves small offsets on large coordinates',()=>{
 const cloud=parsePointCloud('points.TXT',buffer('\uFEFF# sample\r\n1000000000.00, 20, 30\n1000000000.25\t22\t34\r\n'));
 assert.equal(cloud.count,2);
 assert.deepEqual(cloud.origin,[1000000000.125,21,32]);
 assert.deepEqual([...cloud.points],[-.125,-1,-2,.125,1,2]);
 assert.throws(()=>parsePointCloud('points.txt',buffer('1 2 3\n4,,6')),/第 2 行/);
 assert.throws(()=>parsePointCloud('points.xyz',buffer('# empty')),/没有可显示的点/);
});

test('ASCII PLY imports point coordinates and vertex colors',()=>{
 const cloud=parsePointCloud('points.ply',buffer([
  'ply','format ascii 1.0','element vertex 2','property float x','property float y','property float z',
  'property uchar red','property uchar green','property uchar blue','end_header','1 2 3 255 0 0','3 4 5 0 255 0',''
 ].join('\n')));
 assert.equal(cloud.count,2);
 assert.deepEqual(cloud.origin,[2,3,4]);
 assert.deepEqual([...cloud.vertexColors],[1,0,0,0,1,0]);
});

test('ASCII PCD imports organized point coordinates',()=>{
 const cloud=parsePointCloud('points.pcd',buffer([
  'VERSION .7','FIELDS x y z','SIZE 4 4 4','TYPE F F F','COUNT 1 1 1','WIDTH 2','HEIGHT 1',
  'VIEWPOINT 0 0 0 1 0 0 0','POINTS 2','DATA ascii','1 2 3','5 6 7',''
 ].join('\n')));
 assert.equal(cloud.count,2);
 assert.deepEqual(cloud.origin,[3,4,5]);
});
