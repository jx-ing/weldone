import {defineConfig} from 'vite';
import localStepExtraction from './scripts/local-step-extraction.mjs';
export default defineConfig({plugins:[localStepExtraction()],optimizeDeps:{include:['occt-import-js']},server:{host:'127.0.0.1',port:5236,strictPort:true},esbuild:{jsx:'automatic'},build:{outDir:'dist/client'}});
