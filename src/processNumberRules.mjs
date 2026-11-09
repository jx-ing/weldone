export function processNumberAttributes(key){
 if(key==='distance')return {min:0,step:'any','data-process-number-kind':'distance'};
 if(key==='weave')return {min:.1,step:.1,'data-process-number-kind':'weave'};
 if(['current','voltage','correction','job'].includes(key))return {min:1,step:1,'data-process-number-kind':'integer'};
 if(key==='time')return {min:.01,step:.01,'data-process-number-kind':'time'};
 return {step:'any'};
}
export function processNumberError(raw,kind,required=false){
 if(raw==='')return required?'请输入大于 0 的数字':'';
 const value=Number(raw);
 if(kind==='distance')return !Number.isFinite(value)||value<0?'请输入大于等于 0 的数字':'';
 if(!Number.isFinite(value)||value<=0)return '请输入大于 0 的数字';
 if(kind==='integer'&&!Number.isSafeInteger(value))return '只能填写大于 0 的整数';
 if(kind==='time'&&(/\.\d{3,}/.test(raw)||Math.abs(value*100-Math.round(value*100))>1e-8))return '动作时间最多填写两位小数';
 if(kind==='weave'&&(/\.\d{2,}/.test(raw)||Math.abs(value*10-Math.round(value*10))>1e-8))return '摆弧参数最多填写一位小数';
 return '';
}
