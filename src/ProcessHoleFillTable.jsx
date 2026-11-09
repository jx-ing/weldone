import React from 'react';

const speedInCm = value => value == null ? null : value / 10;

export default function ProcessHoleFillTable({rows,editing,onChange}){
 return <div className="process-parameter-scroll"><table className="process-parameter-table" aria-label="立焊过焊孔填充参数">
  <thead><tr>
   <th scope="col">焊道</th><th scope="col">电流 (A)</th><th scope="col">电压／修正值</th><th scope="col">机器人工艺号</th>
   <th scope="col">过焊孔填充速度 <small>(cm/min)</small></th>
   <th scope="col">过焊孔填充起弧停留时间 <small>(s)</small></th>
  </tr></thead>
  <tbody>{rows.map(({pass},index)=>{
   const values=pass.holeFill??{};
   const fields=[
    {key:'current',label:'填充电流',enabled:pass.machineMode!=='job'},
    {key:pass.machineMode==='synergic'?'correction':'voltage',label:'填充电压／修正值',enabled:pass.machineMode!=='job'},
    {key:'job',label:'填充JOB号',enabled:pass.machineMode==='job'},
    {key:'speed',label:'过焊孔填充速度',min:0,placeholder:'沿用焊接速度',fallback:speedInCm(pass.weld.speed)},
    {key:'time',label:'过焊孔填充起弧停留时间',min:0,step:.01,placeholder:'沿用起弧时间',fallback:pass.start.time}
   ];
   return <tr key={pass.id}><td>P{index+1}</td>{fields.map(({key,label,enabled=true,min,step=key==='correction'?'any':1,placeholder='沿用起弧参数',fallback})=>{
    const value=key==='speed'?speedInCm(values[key]):values[key];
    return <td key={key}>{editing?<input type="number" min={min} step={step}
     aria-label={`P${index+1} ${label}`} disabled={!enabled} value={value??''} placeholder={fallback??placeholder}
     onChange={event=>{
      const input=event.target.value;
      onChange(pass,{holeFill:{...values,[key]:input===''?null:Number(input)*(key==='speed'?10:1)}});
     }}/>:enabled?value??fallback??placeholder:'—'}</td>;
   })}</tr>;
  })}</tbody>
 </table></div>;
}
