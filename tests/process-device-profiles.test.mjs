import test from 'node:test';
import assert from 'node:assert/strict';
import {newDeviceProfile,initialDeviceProfiles,updateDeviceProfile,activeDeviceApplicability,validateDeviceProfiles,validDeviceProfileStore} from '../src/processDeviceModel.mjs';
import {migrateDraft} from '../src/templateModel.mjs';

const values=()=>({welderModel:'Lincoln PowerWave R450',material:'Q345不锈钢',wireType:'药芯焊丝',wireDiameter:1.2,gas:'CO2',robotModel:'ABB IRB1600',deviceRemark:'设备备注',method:'MAG'});
test('草稿设备库支持JSON往返，拒绝损坏或重复身份的数据',()=>{const p=newDeviceProfile(values(),true);assert.equal(validDeviceProfileStore(JSON.parse(JSON.stringify([p]))),true);for(const bad of ['broken',[p,p],[{...p,enabled:'true'}],[{...p,applicability:null}]])assert.equal(validDeviceProfileStore(bad),false);});
test('实际设备配置可读取复用，空工艺不虚构示例设备',()=>{
 assert.deepEqual(initialDeviceProfiles([],{}),[]);
 assert.equal(newDeviceProfile().name,'新建设备信息');
 const original=values(),seeded=initialDeviceProfiles([],original);
 assert.equal(seeded.length,1);assert.equal(seeded[0].enabled,true);assert.equal(original.deviceProfileId,undefined);
 assert.equal(initialDeviceProfiles(seeded,original).length,1);
 const restored=migrateDraft({model:'',templates:[],welds:[],processDeviceProfiles:seeded});assert.deepEqual(restored.processDeviceProfiles,seeded);
 assert.deepEqual(migrateDraft({model:'',templates:[],welds:[]}).processDeviceProfiles,[]);
});
test('启用配置互斥、名字限40字符，手工名称不被字段更改覆盖',()=>{
 const first=newDeviceProfile(values(),true),second=newDeviceProfile({...values(),robotModel:'KUKA KR10'});
 const original=[first,second],enabled=updateDeviceProfile(original,second.id,{enabled:true});
 assert.deepEqual(enabled.map(item=>item.enabled),[false,true]);assert.equal(original[0].enabled,true);
 const named=updateDeviceProfile(enabled,second.id,{name:'生产设备A',automaticName:false});
 const changed=updateDeviceProfile(named,second.id,{applicability:{...values(),welderModel:'新的焊机'}});assert.equal(changed[1].name,'生产设备A');
 assert.ok(newDeviceProfile({...values(),welderModel:'长名称'.repeat(40)}).name.length<=40);
 assert.match(validateDeviceProfiles([{...first,name:'长'.repeat(41)}]),/40/);
 assert.equal(validateDeviceProfiles(enabled),'');
});
test('配置确认复制完整参数，不会随后续配置修改而重写工艺',()=>{
 const profile=newDeviceProfile(values(),true),applied=activeDeviceApplicability([profile]);
 assert.equal(applied.robotModel,'ABB IRB1600');assert.equal(applied.method,'MAG');assert.equal(applied.deviceProfileId,profile.id);
 profile.applicability.welderModel='其他焊机';assert.equal(applied.welderModel,'Lincoln PowerWave R450');
 assert.equal(activeDeviceApplicability([]),null);
 assert.match(validateDeviceProfiles([{...profile,applicability:{...values(),robotModel:''}}]),/机器人/);
});
