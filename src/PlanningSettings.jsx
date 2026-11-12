import React,{useState} from 'react';
import SamplingAvoidanceSettings from './SamplingAvoidanceSettings';
import WeldTrackingSettings from './WeldTrackingSettings';
import {DEFAULT_INTERFERENCE_ANGLE,DEFAULT_INTERFERENCE_DISTANCE,INTERFERENCE_END_FIELDS,mergeIncludedAngleRange,planningSettingsErrors} from './planningConfiguration.mjs';
import {DEFAULT_LOCAL_MATCH_DISTANCE} from './localTemplateSearch.mjs';
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
const directionFields=OFFSET_AXES.map((axis,index)=>[index,axis.toUpperCase(),{unit:'',min:null,step:'any',placeholder:'留空按默认顺序'}]);

export default function PlanningSettings({settings={},capabilities={},onSave,onCancel}){
 const [tab,setTab]=useState(SETTINGS_TABS[0][0]),[error,setError]=useState('');
 const [draft,setDraft]=useState(()=>{const next=settingsDefaults(settings,capabilities),range=mergeIncludedAngleRange(settings.mergeParameters);for(const key of ['angleMin','angleMax'])if(range[key]!=='')next.mergeParameters[key]=range[key];return next;});
 const change=(group,key,value)=>{setDraft(previous=>({...previous,[group]:{...previous[group],[key]:value}}));setError('');};
 const a=draft.actionParameters,w=draft.wrapParameters,m=draft.mergeParameters;
 const field=(group,key,label,props={})=><NumberField label={label} value={draft[group][key]} onChange={value=>change(group,key,value)} {...props}/>;
 const group=(section,key,label,fields)=><NumberGroup label={label} value={draft[section][key]} onChange={value=>change(section,key,value)} fields={fields}/>;
 function save(event){event.preventDefault();const next=serializeSettings(draft,capabilities);const issues=[...planningSettingsErrors(next),...useCaseSettingsErrors(next,capabilities)];if(issues.length){setError([...new Set(issues)].join('；'));return;}setError(onSave(next)||'');}
 return <form className="planning-settings-form" noValidate onSubmit={save}><div className="planning-settings-layout"><nav className="planning-settings-nav" aria-label="工艺规划设置分类">{SETTINGS_TABS.map(([key,label])=><button type="button" key={key} className={tab===key?'active':''} aria-current={tab===key?'page':undefined} onClick={()=>{setTab(key);setError('');}}>{label}</button>)}</nav><div className="dialog-body planning-settings" key={tab}>
 {tab==='action'&&<section aria-label="全局焊接设置"><h3>全局焊接设置</h3><label className="planning-setting-row"><span>焊脚高度</span><select aria-label="焊脚高度来源" value={a.legMode} onChange={event=>change('actionParameters','legMode',event.target.value)}><option value="thickness">根据板厚计算</option><option value="global">统一输入</option></select></label>{a.legMode==='global'&&field('actionParameters','legHeight','统一焊脚高度',{min:.5,step:.5})}{field('actionParameters','overlapDistance','起终点搭接距离',{integer:true,placeholder:'默认5',diagram:'/assets/weld-end-overlap.png'})}{field('actionParameters','staggerDistance','起点错开距离',{integer:true,placeholder:'默认20',diagram:'/assets/weld-start-stagger.png'})}
  <label className="planning-setting-row"><span>立焊方向</span><select aria-label="立焊方向" value={a.verticalDown?'down':'up'} onChange={event=>change('actionParameters','verticalDown',event.target.value==='down')}><option value="up">立向上（PF）</option><option value="down">立向下（PG）</option></select></label>
  {field('actionParameters','poseStep','焊枪姿态变化步长',{integer:true,min:1,unit:'°',placeholder:'默认10'})}
  {field('actionParameters','lineStep','直线步长',{integer:true,min:1,placeholder:'默认5'})}
  {field('actionParameters','arcStep','圆弧步长',{integer:true,min:1,placeholder:'默认2'})}
  {field('actionParameters','edgeSearchDistance','焊缝边缘检测距离',{integer:true,min:1,placeholder:'默认15'})}
  {field('actionParameters','liftHeight','收下枪高度（旧配置）',{integer:true,placeholder:'默认100'})}
  {field('actionParameters','externalAxisLength','外部轴联动长度',{integer:true,min:1,placeholder:'默认1500'})}
  {group('actionParameters','safeTransitionOffset','安全过渡点偏移',offsetFields)}
  {group('actionParameters','safeApproachOffset','安全接近点偏移',offsetFields)}
  {group('actionParameters','flatPose','平角焊标准姿态',angleFields)}
  {group('actionParameters','verticalPose','立焊标准姿态',angleFields)}
 </section>}
 {tab==='wrap'&&<section aria-label="包角设置"><h3>包角设置</h3><Switch label="平角焊包角" value={w.flatEnabled} onChange={value=>change('wrapParameters','flatEnabled',value)}/><Switch label="立焊包角" value={w.verticalEnabled} onChange={value=>change('wrapParameters','verticalEnabled',value)}/><fieldset className="planning-setting-fields" disabled={!w.flatEnabled&&!w.verticalEnabled}><legend>包角参数</legend><label className="planning-setting-row"><span>L形包角距离</span><select aria-label="L形包角距离" value={w.lDistanceRatio} onChange={event=>change('wrapParameters','lDistanceRatio',event.target.value)}><option value="1/2">1/2板厚</option><option value="2/3">2/3板厚</option></select></label><img className="planning-wrap-distance-diagram" src="/assets/l-wrap-distance.png" alt="L形包角距离示意图" width={572} height={750}/>{field('wrapParameters','passHoleThreshold','过焊孔包角阈值',{integer:true,placeholder:'默认35',diagram:'/assets/wrap-pass-hole-threshold.png'})}{field('wrapParameters','gapThreshold','包角间隙阈值',{integer:true,placeholder:'默认350',diagram:'/assets/weld-gap-threshold.png'})}
  {field('wrapParameters','independentLength','独立焊缝长度',{min:.1,placeholder:'默认30'})}
  {group('wrapParameters','flatLPose','平角焊L形包角姿态',angleFields)}
  {group('wrapParameters','verticalLPose','立焊L形包角姿态',angleFields)}
  {group('wrapParameters','uPose','U形包角中间点姿态',angleFields)}
 </fieldset></section>}
 {tab==='interference'&&<section aria-label="端点干涉设置"><h3>端点干涉设置</h3><div className="planning-endpoint-columns">{[['start','平角焊起点'],['end','平角焊终点']].map(([side,heading])=><fieldset key={side}><legend>{heading}</legend>{INTERFERENCE_END_FIELDS.map(([key,label,unit])=>{const angle=key==='Angle';return <NumberField key={key} label={label} inputLabel={heading+label} diagram={'/assets/flat-interference-'+side+'-'+key.toLowerCase()+'.png'} value={draft.interferenceEndParameters[side+key]} onChange={value=>change('interferenceEndParameters',side+key,value)} unit={unit} min={angle?-360:key==='Distance'?0:null} max={angle?360:undefined} step={key==='Distance'?.1:'any'} placeholder={angle?'默认'+DEFAULT_INTERFERENCE_ANGLE:key==='Distance'?'默认'+DEFAULT_INTERFERENCE_DISTANCE:'默认0'}/>;})}</fieldset>)}</div>{field('interferenceEndParameters','verticalStartDistance','立焊起点变姿态距离',{placeholder:'默认20',diagram:'/assets/vertical-start-transition-v2.png'})}</section>}
 {tab==='precision'&&<section aria-label="混合焊缝扫描配置"><h3>混合焊缝扫描配置</h3>{MIXED_SCAN_FIELDS.map(([key,label])=><NumberField key={key} label={label} step="any" value={draft.precisionParameters.mixedScan[key]} onChange={value=>change('precisionParameters','mixedScan',{...draft.precisionParameters.mixedScan,[key]:value})}/>)}
  {group('precisionParameters','laserPose','线激光标准姿态',calibrationFields)}
  {group('precisionParameters','structuredLightPose','结构光标准姿态',calibrationFields)}
  {field('precisionParameters','lineSweepSpeed','直线推扫速度',{unit:'mm/min',step:'any',placeholder:'默认150'})}
  {field('precisionParameters','arcSweepSpeed','圆弧推扫速度',{unit:'mm/min',step:'any',placeholder:'默认70'})}
 </section>}
 {tab==='vision'&&<section aria-label="视觉设置"><h3>视觉设置</h3>
  {group('visionParameters','sweepPose','推扫标准姿态',angleFields)}
  {group('visionParameters','photoPose','定点拍照标准姿态',angleFields)}
  {field('visionParameters','twoFaceSpeed','两面交推扫速度',{unit:'mm/min',step:'any',placeholder:'按项目填写'})}
  {field('visionParameters','threeFaceSpeed','三面交推扫速度',{unit:'mm/min',step:'any',placeholder:'按项目填写'})}
 </section>}
 {tab==='sampling'&&<section aria-label="采样避障设置"><h3>采样避障设置</h3>
  <Switch label="采样避障总开关" value={draft.samplingAvoidance.enabled} onChange={value=>change('samplingAvoidance','enabled',value)}/>
  <fieldset className="planning-sampling-fields" disabled={!draft.samplingAvoidance.enabled}>
   {field('samplingAvoidance','step','采样角步长',{unit:'°',placeholder:'按项目填写'})}
   <SamplingAvoidanceSettings value={draft.samplingAvoidance} onChange={value=>{setDraft(previous=>({...previous,samplingAvoidance:value}));setError('');}}/>
  </fieldset>
 </section>}
 {tab==='sequence'&&<section aria-label="顺序与匹配设置"><h3>顺序与匹配设置</h3>
  <NumberGroup label="扫描方向" fields={directionFields} value={draft.sequenceParameters?.scanDirection??[]} onChange={value=>change('sequenceParameters','scanDirection',OFFSET_AXES.map((_,index)=>value[index]??''))}/>
  <NumberField label="局部模板匹配距离" value={draft.localMatchDistance} placeholder={'默认'+DEFAULT_LOCAL_MATCH_DISTANCE} min={0} step="any" onChange={value=>{setDraft(previous=>({...previous,localMatchDistance:value}));setError('');}}/>
 </section>}
 {tab==='tracking'&&<section aria-label="跟踪设置"><h3>跟踪设置</h3><WeldTrackingSettings showHeading={false} capabilities={capabilities} value={draft.trackingParameters} onChange={value=>setDraft(previous=>({...previous,trackingParameters:value}))}/></section>}
 {tab==='topology'&&<section aria-label="焊缝合并设置"><h3>焊缝合并设置</h3><Switch label="自动合并" value={m.enabled} onChange={value=>change('mergeParameters','enabled',value)}/><fieldset className="planning-setting-fields" disabled={!m.enabled}><legend>合并参数</legend><label className="planning-setting-row"><span>合并焊接位置</span><select aria-label="合并焊接位置" value="flat-flat" onChange={()=>{}}><option value="flat-flat">平角焊-平角焊</option></select></label><label className="planning-setting-row"><span>合并角度范围</span><span className="planning-angle-range">{['angleMin','angleMax'].map((key,index)=><React.Fragment key={key}>{index>0&&<span>至</span>}<span className="planning-value"><input type="number" aria-label={index?'最大合并内夹角':'最小合并内夹角'} min={0} max={360} step="any" value={m[key]??''} placeholder={index?'max':'min'} onChange={event=>change('mergeParameters',key,event.target.value)}/><small>°</small></span></React.Fragment>)}</span></label>{field('mergeParameters','gapThreshold','合并间隙阈值',{placeholder:'默认10',step:'any',diagram:'/assets/merge-gap-threshold.png'})}
  {field('mergeParameters','passHoleSize','合并过焊孔尺寸',{min:.1,placeholder:'默认15'})}
  <Switch label="合并数量限制" value={m.countEnabled} onChange={value=>change('mergeParameters','countEnabled',value)}/>
  {field('mergeParameters','count','合并数量',{unit:'条',integer:true,min:2,disabled:!m.countEnabled})}
  <Switch label="合并长度限制" value={m.lengthEnabled} onChange={value=>change('mergeParameters','lengthEnabled',value)}/>
  {field('mergeParameters','maxLength','合并长度',{min:.1,disabled:!m.lengthEnabled,placeholder:'默认1500'})}
 </fieldset></section>}
 {tab==='topology'&&<section aria-label="焊缝打断设置"><h3>焊缝打断设置</h3>{field('splitParameters','gapThreshold','间隙打断阈值',{placeholder:'根据实际焊枪大小填写',diagram:'/assets/weld-gap-threshold.png'})}{field('splitParameters','edgeThreshold','边缘打断阈值',{min:.1,placeholder:'留空使用当前焊缝焊脚高度',diagram:'/assets/weld-edge-break-threshold.png'})}<Switch label="自动删除无法避障焊缝" value={draft.splitParameters.autoDeleteUnavoidable} onChange={value=>change('splitParameters','autoDeleteUnavoidable',value)}/></section>}
 </div></div>{error&&<p role="alert" className="tpl-errors planning-settings-error">{error}</p>}<footer><button type="button" className="btn" onClick={onCancel}>取消</button><button type="submit" className="btn primary">保存</button></footer></form>;
}
