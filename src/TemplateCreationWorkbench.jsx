import {formatDecimal} from './numericPrecision.mjs';
import React, {useEffect,useMemo,useRef} from 'react';
import {Circle, CornerDownRight, Minus, Route, Save} from 'lucide-react';
import {GeometryMatchFields,TemplateBasicMatchFields,TemplateCornerMatchFields,TemplateSegmentMatchFields} from './TemplateMatchInformation';
import {SHORT_SEGMENT_MM} from './templateGeometryRules.mjs';
import TemplateGeometryPreview from './TemplateGeometryPreview';
import TemplatePathPreview from './TemplatePathPreview';
import {TemplateCaptureRangeFields} from './TemplateCaptureSettings';
import {hasTemplateModelPath} from './templateModelEditing.mjs';
import './templateCreationWorkbench.css';

const lengthText = length => formatDecimal(length) + ' mm';

export function templateCreationSections(template) {
  const sections = [{id:'overall', feature:null, label:'整条焊缝', icon:Route}, {id:'start', feature:'start:type', label:'起点', icon:Circle}];
  template.segments.forEach((segment,index)=>{
    sections.push({
      id:'segment:'+index, feature:'segment:'+index+':geometry', label:`第 ${index+1} 段`,
      icon:Minus, kind:'segment', index, short:segment.length<SHORT_SEGMENT_MM
    });
    if(template.corners[index]) {
      const straight=template.corners[index].standard===180;
      sections.push({
        id:'corner:'+index, feature:'corner:'+index, label:(straight?'衔接 ':'转角 ')+(index+1),
        icon:CornerDownRight, kind:'corner', index
      });
    }
  });
  return [...sections, {id:'end', feature:'end:type', label:'终点', icon:Circle}];
}

export function templateCreationSection(feature) {
  if(!feature)return 'overall';
  const [kind,index]=feature.split(':');
  return kind==='segment'||kind==='corner' ? kind+':'+index : kind;
}

export function TemplateCreationNavigation({sections, feature, onSelect}) {
  const selected=templateCreationSection(feature);
  return <nav className="tcc-structure" aria-label="焊缝结构">
    <h3>焊缝结构</h3>
    <ul>{sections.map(({id,feature,label,icon:Icon,short})=><li key={id} className={id==='overall'?'tcc-root':''}>
      <button type="button" aria-pressed={selected===id} onClick={()=>onSelect(feature)}>
        <Icon size={15} aria-hidden="true"/><span>{label}</span>
        {short&&<small title="实测段长小于 30 mm" aria-hidden="true">短段</small>}
      </button>
    </li>)}</ul>
  </nav>;
}

export function TemplateCreationInspector({sections, template, parameters, rules, evidence, feature, onSelect, changeParameters, changeRules, editMatchingParameters}) {
  const active=templateCreationSection(feature);
  const section=sections.find(section=>section.id===active)??sections[0];
  const scroll=useRef(null);
  useEffect(()=>{scroll.current.scrollTop=0;},[section.id]);
  const common={template,parameters,rules,change:changeParameters,changeRules,evidence,selected:feature,onSelect};
  return <aside className="tcc-inspector" aria-label="匹配条件">
    <h3>{section.label}</h3>
    <div className="tcc-condition-scroll" ref={scroll}>
      {sections.map(item=><div key={item.id} data-condition-section={item.id} hidden={item.id!==section.id}>
        {editMatchingParameters&&<TemplateBasicMatchFields parameters={parameters} change={changeParameters} section={item.id} calculatedLeg={template.calculatedLeg}/>}
        {item.kind==='segment'?<>
          <dl className="tcc-facts">
            <div><dt>实测段长</dt><dd>{lengthText(template.segments[item.index].length)}</dd></div>
            <div><dt>焊接位置</dt><dd>{template.segments[item.index].position}</dd></div>
            {!item.short&&!parameters.segments[item.index].lengthMatchEnabled&&<div><dt>适用长度</dt><dd>不限</dd></div>}
          </dl>
          <TemplateSegmentMatchFields {...common} onlyIndex={item.index}/>
        </>:item.kind==='corner'?
          <TemplateCornerMatchFields {...common} onlyIndex={item.index}/>:
          rules&&<GeometryMatchFields {...common} section={item.id} title={item.label+'条件'}
            holeFlags={{start:template.startHole,end:template.endHole}}/>}
      </div>)}
    </div>
  </aside>;
}

export default function TemplateCreationWorkbench({
  initial, draft, parameters, changeParameters, changeRules, changeName, feature, onSelect,
  evidence, captureInput, changeCaptureRange, captureError, captureNotice, onCaptureReady, onSave, onClose, errors,
  editMatchingParameters, saveLabel='保存模板'
}) {
  const sections=useMemo(()=>templateCreationSections(initial),[initial]);
  function revealInvalidField(event) {
    const input=event.target;
    const section=input.closest('[data-condition-section][hidden]');
    const capture=input.closest('details:not([open])');
    if(!section&&!capture)return;
    event.preventDefault();
    if(input!==event.currentTarget.querySelector('input:invalid, select:invalid, textarea:invalid'))return;
    if(section)onSelect(sections.find(node=>node.id===section.dataset.conditionSection)?.feature??null);
    if(capture)capture.open=true;
    requestAnimationFrame(()=>{input.focus();input.reportValidity();});
  }
  return <form className="tcc-create" onSubmit={onSave} onInvalid={revealInvalidField}>
    <div className="tcc-heading">
      <label className="tpl-field"><span>模板名称</span>
        <input aria-label="模板名称" required readOnly={!changeName} maxLength={80} value={draft.name} onChange={changeName?event=>changeName(event.target.value):undefined}/>
      </label>
      <p>{draft.sourceWeld&&<>来源焊缝 <strong>{draft.sourceWeld.id}</strong></>}<span>{draft.sourceWeld?.model&&draft.sourceWeld.model+' · '}焊脚 {formatDecimal(draft.leg)} mm · {draft.segments.length} 段</span></p>
    </div>
    <div className="tcc-layout">
      <TemplateCreationNavigation sections={sections} feature={feature} onSelect={onSelect}/>
      <div className="tcc-model">
        {hasTemplateModelPath(initial)?<TemplateGeometryPreview template={draft} evidence={evidence}
          feature={feature} onCaptureReady={onCaptureReady}/>:<TemplatePathPreview template={initial} segmentsOnly/>}
        {captureInput&&<details className="tcc-capture">
          <summary>局部模型截取范围</summary>
          {captureNotice?<p className="matching-editor-error">{captureNotice}</p>:<TemplateCaptureRangeFields value={captureInput} onChange={changeCaptureRange}/>}
          {captureError&&<p role="alert" className="matching-editor-error">{captureError}</p>}
        </details>}
      </div>
      <TemplateCreationInspector sections={sections} template={initial} parameters={parameters} rules={draft.requirementsMatch}
        evidence={evidence} feature={feature} onSelect={onSelect} changeParameters={changeParameters} changeRules={changeRules} editMatchingParameters={editMatchingParameters}/>
    </div>
    {errors.length>0&&<div className="tpl-errors" role="alert">{errors.map(error=><p key={error}>{error}</p>)}</div>}
    <footer>
      <button type="button" className="btn" onClick={onClose}>取消</button>
      <button type="submit" className="btn primary" disabled={!!captureError}><Save size={15}/>{saveLabel}</button>
    </footer>
  </form>;
}
