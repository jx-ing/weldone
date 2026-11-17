import React,{useMemo,useState} from 'react';
import {partitionWelds} from './multiRobotAllocation.mjs';
import {formatDecimal} from './numericPrecision.mjs';

export default function MultiRobotAllocation({welds,robots,settings,onOverride}){
 const tasks=useMemo(()=>partitionWelds(welds,robots,settings),[welds,robots,settings]);
 const [filter,setFilter]=useState(''),[search,setSearch]=useState('');
 const summary=new Map(robots.map(robot=>[robot.id,{count:0,length:0,seconds:0}]));
 for(const task of tasks){
  const load=summary.get(task.robotId);
  if(load){load.count++;load.length+=task.length;load.seconds+=task.seconds;}
 }
 const visible=tasks.filter(task=>(!filter||task.robotId===filter)&&
  (task.weldId+' '+task.block).toLowerCase().includes(search.trim().toLowerCase()));
 return <>
  <div className="planning-robot-loads" aria-label="机械臂任务量">
   {robots.map(robot=>{
    const load=summary.get(robot.id);
    return <button type="button" key={robot.id} aria-pressed={filter===robot.id}
     onClick={()=>setFilter(filter===robot.id?'':robot.id)}>
     <strong>{robot.label}{robot.model&&' · '+robot.model}</strong>
     <span>{load.count} 条 · {formatDecimal(load.length/1000)} m</span>
     <small>预计 {formatDecimal(load.seconds/60)} min</small>
    </button>;
   })}
  </div>
  {!tasks.length?<p className="planning-setting-note">参数有效且已有焊道时显示分配结果。</p>:<>
   <div className="planning-allocation-search">
    <input aria-label="搜索分配焊道" placeholder="搜索焊缝编号 / 区域" value={search} onChange={event=>setSearch(event.target.value)}/>
    <span>{visible.length} 条</span>
   </div>
   <div className="planning-allocation-table">
    <table aria-label="焊道分配预览">
     <thead><tr><th>焊缝</th><th>区域</th><th>任务量</th><th>执行机械臂</th></tr></thead>
     <tbody>{visible.map(task=><tr key={task.weldId}>
      <td>{task.weldId}</td><td>{task.block}</td><td>{formatDecimal(task.seconds)} s</td>
      <td><select aria-label={task.weldId+' 执行机械臂'} value={task.manual?task.robotId:''}
       onChange={event=>onOverride(task.key,event.target.value)}>
       <option value="">{task.manual?'自动分配':'自动 · '+robots.find(robot=>robot.id===task.robotId).label}</option>
       {robots.map(robot=><option key={robot.id} value={robot.id}>{robot.label}</option>)}
      </select></td>
     </tr>)}</tbody>
    </table>
    {!visible.length&&<p className="planning-setting-note">没有匹配的焊缝。</p>}
   </div>
  </>}
 </>;
}
