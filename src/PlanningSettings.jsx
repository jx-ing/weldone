import React,{useId,useLayoutEffect,useRef,useState} from 'react';
import {ChevronDown, SlidersHorizontal, Combine, Route, Radio, ScanLine} from 'lucide-react';
import WeldTrackingSettings from './WeldTrackingSettings';
import WeldPoseHelp from './WeldPoseHelp';
import {DEFAULT_INTERFERENCE_ANGLE,DEFAULT_INTERFERENCE_DISTANCE,INTERFERENCE_END_FIELDS,mergeIncludedAngleRange,planningSettingsIssues} from './planningConfiguration.mjs';
import {MIXED_SCAN_FIELDS,POSE_AXES,OFFSET_AXES,settingsDefaults,serializeSettings,SETTINGS_TABS,useCaseSettingsIssues} from './planningSettingsModel.mjs';

function FieldError({id,error}) {
 return error&&<span id={id} className="planning-field-error">{error}</span>;
}
function Switch({label,groupLabel=label,value,onChange,disabled=false,fieldId,error}) {
 const id=useId();
 return <div className="planning-setting-row" role="group" aria-label={groupLabel} aria-describedby={error?id:undefined}>
  <span>{label}</span>
  <div className="planning-radio-pair">
   {[[true,'启用'],[false,'禁用']].map(([state,text])=><label key={text}>
    <input type="radio" name={id} data-setting-field={fieldId} disabled={disabled} checked={value===state} aria-invalid={error?true:undefined} aria-describedby={error?id:undefined} onChange={()=>onChange(state)}/>{text}
   </label>)}
   <FieldError id={id} error={error}/>
  </div>
 </div>;
}
function Diagram({src,label,description}) {
 return <details className="planning-diagram">
  <summary aria-label={'查看'+label+'示意图'}><img className="planning-diagram-thumbnail" src={src} alt=""/><span>查看示意图</span></summary>
  <figure>
   <img src={src} alt={label+'示意图'}/>
   <figcaption>{description}</figcaption>
  </figure>
 </details>;
}
function NumberField({label,inputLabel=label,value,onChange,unit='mm',integer=false,disabled=false,inactiveText,placeholder='请输入',min=0,max,step,diagram,description,fieldId,error}) {
 const id=useId();
 return <div className="planning-setting-row">
  <label htmlFor={id}>{label}</label>
  <div className="planning-field-control">
   {disabled&&inactiveText?<span className="planning-inactive-value">{inactiveText}</span>:<span className="planning-value">
    <input id={id} data-setting-field={fieldId} aria-label={inputLabel} aria-invalid={error?true:undefined} aria-describedby={error?id+'-error':undefined} type="number" min={min??undefined} max={max} step={step??(integer?1:unit==='mm'?.1:'any')} disabled={disabled} placeholder={placeholder} value={value??''} onChange={event=>onChange(event.target.value)}/>
    {unit&&<small>{unit}</small>}
   </span>}
   <FieldError id={id+'-error'} error={error}/>
   {diagram&&<Diagram src={diagram} label={inputLabel} description={description}/>}
  </div>
 </div>;
}
function NumberGroup({label,value,onChange,fields,fieldProps}) {
 return <fieldset className="planning-setting-fields planning-number-group"><legend>{label}</legend>
  <div className="planning-number-group-grid">{fields.map(([key,name,props])=><NumberField key={key} label={name} inputLabel={label+name} value={value[key]} onChange={number=>onChange({...value,[key]:number})} {...props} {...fieldProps(key)}/>)}</div>
 </fieldset>;
}

const angleFields=POSE_AXES.map(([key,label])=>[key,label,{unit:'°',min:-360,max:360,placeholder:'按项目填写'}]);
const offsetFields=OFFSET_AXES.map(axis=>[axis,axis.toUpperCase(),{integer:true}]);
const calibrationFields=[...offsetFields.map(([axis,label])=>[axis,label,{min:null,step:'any'}]),...angleFields];

const navIcons={action:SlidersHorizontal,topology:Combine,path:Route,tracking:Radio,measurement:ScanLine};
const navGroups={action:'基础参数',path:'路径规则',tracking:'感知与跟踪',measurement:'感知与跟踪'};
const pathSections=[
 ['path-basic','基础路径设置'],
 ['path-wrap','包角路径设置'],
 ['path-corner','转角路径生成'],
 ['path-endpoints','端点姿态调整'],
 ['path-collision','碰撞检测'],
 ['path-safe-points','安全点生成'],
];

export default function PlanningSettings({settings={},capabilities={},hasWelds=false,onSave,onCancel}){
 const [tab,setTab]=useState(SETTINGS_TABS[0][0]),[saveError,setSaveError]=useState('');
 const [validationShown,setValidationShown]=useState(false),[focusIssue,setFocusIssue]=useState(null);
 const [pathExpanded,setPathExpanded]=useState(true),[moreBelow,setMoreBelow]=useState(false);
 const body=useRef(null),content=useRef(null);
 const pathMenuId=useId();
 const activePath=pathSections.find(([key])=>key===tab);
 const selectSection=key=>setTab(key);
 const showLaser=capabilities.laserPrecision!==false,showStructure=capabilities.structuredLightPrecision!==false;
 const showTracking=capabilities.laserTracking!==false||capabilities.arcTracking!==false;
 const visibleTabs=SETTINGS_TABS.filter(([key])=>(key!=='tracking'||showTracking)&&(key!=='measurement'||showLaser||showStructure));
 const [draft,setDraft]=useState(()=>{const next=settingsDefaults({...settings,topologyVersion:1,weldPreprocessing:settings.weldPreprocessing??{},mergeParameters:{...settings.mergeParameters,enabled:true,angleEnabled:true,grooveEnabled:true}}),range=mergeIncludedAngleRange(settings.mergeParameters);for(const key of ['angleMin','angleMax'])if(range[key]!=='')next.mergeParameters[key]=range[key];return next;});
 const change=(group,key,value)=>{setDraft(previous=>({...previous,[group]:{...previous[group],[key]:value}}));setSaveError('');};
 const action=draft.actionParameters,wrap=draft.wrapParameters,merge=draft.mergeParameters;
 const changeLeg=(kind,key,value)=>change('actionParameters','defaultLegs',{
  ...action.defaultLegs,[kind]:{...action.defaultLegs[kind],[key]:value}
 });
 const serialized=serializeSettings(draft);
 const effective=settingsDefaults(serialized,capabilities);
 const issues=[...planningSettingsIssues(effective),...useCaseSettingsIssues(effective,capabilities)];
 const fieldErrors=new Map();
 const unlocated=[];
 function sectionFor(field) {
  const [section,key]=field.split('.');
  switch(section){
   case 'actionParameters':
    if(key==='defaultLegs')return 'action';
    if(['lineStep','arcStep'].includes(key))return 'topology';
    if(['flatPose','verticalPose'].includes(key))return 'path-basic';
    if(['safeTransitionOffset','safeApproachOffset'].includes(key))return 'path-safe-points';
    break;
   case 'weldPreprocessing':return key==='maxWrapPlateThickness'?'path-wrap':'topology';
   case 'mergeParameters':
    if(['angleMin','angleMax','gapThreshold'].includes(key))return 'topology';
    break;
   case 'wrapParameters':
    if(['flatLPose','verticalLPose','uPose','lDistanceRatio','verticalDistance'].includes(key))return 'path-wrap';
    break;
   case 'splitParameters':
    if(key==='autoDeleteUnavoidable')return 'path-collision';
    break;
   case 'cornerPathParameters':return 'path-corner';
   case 'interferenceEndParameters':return 'path-endpoints';
   case 'precisionParameters':return 'measurement';
   case 'trackingParameters':return 'tracking';
  }
  return null;
 }
 const invalidTabs=new Set();
 const defaultValues=settingsDefaults({topologyVersion:1,weldPreprocessing:{}});
 function restoreSection(){
  const sections={
   action:['actionParameters.defaultLegs'],
   topology:['weldPreprocessing.maxHolePlateThickness','weldPreprocessing.minCornerHoleSize','weldPreprocessing.outerClearance','mergeParameters.angleMin','mergeParameters.angleMax','mergeParameters.gapThreshold','actionParameters.lineStep','actionParameters.arcStep'],
   'path-basic':['actionParameters.flatPose','actionParameters.verticalPose'],
   'path-wrap':['weldPreprocessing.maxWrapPlateThickness','wrapParameters.flatLPose','wrapParameters.verticalLPose','wrapParameters.uPose','wrapParameters.lDistanceRatio','wrapParameters.verticalDistance'],
   'path-corner':['cornerPathParameters'],
   'path-endpoints':['interferenceEndParameters'],
   'path-collision':['splitParameters.autoDeleteUnavoidable'],
   'path-safe-points':['actionParameters.safeTransitionOffset','actionParameters.safeApproachOffset'],
   tracking:[...(capabilities.laserTracking!==false?['trackingParameters.laserEnabled','trackingParameters.minLineLength','trackingParameters.minArcDiameter','trackingParameters.minEdgeWidth']:[]),...(capabilities.arcTracking!==false?['trackingParameters.arcEnabled']:[])],
   measurement:[...(showLaser?['precisionParameters.laserPose','precisionParameters.mixedScan','precisionParameters.lineSweepSpeed','precisionParameters.arcSweepSpeed']:[]),...(showStructure?['precisionParameters.structuredLightPose','precisionParameters.structuredLightMixedScan']:[])]
  };
  setDraft(previous=>{
   const next={...previous};
   for(const field of sections[tab]){
    const [group,key]=field.split('.');
    next[group]=key?{...next[group],[key]:defaultValues[group][key]}:{...next[group],...defaultValues[group]};
   }
   return next;
  });
  setSaveError('');
 }
 function jumpToIssue(field){
  const section=sectionFor(field);
  if(!section)return;
  if(pathSections.some(([key])=>key===section))setPathExpanded(true);
  selectSection(section);
  setFocusIssue({tab:section,field});
 }

 if(validationShown)for(const {field,message} of issues){
  const section=sectionFor(field);
  if(!section){unlocated.push(message);continue;}
  invalidTabs.add(section);
  if(!fieldErrors.has(field))fieldErrors.set(field,message);
 }
 const pathHasErrors=pathSections.some(([key])=>invalidTabs.has(key));
 const fieldProps=fieldId=>({fieldId,error:fieldErrors.get(fieldId)});
 const field=(group,key,label,props={})=><NumberField label={label} value={draft[group][key]} onChange={value=>change(group,key,value)} {...props} {...fieldProps(group+'.'+key)}/>;
 const group=(section,key,label,fields)=><NumberGroup label={label} value={draft[section][key]} onChange={value=>change(section,key,value)} fields={fields} fieldProps={axis=>fieldProps(section+'.'+key+'.'+axis)}/>;
 const mixedScan=(key,label)=><fieldset className="planning-setting-fields planning-number-group">
  <legend>{label}混合焊缝扫描配置</legend>
  {MIXED_SCAN_FIELDS.map(([fieldName,name])=><NumberField key={fieldName} label={name} inputLabel={label+name} step="any"
   value={draft.precisionParameters[key][fieldName]} {...fieldProps('precisionParameters.'+key+'.'+fieldName)}
   onChange={value=>change('precisionParameters',key,{...draft.precisionParameters[key],[fieldName]:value})}/>)}
 </fieldset>;
 async function save(event){
  event.preventDefault();
  if(!issues.length){setSaveError(await onSave(serialized)||'');return;}
  setValidationShown(true);
  const orderedTabs=visibleTabs.flatMap(([key])=>key==='path'?pathSections.map(([section])=>section):key);
  const firstTab=orderedTabs.find(key=>issues.some(issue=>sectionFor(issue.field)===key));
  if(firstTab){
   if(pathSections.some(([key])=>key===firstTab))setPathExpanded(true);
   selectSection(firstTab);
   setFocusIssue({tab:firstTab});
  }
 }
 function updateScrollHint(){
  const panel=body.current;
  setMoreBelow(!!panel&&panel.scrollHeight-panel.clientHeight-panel.scrollTop>2);
 }
 useLayoutEffect(()=>{
  const observer=new ResizeObserver(updateScrollHint);
  observer.observe(body.current);
  observer.observe(content.current);
  updateScrollHint();
  return ()=>observer.disconnect();
 },[tab]);
 useLayoutEffect(()=>{
  if(focusIssue?.tab!==tab)return;
  const selector=focusIssue.field?'[data-setting-field="'+focusIssue.field+'"]':'[aria-invalid="true"]';
  const target=body.current.querySelector(selector+':not(:disabled)');
  target?.focus({preventScroll:true});
  target?.closest('.planning-setting-row,.planning-tracking-field')?.scrollIntoView({block:'nearest'});
 },[focusIssue,tab]);
 function navLabel(label,invalid) {
  return <>{label}{invalid&&<span className="planning-nav-error" aria-label="有未修正的错误">!</span>}</>;
 }
 return <form className="planning-settings-form" noValidate onSubmit={save}>
  {!hasWelds&&<p className="planning-settings-state">尚未提取焊缝，可先配置规划规则。</p>}
  <div className="planning-settings-layout">
   <nav className="planning-settings-nav" aria-label="工艺规划设置分类">
    {visibleTabs.map(([key,label],index)=>{
     const Icon=navIcons[key],category=navGroups[key];
     const heading=category&&category!==navGroups[visibleTabs[index-1]?.[0]];
     return <React.Fragment key={key}>{heading&&<span className="planning-nav-heading">{category}</span>}{key==='path'?
     <div className="planning-path-nav" key={key}>
      <button type="button" className={'planning-path-toggle'+(activePath?' has-current':'')} aria-expanded={pathExpanded} aria-controls={pathMenuId} onClick={()=>setPathExpanded(expanded=>!expanded)}>
       <span><Icon size={16} aria-hidden="true"/>{navLabel(label,pathHasErrors)}<small className="planning-path-count">{pathSections.length}</small></span><ChevronDown size={15} aria-hidden="true"/>
      </button>
      <div className="planning-path-children" id={pathMenuId} hidden={!pathExpanded}>
       {pathSections.map(([section,name])=><button type="button" key={section} className={tab===section?'active':''} aria-current={tab===section?'page':undefined} onClick={()=>selectSection(section)}>{navLabel(name,invalidTabs.has(section))}</button>)}
      </div>
     </div>:
     <button type="button" key={key} className={tab===key?'active':''} aria-current={tab===key?'page':undefined} onClick={()=>selectSection(key)}><span><Icon size={16} aria-hidden="true"/>{navLabel(label,invalidTabs.has(key))}</span>{key==='topology'&&<small>焊缝合并与打断</small>}</button>}</React.Fragment>;
    })}
   </nav>
   <div ref={body} className="dialog-body planning-settings" key={tab} onScroll={updateScrollHint}><div ref={content}>
  <div className="planning-restore"><button type="button" className="btn" title="恢复当前分类的默认值，保存后生效" onClick={restoreSection}>恢复本页默认</button></div>
 {tab==='action'&&<section aria-label="全局焊脚设置">
  <h3>全局焊脚设置</h3>
  {[['flat','平角焊',12],['vertical','立焊',10]].map(([kind,label,example])=>{
   const leg=action.defaultLegs[kind],prefix='actionParameters.defaultLegs.'+kind;
   const fixed=leg.mode==='fixed';
   return <fieldset className="planning-setting-fields planning-leg-method" key={kind}>
    <legend>{label}焊脚高度</legend>
    <div className="planning-leg-options">
     {[['coefficient','计算系数','自动计算，焊脚高度 = 零件板厚 × 计算系数'],['fixed','固定数值','焊脚高度采用设置数值']].map(([mode,title,help])=>
      <label key={mode}><input type="radio" name={pathMenuId+'-'+kind} checked={leg.mode===mode} onChange={()=>changeLeg(kind,'mode',mode)}/>
       <span><strong>{title}</strong><small>{help}</small></span>
      </label>)}
    </div>
    {fixed?<NumberField label="焊脚高度" inputLabel={label+'固定焊脚高度'} value={leg.height} min={.5} step={.5} onChange={value=>changeLeg(kind,'height',value)} {...fieldProps(prefix+'.height')}/>:
    <NumberField label="计算系数" inputLabel={label+'焊脚计算系数'} value={leg.coefficient} unit="倍" step="any" onChange={value=>changeLeg(kind,'coefficient',value)} {...fieldProps(prefix+'.coefficient')}/>}
    {!fixed&&Number(leg.coefficient)>0&&<p className="planning-setting-note">例：板厚 {example} mm → 焊脚 {Number((example*leg.coefficient).toFixed(3))} mm</p>}
   </fieldset>;
  })}
 </section>}
 {tab==='topology'&&<section aria-label="拓扑调整">
  <h3>焊缝预处理</h3>
  <p className="planning-setting-note">处理顺序：自动删除 → 自动合并 → 自动打断</p>
  {field('weldPreprocessing','maxHolePlateThickness','过焊孔内允许焊接最大板厚',{step:'any',placeholder:'留空不限制'})}
  {field('weldPreprocessing','minCornerHoleSize','转角合并最小过焊孔尺寸',{step:'any'})}
  {field('weldPreprocessing','outerClearance','外角最小空间',{step:'any'})}
  <fieldset className="planning-setting-fields planning-subgroup"><legend>合并角度范围</legend>
   <div className="planning-angle-range">
    {field('mergeParameters','angleMin','最小合并内夹角',{unit:'°',max:360})}
    {field('mergeParameters','angleMax','最大合并内夹角',{unit:'°',max:360})}
   </div>
  </fieldset>
  {field('mergeParameters','gapThreshold','最大合并槽隙',{step:'any',placeholder:'默认10'})}
  <h3 className="planning-section-heading">路径步长</h3>
   {field('actionParameters','lineStep','直线步长',{integer:true,min:1,placeholder:'默认5'})}
   {field('actionParameters','arcStep','圆弧步长',{integer:true,min:1,placeholder:'默认2'})}
 </section>}
 {activePath&&<section aria-label={activePath[1]}>
  <h3>{activePath[1]}</h3>
  {['path-basic','path-wrap','path-endpoints'].includes(tab)&&<WeldPoseHelp/>}
  {tab==='path-basic'&&<>
   <p className="planning-setting-note">保存后点击一键规划，自动轨迹会按焊接位置使用已填写的标准姿态。</p>
   {group('actionParameters','flatPose','平角焊标准焊接姿态',angleFields)}
   {group('actionParameters','verticalPose','立焊标准焊接姿态',angleFields)}
  </>}
  {tab==='path-wrap'&&<>
   {field('weldPreprocessing','maxWrapPlateThickness','包角最大板厚',{step:'any',placeholder:'留空不限制'})}
   <fieldset className="planning-setting-fields planning-subgroup">
    <legend>平角焊包角</legend>
    {group('wrapParameters','flatLPose','L形包角参考姿态',angleFields)}
    <p className="planning-setting-note">填写左转 90° 时的参考角度。规划时按焊接方向自动判断左右转，包角姿态与主焊段标准姿态的偏差小于 20°。</p>
    <label className="planning-setting-row"><span>L形包角距离</span><select aria-label="L形包角距离" data-setting-field="wrapParameters.lDistanceRatio" aria-invalid={fieldErrors.has('wrapParameters.lDistanceRatio')||undefined} aria-describedby={fieldErrors.has('wrapParameters.lDistanceRatio')?pathMenuId+'-wrap-distance':undefined} value={wrap.lDistanceRatio} onChange={event=>change('wrapParameters','lDistanceRatio',event.target.value)}><option value="1/2">1/2板厚</option><option value="2/3">2/3板厚</option></select></label>
    <FieldError id={pathMenuId+'-wrap-distance'} error={fieldErrors.get('wrapParameters.lDistanceRatio')}/>
    <Diagram src="/assets/l-wrap-distance.png" label="L形包角距离" description="从板端沿包角方向量取延伸距离，按板厚比例计算。"/>
    {group('wrapParameters','uPose','U形包角控制姿态',angleFields)}
   </fieldset>
   <fieldset className="planning-setting-fields planning-subgroup">
    <legend>立焊上包角</legend>
    {group('wrapParameters','verticalLPose','立焊上包角控制姿态',angleFields)}
    {field('wrapParameters','verticalDistance','立焊上包角距离',{min:.1,placeholder:'留空沿用板厚比例'})}
   </fieldset>
  </>}
  {tab==='path-corner'&&<>
   {field('cornerPathParameters','before','默认转角前距离',{placeholder:'默认30'})}
   {field('cornerPathParameters','after','默认转角后距离',{placeholder:'默认30'})}
   {field('cornerPathParameters','offset','默认转角点偏移',{min:null,step:'any',placeholder:'默认0'})}
  </>}
  {tab==='path-endpoints'&&<>
   <div className="planning-endpoint-columns">{[['start','平角焊起点'],['end','平角焊终点']].map(([side,heading])=><fieldset key={side}>
    <legend>{heading}</legend>
    {INTERFERENCE_END_FIELDS.map(([key,label,unit])=>{
     const angle=key==='Angle',distance=key==='Distance';
     const name=angle?'前进角姿态':label;
     return <NumberField key={key} label={name} inputLabel={heading+name} value={draft.interferenceEndParameters[side+key]}
      onChange={value=>change('interferenceEndParameters',side+key,value)} unit={unit} min={angle?-360:distance?0:null}
      max={angle?360:undefined} step={distance?.1:'any'} {...fieldProps('interferenceEndParameters.'+side+key)}
      description={angle?'图中标出端点焊枪前进角的测量方向。':distance?'沿焊缝从端点量取变姿态的过渡距离。':'图中标出焊枪局部轴上的线偏移方向，偏移沿变姿态距离逐步减小。'}
      diagram={'/assets/flat-interference-'+side+'-'+key.toLowerCase()+'.png'}
      placeholder={'默认'+(angle?DEFAULT_INTERFERENCE_ANGLE:distance?DEFAULT_INTERFERENCE_DISTANCE:0)}/>;
    })}
   </fieldset>)}</div>
   {field('interferenceEndParameters','verticalStartDistance','立焊起点变姿态距离',{placeholder:'默认20',diagram:'/assets/vertical-start-transition-v2.png',description:'沿立焊焊缝从起点量取姿态过渡距离。'})}
  </>}
  {tab==='path-collision'&&<>
   <Switch label="碰撞检测打断焊缝" value={draft.splitParameters.autoDeleteUnavoidable} onChange={value=>change('splitParameters','autoDeleteUnavoidable',value)} {...fieldProps('splitParameters.autoDeleteUnavoidable')}/>
  </>}
  {tab==='path-safe-points'&&<>
   {group('actionParameters','safeTransitionOffset','安全过渡点偏移',offsetFields)}
   {group('actionParameters','safeApproachOffset','安全接近点偏移',offsetFields)}
  </>}
 </section>}
 {tab==='measurement'&&<>
 <section aria-label="精定位设置">
  <h3>精定位设置</h3>
  {showLaser&&<fieldset className="planning-setting-fields planning-subgroup">
   <legend>线激光精定位设置</legend>
   {group('precisionParameters','laserPose','线激光标准姿态',calibrationFields)}
   {field('precisionParameters','lineSweepSpeed','直线推扫动作速度',{unit:'mm/min',step:'any',placeholder:'默认150'})}
   {field('precisionParameters','arcSweepSpeed','圆弧推扫动作速度',{unit:'mm/min',step:'any',placeholder:'默认70'})}
   {mixedScan('mixedScan','线激光')}
  </fieldset>}
  {showStructure&&<fieldset className="planning-setting-fields planning-subgroup">
   <legend>结构光精定位设置</legend>
   {group('precisionParameters','structuredLightPose','结构光标准姿态',calibrationFields)}
   {mixedScan('structuredLightMixedScan','结构光')}
  </fieldset>}
 </section>
 </>}
 {tab==='tracking'&&<section aria-label="跟踪设置"><h3>跟踪设置</h3><WeldTrackingSettings showHeading={false} capabilities={capabilities} value={draft.trackingParameters} fieldProps={key=>fieldProps('trackingParameters.'+key)} onChange={value=>setDraft(previous=>({...previous,trackingParameters:value}))}/></section>}
 </div></div></div>
  {validationShown&&fieldErrors.size>0&&<div className="planning-error-summary" aria-label="待修正的设置"><strong>还有 {fieldErrors.size} 项设置需要修正</strong><ul>{[...fieldErrors].map(([field,message])=><li key={field}><button type="button" onClick={()=>jumpToIssue(field)}>{message}</button></li>)}</ul></div>}
  {(saveError||unlocated.length>0)&&<p role="alert" className="tpl-errors planning-settings-error">{saveError||[...new Set(unlocated)].join('；')}</p>}
  <footer><span className="planning-scroll-hint">{moreBelow&&<><ChevronDown size={14} aria-hidden="true"/>向下滚动查看其余设置</>}</span><button type="button" className="btn" onClick={onCancel}>取消</button><button type="submit" className="btn primary">保存</button></footer>
 </form>;
}
