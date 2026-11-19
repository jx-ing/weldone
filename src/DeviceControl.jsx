import {TextInput} from './FormInput.jsx';
import React,{useState} from 'react';
import NumericInput from './NumericInput.jsx';
import {Camera,Plus,Workflow} from 'lucide-react';
import {EmptyState, PageHeader} from './WorkspaceUI';
import {BASE_DEVICE_TYPES,MAX_ADDITIONAL_DEVICES,DEVICE_TRACKING_MODES,PRECISION_CAMERA_BRANDS,ROBOT_MOUNTING_OPTIONS,activateDeviceProfile,addDeviceProfile,deviceControlError,enabledPlanningRobots,enabledPrecisionBrands,robotProfiles} from './deviceControlModel.mjs';
import {DEFAULT_LASER_MOUNT_SIDE,LASER_HORIZONTAL_OFFSET,LASER_MOUNT_SIDES} from './laserCameraMount.mjs';
import ToolHeadPreview from './ToolHeadPreview';
import {useAssistantCommands} from './assistantCommandBus.mjs';
import {addWorkstationDevice,enabledWorkstationRobots,removeWorkstationDevice,workstationDeviceProfiles,workstationSettingsError} from './workstationDevices.mjs';
import './deviceControl.css';

const iconForType=type=>type==='robot'?Workflow:Camera;
const baseDevices=BASE_DEVICE_TYPES.map(([type,label])=>[type,label,iconForType(type)]);
const cameraTypes=[['weijing','结构光相机'],['yinglai','线激光相机']];

function Group({title,children}){
 return <section className="dc-group" aria-label={title}><h3>{title}</h3>{children}</section>;
}
function Row({label,children}){
 return <div className="dc-row"><span>{label}</span><div className="dc-value">{children}</div></div>;
}
function Commands({names}){
 return <div className="dc-commands">{names.map(name=><button key={name} type="button" className="btn" disabled title="设备通讯未接入">{name}</button>)}</div>;
}
function InputRow({label,value,onChange,numeric=false,min,max,step='any',unit,maxLength=80,disabled=false,placeholder}){
 const Input=numeric?NumericInput:TextInput;
 return <Row label={label}><span className="dc-input">
  <Input aria-label={label} type={numeric?'number':'text'} min={min} max={max} step={numeric?step:undefined}
   maxLength={numeric?undefined:maxLength} value={value??''} disabled={disabled} placeholder={placeholder}
   onChange={event=>onChange(numeric?(event.target.value===''?null:event.target.valueAsNumber):event.target.value)}/>
  {unit&&<span>{unit}</span>}
 </span></Row>;
}
function Connection({kind,device,patch}){
 return <Group title="设备通讯">
  <Row label="设备连接"><Commands names={['连接','断开']}/></Row>
  <InputRow label={kind+'IP地址'} value={device.address} onChange={address=>patch({address})} maxLength={255}/>
  <InputRow label={kind+'端口'} value={device.port} onChange={port=>patch({port})} numeric min={1} max={65535} step={1}/>
 </Group>;
}
function RobotPanel({device,patch,laserAvailable}){
 const checked=mode=>device.trackingModes.includes(mode);
 return <>
  <Connection kind="机器人" device={device} patch={patch}/>
  <Group title="程序控制">
   <Row label="主程序控制"><Commands names={['一键启动']}/></Row>
   <Row label="程序控制"><Commands names={['启动','暂停','终止']}/></Row>
   <Row label="系统复位"><Commands names={['重置']}/></Row>
   <Row label="运行倍率"><span className="dc-muted">—</span></Row>
   <Row label="焊缝跟踪能力">
    <div className="dc-choice" role="group" aria-label="焊缝跟踪能力">
     {DEVICE_TRACKING_MODES.filter(([mode])=>mode!=='laser'||laserAvailable).map(([mode,label])=><label key={mode}><input type="checkbox" checked={checked(mode)}
      onChange={event=>patch({trackingModes:event.target.checked?[...device.trackingModes,mode]:device.trackingModes.filter(item=>item!==mode)})}/>支持{label}</label>)}
    </div>
   </Row>
  </Group>
 </>;
}
function CoarsePanel({device,patch}){
 const manual=device.scanMode==='manual';
 return <>
  <Connection kind="相机" device={device} patch={patch}/>
  <Group title="扫描位置">
   <div className="dc-scan">
    <div>
     <Row label="控制方式"><div className="dc-choice" role="group" aria-label="控制方式">
      {[['auto','自动'],['manual','手动']].map(([value,label])=><label key={value}>
       <input type="radio" name="device-scan-mode" checked={device.scanMode===value} onChange={()=>patch({scanMode:value})}/>{label}
      </label>)}
     </div></Row>
     <InputRow label="扫描起点位置" value={device.scanStart} onChange={scanStart=>patch({scanStart})} numeric unit="mm" disabled={!manual}/>
     <InputRow label="扫描终点位置" value={device.scanEnd} onChange={scanEnd=>patch({scanEnd})} numeric unit="mm" disabled={!manual}/>
    </div>
    <EmptyState className="dc-empty" text="暂无扫描数据" description="设备连接后可查看扫描结果。"/>
   </div>
  </Group>
 </>;
}
function PrecisionPanel({device,patch,laser,structuredLightInstalled,laserMountSide,coverOpen,onCoverChange,fieldOfView,onFieldOfViewChange,workstation}){
 const [showLaserLine,setShowLaserLine]=useState(false);
 if(!laser)return <>
  <Connection kind="相机" device={device} patch={patch}/>
  <Group title="机头预览">
   <Row label="保护盖">
    <div className="dc-commands" role="group" aria-label="伟景保护盖预览">
     <button type="button" className="btn" aria-pressed={coverOpen} onClick={()=>onCoverChange(true)}>开启</button>
     <button type="button" className="btn" aria-pressed={!coverOpen} onClick={()=>onCoverChange(false)}>关闭</button>
     <span role="status">{coverOpen?'已开启':'已关闭'}</span>
    </div>
   </Row>
   <Row label="相机视野"><label className="dc-choice"><input type="checkbox" role="switch" aria-label="显示相机视野" checked={fieldOfView} onChange={event=>onFieldOfViewChange(event.target.checked)}/>显示相机视野</label></Row>
   <ToolHeadPreview structuredLightInstalled={structuredLightInstalled} coverOpen={coverOpen} fieldOfView={fieldOfView} laserMountSide={laserMountSide}/>
  </Group>
 </>;
 return <>
  {!workstation&&<Group title="机头预览">
   <Row label="视野"><div className="dc-choice">
    <label><input type="checkbox" checked={fieldOfView} onChange={event=>onFieldOfViewChange(event.target.checked)}/>相机视野</label>
    <label><input type="checkbox" checked={showLaserLine} onChange={event=>setShowLaserLine(event.target.checked)}/>激光线视野</label>
   </div></Row>
   <Row label="可视点水平偏移"><output>{LASER_HORIZONTAL_OFFSET} mm</output></Row>
   <ToolHeadPreview structuredLightInstalled={structuredLightInstalled} laserMountSide={laserMountSide} camera="laser" fieldOfView={fieldOfView} laserLine={showLaserLine}/>
  </Group>}
  <Group title="连接管理">
   <Row label="设备状态"><span className="dc-offline">未初始化</span></Row>
   <Row label="设备信息"><span>IP {device.address||'—'}</span></Row>
   <Row label="SDK 操作"><Commands names={['InitSDK','连接','断开','UnInitSDK']}/></Row>
   <Row label="返回码"><span className="dc-muted">—</span></Row>
  </Group>
  <Group title="设备控制">
   <Row label="Sensor 使能"><input type="checkbox" role="switch" aria-label="Sensor 使能" disabled/></Row>
   <Row label="Laser 使能"><input type="checkbox" role="switch" aria-label="Laser 使能" disabled/></Row>
   <Row label="温度查询"><Commands names={['获取温度']}/></Row>
   <Row label="Job 切换"><Commands names={['SetJobId']}/></Row>
  </Group>
  <Group title="轮廓采集与求交">
   <Row label="GetCorner"><Commands names={['GetCorner']}/></Row>
   <Row label="轮廓数据流"><Commands names={['开始采集']}/><span className="dc-muted">点数 0</span></Row>
  </Group>
  <Group title="实时日志"><pre className="dc-log">等待设备日志…</pre></Group>
 </>;
}
function RobotDetails({device,patch,workstation}){
 return <>
  <Group title="程序信息">
   {['主程序状态','当前子程序名称','当前子程序状态'].map(label=><Row key={label} label={label}><span className="dc-muted">—</span></Row>)}
  </Group>
  <Group title="设备信息">
   <details open><summary>机器人详情</summary>
    {!workstation&&<InputRow label="机械臂型号" value={device.model} onChange={model=>patch({model})}/>}
    <Row label="机器人安装方式"><select aria-label="机器人安装方式" value={device.mounting??'upright'} onChange={event=>patch({mounting:event.target.value})}>
     {ROBOT_MOUNTING_OPTIONS.map(([key,label])=><option key={key} value={key}>{label}</option>)}
    </select></Row>
    <InputRow label="机器人臂展" value={device.reach} onChange={reach=>patch({reach})} numeric min={0} unit="mm"/>
    <InputRow label="机器人有效工作范围" value={device.workingRange} onChange={workingRange=>patch({workingRange})}
     maxLength={160} placeholder="填写工作范围及单位"/>
   </details>
   <details open><summary>外部轴详情</summary>
    <InputRow label="有效行程" value={device.externalTravel} onChange={externalTravel=>patch({externalTravel})} numeric min={0} unit="mm"/>
   </details>
  </Group>
 </>;
}
function CameraDetails({device,patch,precision,brand,laser,laserMountSide,onMountSide,onRemove}){
 return <Group title="设备信息">
  <details open><summary>相机详情</summary>
   {precision?<Row label="品牌"><span>{PRECISION_CAMERA_BRANDS.find(([key])=>key===brand)?.[1]}</span></Row>:
    <InputRow label="相机品牌" value={device.brand} onChange={brand=>patch({brand})}/>}
   {device&&<InputRow label="相机型号" value={device.model} onChange={model=>patch({model})}/>}
   {laser&&<>
    <Row label="安装侧"><select aria-label="线激光安装侧" value={laserMountSide} onChange={event=>onMountSide(event.target.value)}>
     {LASER_MOUNT_SIDES.map(([key,label])=><option key={key} value={key}>{label}</option>)}
    </select></Row>
    <InputRow label="设备 ID" value={device.id} onChange={id=>patch({id})} numeric min={0} step={1}/>
    <InputRow label="相机IP地址" value={device.address} onChange={address=>patch({address})} maxLength={255}/>
    <InputRow label="相机端口" value={device.port} onChange={port=>patch({port})} numeric min={1} max={65535} step={1}/>
   </>}
  </details>
  {precision&&<button type="button" className="btn" onClick={onRemove}>移除相机</button>}
 </Group>;
}
function DeviceCard({id,label,model,enabled,robot,Icon,selected,laser,onSelect,coverOpen}){
 const fields=robot?['运行状态','运行模式','运行倍率']:id==='weijing'?['保护盖','相机温度']:[];
 return <button type="button" className={'dc-card'+(selected?' active':'')} aria-pressed={selected} aria-label={label} onClick={()=>onSelect(id)}>
  <strong><Icon size={16}/><span>{label}</span>{enabled!==undefined&&<small className={enabled?'active-arm':''}>{enabled?'已生效':'未生效'}</small>}</strong>
  {model&&<span className="dc-card-model" title={model}>{model}</span>}
  <span className="dc-card-status">
   <span><small>设备状态</small><b>{laser?'未初始化':'未连接'}</b></span>
   {fields.map(field=><span key={field}><small>{field}</small><b>{field==='保护盖'?(coverOpen?'预览开启':'预览关闭'):'—'}</b></span>)}
  </span>
 </button>;
}

function SceneActions({dirty,loading,onImport}){
 return <>
  <span className="dc-muted">{dirty?'有未保存修改':'设备通讯未接入'}</span>
  <button className="btn primary" type="button" disabled={loading||dirty}
   title={dirty?'请先应用设备修改':undefined} onClick={onImport}>{loading?'正在加载场景…':'导入场景文件'}</button>
 </>;
}

export default function DeviceControl({value,onSave,coverOpen,onCoverChange,fieldOfView,onFieldOfViewChange,sceneStatus,loading,onImport}){
 const [draft,setDraft]=useState(()=>structuredClone(value)),[selected,setSelected]=useState('robot'),[error,setError]=useState('');
 const [adding,setAdding]=useState(false),[newType,setNewType]=useState('robot'),[newBrand,setNewBrand]=useState('');
 const brands=enabledPrecisionBrands(draft),missing=cameraTypes.filter(([key])=>!brands.includes(key));
 const additional=draft.additionalDevices??[];
 const spare=additional.find(device=>device.id===selected);
 const devices=[...baseDevices.map(([type,label,icon])=>[type,label,icon,draft[type].model]),
  ...additional.map(({id,type,configuration},index)=>[id,BASE_DEVICE_TYPES.find(([key])=>key===type)[1]+' '+(index+2),iconForType(type),configuration.model]),
  ...cameraTypes.filter(([key])=>brands.includes(key)).map(([key,label])=>[key,label,Camera,draft.precisionCamera.profiles[key].model])];
 const precision=brands.includes(selected),robot=(spare?.type??selected)==='robot',laser=selected==='yinglai';
 const addingPrecision=newType==='precisionCamera';
 const registeredRobots=robotProfiles(draft);
 const activeRobots=enabledPlanningRobots(draft);
 const activeIds=activeRobots.map(device=>device.id);
 const currentArm=activeRobots[0]??registeredRobots[0];
 const laserMountSide=brands.includes('yinglai')?currentArm.configuration.laserMountSide??DEFAULT_LASER_MOUNT_SIDE:undefined;
 const device=precision?draft.precisionCamera.profiles[selected]:spare?.configuration??draft[selected];
 const dirty=JSON.stringify(draft)!==JSON.stringify(value);
 function patch(values){
  setDraft(previous=>precision?{
   ...previous,precisionCamera:{...previous.precisionCamera,profiles:{...previous.precisionCamera.profiles,[selected]:{...previous.precisionCamera.profiles[selected],...values}}}
  }:spare?{...previous,additionalDevices:previous.additionalDevices.map(device=>device.id===selected?
   {...device,configuration:{...device.configuration,...values}}:device)}:{...previous,[selected]:{...previous[selected],...values}});
  setError('');
 }
 function updateCameras(brands,selection){
  setDraft(previous=>({...previous,precisionCamera:{...previous.precisionCamera,brands}}));
  setSelected(selection);setAdding(false);setError('');
 }
 function addDevice(){
  if(addingPrecision){
   if(missing.some(([key])=>key===newBrand))updateCameras([...brands,newBrand],newBrand);
   return;
  }
  const id=crypto.randomUUID();
  try{
   setDraft(addDeviceProfile(draft,newType,id));
   setSelected(id);setAdding(false);setError('');
  }catch(error){setError(error.message);}
 }
 async function save(event){
  event.preventDefault();
  setError(deviceControlError(draft)||await onSave(draft)||'');
 }
 useAssistantCommands('device-control',{
  device_apply_changes:async()=>{
   if(JSON.stringify(draft)===JSON.stringify(value))return {ok:false,message:'当前没有待应用的设备修改'};
   const failure=deviceControlError(draft)||await onSave(draft)||'';
   if(failure){setError(failure);return {ok:false,message:failure};}
   return {ok:true,message:'已应用设备修改'};
  },
 });
 return <form className="device-control" aria-label="设备控制" onSubmit={save}>
  <PageHeader title="设备控制" breadcrumb={<span className="dc-status-badge">● {laser?'未初始化':'未连接'}</span>} actions={<SceneActions dirty={dirty} loading={loading} onImport={onImport}/>}/>
  {sceneStatus&&<p role="status" className="dc-workstation-status">{sceneStatus}</p>}
  <div className="dc-workspace" inert={loading}>
   <aside className="dc-list" aria-label="设备列表">
    <h2>设备列表 <button className="btn" type="button" aria-expanded={adding}
     onClick={()=>{setAdding(!adding);setNewType(missing.length?'precisionCamera':'robot');setNewBrand(missing[0]?.[0]??'');}}><Plus size={14}/>新建设备</button></h2>
    {adding&&<div className="dc-add-device">
     <label>设备类型 <select aria-label="设备类型" value={newType} onChange={event=>setNewType(event.target.value)}>
      {BASE_DEVICE_TYPES.map(([key,label])=><option key={key} value={key}>{label}</option>)}
      <option value="precisionCamera">精定位相机</option>
     </select></label>
     {addingPrecision&&<label>精定位相机品牌 <select aria-label="精定位相机品牌" value={newBrand} onChange={event=>setNewBrand(event.target.value)}>
      {!missing.length&&<option value="">已配置可用品牌</option>}
      {missing.map(([key,label])=><option key={key} value={key}>{PRECISION_CAMERA_BRANDS.find(([brand])=>brand===key)[1]} · {label}</option>)}
     </select></label>}
     <button type="button" className="btn primary" disabled={addingPrecision?!missing.length:additional.length>=MAX_ADDITIONAL_DEVICES} onClick={addDevice}>添加设备</button>
    </div>}
    <div>{devices.map(([id,label,Icon,model])=>{
     const isRobot=registeredRobots.some(robot=>robot.id===id);
     return <DeviceCard key={id} id={id} label={label} model={model} robot={isRobot}
      enabled={isRobot&&registeredRobots.length>1?activeIds.includes(id):undefined} Icon={Icon} selected={selected===id}
      laser={id==='yinglai'} onSelect={setSelected} coverOpen={coverOpen}/>;
    })}</div>
   </aside>
   <section className="dc-main" aria-label={robot?'焊接机器人控制':precision?'精定位相机控制':'粗定位相机控制'}>
    {robot?<RobotPanel device={device} patch={patch} laserAvailable={!!laserMountSide}/>:precision?<PrecisionPanel key={selected}
     device={device} patch={patch} laser={laser} structuredLightInstalled={brands.includes('weijing')} laserMountSide={laserMountSide} coverOpen={coverOpen} onCoverChange={onCoverChange}
     fieldOfView={fieldOfView} onFieldOfViewChange={onFieldOfViewChange}/>:<CoarsePanel device={device} patch={patch}/>}
   </section>
   <aside className="dc-details" aria-label="设备详情">
    {robot?<RobotDetails device={device} patch={patch}/>:<CameraDetails device={device} patch={patch}
     precision={precision} brand={selected} laser={laser} laserMountSide={laserMountSide}
     onMountSide={laserMountSide=>setDraft(previous=>currentArm.id==='robot'?{...previous,robot:{...previous.robot,laserMountSide}}:
      {...previous,additionalDevices:previous.additionalDevices.map(device=>device.id===currentArm.id?
       {...device,configuration:{...device.configuration,laserMountSide}}:device)})}
     onRemove={()=>updateCameras(brands.filter(key=>key!==selected),'robot')}/>}
    {robot&&registeredRobots.length>1&&<Group title="工艺规划">
     <Row label="机械臂生效"><label className="dc-choice"><input type="checkbox" aria-label="参与工艺规划" checked={activeIds.includes(selected)}
      disabled={activeIds.length===1&&activeIds.includes(selected)} onChange={event=>{
       const enabled=event.target.checked;
       setDraft(previous=>({...previous,enabledRobotIds:enabled?[...activeIds,selected]:activeIds.filter(id=>id!==selected)}));
      }}/>参与工艺规划</label></Row>
    </Group>}
    {spare&&<div className="dc-profile-actions">
     {!robot&&<button type="button" className="btn" onClick={()=>{setDraft(previous=>activateDeviceProfile(previous,selected));setSelected(spare.type);}}>设为当前设备</button>}
     <button type="button" className="btn" onClick={()=>{
      const remaining=activeIds.filter(id=>id!==selected);
      setDraft(previous=>({...previous,additionalDevices:previous.additionalDevices.filter(device=>device.id!==selected),
       ...(robot?{enabledRobotIds:remaining.length?remaining:['robot']}:{})}));
      setSelected(spare.type);
     }}>移除设备</button>
    </div>}
   </aside>
  </div>
  {error&&<p className="dc-error" role="alert">{error}</p>}
  {dirty&&<div className="dc-edit-actions"><button type="submit" className="btn primary">应用设备修改</button></div>}
 </form>;
}

const emptySettings={};
const scenePropertyLabels={
 purpose:'用途', axes:'轴数', sensor_type:'传感器类型', working_distances:'工作距离', scan_widths:'扫描线宽',
 baseline:'双目基线', max_line_rate:'最高扫描频率', nominal_lateral_offset_in_tool_plane:'可视点水平偏移',
 sensor_model_status:'型号依据', installation_calibration:'安装标定', optical_roll:'光学旋转角',
};

export function WorkstationDeviceControl({workstation,value=emptySettings,onSave,coverOpen,onCoverChange,fieldOfView,onFieldOfViewChange,sceneStatus,loading,onImport}){
 const [draft,setDraft]=useState(value);
 const [selected,setSelected]=useState(()=>workstation.devices.find(device=>device.kind==='robot').id);
 const [error,setError]=useState('');
 const [adding,setAdding]=useState(false),[newKind,setNewKind]=useState('robot'),[newBrand,setNewBrand]=useState('weijing');
 const [targetRobot,setTargetRobot]=useState(()=>workstation.devices.find(device=>device.kind==='robot').id);
 const profiles=workstationDeviceProfiles(workstation.devices,draft);
 const profile=profiles.find(profile=>profile.id===selected)??profiles[0];
 const {kind,label,configuration:device,bindings,properties,precisionBrand,configured}=profile;
 const robotIds=profiles.filter(profile=>profile.kind==='robot'&&!profile.configured).map(profile=>profile.id);
 const activeIds=enabledWorkstationRobots(workstation.devices,draft);
 const laser=precisionBrand==='yinglai',structured=precisionBrand==='weijing';
 const laserAvailable=profiles.some(profile=>profile.precisionBrand==='yinglai'&&!profile.configured);
 const structuredInstalled=profiles.some(profile=>profile.precisionBrand==='weijing');
 const dirty=JSON.stringify(draft)!==JSON.stringify(value);
 const patch=changes=>{
  setDraft(previous=>({...previous,profiles:{...previous.profiles,[profile.id]:{...previous.profiles?.[profile.id],...changes}}}));
  setError('');
 };
 function addDevice(){
  try{
   const entry={kind:newKind,id:crypto.randomUUID(),...(newKind==='precision'?{brand:newBrand,robotId:targetRobot}:{})};
   const next=addWorkstationDevice(workstation.devices,draft,entry);
   const added=workstationDeviceProfiles(workstation.devices,next).find(device=>!profiles.some(previous=>previous.id===device.id));
   setDraft(next);
   if(added)setSelected(added.id);
   setAdding(false);setError('');
  }catch(error){setError(error.message);}
 }
 useAssistantCommands('device-control-workstation',{
  device_apply_changes:async()=>{
   if(!dirty)return {ok:false,message:'当前没有待应用的设备修改'};
   const failure=workstationSettingsError(workstation.devices,draft)||await onSave(draft)||'';
   if(failure){setError(failure);return {ok:false,message:failure};}
   return {ok:true,message:'已应用设备修改'};
  },
 });
 const primaryBinding=bindings?.find(binding=>['base','body'].includes(binding.role));
 return <form className="device-control" aria-label="设备控制" onSubmit={async event=>{
  event.preventDefault();
  setError(workstationSettingsError(workstation.devices,draft)||await onSave(draft)||'');
 }}>
  <PageHeader title="设备控制" breadcrumb={<span title={workstation.name}>{workstation.fileName??workstation.name}</span>}
   actions={<SceneActions dirty={dirty} loading={loading} onImport={onImport}/>}/>
  {sceneStatus&&<p role="status" className="dc-workstation-status">{sceneStatus}</p>}
  <div className="dc-workspace" inert={loading}>
   <aside className="dc-list" aria-label="设备列表">
     <h2>场景设备 <small>{profiles.length} 台</small><button type="button" className="btn" aria-expanded={adding}
      onClick={()=>setAdding(!adding)}><Plus size={14}/>新建设备</button></h2>
     {adding&&<div className="dc-add-device">
      <label>设备类型 <select value={newKind} onChange={event=>setNewKind(event.target.value)}>
       <option value="robot">焊接机器人</option><option value="coarse">粗定位相机</option><option value="precision">精定位相机</option>
      </select></label>
      {newKind==='precision'&&<>
       <label>精定位相机品牌 <select value={newBrand} onChange={event=>setNewBrand(event.target.value)}>
        {cameraTypes.map(([key,label])=><option key={key} value={key}>{PRECISION_CAMERA_BRANDS.find(([brand])=>brand===key)[1]} · {label}</option>)}
       </select></label>
       <label>安装机械臂 <select value={targetRobot} onChange={event=>setTargetRobot(event.target.value)}>
        {profiles.filter(device=>robotIds.includes(device.id)).map(device=><option key={device.id} value={device.id}>{device.label}</option>)}
       </select></label>
      </>}
      <button className="btn primary" type="button" onClick={addDevice}>添加设备</button>
     </div>}
     <div>{profiles.map(item=><DeviceCard key={item.id} id={item.id} label={item.label}
      model={[item.configuration.brand,item.configuration.model].filter(Boolean).join(' · ')} robot={item.kind==='robot'}
      enabled={item.kind==='robot'&&robotIds.length>1?activeIds.includes(item.id):undefined}
      Icon={item.kind==='robot'?Workflow:Camera}
      selected={profile.id===item.id} laser={item.precisionBrand==='yinglai'} onSelect={setSelected}/>)}</div>
   </aside>
   <section className="dc-main" aria-label={label+'控制'}>
    {kind==='robot'?<RobotPanel device={device} patch={patch} laserAvailable={laserAvailable}/>:
     kind==='coarse'?<CoarsePanel device={device} patch={patch}/>:
     laser||structured?<PrecisionPanel key={profile.id} device={device} patch={patch} laser={laser} workstation={laser&&!configured}
      structuredLightInstalled={structuredInstalled} laserMountSide={laserAvailable?DEFAULT_LASER_MOUNT_SIDE:undefined}
      coverOpen={coverOpen} onCoverChange={onCoverChange} fieldOfView={fieldOfView} onFieldOfViewChange={onFieldOfViewChange}/>:
     <Connection kind="相机" device={device} patch={patch}/>}
   </section>
   <aside className="dc-details" aria-label="设备详情">
    <Group title="场景标注">
     <Row label="品牌"><span>{device.brand||'—'}</span></Row>
     <Row label="型号"><span>{device.model||'—'}</span></Row>
     <Row label="设备编号"><span>{profile.id}</span></Row>
     {primaryBinding&&<Row label="模型绑定"><span>{[primaryBinding.link,primaryBinding.visual].filter(Boolean).join(' / ')}</span></Row>}
     {configured&&(!structured||!profile.robotId)&&<Row label="模型绑定"><span>未绑定到场景</span></Row>}
     {properties?.filter(property=>scenePropertyLabels[property.name]).map(property=><Row key={property.name} label={scenePropertyLabels[property.name]}>
      <span>{property.value}{property.unit==='deg'?'°':property.unit&&' '+property.unit}</span>
     </Row>)}
    </Group>
    {kind==='robot'&&<><RobotDetails workstation={!configured} device={device} patch={patch}/>
     {!configured&&robotIds.length>1&&<Group title="工艺规划"><Row label="机械臂生效">
      <label className="dc-choice"><input type="checkbox" checked={activeIds.includes(selected)}
       disabled={activeIds.length===1&&activeIds.includes(selected)} onChange={event=>{
        const enabled=event.target.checked;
        setDraft(previous=>({...previous,enabledRobotIds:enabled?[...activeIds,selected]:activeIds.filter(id=>id!==selected)}));
       }}/>参与工艺规划</label>
     </Row></Group>}
    </>}
    {laser&&<Group title="连接参数">
     <InputRow label="设备 ID" value={device.id} onChange={id=>patch({id})} numeric min={0} step={1}/>
     <InputRow label="相机IP地址" value={device.address} onChange={address=>patch({address})} maxLength={255}/>
     <InputRow label="相机端口" value={device.port} onChange={port=>patch({port})} numeric min={1} max={65535} step={1}/>
    </Group>}
    {kind==='coarse'&&<button type="button" className="btn" disabled={draft.coarseCameraId===profile.id}
     onClick={()=>setDraft(previous=>({...previous,coarseCameraId:profile.id}))}>设为当前粗定位相机</button>}
    {(configured||kind==='precision'||kind==='coarse')&&<button type="button" className="btn" onClick={()=>{
     setDraft(previous=>removeWorkstationDevice(workstation.devices,previous,profile.id));
     setSelected(robotIds[0]);setError('');
    }}>移除设备</button>}
   </aside>
  </div>
  {error&&<p className="dc-error" role="alert">{error}</p>}
  {dirty&&<div className="dc-edit-actions"><button type="submit" className="btn primary">应用设备修改</button></div>}
 </form>;
}
