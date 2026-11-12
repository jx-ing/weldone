import {EPS,along,dot,interpolate,vectorBetween} from './templateCaptureRange.mjs';

export function closestDistance(piece){
 const origin=vectorBetween(piece.from,piece.to),delta=vectorBetween(origin,vectorBetween(piece.endFrom,piece.endTo));
 const size=dot(delta,delta);
 const t=size>EPS*EPS?Math.max(0,Math.min(1,-dot(origin,delta)/size)):0;
 return distanceAt(piece,t);
}

function distanceAt(piece,t){
 const from=interpolate(piece.from,piece.endFrom,t),to=interpolate(piece.to,piece.endTo,t);
 return {from,to,kind:piece.kind,station:piece.start+(piece.end-piece.start)*t,distance:Math.hypot(...vectorBetween(from,to))};
}

function mergeRanges(ranges){
 const merged=[];
 for(const [start,end] of ranges.sort((a,b)=>a[0]-b[0])){
  const last=merged.at(-1);
  if(last&&start<=last.end+EPS)last.end=Math.max(last.end,end);
  else merged.push({start,end});
 }
 return merged;
}

export function distanceProfile(pieces,nearest,length){
 return {pieces,nearest,length,spans:mergeRanges(pieces.map(({start,end})=>[start,end]))};
}

function rangeBelow(piece,distance){
 const a=vectorBetween(piece.from,piece.to),d=vectorBetween(a,vectorBetween(piece.endFrom,piece.endTo));
 const size=dot(d,d),radius=distance*distance;
 if(size<=EPS*EPS)return dot(a,a)<=radius+EPS?[piece.start,piece.end]:null;
 const middle=-dot(a,d)/size;
 const low=along(a,d,middle),remaining=radius-dot(low,low);
 if(remaining<-EPS)return null;
 const half=Math.sqrt(Math.max(0,remaining)/size),start=Math.max(0,middle-half),end=Math.min(1,middle+half);
 if(end<start)return null;
 return [piece.start+(piece.end-piece.start)*start,piece.start+(piece.end-piece.start)*end];
}

function clipSpan(piece,start,end){
 const first=Math.max(piece.start,start),last=Math.min(piece.end,end);
 if(last-first<=EPS)return null;
 const from=distanceAt(piece,(first-piece.start)/(piece.end-piece.start)),to=distanceAt(piece,(last-piece.start)/(piece.end-piece.start));
 return {start:first,end:last,from:from.from,to:from.to,endFrom:to.from,endTo:to.to,kind:piece.kind};
}

export function measureDistanceInterval(profile,start,end,withWitnesses=false){
 if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end-start<=EPS||
  !profile?.spans.some(span=>start>=span.start-EPS&&end<=span.end+EPS))return null;
 const pieces=profile.pieces.map(piece=>clipSpan(piece,start,end)).filter(Boolean);
 let low=Infinity,high=0;
 for(const piece of pieces){
  low=Math.min(low,closestDistance(piece).distance);
  high=Math.max(high,distanceAt(piece,0).distance,distanceAt(piece,1).distance);
 }
 const min=low;
 // Find the smallest maximum that covers the whole interval with the nearest boundary at each station.
 for(let i=0;i<28&&high-low>1e-6;i++){
  const distance=(high+low)/2;
  const covered=mergeRanges(pieces.map(piece=>rangeBelow(piece,distance)).filter(Boolean));
  if(covered.some(range=>range.start<=start+EPS&&range.end>=end-EPS))high=distance;
  else low=distance;
 }
 const result={min,max:high};
 if(!withWitnesses)return result;
 const stations=Array.from({length:9},(_,index)=>start+(end-start)*index/8);
 const witnesses=stations.map(station=>{
  let best=null;
  for(const piece of pieces){
   if(station<piece.start-EPS||station>piece.end+EPS)continue;
   const hit=distanceAt(piece,Math.max(0,Math.min(1,(station-piece.start)/(piece.end-piece.start))));
   if(!best||hit.distance<best.distance)best=hit;
  }
  return best;
 }).filter(Boolean);
 return {...result,witnesses};
}

export function defaultDistanceInterval(profile){
 const widest=profile?.spans.reduce((best,span)=>!best||span.end-span.start>best.end-best.start?span:best,null);
 if(!widest)return null;
 const start=Math.ceil((widest.start-EPS)*1000)/1000||0;
 const end=Math.floor((widest.end+EPS)*1000)/1000;
 return start<end?{start,end}:null;
}
