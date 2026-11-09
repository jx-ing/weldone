import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';
import {loadModelData} from '../src/vendor/geometry-engine.mjs';
const base=new URL('../',import.meta.url);globalThis.fetch=async input=>{try{return new Response(await fs.readFile(new URL('public'+new URL(String(input),'http://local').pathname,base)));}catch{return new Response('',{status:404});}};
const data=await loadModelData('/models/111-rules',undefined,{geometryOnly:true,thicknessWeldThresholdMm:50});
const inputs={};for(const name of ['welds.json','parts.json','edges.json','contacts.json','mesh.bin'])inputs[name]=crypto.createHash('sha256').update(await fs.readFile(new URL('public/models/111-rules/'+name,base))).digest('hex');
const output={sourceSha256:data.analysis.sourceSha256,splitAlgorithmRevision:9,geometryPlanRevision:5,normalization:'Exact migrated loadModelData geometry normalization, canonicalized offline for consistent floating point topology decisions',inputs,weldsData:data.weldsData,collarThicknessReferences:data.collarThicknessReferences,collarGapEndClosureReferences:data.collarGapEndClosureReferences,compositeShellReferences:data.compositeShellReferences};
await fs.writeFile(new URL('public/models/111-rules/planning-input.json',base),JSON.stringify(output));console.log('Canonical planning welds:',data.weldsData.welds.length);
