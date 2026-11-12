export const EXECUTION_RECORDS_KEY = 'weldone.production.executionRecords.v1'
export const emptyExecutionMetrics = () => ({ travelMm: 0, weldMm: 0, simulationSeconds: 0, arcSeconds: 0,
  wireKg: 0, gasM3: 0, energyKWh: 0, unknownWireSeconds: 0, unknownGasSeconds: 0, unknownEnergySeconds: 0 })
export function sumExecutionMetrics(records) {
  const total = emptyExecutionMetrics()
  for (const record of records) for (const task of record.tasks)
    for (const key of Object.keys(total)) total[key] += task[key]
  return total
}
export const executionDay = (date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date(date))
export function executionCsv(records) {
  const cell = (s) => '"' + String(s ?? '').replaceAll('"', '""').replace(/^(\s*[=+@\-])/, "'$1") + '"'
  const rows = [['记录编号','工件','开始时间','状态','执行类型','起弧','焊道','道次','焊接位置','是否完成','运行距离mm','焊接长度mm','仿真时长s','起弧时长s','焊丝kg','气体m3','电弧能量kWh','工艺参数']]
  for (const record of records) for (const task of record.tasks) rows.push([record.id,record.modelName,record.startedAt,record.status,
    record.kind,record.arcEnabled?'是':'否',task.label,task.passIndex+1,task.position,task.completed?'是':'否',task.travelMm,task.weldMm,
    task.simulationSeconds,task.arcSeconds,task.unknownWireSeconds>1e-8?'未配置':task.wireKg,
    task.unknownGasSeconds>1e-8?'未配置':task.gasM3,task.unknownEnergySeconds>1e-8?'未配置':task.energyKWh,task.parameter])
  return '\ufeff' + rows.map(row => row.map(cell).join(',')).join('\r\n')
}
export function readExecutionRecords(storage) {
  try {
    const raw = (storage ?? window.localStorage).getItem(EXECUTION_RECORDS_KEY)
    const value = raw ? JSON.parse(raw) : null
    if (value?.version !== 1 || !Array.isArray(value.records)) return []
    const keys = Object.keys(emptyExecutionMetrics())
    return value.records.filter((record) => record && typeof record.id === 'string' && typeof record.modelName === 'string'
      && typeof record.modelId === 'string' && typeof record.arcEnabled === 'boolean'
      && Number.isFinite(Date.parse(record.startedAt)) && ['preview','welding'].includes(record.kind)
      && ['running','paused','completed','stopped','error'].includes(record.status) && Array.isArray(record.tasks)
      && record.tasks.every(task => task && typeof task.id === 'string' && typeof task.label === 'string' && typeof task.position === 'string'
        && typeof task.completed === 'boolean' && Number.isSafeInteger(task.passIndex) && task.passIndex >= 0
        && Array.isArray(task.weldIds) && task.weldIds.every(id=>typeof id==='string')
        && keys.every(key => typeof task[key] === 'number' && Number.isFinite(task[key]) && task[key] >= 0)
        && Number.isFinite(task.plannedSeconds) && task.plannedSeconds > 0))
      .slice(-300).map((record) => record.status === 'running' || record.status === 'paused'
        ? { ...record, status: 'stopped', note: '上次页面关闭，记录保留已完成的仿真区间。' } : record)
  } catch { return [] }
}
