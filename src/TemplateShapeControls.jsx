import {curveDimensions} from './curveDimensions.mjs';
import React,{useState} from 'react';
import {geometryOptions,changeCurveDimensions,changeTemplateSegment,changeTemplateClosure,resizeSegments,resizeCorners,reconcileTemplateGeometry} from './templateModel.mjs';
import {segmentShape,previewPath} from './templatePreviewGeometry.mjs';

export default function ShapeControls({template,onChange,readOnly=false}) {
  const [selected,setSelected]=useState(0),index=Math.min(selected,template.segments.length-1),s=template.segments[index],single=template.closure==='closed'&&template.segments.length===1,shape=segmentShape(s,single);
  const frame=previewPath(template.segments,'xy',template.corners,template.closure).frames[index],measured=curveDimensions(s.pathPoints||frame.samples),locked=readOnly||!!s.pathPoints?.length;
  const closing=template.closure==='closed'&&index===template.segments.length-1&&template.segments.length>1;
  const metric=v=>Math.round(v*1000)/1000,chord=locked||closing?metric(measured.chordLength):s.shape?.chordLength??metric(measured.chordLength),deviation=locked?metric(measured.maxDeviation):s.shape?.maxDeviation??metric(measured.maxDeviation);
  function change(values){onChange(t=>changeTemplateSegment(t,index,values));}
  function adjust(key,value){change({shape:{...shape,[key]:value}});}
  function preset(kind){onChange(t=>{
    let next=resizeSegments(t,kind==='polygon'?3:1);next=resizeCorners(next,kind==='polygon'?2:0);
    if(kind==='polygon'){next.segments=next.segments.map(s=>({...s,geometry:'直线',length:100,shape:undefined}));next.corners=next.corners.map(()=>({standard:60,tolerance:5}));}
    else next.segments=[{...next.segments[0],geometry:kind==='circle'?'圆弧':kind==='line'?'直线':'曲线',length:100,shape:kind==='circle'?{radius:50,arcAngle:360,direction:'left'}:{bend:30,width:120,height:80,direction:'left'}}];
    return reconcileTemplateGeometry(next);
  });setSelected(0);}
  const numeric=(label,value,changeValue,min=.1,max=10000,disabled=false)=><label className="tpl-shape-field">{label}<span className="tpl-number"><input aria-label={label} type="number" step="any" min={min} max={max} disabled={disabled||readOnly} value={value} onChange={e=>changeValue(e.target.value===''?'':+e.target.value)}/><small>{label.includes('角度')?'°':'mm'}</small></span></label>;
  return <div className="tpl-shape-controls"><div className="tpl-shape-presets"><span>快速形状</span>{(template.closure==='closed'?[['polygon','三段直线'],['loop','闭合曲线'],['circle','圆形']]:[['line','直线'],['curve','曲线']]).map(([key,label])=><button type="button" key={key} disabled={readOnly} onClick={()=>preset(key)}>{label}</button>)}</div><div className="tpl-shape-selectors"><select aria-label="调整焊缝段" value={index} onChange={e=>setSelected(+e.target.value)}>{template.segments.map((_,i)=><option value={i} key={i}>第 {i+1} 段</option>)}</select><select aria-label="示意图几何类型" disabled={readOnly} value={s.geometry} onChange={e=>change({geometry:e.target.value,shape:undefined})}>{geometryOptions(template.closure).map(g=><option key={g}>{g}</option>)}</select></div>
    {s.geometry==='曲线'&&<><div className="tpl-shape-grid">{numeric('曲线弦长',single?0:chord,v=>onChange(t=>changeCurveDimensions(t,index,{chordLength:v})),single?0:.1,100000,locked||single||closing)}{numeric('最大偏离距离',deviation,v=>onChange(t=>changeCurveDimensions(t,index,{maxDeviation:v})),single?.1:0,100000,locked)}</div><label className="tpl-shape-field">弯向<select aria-label="曲线弯向" disabled={locked} value={shape.direction} onChange={e=>onChange(t=>changeCurveDimensions(t,index,{direction:e.target.value}))}><option value="left">左侧</option><option value="right">右侧</option></select></label><p>弦长：两端点的直线距离。最大偏离距离：曲线到弦线段的最远距离。实际焊接长度 {frame.length.toFixed(2)} mm。</p>{single?<p>首尾重合，弦长为 0；偏离距离以起终点为基准，调整时等比例缩放闭合曲线。</p>:closing?<p>收尾弦长由闭合端点确定；可调整最大偏离距离。</p>:null}{s.pathPoints?.length>0&&<p>尺寸由真实路径测量，保留模型曲线。</p>}</>}
    {s.geometry==='圆弧'&&<><div className="tpl-shape-grid">{numeric('圆弧半径',closing?Math.round(previewPath(template.segments,'xy',template.corners,template.closure).frames[index].radius*100)/100:shape.radius,v=>adjust('radius',v),.1,10000,closing)}{numeric('圆弧角度',shape.arcAngle,v=>adjust('arcAngle',v),1,single?360:359,single)}</div>{!single&&<label className="tpl-shape-field">弯向<select aria-label="圆弧弯向" value={shape.direction} onChange={e=>adjust('direction',e.target.value)}><option value="left">左侧</option><option value="right">右侧</option></select></label>}<p>{single?'闭合圆固定为 360°，调整半径即可改变大小。':closing?'收尾圆弧自动连接起点，半径随轮廓计算。':'调整角度改变圆弧开口，调整半径改变大小。'}</p></>}
    {s.geometry==='直线'&&numeric(closing?'闭合段长度':'示意段长度',s.length,v=>change({length:v}),.1,100000,closing)}
    {template.closure==='closed'&&<p>{template.type==='whole'?'首尾始终相接；最后一个转角的标准角度和容差可自定义。':'首尾始终相接；收尾段和对应转角自动随轮廓更新。'}</p>}
  </div>;
}
