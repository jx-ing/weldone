import React, {useEffect, useRef, useState} from 'react';
import {ArrowUp, Check, MessageSquareText, RotateCcw, Settings, ShieldCheck, Square, X} from 'lucide-react';
import {ASSISTANT_ENABLED, ASSISTANT_GUIDES, ASSISTANT_LIMITS, localAssistantAnswer, planningAssistantContext} from './assistantGuide.mjs';
import {assistantActionDefinition, describeAssistantAction, ASSISTANT_TASK_LIMIT} from './assistantActions.mjs';
import {localAssistantAction} from './localAssistantCommands.mjs';
import {askBrowserModel, normalizeBrowserModelConfig, testBrowserModel} from './browserAssistantModel.mjs';
import './weldoneAssistant.css';

const PREVIEW_TTL = 10 * 60 * 1000;
const loopbackHost = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
const browserPresets = [
  {id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat'},
  {id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini'},
  {id: 'local', label: '本机模型（Ollama）', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5'},
  {id: 'custom', label: '自定义兼容服务', baseUrl: '', model: ''},
];
const STEP_LABEL = {pending: '待执行', running: '执行中…', ok: '已完成', failed: '失败', paused: '已暂停'};

export default function WeldoneAssistant(props) {
  if (ASSISTANT_ENABLED) return <AssistantChat {...props}/>;
  return <button type="button" className="assistant-trigger" disabled title="AI 助手暂不支持">
    <MessageSquareText size={17} aria-hidden="true"/><span>AI 助手 · 暂不支持</span>
  </button>;
}

function AssistantChat({page, planning, dialogOpen, inventory = '', weldLabels = {}, onAction, getContextVersion}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('local');
  const [service, setService] = useState(loopbackHost ? 'checking' : 'browser');
  const [browserConfig, setBrowserConfig] = useState(null);
  const [turns, setTurns] = useState([]);
  const [draft, setDraft] = useState('');
  const [attach, setAttach] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [task, setTask] = useState(null);
  const [notes, setNotes] = useState([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profile, setProfile] = useState(null);
  const [config, setConfig] = useState({baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: ''});
  const [configBusy, setConfigBusy] = useState(false);
  const [configNote, setConfigNote] = useState('');
  const [presetId, setPresetId] = useState('deepseek');
  const [usage, setUsage] = useState(null);
  const trigger = useRef(null);
  const input = useRef(null);
  const scroll = useRef(null);
  const request = useRef(null);
  const taskSequence = useRef(0);
  const taskRef = useRef(null);
  const actionHandler = useRef(onAction);
  actionHandler.current = onAction;
  const context = open && planning ? planningAssistantContext(planning) : null;
  const prompts = page === '工艺规划' ? ASSISTANT_GUIDES.slice(0, 3) : ASSISTANT_GUIDES.slice(2);
  const running = task?.status === 'running';
  const busy = pending || running || (!!task && task.status !== 'failed') || settingsOpen;
  const presets = service === 'server' && profile?.presets?.length ? profile.presets : browserPresets;

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    if (!loopbackHost || browserConfig) return;
    const controller = new AbortController();
    fetch('/api/assistant/status', {signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)])})
      .then(response => response.ok ? response.json() : null)
      .then(status => {
        if (!controller.signal.aborted) {
          setService(typeof status?.available === 'boolean' ? 'server' : 'browser');
          setMode(status?.available === true ? 'model' : 'local');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) { setService('browser'); setMode('local'); }
      });
    return () => controller.abort();
  }, [open, browserConfig]);

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => { setAttach(false); }, [page]);
  useEffect(() => { taskRef.current = task; }, [task]);

  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [open, turns, pending, error, task]);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  function revision() {
    return typeof getContextVersion === 'function' ? getContextVersion() : 0;
  }

  function buildTask(actions) {
    const steps = actions.map((action, index) => ({
      stepId: 's' + (index + 1),
      action,
      summary: describeAssistantAction(action, weldLabels),
      danger: !!assistantActionDefinition(action.name)?.danger,
      status: 'pending',
      message: '',
    }));
    const sequence = ++taskSequence.current;
    return {
      previewId: 'preview-' + sequence,
      operationId: 'operation-' + sequence,
      contextVersion: revision(),
      expiresAt: Date.now() + PREVIEW_TTL,
      status: 'proposed',
      steps,
      note: '',
    };
  }

  function remember(text) {
    setNotes(current => [...current, text.slice(0, ASSISTANT_LIMITS.note)].slice(-ASSISTANT_LIMITS.notes));
  }

  async function sendQuestion(event) {
    event.preventDefault();
    const question = draft.trim();
    if (!question || request.current || busy) return;
    if (task?.status === 'failed') setTask(null);
    const summary = attach ? context : null;
    setAttach(false);
    setDraft('');
    setError('');
    const localAction = localAssistantAction(question, {selectedWeldId: planning?.weld?.id, page});
    if (localAction) {
      setTurns(current => [...current, {kind: 'chat', question, answer: '请核对下方待确认的操作。', mode: 'local'}]);
      setTask(buildTask([localAction]));
      return;
    }
    if (mode === 'local') {
      setTurns(current => [...current, {kind: 'chat', question, answer: localAssistantAnswer(question, summary), mode}]);
      return;
    }

    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    const modelEndpoint = browserConfig?.baseUrl;
    const history = turns.filter(turn => turn.kind === 'chat' && turn.mode === 'model' && turn.modelEndpoint === modelEndpoint && (summary || !turn.sharedContext))
      .slice(-ASSISTANT_LIMITS.history / 2).flatMap(({question, answer}) => [
        {role: 'user', content: question}, {role: 'assistant', content: answer},
      ]);
    try {
      const conversation = {question, history, context: summary?.text ?? '', inventory, notes};
      let result;
      if (browserConfig) {
        result = await askBrowserModel(browserConfig, conversation, {signal: controller.signal});
      } else {
        const response = await fetch('/api/assistant/chat', {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(conversation), signal: controller.signal,
        });
        result = await response.json();
        if (!response.ok) throw Error(result.error || '模型服务请求失败');
      }
      const actions = Array.isArray(result.actions) ? result.actions : result.action ? [result.action] : [];
      if (!result.answer && !actions.length) throw Error('模型服务未返回文本回复');
      if (actions.length > ASSISTANT_TASK_LIMIT) throw Error(`一次最多执行 ${ASSISTANT_TASK_LIMIT} 步操作`);
      const answer = typeof result.answer === 'string' ? result.answer : '';
      if (answer) {
        setTurns(current => [...current, {kind: 'chat', question, answer, mode, modelEndpoint, sharedContext: !!summary}]);
      }
      if (actions.length) setTask(buildTask(actions));
    } catch (failure) {
      setDraft(question);
      if (!controller.signal.aborted) setError(failure instanceof TypeError ? (browserConfig ? '无法连接模型服务，请检查地址及跨域设置' : '无法连接本机助手接口，请重试') :
        failure instanceof SyntaxError ? '无法读取模型回复，请重试' : failure.message);
    } finally {
      request.current = null;
      setPending(false);
    }
  }

  function cancelTask() {
    if (taskRef.current?.status === 'running') return;
    taskRef.current = null;
    setTask(null);
    input.current?.focus();
  }

  function finishTask(steps, completed, total, ok) {
    setTurns(current => [...current, {
      kind: 'task',
      steps: steps.map(step => ({summary: step.summary, status: step.status, message: step.message, danger: step.danger})),
      completed, total, ok,
    }]);
  }

  async function executeTask() {
    const current = taskRef.current;
    if (current?.status !== 'proposed' || !onAction) return;
    if (Date.now() > current.expiresAt || revision() !== current.contextVersion) {
      const refreshed = buildTask(current.steps.map(step => step.action));
      refreshed.status = 'proposed';
      refreshed.note = Date.now() > current.expiresAt
        ? '预览已过期，已按当前工作区重新生成，请再次确认。'
        : '工作区在确认前发生变化，已刷新预览，请再次确认。';
      taskRef.current = refreshed;
      setTask(refreshed);
      return;
    }

    const working = {
      ...current, status: 'running',
      steps: current.steps.map(step => ({...step, status: 'pending', message: ''})),
    };
    taskRef.current = working;
    setTask(working);
    let completed = 0;
    let failed = null;
    for (const step of working.steps) {
      step.status = 'running';
      setTask({...working, steps: [...working.steps]});
      let result;
      try {
        result = await actionHandler.current(step.action);
        if (!result || typeof result.ok !== 'boolean') result = {ok: false, message: '本机未返回执行结果'};
      } catch (failure) {
        result = {ok: false, message: failure?.message || '执行失败'};
      }
      step.message = result.message;
      step.choices = Array.isArray(result.choices) ? result.choices : null;
      step.status = result.ok ? 'ok' : 'failed';
      if (result.ok) completed += 1;
      else {
        failed = step;
        break;
      }
      setTask({...working, steps: [...working.steps]});
    }
    if (failed) {
      for (const step of working.steps) if (step.status === 'pending') step.status = 'paused';
    }
    const ok = !failed;
    working.status = ok ? 'done' : 'failed';
    working.steps = [...working.steps];
    taskRef.current = ok ? null : working;
    setTask(taskRef.current);
    finishTask(working.steps, completed, working.steps.length, ok);
    remember(`任务 ${completed}/${working.steps.length} 步完成${failed ? `，第 ${working.steps.indexOf(failed) + 1} 步失败：${failed.message}` : ''}`);
  }

  async function retryRemaining() {
    const current = taskRef.current;
    if (!current || current.status === 'running') return;
    const remaining = current.steps.filter(step => step.status !== 'ok');
    if (!remaining.length) return setTask(null);
    const refreshed = buildTask(remaining.map(step => step.action));
    refreshed.note = '将从失败步骤继续执行；已完成的步骤不会重复。';
    setTask(refreshed);
  }

  async function openSettings() {
    setSettingsOpen(true);
    setConfigNote('');
    setConfig(current => ({...current, apiKey: ''}));
    if (service !== 'server') return;
    fetch('/api/assistant/usage')
      .then(response => response.ok ? response.json() : null)
      .then(data => { if (data) setUsage(data); })
      .catch(() => {});
    try {
      const response = await fetch('/api/assistant/config');
      const data = await response.json();
      if (response.ok) {
        setProfile(data);
        setConfig(current => ({
          baseUrl: data.baseUrl || current.baseUrl,
          model: data.model || current.model,
          apiKey: '',
        }));
      }
    } catch {}
  }

  function choosePreset(id) {
    setPresetId(id);
    const preset = presets.find(item => item.id === id);
    if (!preset) return;
    setConfig(current => ({
      ...current,
      baseUrl: preset.baseUrl,
      model: preset.model,
      apiKey: '',
    }));
  }

  async function saveConfig(event) {
    event.preventDefault();
    if (configBusy) return;
    if (service === 'browser') {
      setConfigBusy(true);
      setConfigNote('正在测试模型连接…');
      try {
        const next = normalizeBrowserModelConfig(config);
        await testBrowserModel(next);
        setBrowserConfig(next);
        setMode('model');
        setConfig(current => ({...current, apiKey: ''}));
        setConfigNote('本页已连接 ' + next.model);
      } catch (error) {
        setConfigNote(error.message || '连接测试失败');
      } finally {
        setConfigBusy(false);
      }
      return;
    }
    if (service !== 'server') return;
    if (!config.baseUrl.trim() || !config.model.trim() || !config.apiKey.trim()) {
      setConfigNote('请填写接口地址、模型名称和 API Key');
      return;
    }
    setConfigBusy(true);
    setConfigNote('正在校验并保存…');
    try {
      const response = await fetch('/api/assistant/config', {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(config),
      });
      const data = await response.json();
      if (!response.ok) {
        setConfigNote(data.error || '保存失败');
        return;
      }
      setConfigNote(data.warning || `已切换到 ${data.model}，配置已保存`);
      setMode('model');
      setProfile(current => ({...current, available: true, baseUrl: data.baseUrl, model: data.model, keyHint: data.keyHint}));
      setTimeout(async () => {
        try {
          const status = await fetch('/api/assistant/status').then(item => item.json());
          if (status?.available) setMode('model');
        } catch {}
      }, 3000);
    } catch {
      setConfigNote('无法连接本机助手接口，请重试');
    } finally {
      setConfigBusy(false);
    }
  }

  function stop() {
    request.current?.abort();
  }

  return <>
    <button ref={trigger} type="button" className="assistant-trigger" aria-label="AI 助手" title="AI 助手"
      aria-controls={open ? 'weldone-assistant' : undefined} aria-expanded={open} onClick={() => open ? close() : setOpen(true)}>
      <MessageSquareText size={17}/><span>AI 助手</span>
    </button>
    {open && <section id="weldone-assistant" className="weldone-assistant" aria-labelledby="assistant-title"
      onKeyDown={event => {
        if (event.key === 'Escape' && !dialogOpen) {
          event.stopPropagation();
          if (task) cancelTask();
          else close();
        }
      }}>
      <header className="assistant-header">
        <div className="assistant-title-icon"><MessageSquareText size={19}/></div>
        <div className="assistant-heading">
          <h2 id="assistant-title">AI 助手</h2>
          <p>{page} · {mode === 'model' ? '模型已连接' : '本地助手'}</p>
        </div>
        <button type="button" className="icon assistant-settings-toggle" aria-label="模型服务设置" title="模型服务设置" disabled={service === 'checking' || pending || running || configBusy}
          aria-pressed={settingsOpen} onClick={() => settingsOpen ? setSettingsOpen(false) : openSettings()}><Settings size={17}/></button>
        <button type="button" className="assistant-clear" disabled={!turns.length || busy}
          onClick={() => { setTurns([]); setDraft(''); setError(''); setAttach(false); setNotes([]); input.current?.focus(); }}>清空对话</button>
        <button type="button" className="icon assistant-close" aria-label="关闭 AI 助手" onClick={close}><X size={18}/></button>
      </header>

      <div className="assistant-scroll" ref={scroll} role="log" aria-label="助手对话">
        {settingsOpen ? <div className="assistant-settings">
          <h3>模型服务</h3>
          <p className="assistant-settings-note">{service === 'browser'
            ? '使用你自己的 OpenAI 兼容服务。浏览器直接连接填写的地址，服务需允许当前网页跨域访问。密钥仅在当前标签页内存中使用，刷新后清除。'
            : '模型连接配置保存在本机，由本机助手服务调用。'}</p>
          {usage && <p className="assistant-settings-note">
            本机累计调用 {usage.total.calls.toLocaleString('zh-CN')} 次 · {usage.total.total.toLocaleString('zh-CN')} tokens
            （今日 {usage.today.calls.toLocaleString('zh-CN')} 次 / {usage.today.total.toLocaleString('zh-CN')} tokens）
          </p>}
          <form onSubmit={saveConfig}><fieldset disabled={configBusy} style={{border:0,padding:0,margin:0,display:'contents'}}>
            <label>服务预设
              <select value={presetId} onChange={event => choosePreset(event.target.value)}>
                {presets.map(preset => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
              </select>
            </label>
            <label>接口地址
              <input value={config.baseUrl} spellCheck={false} placeholder="https://api.deepseek.com/v1"
                onChange={event => setConfig(current => ({...current, baseUrl: event.target.value, apiKey: ''}))}/>
            </label>
            <label>模型名称
              <input value={config.model} spellCheck={false} placeholder="deepseek-chat"
                onChange={event => setConfig(current => ({...current, model: event.target.value}))}/>
            </label>
            <label>{service === 'browser' ? 'API Key（服务需要时填写）' : 'API Key'}
              <input type="password" value={config.apiKey} autoComplete="off"
                placeholder={profile?.keyHint ? `已保存 ${profile.keyHint}，更换请重新填写` : '请输入'}
                onChange={event => setConfig(current => ({...current, apiKey: event.target.value}))}/>
            </label>
            {configNote && <p className="assistant-settings-note" role="status">{configNote}</p>}
            <div className="assistant-settings-buttons">
              <button type="button" onClick={() => setSettingsOpen(false)}>返回对话</button>
              {browserConfig && <button type="button" onClick={() => {
                setBrowserConfig(null); setMode('local'); setConfig(current => ({...current, apiKey: ''})); setConfigNote('已断开个人模型');
              }}>断开连接</button>}
              <button type="submit" className="assistant-settings-save" disabled={configBusy}>{service === 'browser' ? (configBusy ? '正在测试…' : '连接并测试') : (configBusy ? '正在保存…' : '保存并测试')}</button>
            </div>
          </fieldset></form>
        </div> : <>
        {!turns.length && !pending && <div className="assistant-start">
          <h3>想了解什么？</h3>
          <p>{mode === 'local' ? '可输入「打开生产统计」「选中 W10001」或「W10001 拆成两个 L 形包角」。核对操作后点击确认执行。' :
            '可以提问，也可以让我执行启用、屏蔽、修改属性、打断、撤销、复检、发布等操作。每次改动前都会先请你确认。'}</p>
          <div className="assistant-prompts" role="group" aria-label="常用问题">
            {prompts.map(({id, question}) => <button key={id} type="button" onClick={() => {
              setDraft(question);
              input.current?.focus();
            }}>{question}</button>)}
          </div>
        </div>}
        {turns.map((turn, index) => turn.kind === 'task' ? <div key={index} className="assistant-turn">
          <p className="assistant-message assistant-action-log">
            <span className="assistant-message-label">{turn.ok ? `已完成 ${turn.completed}/${turn.total} 步` : `已暂停 ${turn.completed}/${turn.total} 步`}</span>
            任务执行记录
          </p>
          <ol className="assistant-steps assistant-steps-done">
            {turn.steps.map((step, stepIndex) => <li key={stepIndex} data-status={step.status}>
              <span className="assistant-step-index">{stepIndex + 1}</span>
              <span className="assistant-step-text">{step.summary}</span>
              <span className="assistant-step-status">{STEP_LABEL[step.status] || step.status}</span>
              {step.message && <span className="assistant-step-message">{step.message}</span>}
            </li>)}
          </ol>
        </div> : <div key={index} className="assistant-turn">
          <p className="assistant-message assistant-user"><span className="assistant-message-label">我</span>{turn.question}</p>
          <p className="assistant-message assistant-response"><span className="assistant-message-label">{turn.mode === 'model' ? 'AI 助手' : '本地助手'}</span>{turn.answer}</p>
        </div>)}
        {pending && <p className="assistant-feedback">正在生成回复…</p>}
        {error && <p role="alert" className="assistant-feedback assistant-error">{error}</p>}
        </>}
      </div>

      {!settingsOpen && <form className="assistant-composer" onSubmit={sendQuestion}>
        {task && <div className={'assistant-action assistant-task' + (task.steps.some(step => step.danger) ? ' danger' : '')} role="group" aria-label="待确认任务">
          <p className="assistant-action-head"><ShieldCheck size={15}/><strong>{running ? '正在执行任务' : task.status === 'failed' ? '任务已暂停' : `待确认任务 · ${task.steps.length} 步`}</strong>
            {task.steps.some(step => step.danger) && <span className="assistant-action-danger">含高风险</span>}</p>
          <ol className="assistant-steps">
            {task.steps.map((step, index) => <li key={step.stepId} data-status={step.status}>
              <span className="assistant-step-index">{index + 1}</span>
              <span className="assistant-step-text">{step.summary}</span>
              {step.danger && <span className="assistant-step-danger">高风险</span>}
              <span className="assistant-step-status">{STEP_LABEL[step.status] || step.status}</span>
              {step.message && <span className="assistant-step-message">{step.message}</span>}
              {step.choices?.length > 0 && <span className="assistant-step-choices">
                {step.choices.map((choice, choiceIndex) => <button key={choiceIndex} type="button"
                  onClick={() => setTask(buildTask([choice.action, ...task.steps.slice(index + 1).map(step => step.action)]))}>{choice.label}</button>)}
              </span>}
            </li>)}
          </ol>
          <p className="assistant-action-note">{task.note || '确认后按顺序执行；执行前会复核当前工作区，工作区变化时需要重新确认。'}</p>
          <div className="assistant-action-buttons">
            {task.status === 'failed' ? <>
              <button type="button" className="assistant-action-cancel" disabled={running} onClick={() => setTask(null)}>关闭</button>
              <button type="button" className="assistant-action-run" disabled={running || !onAction} onClick={retryRemaining}>
                <RotateCcw size={14}/>重试剩余步骤</button>
            </> : <>
              <button type="button" className="assistant-action-cancel" disabled={running} onClick={cancelTask}>取消</button>
              <button type="button" className="assistant-action-run" disabled={running || !onAction} onClick={executeTask}>
                <Check size={14}/>{running ? '正在执行…' : `确认执行${task.steps.length > 1 ? `（${task.steps.length} 步）` : ''}`}</button>
            </>}
          </div>
        </div>}
        {context && <div className="assistant-context">
          <label><input type="checkbox" checked={attach} disabled={busy} onChange={event => setAttach(event.target.checked)}/>附上本轮规划摘要</label>
          {attach && <details><summary>查看摘要</summary><p>{context.text}</p></details>}
        </div>}
        <div className="assistant-input-row">
          <textarea ref={input} value={draft} placeholder="请输入" aria-label="输入问题" rows={2} readOnly={pending}
            maxLength={ASSISTANT_LIMITS.question} onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                if (!busy) event.currentTarget.form.requestSubmit();
              }
            }}/>
          {pending ? <button className="btn" type="button" onClick={stop} aria-label="停止生成" title="停止生成"><Square size={14}/></button> :
            <button className="btn primary" type="submit" disabled={!draft.trim() || !mode || busy} aria-label="发送问题" title="发送问题"><ArrowUp size={18}/></button>}
        </div>
        {mode === 'model' && <p className="assistant-send-note">模型问答会将问题、近期对话和工作区摘要发送到{browserConfig ? new URL(browserConfig.baseUrl).host : '已配置的模型服务'}。软件操作需确认后执行。</p>}
      </form>}
    </section>}
  </>;
}
