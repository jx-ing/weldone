import {splitWeldPreview} from './manualSplitModel.mjs';

const EPS=1e-7;
export function sliceWeldSegments(weld,start,end){
 let current={...weld,closure:'open',enabled:true};
 if(end<weld.length-EPS)current={...current,segments:splitWeldPreview(current,end,{minimumLength:EPS}).pieces[0]};
 if(start>EPS)current={...current,segments:splitWeldPreview(current,start,{minimumLength:EPS}).pieces[1]};
 return structuredClone(current.segments);
}
