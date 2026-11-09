import {curveDimensions} from './curveDimensions.mjs';
import React, { useId, useRef, useState } from 'react';
import { previewPath, previewPoint, previewBounds, movePreviewPoint, sampleFrame } from './templatePreviewGeometry.mjs';

export default function PathPreview({ template, selectedId, onSelect, onPointChange, onCornerChange, layoutOnly = false, segmentsOnly = false }) {
  const [plane, setPlane] = useState('xy'), [mode, setMode] = useState('auto'), [dragging, setDragging] = useState(false), [zoom,setZoom]=useState(1), [pan,setPan]=useState({x:0,y:0});
  const svg = useRef(), drag = useRef(null), panDrag=useRef(null), latest = useRef();
  latest.current = { template, onPointChange };
  const patternId = useId(), editable = !!onPointChange, pointDraggable = false;
  const corners = layoutOnly ? Array.from({length:template.segments.length - 1}, () => ({standard:90,tolerance:0})) : template.corners || [];
  const path = previewPath(template.cornerReferenceNormal?template.segments.map(s=>({...s,referenceNormal:template.cornerReferenceNormal})):template.segments, plane, corners, template.closure);
  const rendered = segmentsOnly ? [] : template.points.map(p => { const resolved=previewPoint(p,path,plane,layoutOnly,template.points); const pass=plane==='xy'?template.passOffset?.y||0:template.passOffset?.z||0; return {...resolved,point:p,position:{x:resolved.position.x+resolved.frame.normal.x*pass,y:resolved.position.y+resolved.frame.normal.y*pass},base:{x:resolved.base.x+resolved.frame.normal.x*pass,y:resolved.base.y+resolved.frame.normal.y*pass},height:resolved.height+(template.passOffset?.z||0)}; });
  const fitBounds=previewBounds(path,rendered), zoomBounds={x:fitBounds.x+fitBounds.width*(1-1/zoom)/2+pan.x,y:fitBounds.y+fitBounds.height*(1-1/zoom)/2+pan.y,width:fitBounds.width/zoom,height:fitBounds.height/zoom};
  const bounds = drag.current?.bounds || zoomBounds;
  const unit = bounds.width / (editable ? 460 : 500);
  const active = rendered.find(p => p.point.id === selectedId);

  function cursor(event) {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return null;
    const p = svg.current.createSVGPoint(); p.x = event.clientX; p.y = event.clientY;
    return p.matrixTransform(matrix.inverse());
  }
  function start(event, point, axis = mode) {
    if (!pointDraggable || event.button !== 0 || drag.current || point.kind==='control'&&!point.referenceId) return;
    event.preventDefault(); event.stopPropagation();
    onSelect?.(point.id);
    const origin = cursor(event); if (!origin) return;
    drag.current = { pointerId: event.pointerId, point: structuredClone(point), origin, axis, bounds, frame: rendered.find(p=>p.point.id===point.id).frame };
    svg.current.setPointerCapture(event.pointerId);
    setDragging(true);
  }
  function move(event) {
    if(panDrag.current&&event.pointerId===panDrag.current.pointerId){const p=svg.current.createSVGPoint();p.x=event.clientX;p.y=event.clientY;const at=p.matrixTransform(panDrag.current.matrix),d=panDrag.current;setPan({x:d.pan.x+d.origin.x-at.x,y:d.pan.y+d.origin.y-at.y});return;}
    const current = drag.current; if (!current || event.pointerId !== current.pointerId) return;
    const position = cursor(event); if (!position) return;
    const delta = { x: position.x - current.origin.x, y: position.y - current.origin.y };
    if (current.axis === 'auto') {
      if (Math.hypot(delta.x, delta.y) < 3 * unit) return;
      const along = delta.x * current.frame.tangent.x + delta.y * current.frame.tangent.y;
      const across = delta.x * current.frame.normal.x + delta.y * current.frame.normal.y;
      current.axis = Math.abs(along) >= Math.abs(across) ? 'along' : 'normal';
    }
    latest.current.onPointChange?.(current.point.id, movePreviewPoint(current.point, current.frame, delta, current.axis, plane, layoutOnly));
  }
  function startPan(event){if((!editable&&!segmentsOnly)||event.button!==0||drag.current||event.target.closest('.tpl-selectable-point,.tpl-drag-handle'))return;const matrix=svg.current?.getScreenCTM(),origin=cursor(event);if(!matrix||!origin)return;event.preventDefault();panDrag.current={pointerId:event.pointerId,matrix:matrix.inverse(),origin,pan};svg.current.setPointerCapture(event.pointerId);setDragging(true);}
  function resetView(){setZoom(1);setPan({x:0,y:0});}
  function finish(event, cancel = false) {
    if(panDrag.current?.pointerId===event.pointerId){panDrag.current=null;setDragging(false);if(svg.current.hasPointerCapture(event.pointerId))svg.current.releasePointerCapture(event.pointerId);return;}
    const current = drag.current; if (!current || event.pointerId !== current.pointerId) return;
    if (cancel) latest.current.onPointChange?.(current.point.id, current.point);
    drag.current = null; setDragging(false);
    if (svg.current.hasPointerCapture(event.pointerId)) svg.current.releasePointerCapture(event.pointerId);
  }
  function keyboard(event, p) {
    if (['Enter', ' '].includes(event.key)) { event.preventDefault(); onSelect?.(p.id); return; }
    if (!pointDraggable || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); onSelect?.(p.id);
    const frame = rendered.find(r=>r.point.id===p.id).frame, axis = ['ArrowLeft', 'ArrowRight'].includes(event.key) ? 'along' : 'normal';
    const amount = (event.shiftKey ? 10 : 1) * (['ArrowLeft', 'ArrowDown'].includes(event.key) ? -1 : 1);
    const direction = axis === 'along' ? frame.tangent : frame.normal;
    onPointChange(p.id, movePreviewPoint(p, frame, { x: amount * direction.x, y: amount * direction.y }, axis, plane, layoutOnly));
  }
  function handle(axis, label) {
    if (!active || active.point.kind==='control'&&!active.point.referenceId || layoutOnly && active.point.kind !== 'control' && axis === 'along') return null;
    const dir = axis === 'along' ? active.frame.tangent : active.frame.normal, origin = active.position;
    const stem = { x: origin.x + dir.x * 12 * unit, y: origin.y + dir.y * 12 * unit };
    const hitStart = { x: origin.x + dir.x * 18 * unit, y: origin.y + dir.y * 18 * unit };
    const end = { x: origin.x + dir.x * 37 * unit, y: origin.y + dir.y * 37 * unit };
    const side = { x: -dir.y * 5 * unit, y: dir.x * 5 * unit };
    const back = { x: end.x - dir.x * 8 * unit, y: end.y - dir.y * 8 * unit };
    return <g className={`tpl-drag-handle ${axis}`} aria-label={label} role="button" tabIndex={-1} onPointerDown={e => start(e, active.point, axis)}><title>{label}</title><line x1={hitStart.x} y1={hitStart.y} x2={end.x} y2={end.y} strokeWidth={14 * unit} stroke="transparent"/><line x1={stem.x} y1={stem.y} x2={end.x} y2={end.y} strokeWidth={2 * unit}/><path d={`M${back.x + side.x},${back.y + side.y} L${end.x},${end.y} L${back.x - side.x},${back.y - side.y}`} fill="none" strokeWidth={2 * unit}/><text x={end.x + 8 * unit} y={end.y - 5 * unit} fontSize={11 * unit}>{axis === 'along' ? 'X' : plane === 'xy' ? 'Y' : 'Z'}</text></g>;
  }
  return <div className={`tpl-path ${editable ? 'interactive' : ''}`}>
    {editable && <div className="tpl-preview-tools"><div className="tpl-preview-toggle" aria-label="示意图视图">{[['xy','平面 XY'],['xz','高度 XZ']].map(([id,label]) => <button type="button" disabled={dragging} className={plane === id ? 'active' : ''} key={id} onClick={() => {setPlane(id);resetView();}}>{label}</button>)}</div>{pointDraggable&&<div className="tpl-preview-toggle" aria-label="拖拽约束">{[['auto','自动锁定方向'],['along','沿焊道'],['normal','垂直焊道']].map(([id,label]) => <button type="button" disabled={dragging} key={id} className={mode === id ? 'active' : ''} onClick={() => setMode(id)}>{label}</button>)}</div>}</div>}
    {(editable||segmentsOnly)&&<div className="tpl-preview-zoom" aria-label="示意图缩放"><button type="button" aria-label="缩小示意图" disabled={dragging||zoom<=0.5} onClick={()=>setZoom(z=>Math.max(0.5,z/1.25))}>−</button><span>{Math.round(zoom*100)}%</span><button type="button" aria-label="放大示意图" disabled={dragging||zoom>=8} onClick={()=>setZoom(z=>Math.min(8,z*1.25))}>＋</button><button type="button" disabled={dragging} onClick={resetView}>适应视图</button><small>拖动空白区域平移</small></div>}
    <svg onPointerDown={startPan} ref={svg} className={editable ? 'tpl-interactive-svg' : ''} viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`} role={editable ? 'group' : 'img'} aria-label={segmentsOnly ? "焊缝段示意图" : "模板点位位置示意图"} onPointerMove={move} onPointerUp={e => finish(e)} onPointerCancel={e => finish(e,true)} onLostPointerCapture={e => finish(e,true)}>
      <defs><pattern id={patternId} width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10 0 L0 0 0 10" fill="none" stroke="#e9edf1" strokeWidth={0.6 * unit}/></pattern></defs><rect x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height} fill={`url(#${patternId})`}/>
      <g className="tpl-weld-segments">{path.frames.map((f,i)=><path key={i} data-segment={i+1} d={f.d} fill="none" stroke="#aebbc9" strokeWidth={5*unit} strokeLinecap="round"/>)}</g>
      {plane==='xy'&&(editable||segmentsOnly)&&<g className="tpl-curve-dimensions" pointerEvents="none">{path.frames.map((f,i)=>{
        if(template.segments[i].geometry!=='曲线')return null;
        const m=curveDimensions(f.samples),p=f.samples[m.maxIndex],foot={x:m.foot[0],y:m.foot[1]},middle={x:(f.start.x+f.end.x)/2,y:(f.start.y+f.end.y)/2};
        return <g key={i}><line x1={f.start.x} y1={f.start.y} x2={f.end.x} y2={f.end.y} stroke="#6f99b0" strokeWidth={unit} strokeDasharray={`${4*unit} ${3*unit}`}/><line x1={foot.x} y1={foot.y} x2={p.x} y2={p.y} stroke="#d99a48" strokeWidth={unit} strokeDasharray={`${3*unit} ${2*unit}`}/><text x={middle.x} y={middle.y+15*unit} fontSize={10*unit} fill="#628296" textAnchor="middle">弦长 {Math.round(m.chordLength*100)/100} mm</text><text x={(foot.x+p.x)/2+8*unit} y={(foot.y+p.y)/2-7*unit} fontSize={10*unit} fill="#b47c32">最大偏离 {Math.round(m.maxDeviation*100)/100} mm</text></g>;
      })}</g>}
      {segmentsOnly && <g pointerEvents="none">{path.frames.map((f,i) => {
        const sampled=sampleFrame(f,f.length*.58),p=sampled.position; f={...f,tangent:sampled.tangent,normal:{x:sampled.tangent.y,y:-sampled.tangent.x}};
        const tip={x:p.x+f.tangent.x*5*unit,y:p.y+f.tangent.y*5*unit};
        const back={x:p.x-f.tangent.x*4*unit,y:p.y-f.tangent.y*4*unit};
        return <path key={i} d={`M${back.x+f.normal.x*4*unit},${back.y+f.normal.y*4*unit} L${tip.x},${tip.y} L${back.x-f.normal.x*4*unit},${back.y-f.normal.y*4*unit}`} fill="none" stroke="#7d8e9f" strokeWidth={unit*1.5}/>;
      })}{(template.type==='local'?path.vertices.slice(1,-1):[path.vertices[0],path.vertices.at(-1)]).map((p,i)=><g key={i}><circle cx={p.x} cy={p.y} r={4*unit} fill={template.type==='local'?'#fa8c16':i ? '#4f8a9d' : '#fa8c16'}/><text x={p.x+(i ? 8 : -8)*unit} y={p.y-10*unit} textAnchor={i ? 'start' : 'end'} fill="#7a858d" fontSize={11*unit}>{template.type==='local'?`段连接点${i+1}`:i ? '终点' : '起点'}</text></g>)}</g>}
      {path.frames.map((f,i)=>{const m=sampleFrame(f,f.length*.5),n={x:m.tangent.y,y:-m.tangent.x};return <text key={i} x={m.position.x-n.x*20*unit} y={m.position.y-n.y*20*unit} textAnchor="middle" fill="#8a919a" fontSize={10*unit}>焊缝段 {i+1}</text>;})}
      {rendered.map(({point:p,base,position}) => <g key={`base-${p.id}`} pointerEvents="none">{Math.hypot(position.x-base.x,position.y-base.y)>unit && <><circle cx={base.x} cy={base.y} r={4 * unit} fill="white" stroke="#aab4bf" strokeWidth={unit}/><line x1={base.x} y1={base.y} x2={position.x} y2={position.y} stroke="#e7ac5d" strokeWidth={unit} strokeDasharray={`${4*unit} ${3*unit}`}/></>}</g>)}
      {rendered.filter(r => r.point.id !== selectedId).concat(active ? [active] : []).map(({point:p,position,height}) => <g key={p.id} className={onSelect ? 'tpl-selectable-point' : ''} role={onSelect ? 'button' : undefined} tabIndex={onSelect ? 0 : undefined} aria-label={`选择${p.name}`} onPointerDown={e => start(e,p)} onClick={() => onSelect?.(p.id)} onKeyDown={e => keyboard(e,p)}><title>{`${p.name} · 第 ${p.segment} 段 ${p.percent}% · X ${p.offset?.x || 0} / Y ${p.offset?.y || 0} / Z ${p.offset?.z || 0} mm`}</title><circle cx={position.x} cy={position.y} r={14 * unit} fill="transparent"/><circle cx={position.x} cy={position.y} r={(p.id === selectedId ? 8 : 6) * unit} fill={p.id === selectedId ? '#fa8c16' : p.kind === 'control' ? '#fff' : '#fa8c16'} stroke="#fa8c16" strokeWidth={2 * unit}/><text x={position.x + (p.autoRole?12:path.closed&&(p.kind==='end'||p.anchorRole==='trailing')?10:-10) * unit} y={position.y + (p.autoRole?16:-17) * unit} textAnchor={p.autoRole||path.closed&&(p.kind==='end'||p.anchorRole==='trailing')?'start':'end'} fontSize={11 * unit} fill="#765730">{p.name}</text>{plane === 'xy' && height ? <text x={position.x} y={position.y + 22 * unit} textAnchor="middle" fill="#6a80a0" fontSize={10 * unit}>Z {Math.round(height*100)/100} mm</text> : null}</g>)}
      {pointDraggable && <>{handle('along','沿焊道拖拽（X）')}{handle('normal',`垂直焊道拖拽（${plane === 'xy' ? 'Y' : 'Z'}）`)}</>}
      <g pointerEvents="none" fill="#8a919a" stroke="#8a919a" strokeWidth={unit}><path d={`M${bounds.x+18*unit} ${bounds.y+bounds.height-23*unit} v${5*unit} h10 v${-5*unit}`} fill="none"/><text stroke="none" x={bounds.x+18*unit} y={bounds.y+bounds.height-5*unit} fontSize={10*unit}>10 mm</text></g>
    </svg>
  </div>;
}
