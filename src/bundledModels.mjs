export const STARTUP_STEP_MODEL='a1a.step';
export const EXAMPLE_MODEL='111.step';
export const DEMO_SOURCE_SHA256='c85056ed9022210cd93e48bc4d09b97615c57a70235f4f55d986e6a2bdec4fc8';
export const STARTUP_STEP_REFERENCE=Object.freeze({
 sourceSha256:'e3fa12d40ff8dbe3226efb4a51397be3ba0d9726810d2ab98240cfd0be693c07'
});

export const bundledModelUrl=file=>(import.meta.env?.BASE_URL??'/')+'models/'+file;

const models=[
 {name:STARTUP_STEP_MODEL,sha:STARTUP_STEP_REFERENCE.sourceSha256},
 {name:EXAMPLE_MODEL,sha:DEMO_SOURCE_SHA256}
];

export function bundledModelIdentity(workspace){
 if(workspace.stepModel?.kind)return undefined;
 const sha=workspace.stepModel?.sourceSha256??workspace.geometryProcessing?.sourceSha256;
 if(sha)return models.find(model=>model.sha===sha);
 if(workspace.stepModel)return undefined;
 const name=String(workspace.model??'').replace(/\\/g,'/').split('/').at(-1).toLowerCase().replace(/\.stp$/,'.step');
 return models.find(model=>model.name===name);
}
