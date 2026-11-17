import {defineConfig} from 'vite';
import localStepExtraction from './scripts/local-step-extraction.mjs';
import localReverseModel from './scripts/local-reverse-model.mjs';
export default defineConfig({plugins:[localStepExtraction(),localReverseModel()],optimizeDeps:{include:['occt-import-js']},server:{host:'127.0.0.1',port:5236,strictPort:true,watch:{ignored:['**/public/models/pf400-laser/*.stl']}},esbuild:{jsx:'automatic'},build:{outDir:'dist/client'}});
