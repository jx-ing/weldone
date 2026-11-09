import {defineConfig} from 'vite';
export default defineConfig({server:{host:'127.0.0.1',port:5236,strictPort:true},esbuild:{jsx:'automatic'},build:{outDir:'dist/client'}});
