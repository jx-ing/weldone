export function assistantRecheckResult(welds, ids) {
  const checked = welds.filter(weld => ids.has(weld.id));
  if (!checked.length || checked.length !== ids.size) return {ok: false, message: '复检结果缺少目标焊缝'};
  const incomplete = checked.filter(weld => weld.collisionVerified !== true);
  if (incomplete.length) {
    const details = incomplete.map(weld => weld.id + ' · ' + (weld.collisionState || '未检测'));
    return {ok: false, message: '复检未通过：' + details.join('、')};
  }
  const near = checked.filter(weld => weld.collisionState === '间隙不足');
  const note = near.length ? '，间隙不足：' + near.map(weld => weld.id).join('、') : '';
  return {ok: true, message: `已复检 ${checked.length} 条焊缝，未发现碰撞${note}`};
}
