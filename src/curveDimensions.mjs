// Measurements use the finite endpoint chord, in the same mm coordinates as
// the actual path. A closed segment has a zero chord (its endpoint).
export function curveDimensions(points){
  const array=p=>Array.isArray(p)?p:[p.x,p.y,p.z||0];
  if(!points?.length)return {chordLength:0,maxDeviation:0,maxIndex:0,foot:[]};
  const first=array(points[0]),last=array(points.at(-1)),axis=first.map((v,i)=>(last[i]||0)-v),squared=axis.reduce((n,v)=>n+v*v,0);
  let maxDeviation=0,maxIndex=0,foot=[...first];
  points.forEach((point,index)=>{const p=array(point),t=squared?Math.max(0,Math.min(1,p.reduce((n,v,i)=>n+(v-first[i])*axis[i],0)/squared)):0,projection=first.map((v,i)=>v+axis[i]*t),d=Math.hypot(...p.map((v,i)=>v-projection[i]));if(d>maxDeviation){maxDeviation=d;maxIndex=index;foot=projection;}});
  return {chordLength:Math.sqrt(squared),maxDeviation,maxIndex,foot};
}
