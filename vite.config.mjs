import {defineConfig,loadEnv} from 'vite';
import localStepExtraction from './scripts/local-step-extraction.mjs';
import localReverseModel from './scripts/local-reverse-model.mjs';
import localAssistant from './scripts/local-assistant.mjs';

export default defineConfig(({mode})=>({
  plugins:[localStepExtraction(),localReverseModel(),localAssistant({...process.env,...loadEnv(mode,process.cwd(),'WELDONE_AI_')})],
  optimizeDeps:{include:['occt-import-js']},
  server:{host:'127.0.0.1',port:5236,strictPort:true,watch:{ignored:['**/public/models/pf400-laser/*.stl','**/*.tmpdir/**','**/.*.tmpdir/**']}},
  esbuild:{jsx:'automatic'},
  build:{outDir:'dist/client'},
}));
