import test from 'node:test';
import assert from 'node:assert/strict';
import {newTemplate,addTemplateCorner,validateTemplate,matchTemplate,applyTemplateToWeld,migrateTemplate} from '../src/templateModel.mjs';
import {templateMatchParameters,templateForMatching} from '../src/templateMatchingParameters.mjs';

function target(template){return {id:'W001',name:'参数测试',enabled:true,closure:template.closure,leg:template.leg,segments:structuredClone(template.segments),cornerAngles:template.corners.map(c=>c.standard),groove:structuredClone(template.groove),completeStart:true,completeEnd:true,startHole:template.startHole,endHole:template.endHole};}

test('长度仅按适用范围匹配，不再受历史标准长度或容差限制，来源几何及点位独立',()=>{
 const original={...newTemplate('whole'),name:'匹配参数测试',mode:'exact'},weld=target(original);weld.leg=8;weld.segments[0].length=250;
 const before=structuredClone(original),parameters=templateMatchParameters(original);parameters.leg=8;Object.assign(parameters.segments[0],{minLength:200,maxLength:300});
 assert.equal(parameters.version,2);assert.equal('length' in parameters.segments[0],false);assert.equal('lengthTolerance' in parameters.segments[0],false);assert.equal('mode' in parameters,false);
 const changed={...original,matchParameters:parameters};assert.deepEqual(validateTemplate(changed),[]);assert.equal(matchTemplate(original,weld).ok,false);assert.equal(matchTemplate(changed,weld).ok,true);
 assert.equal(matchTemplate(changed,{...weld,leg:6}).ok,false);const tooLong=structuredClone(weld);tooLong.segments[0].length=301;assert.equal(matchTemplate(changed,tooLong).ok,false);
 for(const length of [200,280,300]){const within=structuredClone(weld);within.segments[0].length=length;assert.equal(matchTemplate(changed,within).ok,true);}
 const applied=applyTemplateToWeld(weld,changed);assert.equal(applied.templateId,original.id);assert.ok(applied.controlPoints.length);assert.deepEqual(changed.segments,before.segments);assert.deepEqual(changed.layers,before.layers);assert.deepEqual(original,before);
 const roundtrip=migrateTemplate(JSON.parse(JSON.stringify(changed)));assert.deepEqual(roundtrip.matchParameters,parameters);assert.equal(matchTemplate(roundtrip,weld).ok,true);
});

test('基本条件、几何类型、角度、坡口及过焊孔条件均参与实际匹配',()=>{
 const original={...newTemplate('whole'),name:'条件编辑'},parameters=templateMatchParameters(original);parameters.startHole=true;parameters.groove={type:'V 形',angle:60,depth:5,rootGap:2,rootRadius:0};
 const changed={...original,matchParameters:parameters},weld=target(original);weld.startHole=true;weld.groove=structuredClone(parameters.groove);weld.segments[0].length=500;
 assert.equal(matchTemplate(changed,weld).ok,true);assert.equal(matchTemplate(changed,{...weld,startHole:false}).ok,false);assert.equal(matchTemplate(changed,{...weld,groove:{...weld.groove,angle:55}}).ok,false);
 const effective=templateForMatching(changed);effective.groove.angle=50;assert.equal(changed.matchParameters.groove.angle,60);
 const bent={...addTemplateCorner(original),name:'转角条件'},cornerParameters=templateMatchParameters(bent);Object.assign(cornerParameters.corners[0],{angleMin:100,angleMax:100});Object.assign(cornerParameters,{position:'PF · 立向上焊',joint:'搭接接头'});cornerParameters.segments[0].geometry='曲线';
 const cornerTemplate={...bent,matchParameters:cornerParameters},cornerWeld=target(bent);cornerWeld.cornerAngles=[100];cornerWeld.segments=cornerWeld.segments.map((segment,index)=>({...segment,position:'PF · 立向上焊',joint:'搭接接头',...(index===0?{geometry:'曲线'}:{})}));
 assert.equal(matchTemplate(cornerTemplate,cornerWeld).ok,true);assert.equal(matchTemplate(cornerTemplate,{...cornerWeld,cornerAngles:[90]}).ok,false);assert.equal(matchTemplate(bent,cornerWeld).ok,false);
 const mismatched=structuredClone(cornerWeld);mismatched.segments[1].position='PB · 横角焊';assert.equal(matchTemplate(cornerTemplate,mismatched).ok,false);
});

test('无覆盖的旧模板沿用原规则，非法覆盖和长度范围阻止保存或匹配',()=>{
 const original={...newTemplate('whole'),name:'旧模板'};assert.strictEqual(templateForMatching(original),original);assert.equal(matchTemplate(original,target(original)).ok,true);
 for(const mutate of [p=>{p.leg=null;},p=>{p.leg=-1;},p=>{p.segments=[];},p=>{p.segments[0].minLength=50;p.segments[0].maxLength=20;},p=>{p.position='错误位置';},p=>{p.groove=null;},p=>{p.startHole='yes';}]){const p=templateMatchParameters(original);mutate(p);const changed={...original,matchParameters:p};assert.ok(validateTemplate(changed).length);assert.equal(matchTemplate(changed,target(original)).ok,false);}
});

test('旧版精确条件保留至显式保存新版；混合段的基本条件不被默认覆盖',()=>{
 const original={...newTemplate('whole'),name:'旧版参数',mode:'exact'},legacy={...original,matchParameters:{version:1,leg:6,mode:'exact',segments:original.segments.map(segment=>({...segment,length:100,lengthTolerance:0,minLength:.1,maxLength:null})),corners:[],groove:original.groove,startHole:false,endHole:false}},weld=target(original);weld.segments[0].length=150;
 assert.equal(matchTemplate(legacy,weld).ok,false);const saved={...legacy,matchParameters:templateMatchParameters(legacy)};assert.equal(matchTemplate(saved,weld).ok,true);assert.equal(legacy.matchParameters.version,1);
 const mixed=addTemplateCorner(original);mixed.segments[1]={...mixed.segments[1],position:'PF · 立向上焊',joint:'搭接接头'};const parameters=templateMatchParameters(mixed);assert.equal(parameters.position,null);assert.equal(Object.hasOwn(parameters,'joint'),false);assert.deepEqual(templateForMatching({...mixed,matchParameters:parameters}).segments.map(segment=>segment.position),mixed.segments.map(segment=>segment.position));
});

test('转角角度范围兼容旧标准与容差边界，保存新范围并拒绝倒置或越界值',()=>{
 const original={...addTemplateCorner(newTemplate('whole')),name:'角度范围'},parameters=templateMatchParameters(original);
 assert.deepEqual(parameters.corners[0],{angleMin:85,angleMax:95,angleSide:'inner'});
 const modern={...original,matchParameters:parameters},legacy={...original,matchParameters:{...parameters,corners:[{standard:90,tolerance:5,angleSide:'inner'}]}};
 for(const angle of [0,84.99,85,90,95,95.01,180]){const weld=target(original);weld.cornerAngles=[angle];assert.equal(matchTemplate(modern,weld).ok,matchTemplate(original,weld).ok);assert.equal(matchTemplate(legacy,weld).ok,matchTemplate(modern,weld).ok);}
 const edited=structuredClone(modern);Object.assign(edited.matchParameters.corners[0],{angleMin:80,angleMax:100});const weld=target(original);weld.cornerAngles=[100];assert.equal(matchTemplate(edited,weld).ok,true);weld.cornerAngles=[100.01];assert.equal(matchTemplate(edited,weld).ok,false);
 assert.deepEqual(migrateTemplate(JSON.parse(JSON.stringify(edited))).matchParameters.corners[0],{angleMin:80,angleMax:100,angleSide:'inner'});assert.deepEqual(edited.corners,original.corners);
 for(const [angleMin,angleMax] of [[100,80],[-1,95],[85,361],['',95],[85,null]]){const invalid=structuredClone(modern);Object.assign(invalid.matchParameters.corners[0],{angleMin,angleMax});assert.ok(validateTemplate(invalid).length);}
});
