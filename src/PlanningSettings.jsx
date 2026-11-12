import React,{useState} from 'react';
import WeldTrackingSettings from './WeldTrackingSettings';
import {DEFAULT_INTERFERENCE_ANGLE,DEFAULT_INTERFERENCE_DISTANCE,INTERFERENCE_END_FIELDS,mergeIncludedAngleRange,planningSettingsErrors} from './planningConfiguration.mjs';
import {MIXED_SCAN_FIELDS,POSE_AXES,OFFSET_AXES,settingsDefaults,serializeSettings,SETTINGS_TABS,useCaseSettingsErrors} from './planningSettingsModel.mjs';

function Switch({label,value,onChange,disabled=false}){return <div className="planning-setting-row" role="group" aria-label={label}><span>{label}</span><div className="planning-radio-pair">{[[true,'启用'],[false,'禁用']].map(([state,text])=><label key={text}><input type="radio" name={label} disabled={disabled} checked={value===state} onChange={()=>onChange(state)}/>{text}</label>)}</div></div>;}
function NumberField({label,inputLabel=label,value,onChange,unit='mm',integer=false,disabled=false,placeholder='请输入',min=0,max,step,diagram}){return <label className="planning-setting-row"><span>{label}</span><span className={diagram?'planning-number-with-diagram':undefined}><span className="planning-value"><input aria-label={inputLabel} type="number" min={min} max={max} step={step??(integer?1:unit==='mm'?.1:'any')} disabled={disabled} placeholder={placeholder} value={value??''} onChange={event=>onChange(event.target.value)}/>{unit&&<small>{unit}</small>}</span>{diagram&&<img src={diagram} alt={inputLabel+'示意图'}/>}</span></label>;}
function NumberGroup({label,value,onChange,fields}) {
 return <fieldset className="planning-setting-fields planning-number-group"><legend>{label}</legend>
  <div className="planning-number-group-grid">{fields.map(([key,name,props])=><NumberField key={key} label={name} inputLabel={label+name} value={value[key]} onChange={number=>onChange({...value,[key]:number})} {...props}/>)}</div>
 </fieldset>;
}

const angleFields=POSE_AXES.map(([key,label])=>[key,label,{unit:'°',min:-360,max:360,placeholder:'按项目填写'}]);
const offsetFields=OFFSET_AXES.map(axis=>[axis,axis.toUpperCase(),{integer:true}]);
const calibrationFields=[...offsetFields.map(([axis,label])=>[axis,label,{min:null,step:'any'}]),...angleFields];

export default function PlanningSettings({settings={},capabilities={},onSave,onCancel}){
 const [tab,setTab]=useState(SETTINGS_TABS[0][0]),[error,setError]=useState('');
 const [draft,setDraft]=useState(()=>{const next=settingsDefaults({...settings,topologyVersion:1},capabilities),range=mergeIncludedAngleRange(settings.mergeParameters);for(const key of ['angleMin','angleMax'])if(range[key]!=='')next.mergeParameters[key]=range[key];return next;});
 const change=(group,key,value)=>{setDraft(previous=>({...previous,[group]:{...previous[group],[key]:value}}));setError('');};
 const action=draft.actionParameters,wrap=draft.wrapParameters,merge=draft.mergeParameters;
 const changeLeg=(kind,key,value)=>change('actionParameters','defaultLegs',{
  ...action.defaultLegs,[kind]:{...action.defaultLegs[kind],[key]:value}
 });
 const field=(group,key,label,props={})=><NumberField label={label} value={draft[group][key]} onChange={value=>change(group,key,value)} {...props}/>;
 const group=(section,key,label,fields)=><NumberGroup label={label} value={draft[section][key]} onChange={value=>change(section,key,value)} fields={fields}/>;
 function save(event){event.preventDefault();const next=serializeSettings(draft,capabilities);const issues=[...planningSettingsErrors(next),...useCaseSettingsErrors(next,capabilities)];if(issues.length){setError([...new Set(issues)].join('；'));return;}setError(onSave(next)||'');}
 return <form className="planning-settings-form" noValidate onSubmit={save}><div className="planning-settings-layout"><nav className="planning-settings-nav" aria-label="工艺规划设置分类">{SETTINGS_TABS.map(([key,label])=><button type="button" key={key} className={tab===key?'active':''} aria-current={tab===key?'page':undefined} onClick={()=>{setTab(key);setError('');}}>{label}</button>)}</nav><div className="dialog-body planning-settings" key={tab}>
 {tab==='action'&&<section aria-label="全局工艺参数">
  <h3>全局工艺参数</h3>
  {[['flat','平角焊'],['vertical','立焊']].map(([kind,label])=>{
   const leg=action.defaultLegs[kind],name=label+'默认焊脚高度';
   return <fieldset className="planning-setting-fields" key={kind}>
    <Switch label={name} value={leg.enabled} onChange={value=>changeLeg(kind,'enabled',value)}/>
    <NumberField label={name} value={leg.height} min={.5} step={.5} disabled={!leg.enabled} onChange={value=>changeLeg(kind,'height',value)}/>
   </fieldset>;
  })}
 </section>}
 {tab==='topology'&&<section aria-label="拓扑调整">
  <h3>合并</h3>
  {field('mergeParameters','flatContactGap','平角焊焊缝相接最小间隙',{placeholder:'默认0'})}
  {field('mergeParameters','verticalContactGap','立焊焊缝相接最小间隙',{placeholder:'默认0'})}
  <fieldset className="planning-setting-fields planning-subgroup">
   <legend>自由板端合并</legend>
   <Switch label="平角焊合并（L/U形包角）" value={wrap.flatEnabled} onChange={value=>change('wrapParameters','flatEnabled',value)}/>
   <fieldset className="planning-setting-fields" disabled={!wrap.flatEnabled}>
    {field('wrapParameters','independentLength','独立焊缝长度',{min:.1,placeholder:'默认30'})}
    {field('wrapParameters','passHoleThreshold','过焊孔阈值',{min:1,integer:true,diagram:'/assets/wrap-pass-hole-threshold.png'})}
    {field('wrapParameters','outerClearance','外角最小空间',{placeholder:'默认0'})}
   </fieldset>
   <Switch label="立焊合并（立焊上包角）" value={wrap.verticalEnabled} onChange={value=>change('wrapParameters','verticalEnabled',value)}/>
  </fieldset>
  <fieldset className="planning-setting-fields planning-subgroup">
   <legend>相接板端合并（转角）</legend>
   <Switch label="相接板端合并" value={merge.enabled} onChange={value=>change('mergeParameters','enabled',value)}/>
   <fieldset className="planning-setting-fields" disabled={!merge.enabled}>
    <Switch label="合并角度范围" value={merge.angleEnabled} onChange={value=>change('mergeParameters','angleEnabled',value)}/>
    <div className="planning-angle-range">
     {field('mergeParameters','angleMin','最小合并内夹角',{unit:'°',max:360,disabled:!merge.angleEnabled})}
     {field('mergeParameters','angleMax','最大合并内夹角',{unit:'°',max:360,disabled:!merge.angleEnabled})}
    </div>
    <Switch label="最大合并槽隙" value={merge.grooveEnabled} onChange={value=>change('mergeParameters','grooveEnabled',value)}/>
    {field('mergeParameters','gapThreshold','最大合并槽隙',{disabled:!merge.grooveEnabled,placeholder:'默认10',step:'any',diagram:'/assets/merge-gap-threshold.png'})}
   </fieldset>
  </fieldset>
  <h3 className="planning-section-heading">打断</h3>
  {field('splitParameters','gapThreshold','间隙打断阈值',{placeholder:'根据实际焊枪大小填写',diagram:'/assets/weld-gap-threshold.png'})}
 </section>}
 {tab==='path'&&<section aria-label="路径">
  <h3>基础路径生成</h3>
  {group('actionParameters','flatPose','平角焊标准焊接姿态',angleFields)}
  {group('actionParameters','verticalPose','立焊标准焊接姿态',angleFields)}
  {field('actionParameters','lineStep','直线步长',{integer:true,min:1,placeholder:'默认5'})}
  {field('actionParameters','arcStep','圆弧步长',{integer:true,min:1,placeholder:'默认2'})}
  <h3 className="planning-section-heading">包角路径生成</h3>
  <fieldset className="planning-setting-fields planning-subgroup" disabled={!wrap.flatEnabled}>
   <legend>平角焊包角</legend>
   {group('wrapParameters','flatLPose','L形包角控制姿态',angleFields)}
   <label className="planning-setting-row"><span>L形包角距离</span><select aria-label="L形包角距离" value={wrap.lDistanceRatio} onChange={event=>change('wrapParameters','lDistanceRatio',event.target.value)}><option value="1/2">1/2板厚</option><option value="2/3">2/3板厚</option></select></label>
   <img className="planning-wrap-distance-diagram" src="/assets/l-wrap-distance.png" alt="L形包角距离示意图" width={572} height={750}/>
   {group('wrapParameters','uPose','U形包角控制姿态',angleFields)}
  </fieldset>
  <fieldset className="planning-setting-fields planning-subgroup" disabled={!wrap.verticalEnabled}>
   <legend>立焊上包角</legend>
   {group('wrapParameters','verticalLPose','立焊上包角控制姿态',angleFields)}
   {field('wrapParameters','verticalDistance','立焊上包角距离',{min:.1,placeholder:'留空沿用板厚比例'})}
  </fieldset>
  <h3 className="planning-section-heading">转角路径生成</h3>
  {field('cornerPathParameters','before','默认转角前距离',{placeholder:'默认30'})}
  {field('cornerPathParameters','after','默认转角后距离',{placeholder:'默认30'})}
  {field('cornerPathParameters','offset','默认转角点偏移',{min:null,step:'any',placeholder:'默认0'})}
  <h3 className="planning-section-heading">端点姿态调整</h3>
  <div className="planning-endpoint-columns">{[['start','平角焊起点'],['end','平角焊终点']].map(([side,heading])=><fieldset key={side}>
   <legend>{heading}</legend>
   {INTERFERENCE_END_FIELDS.map(([key,label,unit])=>{
    const angle=key==='Angle',distance=key==='Distance';
    const name=angle?'前进角姿态':label;
    return <NumberField key={key} label={name} inputLabel={heading+name} value={draft.interferenceEndParameters[side+key]}
     onChange={value=>change('interferenceEndParameters',side+key,value)} unit={unit} min={angle?-360:distance?0:null}
     max={angle?360:undefined} step={distance?.1:'any'}
     diagram={'/assets/flat-interference-'+side+'-'+key.toLowerCase()+'.png'}
     placeholder={'默认'+(angle?DEFAULT_INTERFERENCE_ANGLE:distance?DEFAULT_INTERFERENCE_DISTANCE:0)}/>;
   })}
  </fieldset>)}</div>
  {field('interferenceEndParameters','verticalStartDistance','立焊起点变姿态距离',{placeholder:'默认20',diagram:'/assets/vertical-start-transition-v2.png'})}
  <h3 className="planning-section-heading">碰撞检测</h3>
  <Switch label="碰撞打断" value={draft.splitParameters.autoDeleteUnavoidable} onChange={value=>change('splitParameters','autoDeleteUnavoidable',value)}/>
  <h3 className="planning-section-heading">安全点生成</h3>
  {group('actionParameters','safeTransitionOffset','安全过渡点偏移',offsetFields)}
  {group('actionParameters','safeApproachOffset','安全接近点偏移',offsetFields)}
 </section>}
 {tab==='measurement'&&<>
 <section aria-label="混合焊缝扫描配置"><h3>混合焊缝扫描配置</h3>{MIXED_SCAN_FIELDS.map(([key,label])=><NumberField key={key} label={label} step="any" value={draft.precisionParameters.mixedScan[key]} onChange={value=>change('precisionParameters','mixedScan',{...draft.precisionParameters.mixedScan,[key]:value})}/>)}
  {group('precisionParameters','laserPose','线激光标准姿态',calibrationFields)}
  {group('precisionParameters','structuredLightPose','结构光标准姿态',calibrationFields)}
  {field('precisionParameters','lineSweepSpeed','直线推扫速度',{unit:'mm/min',step:'any',placeholder:'默认150'})}
  {field('precisionParameters','arcSweepSpeed','圆弧推扫速度',{unit:'mm/min',step:'any',placeholder:'默认70'})}
 </section>
 <section aria-label="视觉设置"><h3>视觉设置</h3>
  {group('visionParameters','sweepPose','推扫标准姿态',angleFields)}
  {group('visionParameters','photoPose','定点拍照标准姿态',angleFields)}
  {field('visionParameters','twoFaceSpeed','两面交推扫速度',{unit:'mm/min',step:'any',placeholder:'按项目填写'})}
  {field('visionParameters','threeFaceSpeed','三面交推扫速度',{unit:'mm/min',step:'any',placeholder:'按项目填写'})}
 </section>
 </>}
 {tab==='tracking'&&<section aria-label="跟踪设置"><h3>跟踪设置</h3><WeldTrackingSettings showHeading={false} capabilities={capabilities} value={draft.trackingParameters} onChange={value=>setDraft(previous=>({...previous,trackingParameters:value}))}/></section>}
 </div></div>{error&&<p role="alert" className="tpl-errors planning-settings-error">{error}</p>}<footer><button type="button" className="btn" onClick={onCancel}>取消</button><button type="submit" className="btn primary">保存</button></footer></form>;
}
