import {autoWeldReferenceNormal} from './weldDirectionGeometry.mjs';
import {cornerSide} from './templateCornerAngles.mjs';
const number = v => Number.isFinite(v) ? v : 0;
const round = v => Math.round(v * 100) / 100;
const add=(a,b)=>({x:a.x+b.x,y:a.y+b.y}),mul=(a,k)=>({x:a.x*k,y:a.y*k});
const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y});
const unit=v=>{const l=Math.hypot(v.x,v.y);return l>1e-9?mul(v,1/l):{x:1,y:0};};
const normal=t=>({x:t.y,y:-t.x});
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const TAU=Math.PI*2;
export function segmentShape(segment,closedSingle=false) {
  const shape=segment.shape||{},arcAngle=closedSingle?360:(Number.isFinite(shape.arcAngle)?shape.arcAngle:90);
  return {...shape,bend:Number.isFinite(shape.bend)?clamp(shape.bend,0,100):30,width:Number.isFinite(shape.width)&&shape.width>0?shape.width:120,height:Number.isFinite(shape.height)&&shape.height>0?shape.height:80,direction:shape.direction||'left',arcAngle:clamp(arcAngle,1,360),radius:Number.isFinite(shape.radius)&&shape.radius>0?shape.radius:(segment.length||100)/(clamp(arcAngle,1,360)*Math.PI/180)};
}
function finishFrame(start,end,samples,d,options={}) {
  let length=0;const measured=samples.map((p,i)=>{if(i)length+=Math.hypot(p.x-samples[i-1].x,p.y-samples[i-1].y);return {...p,s:length};});
  const tangent=options.tangent||unit(sub(samples[1]||end,start)),endTangent=options.endTangent||unit(sub(end,samples.at(-2)||start));
  return {start,end,tangent,normal:normal(tangent),endTangent,samples:measured,length,d,...options};
}
function line(start,end) {const tangent=unit(sub(end,start));return finishFrame(start,end,[start,end],`M${start.x},${start.y} L${end.x},${end.y}`,{tangent,endTangent:tangent});}
function quadraticTo(start,end,bend) {
  const chord=sub(end,start),side=normal(unit(chord)),control=add(mul(add(start,end),.5),mul(side,Math.hypot(chord.x,chord.y)*bend/100));
  const samples=Array.from({length:129},(_,i)=>{const t=i/128;return add(add(mul(start,(1-t)**2),mul(control,2*(1-t)*t)),mul(end,t*t));});samples[0]=start;samples[128]=end;
  return finishFrame(start,end,samples,`M${start.x},${start.y} Q${control.x},${control.y} ${end.x},${end.y}`,{tangent:unit(sub(control,start)),endTangent:unit(sub(end,control))});
}
function quadraticDeviation(start,end,deviation){
  const c=Math.hypot(end.x-start.x,end.y-start.y);
  return quadraticTo(start,end,c?deviation*200/c:0);
}
function curveFromDimensions(start,heading,chord,deviation){
  const axis=heading-Math.atan2(4*deviation,chord),canonical=quadraticDeviation({x:0,y:0},{x:chord,y:0},-deviation);
  const transform=p=>add(start,{x:p.x*Math.cos(axis)-p.y*Math.sin(axis),y:p.x*Math.sin(axis)+p.y*Math.cos(axis)}),end=transform({x:chord,y:0}),control=transform({x:chord/2,y:2*deviation});
  return finishFrame(start,end,canonical.samples.map(transform),`M${start.x},${start.y} Q${control.x},${control.y} ${end.x},${end.y}`,{tangent:{x:Math.cos(heading),y:Math.sin(heading)},endTangent:unit(sub(end,control))});
}
function curveFrom(start,heading,length,bend) {
  const axis=heading-Math.atan2(bend/100,.5),canonical=quadraticTo({x:0,y:0},{x:1,y:0},-bend),scale=length/canonical.length;
  const transform=p=>add(start,{x:(p.x*Math.cos(axis)-p.y*Math.sin(axis))*scale,y:(p.x*Math.sin(axis)+p.y*Math.cos(axis))*scale});
  const end=transform({x:1,y:0}),control=transform({x:.5,y:bend/100});
  return finishFrame(start,end,canonical.samples.map(transform),`M${start.x},${start.y} Q${control.x},${control.y} ${end.x},${end.y}`,{tangent:{x:Math.cos(heading),y:Math.sin(heading)},endTangent:unit(sub(end,control))});
}
function circleArc(start,center,radius,angle,sign,endOverride) {
  const initial=Math.atan2(start.y-center.y,start.x-center.x),sweep=angle*Math.PI/180*sign;
  const at=t=>add(center,{x:radius*Math.cos(initial+sweep*t),y:radius*Math.sin(initial+sweep*t)});
  const end=endOverride||(angle===360?{...start}:at(1)),steps=Math.max(24,Math.ceil(angle/3));
  const samples=Array.from({length:steps+1},(_,i)=>at(i/steps));samples[0]=start;samples[steps]=end;
  const flag=sign>0?1:0,mid=at(.5);
  const d=angle===360?`M${start.x},${start.y} A${radius},${radius} 0 0 ${flag} ${mid.x},${mid.y} A${radius},${radius} 0 0 ${flag} ${end.x},${end.y}`:`M${start.x},${start.y} A${radius},${radius} 0 ${angle>180?1:0} ${flag} ${end.x},${end.y}`;
  return finishFrame(start,end,samples,d,{length:radius*angle*Math.PI/180,radius,tangent:{x:-Math.sin(initial)*sign,y:Math.cos(initial)*sign},endTangent:{x:-Math.sin(initial+sweep)*sign,y:Math.cos(initial+sweep)*sign}});
}
function arcFrom(start,heading,radius,angle,direction) {
  const sign=direction==='right'?1:-1,t={x:Math.cos(heading),y:Math.sin(heading)};
  return circleArc(start,add(start,mul(normal(t),-sign*radius)),radius,angle,sign);
}
function arcTo(start,end,angle,direction) {
  const chord=sub(end,start),length=Math.hypot(chord.x,chord.y),radians=clamp(angle,1,359)*Math.PI/180,sign=direction==='right'?1:-1;
  const center=add(mul(add(start,end),.5),mul(normal(unit(chord)),-sign*length/(2*Math.tan(radians/2))));
  return circleArc(start,center,length/(2*Math.sin(radians/2)),radians*180/Math.PI,sign,end);
}
function closedCurve(start,width,height,direction) {
  const rx=width/2,ry=height/2,k=.5522847498307936,sign=direction==='right'?-1:1;
  const raw=[[[0,0],[k*rx,0],[rx,-ry+k*ry],[rx,-ry]],[[rx,-ry],[rx,-ry-k*ry],[k*rx,-2*ry],[0,-2*ry]],[[0,-2*ry],[-k*rx,-2*ry],[-rx,-ry-k*ry],[-rx,-ry]],[[-rx,-ry],[-rx,-ry+k*ry],[-k*rx,0],[0,0]]];
  const transform=p=>add(start,{x:p[0]*sign,y:p[1]});let d=`M${start.x},${start.y}`;const samples=[];
  raw.forEach((part,index)=>{const [a,b,c,e]=part.map(transform);d+=` C${b.x},${b.y} ${c.x},${c.y} ${e.x},${e.y}`;for(let i=index?1:0;i<=48;i++){const t=i/48;samples.push(add(add(mul(a,(1-t)**3),mul(b,3*(1-t)**2*t)),add(mul(c,3*(1-t)*t*t),mul(e,t**3))));}});samples[0]=start;samples[samples.length-1]=start;
  return finishFrame(start,start,samples,d,{tangent:{x:sign,y:0},endTangent:{x:sign,y:0}});
}
function actualAngle(before,after,preferReflex=false) {
  const a=mul(before.endTangent,-1),b=after.tangent,small=Math.acos(clamp(a.x*b.x+a.y*b.y,-1,1))*180/Math.PI;
  return preferReflex?360-small:small;
}
export function previewPath(segments,plane='xy',corners=[],closure='open') {
  if(segments.length&&segments.every(s=>s.pathPoints?.length>=2))return pickedPreviewPath(segments,plane,corners,closure);
  const closed=closure==='closed',vertices=[{x:0,y:0}],frames=[];let heading=0,distance=0;
  segments.forEach((segment,i)=>{
    const shape=segmentShape(segment,closed&&segments.length===1),length=Number.isFinite(segment.length)&&segment.length>0?segment.length:100;
    const corner=corners[i-1],fallback=closed&&segments.length>=3?180-360/segments.length:180,standard=Number.isFinite(corner?.standard)?clamp(corner.standard,0,360):fallback;
    if(i){const incoming=frames.at(-1).endTangent;const small=Math.min(standard,360-standard);heading=Math.atan2(incoming.y,incoming.x)+(cornerSide(corner||{standard})==='outer'?1:-1)*(180-small)*Math.PI/180;}
    const start=vertices.at(-1),bend=shape.bend*(shape.direction==='right'?-1:1);let f;
    if(closed&&segments.length===1&&segment.geometry==='曲线')f=closedCurve(start,shape.width,shape.height,shape.direction);
    else if(closed&&segments.length===1&&segment.geometry==='圆弧')f=arcFrom(start,0,shape.radius,360,shape.direction);
    else if(closed&&i===segments.length-1){const end=vertices[0];f=segment.geometry==='曲线'?(Number.isFinite(shape.maxDeviation)?quadraticDeviation(start,end,shape.maxDeviation*(shape.direction==='right'?-1:1)):quadraticTo(start,end,bend)):segment.geometry==='圆弧'?arcTo(start,end,shape.arcAngle,shape.direction):line(start,end);}
    else if(segment.geometry==='曲线')f=Number.isFinite(shape.chordLength)&&shape.chordLength>0&&Number.isFinite(shape.maxDeviation)&&shape.maxDeviation>=0?curveFromDimensions(start,heading,shape.chordLength,shape.maxDeviation*(shape.direction==='right'?-1:1)):curveFrom(start,heading,length,bend);
    else if(segment.geometry==='圆弧')f=arcFrom(start,heading,shape.radius,shape.arcAngle,shape.direction);
    else f=line(start,add(start,{x:Math.cos(heading)*length,y:Math.sin(heading)*length}));
    f.distance=distance;f.cornerStandard=i?(corner?.standard??standard):undefined;
    if(closed&&i===segments.length-1&&i>0){const a=frames[i-1].endTangent,b=f.tangent,turn=Math.atan2(-(a.x*b.y-a.y*b.x),a.x*b.x+a.y*b.y)*180/Math.PI;f.cornerStandard=180-turn;}
    frames.push(f);vertices.push(f.end);distance+=f.length;
  });
  if(plane==='xz'){let x=0;const flat=frames.map(f=>{const start={x,y:0};x+=f.length;return {...line(start,{x,y:0}),distance:f.distance,cornerStandard:f.cornerStandard};});return {vertices:[{x:0,y:0},...flat.map(f=>f.end)],frames:flat,closed:false,totalLength:distance};}
  return {vertices,frames,closed,totalLength:distance};
}
function pickedPreviewPath(segments,plane,corners,closure){
  const origin=segments[0].pathPoints[0],sub3=(a,b)=>a.map((v,i)=>v-b[i]),dot3=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0),cross3=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],unit3=v=>{const n=Math.hypot(...v);return v.map(x=>x/(n||1));};
  const x=unit3(sub3(segments[0].pathPoints[1],origin));let z;
  for(const s of segments){const n=s.referenceNormal||s.endReferenceNormal||s.startReferenceNormal;if(n&&Math.hypot(...n)>.001){z=unit3(n);break;}}
  z=z||autoWeldReferenceNormal(segments);const y=cross3(z,x),project=p=>({x:dot3(sub3(p,origin),x),y:-dot3(sub3(p,origin),y)||0});let distance=0;
  const frames=segments.map((s,i)=>{const points=s.pathPoints,positions=points.map(project);let length=0;const measured=positions.map((p,j)=>{if(j)length+=Math.hypot(...sub3(points[j],points[j-1]));return {...p,s:length};});const f=plane==='xz'?line({x:distance,y:0},{x:distance+length,y:0}):finishFrame(positions[0],positions.at(-1),positions,positions.map((p,j)=>`${j?'L':'M'}${p.x},${p.y}`).join(' '));if(plane!=='xz')f.samples=measured;f.length=length;f.distance=distance;f.cornerStandard=corners[i-1]?.standard;distance+=length;return f;});
  return {frames,vertices:[frames[0].start,...frames.map(f=>f.end)],closed:closure==='closed'&&plane!=='xz',totalLength:distance};
}
export function sampleFrame(frame,distance) {
  if(distance<0)return {position:add(frame.start,mul(frame.tangent,distance)),tangent:frame.tangent};
  if(distance>frame.length)return {position:add(frame.end,mul(frame.endTangent,distance-frame.length)),tangent:frame.endTangent};
  const samples=frame.samples,at=frame.length?distance/frame.length*samples.at(-1).s:0;
  const hi=samples.findIndex(p=>p.s>=at);if(hi<=0)return {position:frame.start,tangent:frame.tangent};
  const a=samples[hi-1],b=samples[hi],t=(at-a.s)/(b.s-a.s||1),tangent=distance>=frame.length-1e-8?frame.endTangent:unit(sub(b,a));
  return {position:add(a,mul(sub(b,a),t)),tangent};
}
export function previewCorner(path,index,radius,standard) {
  const before=path.frames[index],after=path.frames[index+1];if(!before||!after)return null;
  const center=before.end,a=mul(before.endTangent,-1),b=after.tangent,cross=a.x*b.y-a.y*b.x,dot=clamp(a.x*b.x+a.y*b.y,-1,1),actual=Number.isFinite(after.cornerStandard)?after.cornerStandard:Math.acos(dot)*180/Math.PI,angle=(Number.isFinite(standard)?standard:actual)*Math.PI/180;
  const minorSweep=cross>=-1e-9?1:0,sweep=angle>Math.PI?1-minorSweep:minorSweep,mid=Math.atan2(a.y,a.x)+(sweep?1:-1)*angle/2;
  const endDirection=Math.atan2(a.y,a.x)+(sweep?1:-1)*angle;
  const start=add(center,mul(a,radius)),end=add(center,{x:Math.cos(endDirection)*radius,y:Math.sin(endDirection)*radius}),opposite=add(center,mul(a,-radius));
  const d=angle>=TAU-1e-9?`M${start.x},${start.y} A${radius},${radius} 0 0 ${sweep} ${opposite.x},${opposite.y} A${radius},${radius} 0 0 ${sweep} ${start.x},${start.y}`:`M${start.x},${start.y} A${radius},${radius} 0 ${angle>Math.PI?1:0} ${sweep} ${end.x},${end.y}`;
  return {center,start,end,label:{x:center.x+Math.cos(mid)*radius*1.65,y:center.y+Math.sin(mid)*radius*1.65},d,angle:angle*180/Math.PI,actualAngle:actual,guide:Number.isFinite(standard)&&Math.abs(standard-actual)>.05?add(center,mul(sub(end,center),1.45)):null};
}
export function samplePath(path,distance) {
  if(path.closed&&path.totalLength>0&&(distance<0||distance>path.totalLength))distance=((distance%path.totalLength)+path.totalLength)%path.totalLength;
  const frame=path.frames.find((f,i)=>distance<f.distance+f.length-1e-8||i===path.frames.length-1)||path.frames[0];
  return {...sampleFrame(frame,distance-frame.distance),frame,index:path.frames.indexOf(frame),distance};
}
export function previewPoint(point,path,plane='xy',layoutOnly=false,points=[],visited=new Set()) {
  visited=new Set(visited);visited.add(point.id);
  const reference=point.referenceId!==point.id?points.find(p=>p.id===point.referenceId&&p.kind!=='control'&&!visited.has(p.id)):null;
  const resolvedReference=reference?previewPoint(reference,path,plane,layoutOnly,points,visited):null;
  const basis=reference||point,frame=path.frames[basis.segment-1]||path.frames[0],key=plane==='xz'?'height':'normal',offsetKey=plane==='xz'?'z':'y';
  const referenceAlong=reference&&!layoutOnly?number(reference.offset?.x):0;
  const at=resolvedReference?resolvedReference.distance:frame.distance+number(basis.percent)*frame.length/100+referenceAlong;
  const along=number(point.location?.along)+(layoutOnly?0:number(point.offset?.x));
  const distance=at+along,baseSample=samplePath(path,at),shifted=samplePath(path,distance);
  const inherited=resolvedReference?((resolvedReference.position.x-baseSample.position.x)*normal(baseSample.tangent).x+(resolvedReference.position.y-baseSample.position.y)*normal(baseSample.tangent).y):0;
  const placement=number(point.location?.[key]),across=inherited+placement+(layoutOnly?0:number(point.offset?.[offsetKey]));
  return {frame:{...shifted.frame,tangent:shifted.tangent,normal:normal(shifted.tangent)},base:add(baseSample.position,mul(normal(baseSample.tangent),inherited+placement)),position:add(shifted.position,mul(normal(shifted.tangent),across)),distance,actualSegment:shifted.index+1,height:number(point.location?.height)+(layoutOnly?0:number(point.offset?.z))+(resolvedReference?resolvedReference.height:0)};
}
export function movePreviewPoint(point,frame,delta,axis,plane='xy',layoutOnly=false) {
  const along=delta.x*frame.tangent.x+delta.y*frame.tangent.y,across=delta.x*frame.normal.x+delta.y*frame.normal.y;
  if(layoutOnly){if(axis==='along')return point.kind==='control'?{...point,location:{normal:0,height:0,...point.location,along:round(number(point.location?.along)+along)}}:point;const key=plane==='xz'?'height':'normal';return {...point,location:{normal:0,height:0,...point.location,[key]:round(number(point.location?.[key])+across)}};}
  const key=axis==='along'?'x':plane==='xz'?'z':'y';return {...point,offset:{...point.offset,[key]:round(number(point.offset?.[key])+(axis==='along'?along:across))}};
}
export function previewBounds(path,points) {
  const all=[...path.frames.flatMap(f=>f.samples),...points.flatMap(p=>[p.base,p.position])],minX=Math.min(...all.map(p=>p.x)),maxX=Math.max(...all.map(p=>p.x)),minY=Math.min(...all.map(p=>p.y)),maxY=Math.max(...all.map(p=>p.y));
  const width=Math.max(Math.max(100,maxX-minX)*1.4,Math.max(30,maxY-minY)*2.8*1.5),height=width/2.8;
  return {x:(minX+maxX-width)/2,y:(minY+maxY-height)/2,width,height};
}
