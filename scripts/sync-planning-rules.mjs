import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {applyPlanningEdgeAdapter} from './planning-edge-engine-adapter.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),source=path.resolve(root,'../weld_viewer_next');
const {build}=await import(pathToFileURL(path.join(source,'node_modules/esbuild/lib/main.js')));
const result=await build({absWorkingDir:source,stdin:{contents:"export {loadModelData} from './src/lib/loadData'; export {prepareProcessedGeometryData,computeProcessedGeometryPlan,processedGeometryPlanConfig,DEFAULT_PROCESSED_GEOMETRY_PLAN_CONFIG} from './src/lib/processedGeometryPlan'; export {computeAllSplitsAsync} from './src/lib/weldSplitAsync'; export {WELD_SPLIT_ALGORITHM_REVISION} from './src/lib/weldSplit';",resolveDir:source,sourcefile:'original-platform-geometry-entry.ts'},tsconfig:path.join(source,'tsconfig.app.json'),bundle:true,format:'esm',platform:'browser',external:['three'],metafile:true,write:false,logLevel:'silent'});
const target=path.join(root,'src/vendor');await fs.mkdir(target,{recursive:true});await fs.writeFile(path.join(target,'geometry-engine.mjs'),applyPlanningEdgeAdapter(result.outputFiles[0].text));
const files=[];
for(const entry of Object.keys(result.metafile.inputs).filter(v=>v.startsWith('src/'))){const content=await fs.readFile(path.join(source,entry)),out=path.join(target,'planning-rules',entry.slice(4));await fs.mkdir(path.dirname(out),{recursive:true});await fs.writeFile(out,content);files.push({path:entry,sha256:crypto.createHash('sha256').update(content).digest('hex')});}
const pythonDir=path.join(root,'scripts/vendor-extraction');for(const name of await fs.readdir(pythonDir)){const content=await fs.readFile(path.join(pythonDir,name));files.push({path:'scripts/'+name,sha256:crypto.createHash('sha256').update(content).digest('hex')});}
const manifest={sourcePlatform:'工艺规划平台',sourceProject:'weld_viewer_next',sourcePort:5216,splitAlgorithmRevision:9,geometryPlanRevision:5,files};await fs.writeFile(path.join(target,'planning-rules.manifest.json'),JSON.stringify(manifest,null,2));console.log('Ported exact geometry rules:',files.length,'source files; engine',result.outputFiles[0].contents.length,'bytes');
