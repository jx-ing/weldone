const segmentKeys=['position','joint','geometry','length','lengthTolerance','minLength','maxLength'];
const pick=(value,keys)=>Object.fromEntries(keys.map(key=>[key,value[key]]));
const common=(segments,key)=>segments.every(segment=>segment[key]===segments[0]?.[key])?segments[0]?.[key]??null:null;
function cornerParameters(corner,saved={}){
 const previous={...corner,...saved},angleSide=previous.angleSide??(previous.standard>180?'outer':'inner');
 return 'angleMin' in previous||'angleMax' in previous?{angleMin:previous.angleMin,angleMax:previous.angleMax,angleSide}:{angleMin:Math.max(0,previous.standard-previous.tolerance),angleMax:Math.min(360,previous.standard+previous.tolerance),angleSide};
}

export function templateMatchParameters(template){
 const saved=template.matchParameters||{};
 const segments=template.segments.map((segment,index)=>{const previous={...segment,...saved.segments?.[index]};return {...pick(previous,['position','joint','geometry']),minLength:previous.minLength??.1,maxLength:previous.maxLength??null};});
 return structuredClone({version:2,leg:saved.leg??template.leg,position:saved.version===2?saved.position:common(segments,'position'),joint:saved.version===2?saved.joint:common(segments,'joint'),segments,
  corners:template.corners.map((corner,index)=>cornerParameters(corner,saved.corners?.[index])),
  groove:saved.groove??template.groove,startHole:saved.startHole??template.startHole,endHole:saved.endHole??template.endHole});
}

export function matchingParameterShapeErrors(template){
 const value=template.matchParameters;
 if(value===undefined)return [];
 if(!value||typeof value!=='object'||Array.isArray(value)||![1,2].includes(value.version))return ['模板匹配参数结构无效'];
 if(value.leg===null||value.leg===undefined||typeof value.startHole!=='boolean'||typeof value.endHole!=='boolean')return ['请完善匹配焊脚和过焊孔条件'];
 if(value.version===1&&!['standard','exact'].includes(value.mode))return ['匹配模式无效'];
 if(value.version===2&&['position','joint'].some(key=>value[key]!==null&&(typeof value[key]!=='string'||!value[key])))return ['请完善基本匹配参数中的焊接位置和接头类型'];
 if(!Array.isArray(value.segments)||value.segments.length!==template.segments.length||value.segments.some(s=>!s||typeof s!=='object'||Array.isArray(s)))return ['匹配参数必须与模板焊缝段一一对应'];
 if(!Array.isArray(value.corners)||value.corners.length!==template.corners?.length||value.corners.some(c=>!c||typeof c!=='object'||Array.isArray(c)))return ['匹配参数必须与模板转角一一对应'];
 if(value.version===2)for(const [index,corner] of value.corners.entries())if('angleMin' in corner||'angleMax' in corner){if(![corner.angleMin,corner.angleMax].every(angle=>Number.isFinite(angle)&&angle>=0&&angle<=360))return [`转角${index+1}角度范围应为0–360°`];if(corner.angleMin>corner.angleMax)return [`转角${index+1}最小角度不能大于最大角度`];}
 if(value.version===2)for(const [index,corner] of value.corners.entries())if(!('angleMin' in corner)&&!('angleMax' in corner)&&['standard','tolerance'].some(key=>key in corner&&(!Number.isFinite(corner[key])||corner[key]<0||corner[key]>360)))return [`转角${index+1}旧角度参数无效`];
 if(!value.groove||typeof value.groove!=='object'||Array.isArray(value.groove))return ['匹配坡口参数无效'];
 return [];
}

export function templateForMatching(template){
 if(template.matchParameters===undefined)return template;
 const {matchParameters,...base}=template,parameters=matchParameters.version===1?structuredClone(matchParameters):templateMatchParameters(template);
 return {...base,leg:parameters.leg,mode:parameters.version===1?parameters.mode:'standard',startHole:parameters.startHole,endHole:parameters.endHole,groove:parameters.groove,
  segments:template.segments.map((segment,index)=>({...segment,...pick({...segment,...parameters.segments[index]},parameters.version===1?segmentKeys:['position','joint','geometry','minLength','maxLength']),...(parameters.version===2?{position:parameters.position??parameters.segments[index].position,joint:parameters.joint??parameters.segments[index].joint}:{})})),
  corners:template.corners.map((corner,index)=>{const value=parameters.corners[index];return {...corner,...(parameters.version===1?pick(value,['standard','tolerance','angleSide']):{standard:(value.angleMin+value.angleMax)/2,tolerance:(value.angleMax-value.angleMin)/2,angleSide:value.angleSide})};})};
}
