export const PROCESS_POINT_GROUPS={
  inner:{label:'内角参数',pointLabel:'内角点',count:3},
  outer:{label:'外角参数',pointLabel:'外角点',count:3},
  wrap:{label:'包角参数',pointLabel:'包角点',count:7}
};
export const newProcessFeaturePoint=()=>({enabled:false,current:null,voltage:null,correction:0,time:0,job:null});
export const newProcessPointWeave=()=>({enabled:false,pattern:'sine',amplitude:null,frequency:null,dwellLeft:null,dwellRight:null,centerOffset:null});
export const newCornerPointGroups=()=>({inner:Array.from({length:3},newProcessFeaturePoint),outer:Array.from({length:3},newProcessFeaturePoint)});
export const newWrapPoints=()=>Array.from({length:7},newProcessFeaturePoint);

export function processFeaturePoints(pass,kind){
 const spec=PROCESS_POINT_GROUPS[kind];if(!spec)throw Error('参数点类型无效');
 const source=kind==='wrap'?pass.wrapParameters:Array.isArray(pass.cornerParameters)?pass.cornerParameters.slice(kind==='inner'?0:3,kind==='inner'?3:6):pass.cornerParameters?.[kind];
 return Array.from({length:spec.count},(_,index)=>structuredClone(source?.[index]||newProcessFeaturePoint()));
}

export function sharedCornerPoint(pass,kind){
 const points=processFeaturePoints(pass,kind);
 const corner=points[1];
 return corner.enabled?corner:points.find(point=>point.enabled)??corner;
}

export function sharedCornerPointChanges(pass,kind,values){
 const corners={inner:processFeaturePoints(pass,'inner'),outer:processFeaturePoints(pass,'outer')};
 const {weave,...shared}=values;
 corners[kind]=corners[kind].map(point=>({...point,...shared}));
 return {cornerParameters:corners,...(Array.isArray(pass.cornerParameters)?{legacyCornerParameters:structuredClone(pass.cornerParameters)}:{})};
}

export function processFeaturePointChanges(pass,kind,index,values){
 const spec=PROCESS_POINT_GROUPS[kind];if(!spec||!Number.isInteger(index)||index<0||index>=spec.count)throw Error('参数点位置无效');
 if(kind==='wrap'){const points=processFeaturePoints(pass,kind);points[index]={...points[index],...structuredClone(values)};return {wrapParameters:points};}
 const corners={inner:processFeaturePoints(pass,'inner'),outer:processFeaturePoints(pass,'outer')};
 corners[kind][index]={...corners[kind][index],...structuredClone(values)};
 return {cornerParameters:corners,...(Array.isArray(pass.cornerParameters)?{legacyCornerParameters:structuredClone(pass.cornerParameters)}:{})};
}
