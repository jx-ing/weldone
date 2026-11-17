import NumericInput from './NumericInput.jsx';
import React,{useId,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ChevronDown, CircleHelp} from 'lucide-react';
import WeldTrackingSettings from './WeldTrackingSettings';
import {DEFAULT_INTERFERENCE_ANGLE,DEFAULT_INTERFERENCE_DISTANCE,INTERFERENCE_END_FIELDS,L_WRAP_DISTANCES,configuredWrapDistance,hasCustomWrapRatio,mergeIncludedAngleRange,planningSettingsIssues,usesLegacyVerticalWrapDistance,verticalWrapPreset,wrapDistanceRatio} from './planningConfiguration.mjs';
import {MIXED_SCAN_FIELDS,STRUCTURED_LIGHT_SCAN_FIELDS,POSE_AXES,OFFSET_AXES,settingsDefaults,serializeSettings,SETTINGS_TABS,useCaseSettingsIssues} from './planningSettingsModel.mjs';
import {roundWeldLeg} from './planningRequirements.mjs';
import flatWrapGeometry from './flatWrapDiagramGeometry.json';

function FieldError({id,error}) {
 return error&&<span id={id} className="planning-field-error">{error}</span>;
}
function HelpGif({src,label}) {
 const [preview,setPreview]=useState(null),timer=useRef(null),anchor=useRef(null),previewRef=useRef(null);
 function show(){
  clearTimeout(timer.current);
  const rect=anchor.current?.getBoundingClientRect();
  if(!rect)return;
  const width=Math.min(480,window.innerWidth-24),height=width*.6+14;
  const left=rect.right+12+width<=window.innerWidth?rect.right+12:Math.max(12,rect.left-width-12);
  const top=Math.max(12,Math.min(rect.top+rect.height/2-height/2,window.innerHeight-height-12));
  setPreview({left,top,width});
 }
 function scheduleHide(){timer.current=setTimeout(()=>setPreview(null),180);}
 return <>
  <button ref={anchor} type="button" className="planning-help-trigger" aria-label={'查看'+label+'动图说明'} aria-describedby={preview?'help-'+label:undefined}
   onPointerEnter={show} onPointerLeave={scheduleHide} onFocus={show} onBlur={scheduleHide} onClick={show}><CircleHelp size={16} aria-hidden="true"/></button>
  {preview&&createPortal(<div ref={previewRef} id={'help-'+label} role="tooltip" className="planning-help-preview" style={preview}
   onPointerEnter={()=>clearTimeout(timer.current)} onPointerLeave={scheduleHide}>
   <img src={src} alt={label+'动图示意'}/>
  </div>,document.body)}
 </>;
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
function AdvanceAnglePlane({value}) {
 const degrees=value==null||value===''?DEFAULT_INTERFERENCE_ANGLE:Number(value);
 const valid=Number.isFinite(degrees)&&Math.abs(degrees)<=360;
 const centerX=344,centerY=116,radius=47;
 const radians=degrees*Math.PI/180;
 const endX=centerX+radius*Math.sin(radians),endY=centerY-radius*Math.cos(radians);
 const arc=valid&&degrees!==0&&Math.abs(degrees)<360
  ? `M ${centerX} ${centerY-radius} A ${radius} ${radius} 0 ${Math.abs(degrees)>180?1:0} ${degrees>0?1:0} ${endX} ${endY}`
  : null;
 const angleLabel=valid?degrees+'°':'—';
 return <svg className="planning-advance-plane" viewBox="0 0 475 202" role="img" aria-label={'前进角测量平面 '+angleLabel}>
  <rect x=".5" y=".5" width="474" height="201" rx="14" fill="#fff" stroke="#c4d3df"/>
  <text x="22" y="48" fill="#163042" fontSize="24" fontWeight="600">前进角测量平面</text>
  <text x="22" y="118" fill="#6545a5" fontSize="50" fontWeight="700">{angleLabel}</text>
  <path d="M 261 116 H 456 l -9 -5 m 9 5 l -9 5" fill="none" stroke="#8198a8" strokeWidth="2"/>
  <text x="457" y="148" textAnchor="end" fill="#506576" fontSize="18">焊接方向</text>
  <path d="M 344 116 V 45" fill="none" stroke="#8198a8" strokeWidth="2" strokeDasharray="6 4"/>
  <text x="344" y="34" textAnchor="middle" fill="#506576" fontSize="18">0°</text>
  {valid&&<g stroke="#6545a5" strokeWidth="3" fill="none" strokeLinejoin="round">
   {arc&&<path d={arc}/>}
   {Math.abs(degrees)===360&&<circle cx={centerX} cy={centerY} r={radius}/>}
   <g transform={`translate(${centerX} ${centerY}) rotate(${degrees})`}><path d="M 0 0 V -65 m -5 9 l 5 -9 5 9"/></g>
  </g>}
  <circle cx={centerX} cy={centerY} r="4" fill="#6545a5"/>
 </svg>;
}
const displayWrapPercent=ratio=>Number((ratio*100).toFixed(1));
const interpolatePoint=(a,b,ratio)=>a.map((value,index)=>value+(b[index]-value)*ratio);
function WrapRatioGrip({start,end,ratio,onRatioChange,label,radius=7}){
 const drag=useRef(null);
 const [x,y]=interpolatePoint(start,end,ratio);
 function pointerRatio(event){
  const svg=event.currentTarget.ownerSVGElement;
  const transform=svg?.getScreenCTM();
  if(!transform)return null;
  const point=svg.createSVGPoint();
  point.x=event.clientX;point.y=event.clientY;
  const local=point.matrixTransform(transform.inverse());
  const dx=end[0]-start[0],dy=end[1]-start[1];
  return ((local.x-start[0])*dx+(local.y-start[1])*dy)/(dx*dx+dy*dy);
 }
 function setRatio(ratio){onRatioChange(Math.round(Math.max(0,Math.min(1,ratio))*1000)/1000);}
 function pointerDown(event){
  if(event.button!==0||drag.current)return;
  const pointer=pointerRatio(event);
  if(pointer===null)return;
  drag.current={id:event.pointerId,offset:ratio-pointer};
  event.currentTarget.setPointerCapture(event.pointerId);
 }
 function pointerMove(event){
  if(drag.current?.id!==event.pointerId)return;
  const pointer=pointerRatio(event);
  if(pointer!==null)setRatio(pointer+drag.current.offset);
 }
 function pointerEnd(event){if(drag.current?.id===event.pointerId)drag.current=null;}
 function keyboardChange(event){
  const step=event.shiftKey?0.1:0.01;
  const next={ArrowLeft:ratio-step,ArrowDown:ratio-step,ArrowRight:ratio+step,ArrowUp:ratio+step,Home:0,End:1}[event.key];
  if(next===undefined)return;
  event.preventDefault();
  setRatio(next);
 }
 return <g className="planning-wrap-handle" role="slider" tabIndex="0" aria-label={label}
  aria-valuemin={0} aria-valuemax={100} aria-valuenow={displayWrapPercent(ratio)}
  aria-valuetext={displayWrapPercent(ratio)+'% 板厚'}
  onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd}
  onPointerCancel={pointerEnd} onLostPointerCapture={pointerEnd} onKeyDown={keyboardChange}>
  <circle cx={x} cy={y} r={radius+10} fill="transparent"/>
  <circle className="planning-wrap-grip" cx={x} cy={y} r={radius} fill="#fff" stroke="#087e8b" strokeWidth="2"/>
  <path d={`M${x-3} ${y} h6`} stroke="#087e8b" strokeWidth="1.5" pointerEvents="none"/>
 </g>;
}
const WRAP_PREVIEW_THICKNESS=12;
function FlatWrapPath({kind,settings,onRatioChange,graphicRef,posePoint}) {
 const arrow=useId();
 const marker='url(#'+arrow+')';
 const colors={main:'#00786a',wrap:'#ab5b16',measure:'#b98255',leader:'#8198a8'};
 const {size:[width,height],corner,backCorner,entry,entryArrow,backExit,backArrow,measureStart,measureEdge}=flatWrapGeometry;
 const isL=kind==='L';
 const thickness=WRAP_PREVIEW_THICKNESS;
 const baseRatio=isL?wrapDistanceRatio(settings):1;
 const ratio=isL?configuredWrapDistance(thickness,settings,'L')/thickness:1;
 const ratioEnd=interpolatePoint(corner,backCorner,baseRatio);
 const wrapEnd=interpolatePoint(corner,backCorner,ratio);
 const measureEnd=interpolatePoint(measureStart,measureEdge,ratio);
 return <svg ref={graphicRef} className="planning-flat-wrap-graphic" viewBox={`12 10 ${width-24} ${height-20}`} aria-label={kind+'形包角焊接路径'}>
  <desc>{isL?'平角焊经过一个转折点后沿板厚方向包角。':'平角焊依次经过两个转折点，连到板件背侧焊缝。背侧焊缝以虚线显示。'}</desc>
  <image href={'/assets/parameter-help/flat-wrap-'+kind.toLowerCase()+'.png'} width={width} height={height} aria-hidden="true"/>
  <defs><marker id={arrow} markerWidth="14" markerHeight="12" refX="13" refY="6" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M0 0 L14 6 L0 12 Z" fill="context-stroke"/></marker></defs>
  <g fill="none" strokeLinecap="round" strokeLinejoin="round" pointerEvents="none">
   <path d={`M${entry} L${entryArrow} L${corner}`} stroke={colors.main} strokeWidth="6" markerMid={marker}/>
   {isL&&<path d={`M${corner} L${backCorner}`} stroke={colors.leader} strokeWidth="2" strokeDasharray="5 5"/>}
   {baseRatio>0&&<path d={`M${corner} L${ratioEnd}`} stroke={colors.wrap} strokeWidth="6"/>}
   {ratio>baseRatio&&<path d={`M${ratioEnd} L${wrapEnd}`} stroke="#d59c60" strokeWidth="6"/>}
   {isL&&ratio>0&&<path d={`M${corner} L${measureStart} M${wrapEnd} L${measureEnd}`} stroke={colors.measure} strokeWidth="2"/>}
   {isL&&ratio>0&&<path d={`M${measureStart} L${measureEnd}`} stroke={colors.wrap} strokeWidth="2"
    markerStart={ratio>.33?marker:undefined} markerEnd={ratio>.33?marker:undefined}/>}
   {!isL&&<path d={`M${backCorner} L${backArrow} L${backExit}`} stroke={colors.main} strokeWidth="5" strokeDasharray="7 5" markerMid={marker}/>}
   {!isL&&<>
    <path d={`M${backArrow} H145 L128 181 H114`} stroke={colors.leader} strokeWidth="2"/>
    <circle cx={backCorner[0]} cy={backCorner[1]} r="6" fill="#fff" stroke={colors.main} strokeWidth="2.5"/>
    <circle cx={corner[0]} cy={corner[1]} r="6" fill="#fff" stroke={colors.main} strokeWidth="2.5"/>
   </>}
   <circle className="planning-flat-wrap-pose-point" cx={posePoint[0]} cy={posePoint[1]} r="6" fill="#fff"
    stroke={isL?colors.main:colors.wrap} strokeWidth="2.5"/>
  </g>
  <g className="planning-flat-wrap-labels" aria-hidden="true">
   <text x="351" y="241" fill={colors.main} textAnchor="middle">焊接方向</text>
   {!isL&&<text x="107" y="187" textAnchor="end">背侧焊缝</text>}
  </g>
  {isL&&<WrapRatioGrip start={corner} end={backCorner} ratio={ratio} onRatioChange={onRatioChange} radius={10} label="拖动焊缝末端调整板厚比例"/>}
 </svg>;
}
function flatWrapLeader(source,card,origin,placement){
 const x=source.x-origin.left,y=source.y-origin.top;
 const left=card.left-origin.left,top=card.top-origin.top;
 if(placement==='below')return `M${x} ${y} l8 10 V${top}`;
 if(placement==='gutter')return `M${x} ${y} l-8 10 H${left-5} V${top+18} H${left}`;
 const dock=Math.max(top+14,Math.min(y+10,top+card.height-14));
 return `M${x} ${y} l12 12 H${left-18} L${left-7} ${dock} H${left}`;
}
function FlatWrapFigure({kind,settings,onRatioChange,pose,children}){
 const graphic=useRef(null),overlay=useRef(null),poseCard=useRef(null),distanceCard=useRef(null);
 const arrow=useId();
 const [leaders,setLeaders]=useState({pose:'',distance:''});
 const isL=kind==='L';
 const posePoint=isL?flatWrapGeometry.corner:flatWrapGeometry.control;
 const showDistance=isL&&configuredWrapDistance(WRAP_PREVIEW_THICKNESS,settings,'L')>0;
 useLayoutEffect(()=>{
  const art=graphic.current,layer=overlay.current,posePanel=poseCard.current,distancePanel=distanceCard.current;
  function measure(){
   const matrix=art.getScreenCTM();
   if(!matrix)return;
   const origin=layer.getBoundingClientRect();
   const poseBounds=posePanel.getBoundingClientRect();
   const stacked=poseBounds.top>=art.getBoundingClientRect().bottom-1;
   const project=point=>new DOMPoint(...point).matrixTransform(matrix);
   setLeaders({
    pose:flatWrapLeader(project(posePoint),poseBounds,origin,stacked?'below':'side'),
    distance:showDistance?flatWrapLeader(project(flatWrapGeometry.measureStart),distancePanel.getBoundingClientRect(),origin,stacked?'gutter':'side'):'',
   });
  }
  measure();
  const observer=new ResizeObserver(measure);
  for(const element of [art,layer,posePanel,distancePanel])if(element)observer.observe(element);
  return ()=>observer.disconnect();
 },[posePoint,showDistance]);
 return <figure className="planning-flat-wrap-diagram" aria-label={kind+'形包角示意图'}>
  <FlatWrapPath kind={kind} settings={settings} onRatioChange={onRatioChange} graphicRef={graphic} posePoint={posePoint}/>
  <div className="planning-flat-wrap-controls">
   <div ref={poseCard} className="planning-wrap-parameter planning-wrap-pose">{pose}</div>
   {children&&<div ref={distanceCard} className="planning-wrap-parameter planning-wrap-distance">{children}</div>}
  </div>
  <svg ref={overlay} className="planning-flat-wrap-leaders" aria-hidden="true" focusable="false">
   <defs><marker id={arrow} markerWidth="5" markerHeight="5" refX="5" refY="2.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0 L5 2.5 L0 5 Z" fill="context-stroke"/></marker></defs>
   <path d={leaders.pose} className="planning-flat-wrap-pose-leader" markerEnd={'url(#'+arrow+')'}/>
   {leaders.distance&&<path d={leaders.distance} className="planning-flat-wrap-distance-leader" markerEnd={'url(#'+arrow+')'}/>}
  </svg>
 </figure>;
}
function VerticalWrapPath({settings,onRatioChange,className,wide=false}){
 const arrow=useId();
 // Points from the orthographic projection in vertical-upper-wrap-preview.py.
 const locate=([x,y])=>wide?[x+18,y+15]:[x,y];
 const start=locate([242,129.6]),edge=locate([326.4,109.22]);
 const measureStart=locate([326.78,163.13]),measureEdge=locate([411.17,142.75]);
 const thickness=WRAP_PREVIEW_THICKNESS;
 const total=configuredWrapDistance(thickness,settings,'vertical')/thickness;
 const ratio=usesLegacyVerticalWrapDistance(settings)?total:wrapDistanceRatio(settings,'vertical');
 const ratioEnd=interpolatePoint(start,edge,ratio),weldEnd=interpolatePoint(start,edge,total);
 const measureEnd=interpolatePoint(measureStart,measureEdge,total);
 return <svg className={className} viewBox={wide?'0 0 1080 574':'0 0 528 546'} aria-label="立焊上包角路线及板厚调整">
  <image href={'/assets/parameter-help/vertical-upper-wrap'+(wide?'-diagram':'')+'.png'} width={wide?1080:528} height={wide?574:546} aria-hidden="true"/>
  <defs><marker id={arrow} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M0 0 L8 4 L0 8 Z" fill="#ab5b16"/></marker></defs>
  <g fill="none" strokeLinecap="round" pointerEvents="none">
   <path d={`M${start} L${edge}`} stroke="#8198a8" strokeWidth="2" strokeDasharray="5 5"/>
   {ratio>0&&<path d={`M${start} L${ratioEnd}`} stroke="#ab5b16" strokeWidth="6"/>}
   {total>ratio&&<path d={`M${ratioEnd} L${weldEnd}`} stroke="#d59c60" strokeWidth="6"/>}
   {total>0&&<path d={`M${start} L${measureStart} M${weldEnd} L${measureEnd}`} stroke="#b98255" strokeWidth="2"/>}
   {total>.12&&<path d={`M${measureStart} L${measureEnd}`} stroke="#ab5b16" strokeWidth="2.5" markerStart={'url(#'+arrow+')'} markerEnd={'url(#'+arrow+')'}/>}
   {wide&&<path d={`M${measureEnd[0]+9},${measureEnd[1]} H504 L549,382 H568`} stroke="#b98255" strokeWidth="2"/>}
  </g>
  {total>0&&<circle cx={start[0]} cy={start[1]} r="6" fill="white" stroke="#08786a" strokeWidth="2" pointerEvents="none"/>}
  {total>ratio&&<circle cx={weldEnd[0]} cy={weldEnd[1]} r="5" fill="white" stroke="#ab5b16" strokeWidth="2" pointerEvents="none"/>}
  <WrapRatioGrip start={start} end={edge} ratio={ratio} onRatioChange={onRatioChange} radius={10} label="拖动立焊上包角末端调整板厚比例"/>
 </svg>;
}
function CornerPathDiagram({inner=false,field}) {
 const side=inner?'内角':'外角';
 const kind=inner?'inner':'outer';
 return <figure className={'planning-corner-diagram'+(inner?' is-inner':'')} aria-label={side+'转角路径示意图'}>
  <figcaption>转角路径 · {side}</figcaption>
  <div className="planning-corner-canvas">
   <svg viewBox="0 0 520 244" preserveAspectRatio="none" aria-hidden="true">
    <path className="workpiece" d={inner?'M36 134 H250 V25 H381 V147 H36 Z':'M36 134 V25 H250 V134 Z'}/>
    <path className="reference" d="M36 134 H250 V19 M246 25 L250 19 L254 25 M88 130 L94 134 L88 138"/>
    <path className="weld-path" d="M154 134 H250 V50"/>
    <path className="distance" d="M154 142 V167 M250 142 V167 M154 160 H250 M160 157 L154 160 L160 163 M244 157 L250 160 L244 163 M258 50 H291 M258 134 H291 M285 50 V134 M282 56 L285 50 L288 56 M282 128 L285 134 L288 128"/>
    <path className="offset offset-line" d={inner?'M246 130 L200 77':'M254 138 L300 191'}/>
    <path className="offset" d={inner?'M207 80 L200 77 L202 85':'M293 188 L300 191 L298 183'}/>
    <circle className="weld-node" cx="154" cy="134" r="3.6"/><circle className="weld-node" cx="250" cy="50" r="3.6"/>
    <circle className="corner-node" cx="250" cy="134" r="4.4"/>
   </svg>
   <span className="planning-corner-join">入角点</span><span className="planning-corner-exit">出角点</span>
   <span className="planning-corner-point">几何转角</span>
   <div className="planning-corner-callout before">{field(kind,'before','转角前距离',{inputLabel:side+'默认转角前距离',placeholder:'默认30'})}</div>
   <div className="planning-corner-callout after">{field(kind,'after','转角后距离',{inputLabel:side+'默认转角后距离',placeholder:'默认30'})}</div>
   <div className="planning-corner-callout shift">{field(kind,'offset','转角点偏移',{inputLabel:side+'默认转角点偏移',min:null,step:'any',placeholder:'默认0'})}</div>
  </div>
 </figure>;
}
function NumberField({label,inputLabel=label,value,onChange,unit='mm',integer=false,disabled=false,inactiveText,placeholder='请输入',min=0,max,step,helpGif,fieldId,error}) {
 const id=useId();
 return <div className="planning-setting-row">
  <div className="planning-setting-label"><label htmlFor={id}>{label}</label>{helpGif&&<HelpGif src={helpGif} label={label}/>}</div>
  <div className="planning-field-control">
   {disabled&&inactiveText?<span className="planning-inactive-value">{inactiveText}</span>:<span className="planning-value">
    <NumericInput id={id} data-setting-field={fieldId} aria-label={inputLabel} aria-invalid={error?true:undefined} aria-describedby={error?id+'-error':undefined} min={min??undefined} max={max} step={step??(integer?1:unit==='mm'?.1:'any')} disabled={disabled} placeholder={placeholder} value={value??''} onChange={event=>onChange(event.target.value)}/>
    {unit&&<small>{unit}</small>}
   </span>}
   <FieldError id={id+'-error'} error={error}/>
  </div>
 </div>;
}
function NumberGroup({label,inputLabel=label,value,onChange,fields,fieldProps}) {
 return <fieldset className="planning-setting-fields planning-number-group"><legend>{label}</legend>
  <div className="planning-number-group-grid">{fields.map(([key,name,props])=><NumberField key={key} label={name} inputLabel={inputLabel+name} value={value[key]} onChange={number=>onChange({...value,[key]:number})} {...props} {...fieldProps(key)}/>)}</div>
 </fieldset>;
}

const angleFields=POSE_AXES.map(([key,label])=>[key,label,{unit:'°',min:-360,max:360,placeholder:'按项目填写'}]);
const safetyOffsetFields=OFFSET_AXES.map(axis=>[axis,axis.toUpperCase(),{integer:true,unit:''}]);
const flatEndpointFields=['Angle','LineOffset','Distance'].map(key=>INTERFERENCE_END_FIELDS.find(([field])=>field===key));

const navGroups={action:'基础参数',tracking:'视觉设置',measurement:'视觉设置'};
const pathSections=[
 ['path-basic','基础路径设置'],
 ['path-continuous','连续焊接路径设置'],
 ['path-endpoints','端点姿态调整'],
 ['path-collision','碰撞检测'],
 ['path-safe-points','安全过渡点'],
];

function settingsSignature(settings){
 const wrap=settings.wrapParameters;
 const comparable={...settings,wrapParameters:{...wrap,lDistanceCustomRatio:wrap.lDistanceCustomRatio??null,
  verticalDistanceCustomRatio:wrap.verticalDistanceCustomRatio??null,verticalDistanceOffset:wrap.verticalDistanceOffset??0}};
 return JSON.stringify(comparable,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value);
}

export default function PlanningSettings({settings={},capabilities={},hasWelds=false,saving=false,onSave,onCancel}){
 const [tab,setTab]=useState(SETTINGS_TABS[0][0]),[saveError,setSaveError]=useState('');
 const [validationShown,setValidationShown]=useState(false),[focusIssue,setFocusIssue]=useState(null);
 const [pathExpanded,setPathExpanded]=useState(true);
 const body=useRef(null);
 const pathMenuId=useId();
 const activePath=pathSections.find(([key])=>key===tab);
 const selectSection=key=>setTab(key);
 const showLaser=capabilities.laserPrecision!==false,showStructure=capabilities.structuredLightPrecision!==false;
 const showTracking=capabilities.laserTracking!==false||capabilities.arcTracking!==false;
 const visibleTabs=SETTINGS_TABS.filter(([key])=>(key!=='tracking'||showTracking)&&(key!=='measurement'||showLaser||showStructure));
 const [draft,setDraft]=useState(()=>{const next=settingsDefaults({...settings,topologyVersion:1,weldPreprocessing:settings.weldPreprocessing??{},mergeParameters:{...settings.mergeParameters,enabled:true,angleEnabled:true,grooveEnabled:true}}),range=mergeIncludedAngleRange(settings.mergeParameters);for(const key of ['angleMin','angleMax'])if(range[key]!=='')next.mergeParameters[key]=range[key];return next;});
 const [initialSettingsSignature]=useState(()=>settingsSignature(serializeSettings(draft)));
 const change=(group,key,value)=>{setDraft(previous=>({...previous,[group]:{...previous[group],[key]:value}}));setSaveError('');};
 const action=draft.actionParameters,wrap=draft.wrapParameters,merge=draft.mergeParameters;
 const customWrapRatio=hasCustomWrapRatio(wrap);
 function selectWrapRatio(ratio){
  if(ratio==='custom')return;
  setDraft(previous=>({...previous,wrapParameters:{...previous.wrapParameters,lDistanceRatio:ratio,lDistanceCustomRatio:null}}));
  setSaveError('');
 }
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
    if(['flatPose','verticalPose','lineStepEnabled','lineStep','arcStep'].includes(key))return 'path-basic';
    if(['safeTransitionOffset','safeApproachOffset','endSafeTransitionOffset','endSafeApproachOffset'].includes(key))return 'path-safe-points';
    break;
   case 'weldPreprocessing':return key==='maxWrapPlateThickness'?'path-continuous':'topology';
   case 'mergeParameters':
    if(['angleMin','angleMax','gapThreshold','maxLength'].includes(key))return 'topology';
    break;
   case 'wrapParameters':
    if(['flatLPose','verticalLPose','uPose','lDistanceRatio','lDistanceOffset','verticalDistance','verticalDistanceRatio','verticalDistanceOffset'].includes(key))return 'path-continuous';
    break;
   case 'splitParameters':
    if(['toolHeadCollisionEnabled','autoDeleteUnavoidable','minWeldLength'].includes(key))return 'path-collision';
    break;
   case 'cornerPathParameters':return 'path-continuous';
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
   topology:['weldPreprocessing.maxHolePlateThickness','weldPreprocessing.minCornerHoleSize','weldPreprocessing.outerClearance','mergeParameters.angleMin','mergeParameters.angleMax','mergeParameters.gapThreshold','mergeParameters.maxLength','mergeParameters.lengthEnabled'],
   'path-basic':['actionParameters.flatPose','actionParameters.verticalPose','actionParameters.lineStepEnabled','actionParameters.lineStep','actionParameters.arcStep'],
   'path-continuous':['weldPreprocessing.maxWrapPlateThickness','wrapParameters.flatLPose','wrapParameters.verticalLPose','wrapParameters.uPose','wrapParameters.lDistanceRatio','wrapParameters.lDistanceOffset','wrapParameters.verticalDistance','wrapParameters.verticalDistanceRatio','wrapParameters.verticalDistanceCustomRatio','wrapParameters.verticalDistanceOffset','cornerPathParameters'],
   'path-endpoints':['interferenceEndParameters'],
   'path-collision':['splitParameters.toolHeadCollisionEnabled','splitParameters.autoDeleteUnavoidable','splitParameters.minWeldLength'],
   'path-safe-points':['actionParameters.safeTransitionOffset','actionParameters.safeApproachOffset','actionParameters.endSafeTransitionOffset','actionParameters.endSafeApproachOffset'],
   tracking:[...(capabilities.laserTracking!==false?['trackingParameters.laserEnabled','trackingParameters.minLineLength','trackingParameters.minArcDiameter','trackingParameters.minEdgeWidth']:[]),...(capabilities.arcTracking!==false?['trackingParameters.arcEnabled']:[])],
   measurement:[...(showLaser?['precisionParameters.laserPose','precisionParameters.mixedScan','precisionParameters.lineSweepSpeed','precisionParameters.arcSweepSpeed']:[]),...(showStructure?['precisionParameters.structuredLightPhotoDistance','precisionParameters.structuredLightMixedScan']:[])]
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
 const wrapRatioError=fieldErrors.get('wrapParameters.lDistanceRatio');
 const wrapOffsetError=fieldErrors.get('wrapParameters.lDistanceOffset');
 const verticalLegacyError=fieldErrors.get('wrapParameters.verticalDistance');
 const verticalRatioError=fieldErrors.get('wrapParameters.verticalDistanceRatio')??verticalLegacyError;
 const verticalOffsetError=fieldErrors.get('wrapParameters.verticalDistanceOffset');
 const verticalWrapHasErrors=verticalRatioError||verticalOffsetError||
  POSE_AXES.some(([axis])=>fieldErrors.has('wrapParameters.verticalLPose.'+axis));
 const savedWrap=serialized.wrapParameters;
 const legacyVerticalDistance=usesLegacyVerticalWrapDistance(savedWrap);
 const customVerticalRatio=hasCustomWrapRatio(savedWrap,'vertical');
 function changeVerticalWrapRatio(ratio,custom){
  if(ratio==='custom'||ratio==='legacy')return;
  setDraft(previous=>({...previous,wrapParameters:{...previous.wrapParameters,verticalDistance:null,
   verticalDistanceRatio:custom?verticalWrapPreset(previous.wrapParameters):ratio,
   verticalDistanceCustomRatio:custom?ratio:null}}));
  setSaveError('');
 }
 const fieldProps=fieldId=>({fieldId,error:fieldErrors.get(fieldId)});
 const field=(group,key,label,props={})=><NumberField label={label} value={draft[group][key]} onChange={value=>change(group,key,value)} {...props} {...fieldProps(group+'.'+key)}/>;
 const cornerField=(side,key,label,props)=><NumberField label={label} value={draft.cornerPathParameters[side][key]}
  onChange={value=>{
   setDraft(previous=>({...previous,cornerPathParameters:{...previous.cornerPathParameters,[side]:{...previous.cornerPathParameters[side],[key]:value}}}));
   setSaveError('');
  }} {...props} {...fieldProps('cornerPathParameters.'+side+'.'+key)}/>;
 const group=(section,key,label,fields,inputLabel)=><NumberGroup label={label} inputLabel={inputLabel} value={draft[section][key]} onChange={value=>change(section,key,value)} fields={fields} fieldProps={axis=>fieldProps(section+'.'+key+'.'+axis)}/>;
 const mixedScan=(key,label,fields)=><fieldset className="planning-setting-fields planning-number-group">
  <legend>{label}寻位设置</legend>
  {fields.map(([fieldName,name])=><NumberField key={fieldName} label={name} inputLabel={label+name} step="any"
   value={draft.precisionParameters[key][fieldName]} {...fieldProps('precisionParameters.'+key+'.'+fieldName)}
   onChange={value=>change('precisionParameters',key,{...draft.precisionParameters[key],[fieldName]:value})}/>)}
 </fieldset>;
 async function save(event){
  event.preventDefault();
  if(saving)return;
  if(!issues.length){setSaveError(await onSave(serialized,settingsSignature(serialized)!==initialSettingsSignature)||'');return;}
  setValidationShown(true);
  const orderedTabs=visibleTabs.flatMap(([key])=>key==='path'?pathSections.map(([section])=>section):key);
  const firstTab=orderedTabs.find(key=>issues.some(issue=>sectionFor(issue.field)===key));
  if(firstTab){
   if(pathSections.some(([key])=>key===firstTab))setPathExpanded(true);
   selectSection(firstTab);
   setFocusIssue({tab:firstTab});
  }
 }
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
     const category=navGroups[key];
     const heading=category&&category!==navGroups[visibleTabs[index-1]?.[0]];
     return <React.Fragment key={key}>{heading&&<span className="planning-nav-heading">{category}</span>}{key==='path'?
     <div className="planning-path-nav" key={key}>
      <button type="button" className={'planning-path-toggle'+(activePath?' has-current':'')} aria-expanded={pathExpanded} aria-controls={pathMenuId} onClick={()=>setPathExpanded(expanded=>!expanded)}>
       <span>{navLabel(label,pathHasErrors)}<small className="planning-path-count">{pathSections.length}</small></span><ChevronDown size={15} aria-hidden="true"/>
      </button>
      <div className="planning-path-children" id={pathMenuId} hidden={!pathExpanded}>
       {pathSections.map(([section,name])=><button type="button" key={section} className={tab===section?'active':''} aria-current={tab===section?'page':undefined} onClick={()=>selectSection(section)}>{navLabel(name,invalidTabs.has(section))}</button>)}
      </div>
     </div>:
     <button type="button" key={key} className={tab===key?'active':''} aria-current={tab===key?'page':undefined} onClick={()=>selectSection(key)}><span>{navLabel(label,invalidTabs.has(key))}</span>{key==='topology'&&<small>焊缝合并与打断</small>}</button>}</React.Fragment>;
    })}
   </nav>
   <div ref={body} className="dialog-body planning-settings" key={tab}>
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
    {kind==='flat'&&!fixed&&Number(leg.coefficient)>0&&<p className="planning-setting-note">例：板厚 {example} mm → 焊脚 {roundWeldLeg(example*leg.coefficient)} mm</p>}
   </fieldset>;
  })}
 </section>}
 {tab==='topology'&&<section aria-label="焊缝合并与打断">
  <h3>焊缝合并与打断</h3>
  {field('weldPreprocessing','maxHolePlateThickness','过焊孔允许连续焊接最大板厚',{step:'any',placeholder:'留空不限制',helpGif:'/assets/parameter-help/max-hole-plate-thickness.gif'})}
  {field('weldPreprocessing','minCornerHoleSize','转角合并最小过焊孔尺寸',{step:'any',helpGif:'/assets/parameter-help/min-corner-hole-size.gif'})}
  {field('weldPreprocessing','outerClearance','外角最小空间',{step:'any',helpGif:'/assets/parameter-help/outer-clearance.gif'})}
  <fieldset className="planning-setting-fields planning-subgroup"><legend>合并角度范围</legend>
   <div className="planning-angle-range">
    {field('mergeParameters','angleMin','最小合并夹角',{unit:'°',max:360})}
    {field('mergeParameters','angleMax','最大合并夹角',{unit:'°',max:360})}
   </div>
  </fieldset>
  {field('mergeParameters','gapThreshold','最大合并槽隙',{step:'any',placeholder:'默认10'})}
  <NumberField label="合并长度上限" value={draft.mergeParameters.lengthEnabled?draft.mergeParameters.maxLength:''}
   onChange={value=>setDraft(current=>({...current,mergeParameters:{...current.mergeParameters,maxLength:value,lengthEnabled:value!==''}}))}
   placeholder="留空不限制" min={.1} step="any" {...fieldProps('mergeParameters.maxLength')}/>
 </section>}
 {activePath&&<section aria-label={activePath[1]}>
  <h3>{activePath[1]}</h3>
  {tab==='path-basic'&&<>
   {group('actionParameters','flatPose','平角焊标准焊接姿态',angleFields)}
   {group('actionParameters','verticalPose','立焊标准焊接姿态',angleFields)}
   <h4 className="planning-section-heading">路径步长</h4>
   <Switch label="直线步长生效" value={action.lineStepEnabled} onChange={value=>change('actionParameters','lineStepEnabled',value)}
    {...fieldProps('actionParameters.lineStepEnabled')}/>
   {field('actionParameters','lineStep','直线步长',{integer:true,min:1,placeholder:'默认5',disabled:!action.lineStepEnabled})}
   {field('actionParameters','arcStep','圆弧步长',{integer:true,min:1,placeholder:'默认2'})}
  </>}
  {tab==='path-continuous'&&<>
   <h4>包角路径</h4>
   {field('weldPreprocessing','maxWrapPlateThickness','包角最大板厚',{step:'any',placeholder:'留空不限制'})}
   <fieldset className="planning-setting-fields planning-subgroup">
    <legend>平角焊包角</legend>
    <FlatWrapFigure kind="L" settings={savedWrap} onRatioChange={ratio=>change('wrapParameters','lDistanceCustomRatio',ratio)}
     pose={group('wrapParameters','flatLPose','L形包角参考姿态',angleFields)}>
     <label className="planning-wrap-distance-label" htmlFor={pathMenuId+'-wrap-ratio'}>L形包角距离</label>
     <div className="planning-wrap-distance-inputs">
      <select id={pathMenuId+'-wrap-ratio'} data-setting-field="wrapParameters.lDistanceRatio" aria-invalid={!!wrapRatioError||undefined}
       aria-describedby={wrapRatioError?pathMenuId+'-wrap-ratio-error':undefined} value={customWrapRatio?'custom':wrap.lDistanceRatio} onChange={event=>selectWrapRatio(event.target.value)}>
       {L_WRAP_DISTANCES.map(([ratio,label])=><option key={ratio} value={ratio}>{label}</option>)}
       {customWrapRatio&&<option value="custom">自定义 {displayWrapPercent(wrap.lDistanceCustomRatio)}%</option>}
      </select>
      <span aria-hidden="true">+</span>
      <span className="planning-value">
       <NumericInput aria-label="调整偏移" title={customWrapRatio?'固定比例时使用调整偏移':'调整偏移'} min="0" step="0.1" placeholder="默认0" value={wrap.lDistanceOffset} disabled={customWrapRatio}
        data-setting-field="wrapParameters.lDistanceOffset" aria-invalid={!!wrapOffsetError||undefined}
        aria-describedby={wrapOffsetError?pathMenuId+'-wrap-offset-error':undefined} onChange={event=>change('wrapParameters','lDistanceOffset',event.target.value)}/>
       <small>mm</small>
      </span>
     </div>
     <FieldError id={pathMenuId+'-wrap-ratio-error'} error={wrapRatioError}/>
     <FieldError id={pathMenuId+'-wrap-offset-error'} error={wrapOffsetError}/>
    </FlatWrapFigure>
    <FlatWrapFigure kind="U" pose={group('wrapParameters','uPose','U形包角控制姿态',angleFields)}/>
   </fieldset>
   <fieldset className="planning-setting-fields planning-subgroup">
    <legend>立焊上包角</legend>
    <figure className={'planning-vertical-wrap-diagram'+(verticalWrapHasErrors?' has-errors':'')} aria-label="立焊上包角示意图">
     <VerticalWrapPath wide className="planning-vertical-wrap-path planning-vertical-wrap-wide" settings={savedWrap} onRatioChange={ratio=>changeVerticalWrapRatio(ratio,true)}/>
     <VerticalWrapPath className="planning-vertical-wrap-path planning-vertical-wrap-narrow" settings={savedWrap} onRatioChange={ratio=>changeVerticalWrapRatio(ratio,true)}/>
     <div className="planning-wrap-parameter planning-wrap-pose planning-vertical-wrap-parameter planning-vertical-wrap-pose">
      {group('wrapParameters','verticalLPose','立焊上包角控制姿态',angleFields)}
     </div>
     <div className="planning-wrap-parameter planning-wrap-distance planning-vertical-wrap-parameter planning-vertical-wrap-distance">
      <label className="planning-wrap-distance-label" htmlFor={pathMenuId+'-vertical-wrap-ratio'}>立焊上包角距离</label>
      <div className="planning-wrap-distance-inputs">
       <select id={pathMenuId+'-vertical-wrap-ratio'} aria-label="立焊上包角板厚比例"
        data-setting-field={'wrapParameters.'+(verticalLegacyError?'verticalDistance':'verticalDistanceRatio')}
        aria-invalid={!!verticalRatioError||undefined} aria-describedby={verticalRatioError?pathMenuId+'-vertical-wrap-ratio-error':undefined}
        value={legacyVerticalDistance?'legacy':customVerticalRatio?'custom':verticalWrapPreset(wrap)} onChange={event=>changeVerticalWrapRatio(event.target.value,false)}>
        {legacyVerticalDistance&&<option value="legacy">原距离 {savedWrap.verticalDistance} mm</option>}
        {L_WRAP_DISTANCES.map(([ratio,label])=><option key={ratio} value={ratio}>{label}</option>)}
        {customVerticalRatio&&<option value="custom">自定义 {displayWrapPercent(savedWrap.verticalDistanceCustomRatio)}%</option>}
       </select>
       <span aria-hidden="true">+</span>
       <span className="planning-value">
        <NumericInput aria-label="立焊上包角调整偏移" title="调整偏移" min="0" step="0.1" placeholder="0" disabled={legacyVerticalDistance}
         value={wrap.verticalDistanceOffset??0} data-setting-field="wrapParameters.verticalDistanceOffset"
         aria-invalid={!!verticalOffsetError||undefined} aria-describedby={verticalOffsetError?pathMenuId+'-vertical-wrap-offset-error':undefined}
         onChange={event=>change('wrapParameters','verticalDistanceOffset',event.target.value)}/>
        <small>mm</small>
       </span>
      </div>
      <FieldError id={pathMenuId+'-vertical-wrap-ratio-error'} error={verticalRatioError}/>
      <FieldError id={pathMenuId+'-vertical-wrap-offset-error'} error={verticalOffsetError}/>
     </div>
    </figure>
   </fieldset>
   <h4>转角路径</h4>
   <div className="planning-corner-illustrations">
    <CornerPathDiagram field={cornerField}/>
    <CornerPathDiagram inner field={cornerField}/>
   </div>
  </>}
  {tab==='path-endpoints'&&<>
   {[['start','平角焊起点'],['end','平角焊终点']].map(([side,heading])=>{
    const hasError=flatEndpointFields.some(([key])=>fieldErrors.has('interferenceEndParameters.'+side+key));
    const asset='/assets/parameter-help/flat-endpoint-'+side;
    return <React.Fragment key={side}>
     <h4>{heading}</h4>
     <figure className={'planning-endpoint-diagram'+(hasError?' has-errors':'')} aria-label={heading+'姿态示意图'}>
      <div className="planning-endpoint-visual">
       <picture>
        <source media="(max-width:820px)" srcSet={asset+'.png'}/>
        <img src={asset+(hasError?'.png':'-diagram.png')} width={hasError?590:1080} height="660"
         alt={'端挡板、立板和底板在焊缝端点相交。'+(side==='start'?'从起点沿焊接方向':'从终点沿焊接反方向')+'量取过渡距离。线偏移沿焊丝轴。'}/>
       </picture>
       <AdvanceAnglePlane value={draft.interferenceEndParameters[side+'Angle']}/>
      </div>
      {flatEndpointFields.map(([key,label,unit])=>{
       const angle=key==='Angle',distance=key==='Distance';
       const name=angle?'前进角姿态':label;
       return <div key={key} className={'planning-endpoint-parameter planning-endpoint-'+key.toLowerCase()}>
        <NumberField label={name} inputLabel={heading+name} value={draft.interferenceEndParameters[side+key]}
         onChange={value=>change('interferenceEndParameters',side+key,value)} unit={unit} min={angle?-360:distance?0:null}
         max={angle?360:undefined} step={distance?0.1:'any'} {...fieldProps('interferenceEndParameters.'+side+key)}
         placeholder={'默认'+(angle?DEFAULT_INTERFERENCE_ANGLE:distance?DEFAULT_INTERFERENCE_DISTANCE:0)}/>
       </div>;
      })}
     </figure>
    </React.Fragment>;
   })}
   <figure className="planning-endpoint-diagram planning-vertical-transition-diagram" aria-label="立焊起点姿态示意图">
    <img src="/assets/parameter-help/vertical-start-static.png" width="584" height="556"
     alt="同一条立焊焊缝上的起点姿态和到达过渡距离后的立焊姿态。距离从立焊起点沿焊缝向上量取。"/>
    <div className="planning-vertical-transition-controls">
     <div className="planning-vertical-transition-entry">
      {field('interferenceEndParameters','verticalStartDistance','立焊起点变姿态距离',{placeholder:'默认20'})}
     </div>
     <div className="planning-vertical-start-pose">
      {group('interferenceEndParameters','verticalStartPose','立焊起点姿态',angleFields.map(([axis,label,props])=>[
       axis,label,{...props,placeholder:axis==='work'?'默认继承平角焊工作角，未设时取立焊工作角':'默认继承立焊标准姿态'}
      ]))}
     </div>
    </div>
   </figure>
  </>}
  {tab==='path-collision'&&<>
   {field('splitParameters','minWeldLength','最小焊缝长度',{min:0})}
   <p className="planning-setting-note">规划完成后，短于此长度的焊缝将被屏蔽。</p>
   <Switch label="工具头碰撞检测使能" value={draft.splitParameters.toolHeadCollisionEnabled} onChange={value=>change('splitParameters','toolHeadCollisionEnabled',value)} {...fieldProps('splitParameters.toolHeadCollisionEnabled')}/>
   <Switch label="碰撞检测打断焊缝" value={draft.splitParameters.toolHeadCollisionEnabled&&draft.splitParameters.autoDeleteUnavoidable}
    disabled={!draft.splitParameters.toolHeadCollisionEnabled} onChange={value=>change('splitParameters','autoDeleteUnavoidable',value)} {...fieldProps('splitParameters.autoDeleteUnavoidable')}/>
  </>}
  {tab==='path-safe-points'&&<>
   {[
    ['起点','start','safeTransitionOffset','safeApproachOffset','过渡点 → 接近点 → 焊缝起点'],
    ['终点','end','endSafeTransitionOffset','endSafeApproachOffset','焊缝终点 → 接近点 → 过渡点'],
   ].map(([label,side,transition,approach,path])=>{
    const hasError=[transition,approach].some(key=>OFFSET_AXES.some(axis=>fieldErrors.has('actionParameters.'+key+'.'+axis)));
    const asset='/assets/parameter-help/safety-'+side;
    return <React.Fragment key={side}>
    <h4>{label}</h4>
    <figure className={'planning-safety-diagram'+(hasError?' has-errors':'')} aria-label={label+'安全点示意图'}>
     <picture>
      <source media="(max-width:960px)" srcSet={asset+'.png'}/>
      <img src={asset+(hasError?'.png':'-diagram.png')} alt={path} width="1080" height={hasError?628:600}/>
     </picture>
     <div className="planning-safety-offset planning-safety-transition">
      {group('actionParameters',transition,'过渡点偏移（mm）',safetyOffsetFields,label+'安全过渡点偏移')}
     </div>
     <div className="planning-safety-offset planning-safety-approach">
      {group('actionParameters',approach,'接近点偏移（mm）',safetyOffsetFields,label+'安全接近点偏移')}
     </div>
    </figure>
    </React.Fragment>;
   })}
  </>}
 </section>}
 {tab==='measurement'&&<>
 <section aria-label="精定位设置">
  <h3>精定位设置</h3>
  {showLaser&&<fieldset className="planning-setting-fields planning-subgroup">
   <legend>线激光精定位设置</legend>
   {group('precisionParameters','laserPose','线激光标准姿态',angleFields)}
   {field('precisionParameters','lineSweepSpeed','直线推扫动作速度',{unit:'mm/min',step:'any',placeholder:'默认150'})}
   {field('precisionParameters','arcSweepSpeed','圆弧推扫动作速度',{unit:'mm/min',step:'any',placeholder:'默认70'})}
   {mixedScan('mixedScan','线激光',MIXED_SCAN_FIELDS)}
  </fieldset>}
  {showStructure&&<fieldset className="planning-setting-fields planning-subgroup">
   <legend>结构光精定位设置</legend>
   <p>定点拍照的机头沿焊缝开口角平分线，旋转角跟随被测点的焊接姿态。</p>
   {field('precisionParameters','structuredLightPhotoDistance','拍照距离',{unit:'mm',step:'any',placeholder:'留空自动'})}
   <p className="planning-setting-note">沿镜头光轴从镜头量到焊缝被测点。留空时自动计算，距离过近时取几何允许的最近距离。</p>
   {mixedScan('structuredLightMixedScan','结构光',STRUCTURED_LIGHT_SCAN_FIELDS)}
  </fieldset>}
 </section>
 </>}
 {tab==='tracking'&&<section aria-label="跟踪设置"><h3>跟踪设置</h3><WeldTrackingSettings showHeading={false} capabilities={capabilities} value={draft.trackingParameters} fieldProps={key=>fieldProps('trackingParameters.'+key)} onChange={value=>setDraft(previous=>({...previous,trackingParameters:value}))}/></section>}
 </div></div>
  {validationShown&&fieldErrors.size>0&&<div className="planning-error-summary" aria-label="待修正的设置"><strong>还有 {fieldErrors.size} 项设置需要修正</strong><ul>{[...fieldErrors].map(([field,message])=><li key={field}><button type="button" onClick={()=>jumpToIssue(field)}>{message}</button></li>)}</ul></div>}
  {(saveError||unlocated.length>0)&&<p role="alert" className="tpl-errors planning-settings-error">{saveError||[...new Set(unlocated)].join('；')}</p>}
  <footer><button type="button" className="btn" onClick={onCancel}>取消</button><button type="submit" className="btn primary" disabled={saving}>保存</button></footer>
 </form>;
}
