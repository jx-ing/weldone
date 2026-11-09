// Optional rows become active when the user supplies parameters; blank rows stay unused.
export function editOptionalProcessValues(current,changes,machineMode){
 const next={...current,...changes};
 const filled=value=>value!==null&&value!==undefined&&value!=='';
 const power=machineMode==='job'?['job']:machineMode==='synergic'?['current']:['current','voltage'];
 const crater=Object.hasOwn(next,'distance');
 const fields=crater?[...power,'distance','speed','actualSpeed']:power;
 next.enabled=fields.some(key=>filled(next[key]))
  ||(machineMode==='synergic'&&filled(next.correction)&&next.correction!==0)
  ||(filled(next.time)&&next.time!==0)
  ||next.weave?.enabled===true;
 return next;
}
