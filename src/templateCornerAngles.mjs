export const CORNER_SIDES={inner:'内角',outer:'外角'};
export function cornerSide(c){return c.angleSide??(c.standard>180?'outer':'inner');}
export function innerCornerAngle(a){return Number.isFinite(a)&&a>=0&&a<=360?Math.min(a,360-a):NaN;}
// Already directed angles are never complemented to satisfy a template.
export function cornerMeasuredAngle(a){return Number.isFinite(a)&&a>=0&&a<=360?a:NaN;}
export function changeCornerSide(c,side){if(!Object.hasOwn(CORNER_SIDES,side))return c;const next={...c,angleSide:side};delete next.pathStandard;return next;}
export function changeCornerStandard(c,value){const next={...c,standard:value===''?'':Number(value),angleSide:cornerSide(c)};delete next.pathStandard;return next;}
