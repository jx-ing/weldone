export const GROOVE_TYPES=['V 形','喇叭形','无坡口','I 形'];
const legacy=['单边 V 形','X 形','U 形','J 形'];
const aliases={'单V形':'V 形','自然V形坡口':'V 形','V形':'V 形','I形':'I 形','自然喇叭形坡口':'喇叭形','X形':'X 形','U形':'U 形','J形':'J 形','单边V形':'单边 V 形'};
export const grooveType=t=>typeof t==='string'?(Object.hasOwn(aliases,t.trim())?aliases[t.trim()]:t.trim()):t;
export const noGroove=()=>({type:'无坡口',angle:0,depth:0});
export function normalizeWeldGroove(g){
 const type=grooveType(g?.type);
 if(type==='无坡口'||![...GROOVE_TYPES,...legacy].includes(type))return noGroove();
 return {...g,type};
}
export const grooveValue=(g,key)=>g?.[key]===undefined&&['rootGap','rootRadius','rootFace'].includes(key)?0:g?.[key];
export function validGroove(g){return !!g&&[...GROOVE_TYPES,...legacy].includes(grooveType(g.type))&&(grooveType(g.type)==='无坡口'||grooveFieldsFor(g.type).every(([key])=>Number.isFinite(grooveValue(g,key))&&grooveValue(g,key)>=0&&(key!=='angle'||grooveValue(g,key)<=180)));}
export const grooveProperties=[['angle','坡口角度','°',180],['depth','坡口深度','mm'],['rootGap','根部间隙','mm'],['rootRadius','根部半径','mm'],['rootFace','钝边长度','mm']];

export function grooveFieldsFor(type){
 const normalized=grooveType(type);
 return grooveProperties.filter(([key])=>normalized==='I 形'?['depth','rootGap','rootFace'].includes(key):normalized==='V 形'?key!=='rootRadius':true);
}

export function sameGroove(a,b){return !!a&&!!b&&grooveType(a.type)===grooveType(b.type)&&(grooveType(a.type)==='无坡口'||grooveFieldsFor(a.type).every(([key])=>grooveValue(a,key)===grooveValue(b,key)));}
