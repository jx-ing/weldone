export const ASSISTANT_ENABLED = true;
export const ASSISTANT_LIMITS = {question: 2000, context: 4000, history: 8, answer: 6000, inventory: 8000, notes: 4, note: 400};

export const ASSISTANT_GUIDES = [
  {
    id: 'weld',
    question: '帮我检查当前焊缝',
    matches: /当前焊|这(条|道)焊|未匹配|待处理|匹配失败|焊缝.*(为什么|原因|没生成|排查)/,
    answer: '在「工艺规划」的结构树选中焊缝。先确认该焊缝已启用，再在右侧「焊缝属性」查看模板和工艺参数的匹配结果，以及跟踪方向、最小长度或碰撞状态。',
  },
  {
    id: 'logs',
    question: '怎么看规划日志？',
    matches: /日志|报错|规划失败|规划未完成/,
    answer: '在「工艺规划」的模型视图下方展开「日志」，查看最近的一键规划记录。可以搜索焊缝编号或「未完成」，定位相关记录。',
  },
  {
    id: 'production',
    question: '如何导出到生产执行？',
    matches: /导出|发布|生产执行|仿真|\bpf\b/i,
    answer: '在「工艺规划」完成规划并检查焊缝状态后，点击「导出任务」，再进入「生产执行」查看已发布任务。选择一道后可用「一键执行」在工作站视图中仿真。',
  },
  {
    id: 'planning',
    question: '怎么开始一键规划？',
    matches: /一键规划|导入模型|导入.*step|提取焊缝|工艺规划设置/i,
    answer: '在「工艺规划」打开「导入模型」，选择 STEP 文件，然后点击「一键规划」。旁边的齿轮用于打开「工艺规划设置」。规划完成后，在结构树中选择焊缝并查看右侧属性。',
  },
];

export function planningAssistantContext({weld, match, trackingIssue, weldCount, enabledCount, logs, progress}) {
  const recentLogs = [...logs].sort((a, b) => b.sequence - a.sequence).slice(0, 3)
    .map(({message}) => message.slice(0, 240));
  const weldLines = weld ? [
    `当前焊缝 ${weld.id} · ${weld.enabled ? '已启用' : '已屏蔽'} · ${weld.position || '焊位待确认'}`,
    `焊缝长度 ${Number(weld.length.toFixed(2))} mm${Number.isFinite(weld.leg) ? `，焊脚 ${Number(weld.leg.toFixed(2))} mm` : ''}`,
    weld.disabledByMinWeldLength && '短于最小焊缝长度，已屏蔽',
    match?.reason?.slice(0, 240),
    trackingIssue !== match?.reason && trackingIssue?.slice(0, 240),
    weld.collisionState?.slice(0, 240),
  ].filter(Boolean) : [];
  const text = [
    `已启用 ${enabledCount} / ${weldCount} 条焊缝`,
    progress?.stage,
    ...weldLines,
    ...recentLogs.map(message => `日志 · ${message}`),
  ].filter(Boolean).join('\n');
  return {text: text.slice(0, ASSISTANT_LIMITS.context), weldLines, recentLogs};
}

export function localAssistantAnswer(question, context) {
  const guide = ASSISTANT_GUIDES.find(item => item.question === question) ??
    ASSISTANT_GUIDES.find(item => item.matches.test(question));
  if (!guide) return '请输入一项具体操作，例如「打开生产统计」「把 W10001 的焊脚改为 6 mm」或「W10001 拆成两个 L 形包角」。也可以询问一键规划、焊缝排查、日志或任务导出。';
  if (guide.id === 'weld' && context?.weldLines.length) return `${context.weldLines.join('\n')}\n\n${guide.answer}`;
  if (guide.id === 'logs' && context?.recentLogs.length) {
    return `最近的规划日志\n${context.recentLogs.join('\n')}\n\n${guide.answer}`;
  }
  return guide.answer;
}
