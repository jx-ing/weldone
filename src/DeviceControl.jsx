import React,{useState} from 'react';
import {Camera,Workflow} from 'lucide-react';
import {DEVICE_TRACKING_MODES,PRECISION_CAMERA_BRANDS,deviceControlError} from './deviceControlModel.mjs';
import './deviceControl.css';

const devices=[['robot','焊接机器人',Workflow],['coarseCamera','粗定位相机',Camera],['precisionCamera','精定位相机',Camera]];

function Group({title,children}){
 return <section className="dc-group" aria-label={title}><h3>{title}</h3>{children}</section>;
}
function Row({label,children}){
 return <div className="dc-row"><span>{label}</span><div className="dc-value">{children}</div></div>;
}
function Commands({names}){
 return <div className="dc-commands">{names.map(name=><button key={name} type="button" className="btn" disabled>{name}</button>)}</div>;
}
function InputRow({label,value,onChange,numeric=false,min,max,step='any',unit,maxLength=80,disabled=false,placeholder}){
 return <Row label={label}><span className="dc-input">
  <input aria-label={label} type={numeric?'number':'text'} min={min} max={max} step={numeric?step:undefined}
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
function RobotPanel({device,patch}){
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
     {DEVICE_TRACKING_MODES.map(([mode,label])=><label key={mode}><input type="checkbox" checked={checked(mode)}
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
    <div className="dc-empty"><img src="/assets/empty-data.svg" alt=""/><p>暂无扫描数据</p></div>
   </div>
  </Group>
 </>;
}
function PrecisionPanel({device,patch,laser}){
 if(!laser)return <>
  <Connection kind="相机" device={device} patch={patch}/>
  <Group title="其他位置"><Row label="保护盖"><Commands names={['开启','关闭']}/></Row></Group>
 </>;
 return <>
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
function RobotDetails({device,patch}){
 return <>
  <Group title="程序信息">
   {['主程序状态','当前子程序名称','当前子程序状态'].map(label=><Row key={label} label={label}><span className="dc-muted">—</span></Row>)}
  </Group>
  <Group title="设备信息">
   <details open><summary>机器人详情</summary>
    <InputRow label="机械臂型号" value={device.model} onChange={model=>patch({model})}/>
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
function CameraDetails({device,patch,precision,brand,onBrand,laser}){
 return <Group title="设备信息">
  <details open><summary>相机详情</summary>
   {precision?<Row label="品牌"><select aria-label="相机品牌" value={brand} onChange={event=>onBrand(event.target.value)}>
    {PRECISION_CAMERA_BRANDS.map(([key,label])=><option key={key} value={key}>{label}</option>)}
   </select></Row>:<InputRow label="相机品牌" value={device.brand} onChange={brand=>patch({brand})}/>}
   <InputRow label="相机型号" value={device.model} onChange={model=>patch({model})}/>
   {laser&&<>
    <InputRow label="设备 ID" value={device.id} onChange={id=>patch({id})} numeric min={0} step={1}/>
    <InputRow label="相机IP地址" value={device.address} onChange={address=>patch({address})} maxLength={255}/>
    <InputRow label="相机端口" value={device.port} onChange={port=>patch({port})} numeric min={1} max={65535} step={1}/>
   </>}
  </details>
 </Group>;
}
function DeviceCard({id,label,Icon,selected,laser,onSelect}){
 const fields=id==='robot'?['运行状态','运行模式','运行倍率']:id==='precisionCamera'&&!laser?['保护盖','相机温度']:[];
 return <button type="button" className={'dc-card'+(selected?' active':'')} aria-pressed={selected} aria-label={label} onClick={()=>onSelect(id)}>
  <strong><Icon size={16}/>{label}</strong>
  <span className="dc-card-status">
   <span><small>设备状态</small><b>{laser?'未初始化':'未连接'}</b></span>
   {fields.map(field=><span key={field}><small>{field}</small><b>—</b></span>)}
  </span>
 </button>;
}

export default function DeviceControl({value,onSave}){
 const [draft,setDraft]=useState(()=>structuredClone(value)),[selected,setSelected]=useState('robot'),[error,setError]=useState('');
 const precision=selected==='precisionCamera',robot=selected==='robot';
 const {brand,profiles}=draft.precisionCamera,laser=precision&&brand==='yinglai';
 const device=precision?profiles[brand]:draft[selected];
 const dirty=JSON.stringify(draft)!==JSON.stringify(value);
 function patch(values){
  setDraft(previous=>precision?{
   ...previous,precisionCamera:{...previous.precisionCamera,profiles:{...previous.precisionCamera.profiles,[brand]:{...previous.precisionCamera.profiles[brand],...values}}}
  }:{...previous,[selected]:{...previous[selected],...values}});
  setError('');
 }
 function chooseBrand(brand){
  setDraft(previous=>({...previous,precisionCamera:{...previous.precisionCamera,brand}}));setError('');
 }
 function save(event){
  event.preventDefault();
  setError(deviceControlError(draft)||onSave(draft)||'');
 }
 return <form className="device-control" aria-label="设备控制" onSubmit={save}>
  <header className="dc-header">
   <h1>设备控制</h1>
   <div><span>{dirty?'有未保存修改':'设备通讯未接入'}</span>
    <button className="btn primary" type="submit" disabled={!dirty}>保存设备配置</button>
   </div>
  </header>
  <div className="dc-workspace">
   <aside className="dc-list" aria-label="设备列表">
    <h2>设备列表</h2>
    <div>{devices.map(([id,label,Icon])=><DeviceCard key={id} id={id} label={label} Icon={Icon} selected={selected===id}
     laser={id==='precisionCamera'&&brand==='yinglai'} onSelect={setSelected}/>)}</div>
   </aside>
   <section className="dc-main" aria-label={robot?'焊接机器人控制':precision?'精定位相机控制':'粗定位相机控制'}>
    {robot?<RobotPanel device={device} patch={patch}/>:precision?<PrecisionPanel device={device} patch={patch} laser={laser}/>:<CoarsePanel device={device} patch={patch}/>}
   </section>
   <aside className="dc-details" aria-label="设备详情">
    {robot?<RobotDetails device={device} patch={patch}/>:<CameraDetails device={device} patch={patch} precision={precision} brand={brand} onBrand={chooseBrand} laser={laser}/>}
   </aside>
  </div>
  {error&&<p className="dc-error" role="alert">{error}</p>}
 </form>;
}
