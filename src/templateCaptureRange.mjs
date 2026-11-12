export const TEMPLATE_CAPTURE_FIELDS=[
 ['along','沿焊缝两端'],['across','焊缝两侧'],['above','焊缝上方'],['below','焊缝下方']
];
export const DEFAULT_TEMPLATE_CAPTURE_RANGE={along:40,across:40,above:40,below:40};
export const validTemplateCaptureRange=value=>!!value&&TEMPLATE_CAPTURE_FIELDS.every(([key])=>
 Number.isFinite(value[key])&&value[key]>=0
)&&value.along>0&&value.across>0&&value.above+value.below>0;

export const vectorBetween=(a,b)=>b.map((v,i)=>v-a[i]);
export const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
export const along=(p,v,t)=>p.map((x,i)=>x+v[i]*t);
export const interpolate=(a,b,t)=>along(a,vectorBetween(a,b),t);
export const EPS=1e-7;

export function captureFrame(segments,points,range){
 let direction=[1,0,0],longest=EPS;
 for(const {pathPoints} of segments)for(let i=1;i<(pathPoints?.length??0);i++){
  const [x,y]=vectorBetween(pathPoints[i-1],pathPoints[i]),length=Math.hypot(x,y);
  if(length>longest){longest=length;direction=[x/length,y/length,0];}
 }
 const axes=[direction,[-direction[1],direction[0],0],[0,0,1]];
 const base=points[0];
 const low=[range.along,range.across,range.below],high=[range.along,range.across,range.above];
 const min=[0,0,0],max=[0,0,0];
 for(const point of points){
  const relative=vectorBetween(base,point);
  axes.forEach((axis,i)=>{
   const projected=dot(relative,axis);
   min[i]=Math.min(min[i],projected);
   max[i]=Math.max(max[i],projected);
  });
 }
 low.forEach((value,i)=>{min[i]-=value;max[i]+=high[i];});
 return {axes,base,min,max};
}
export const captureLocal=(frame,point)=>frame.axes.map(axis=>dot(vectorBetween(frame.base,point),axis));
export const capturePoint=(frame,local)=>local.reduce((p,v,i)=>along(p,frame.axes[i],v),frame.base);
export function captureCorners(frame){
 return [frame.min[0],frame.max[0]].flatMap(x=>[frame.min[1],frame.max[1]].flatMap(y=>
  [frame.min[2],frame.max[2]].map(z=>capturePoint(frame,[x,y,z]))));
}
export function insideCapture(frame,point){
 return captureLocal(frame,point).every((value,i)=>value>=frame.min[i]-EPS&&value<=frame.max[i]+EPS);
}
export function captureRayLimit(frame,point,direction){
 const local=captureLocal(frame,point);
 return Math.max(0,Math.min(...frame.axes.map((axis,i)=>{
  const speed=dot(direction,axis);
  return Math.abs(speed)<=EPS?Infinity:((speed>0?frame.max[i]:frame.min[i])-local[i])/speed;
 })));
}

export function clipCapturePolyline(frame,points){
 const chunks=[];
 for(let i=1;i<points.length;i++){
  const a=captureLocal(frame,points[i-1]),delta=vectorBetween(a,captureLocal(frame,points[i]));
  let start=0,end=1;
  for(let axis=0;axis<3;axis++){
   if(Math.abs(delta[axis])<EPS){
    if(a[axis]<frame.min[axis]-EPS||a[axis]>frame.max[axis]+EPS)end=-1;
    continue;
   }
   const bounds=[frame.min[axis],frame.max[axis]].map(v=>(v-a[axis])/delta[axis]);
   start=Math.max(start,Math.min(...bounds));
   end=Math.min(end,Math.max(...bounds));
  }
  if(end-start<=EPS)continue;
  const left=interpolate(points[i-1],points[i],start),right=interpolate(points[i-1],points[i],end),last=chunks.at(-1);
  if(last&&Math.hypot(...vectorBetween(last.at(-1),left))<EPS)last.push(right);
  else chunks.push([left,right]);
 }
 return chunks;
}
