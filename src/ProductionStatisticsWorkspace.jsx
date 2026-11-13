import { useMemo, useState } from 'react'
import { CalendarDays, Download } from 'lucide-react'
import { executionCsv, executionDay, readExecutionRecords, sumExecutionMetrics } from './productionStatisticsModel.mjs'
import {EmptyState, PageHeader} from './WorkspaceUI'
import './productionStatistics.css'

const EXECUTION_STATUS_NAMES={running:'执行中',paused:'已暂停',completed:'已完成',stopped:'已停止',error:'失败'}

const number=(n,digits=2)=>n.toLocaleString('zh-CN',{maximumFractionDigits:digits})
export default function ProductionStatisticsWorkspace() {
  const [records]=useState(()=>readExecutionRecords())
  const [consumables,setConsumables]=useState(false),[period,setPeriod]=useState(7),[model,setModel]=useState('all')
  const [metric,setMetric]=useState('runs'),[active,setActive]=useState(''),[page,setPage]=useState(0)
  const today=executionDay(new Date().toISOString())
  const days=Array.from({length:period},(_,i)=>new Date(Date.parse(today+'T12:00:00+08:00')-(period-1-i)*86400000).toISOString().slice(0,10))
  const filtered=useMemo(()=>records.filter(r=>executionDay(r.startedAt)>=days[0]&&executionDay(r.startedAt)<=today&&(model==='all'||r.modelId===model)),[records,period,today,model])
  const total=sumExecutionMetrics(filtered)
  const completedRuns=filtered.filter(r=>r.status==='completed').length
  const completedWelds=filtered.reduce((sum,r)=>{
    if(r.kind!=='welding'||!r.arcEnabled)return sum
    return sum+[...new Set(r.tasks.flatMap(t=>t.weldIds))].filter(id=>{
      const tasks=r.tasks.filter(t=>t.weldIds.includes(id));return tasks.every(t=>t.completed)&&tasks.some(t=>t.weldMm>1e-8)
    }).length
  },0)
  const completed=filtered.reduce((sum,r)=>sum+r.tasks.filter(t=>t.completed).length,0),planned=filtered.reduce((sum,r)=>sum+r.tasks.length,0)
  const bars=days.map(day=>{
    const group=filtered.filter(r=>executionDay(r.startedAt)===day),metrics=sumExecutionMetrics(group)
    return {day,value:consumables?(metrics.unknownWireSeconds>1e-8?null:metrics.wireKg):metric==='runs'?group.filter(r=>r.status==='completed').length:metrics.weldMm/1000}
  })
  const max=Math.max(1e-9,...bars.map(b=>b.value??0)),chosen=bars.find(b=>b.day===active)??bars.at(-1)
  const wire=total.unknownWireSeconds>1e-8?'—':number(total.wireKg,4),gas=total.unknownGasSeconds>1e-8?'—':number(total.gasM3,4)
  const energy=total.unknownEnergySeconds>1e-8?'—':number(total.energyKWh,4)
  const cards=consumables?[['焊丝计算量',wire,'kg'],['保护气体计算量',gas,'m³'],['电弧能量',energy,'kWh'],['累计起弧时长',number(total.arcSeconds),'s']]
    :[['完成仿真批次',number(completedRuns,0),'批'],['完成焊道',number(completedWelds,0),'条'],['累计起弧焊接长度',number(total.weldMm/1000,3),'m'],['仿真道次完成率',planned?number(completed/planned*100,1):'0','%']]
  const rows=filtered.slice().reverse().flatMap(r=>r.tasks.map(task=>({record:r,task})))
  const exportCsv=()=>{
    const url=URL.createObjectURL(new Blob([executionCsv(filtered)],{type:'text/csv;charset=utf-8'})),a=document.createElement('a')
    a.href=url;a.download=`weldone-仿真${consumables?'耗材':'产量'}统计-${today}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  return <section className="production-statistics" aria-label="生产统计">
    <PageHeader title="生产统计" actions={<button type="button" className="btn" disabled={!filtered.length} title={filtered.length?'导出当前筛选结果':'当前筛选条件下无记录可导出'} onClick={exportCsv}><Download size={15}/>导出 CSV</button>}/>
    <div className="statistics-body">
    <div className="statistics-query">
      <div role="group" aria-label="统计视图" className="panel-tabs"><button className={!consumables?'active':''} aria-pressed={!consumables} onClick={()=>{setConsumables(false);setPage(0)}}>产量统计</button><button className={consumables?'active':''} aria-pressed={consumables} onClick={()=>{setConsumables(true);setPage(0)}}>耗材统计</button></div>
      <div className="statistics-filters"><span><CalendarDays size={15}/>统计日期</span><div className="statistics-segmented" role="group" aria-label="统计日期">{[1,7,30].map(p=><button className="btn" key={p} aria-pressed={period===p} onClick={()=>{setPeriod(p);setPage(0)}}>{p===1?'今日':`近 ${p} 天`}</button>)}</div>
        <label>工件<select aria-label="统计工件" value={model} onChange={e=>{setModel(e.target.value);setPage(0)}}><option value="all">全部工件</option>{[...new Map(records.map(r=>[r.modelId,r.modelName])).entries()].map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
      </div>
    </div>
    <details className="statistics-explanation"><summary>统计口径</summary><p>数据来自本浏览器最近 300 批生产执行仿真记录，按开始日期统计（北京时间）。预览和未起弧的运行仅计入仿真批次，不计入焊接长度、完成焊道和耗材。重复执行分别记录，不代表实体工件交付数量。</p></details>
    <div className="statistics-metrics">{cards.map(([label,value,unit])=><div key={label}><span>{label}</span><strong>{value}<small>{unit}</small></strong></div>)}</div>
    {consumables&&<details className="statistics-explanation"><summary>耗材计算口径</summary><p>焊丝按送丝速度、直径、密度和起弧时长计算，气体按流量和起弧时长计算；电弧能量按电流、电压积分。缺少任一必要参数时显示“—”；这些为仿真计算值，不是设备实测消耗。</p></details>}
    <section className="statistics-chart"><header><div><h2>{consumables?'焊丝计算量趋势':'产量趋势'}</h2><span>{model==='all'?'全部工件':filtered[0]?.modelName??'当前工件'} · 最近 {period} 天</span></div>{!consumables&&<div className="statistics-segmented"><button className="btn" aria-pressed={metric==='runs'} onClick={()=>setMetric('runs')}>完成批次</button><button className="btn" aria-pressed={metric==='length'} onClick={()=>setMetric('length')}>焊接长度</button></div>}</header>
      {filtered.length>0&&<div className="statistics-chart-unit">{consumables?'kg':metric==='runs'?'批':'m'}<span>{chosen.day}：{chosen.value===null?'未配置耗材参数':number(chosen.value,4)}</span></div>}
      {!filtered.length?<EmptyState text="暂无生产执行仿真记录" description="有符合筛选条件的记录后，趋势会在这里显示。"/>:<div className="statistics-bars">{bars.map(bar=><button key={bar.day} aria-label={`${bar.day} ${bar.value===null?'未确认':bar.value}`} aria-pressed={bar.day===chosen.day} onClick={()=>setActive(bar.day)}><span>{bar.value===null?'—':number(bar.value,3)}</span><i style={{height:bar.value===null?0:`${Math.max(0,bar.value/max*150)}px`}}/><small>{bar.day.slice(5)}</small></button>)}</div>}
    </section>
    <section className="statistics-details"><header><h2>{consumables?'耗材计算明细':'仿真执行明细'}</h2><span>{rows.length} 条道次记录</span></header>
      <div className="statistics-table-scroll"><table><thead><tr>{(consumables?['工件／焊道','道次','起弧时长 s','焊丝 kg','气体 m³','电弧能量 kWh','状态']:['开始时间','工件／焊道','道次／焊接位置','执行类型','运行距离 m','起弧焊接 m','状态']).map(h=><th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.slice(page*50,page*50+50).map(({record:r,task:t})=><tr key={r.id+'|'+t.id}>{(consumables
          ?[`${r.modelName} / ${t.label}`,t.passIndex+1,number(t.arcSeconds),t.unknownWireSeconds>1e-8?'未配置':number(t.wireKg,4),t.unknownGasSeconds>1e-8?'未配置':number(t.gasM3,4),t.unknownEnergySeconds>1e-8?'未配置':number(t.energyKWh,4)]
          :[new Date(r.startedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}),`${r.modelName} / ${t.label}`,`${t.passIndex+1} / ${t.position}`,r.kind==='preview'?'几何预览':r.arcEnabled?'起弧仿真':'无弧仿真',number(t.travelMm/1000,3),number(t.weldMm/1000,3)]).map((value,i)=><td key={i}>{value}</td>)}<td>{t.completed?'已完成':EXECUTION_STATUS_NAMES[r.status]}</td></tr>)}</tbody></table></div>
      {!rows.length&&<EmptyState text="当前筛选条件下无仿真明细"/>}
      {rows.length>50&&<footer><button className="btn" disabled={!page} onClick={()=>setPage(p=>p-1)}>上一页</button><span>{page+1} / {Math.ceil(rows.length/50)}</span><button className="btn" disabled={(page+1)*50>=rows.length} onClick={()=>setPage(p=>p+1)}>下一页</button></footer>}
    </section>
    </div>
  </section>
}
