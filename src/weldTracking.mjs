export function configuredTracking(segment,weld,mode){
 const key=mode==='arc'?'arcTracking':'laserTracking';
 if(typeof segment?.[key]==='boolean')return segment[key];
 if(typeof weld?.[key]==='boolean')return weld[key];
 const legacy=segment?.tracking??weld?.tracking;
 return typeof legacy==='string'?legacy===(mode==='arc'?'电弧跟踪':'激光跟踪'):undefined;
}

export function segmentUsesArcTracking(segment,weld){
 return segment?.effectiveArcTracking??configuredTracking(segment,weld,'arc')??false;
}
