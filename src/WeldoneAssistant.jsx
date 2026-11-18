import React, {useEffect, useRef, useState} from 'react';
import {ArrowUp, Check, MessageSquareText, Settings, ShieldCheck, Square, X} from 'lucide-react';
import {ASSISTANT_ENABLED, ASSISTANT_GUIDES, ASSISTANT_LIMITS, localAssistantAnswer, planningAssistantContext} from './assistantGuide.mjs';
import {assistantActionDefinition, describeAssistantAction} from './assistantActions.mjs';
import './weldoneAssistant.css';

export default function WeldoneAssistant(props) {
  if (ASSISTANT_ENABLED) return <AssistantChat {...props}/>;
  return <button type="button" className="assistant-trigger" disabled title="AI 助手暂不支持">
    <MessageSquareText size={17} aria-hidden="true"/><span>AI 助手 · 暂不支持</span>
  </button>;
}

function AssistantChat({page, planning, dialogOpen, inventory = '', weldLabels = {}, onAction}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState(null);
  const [turns, setTurns] = useState([]);
  const [draft, setDraft] = useState('');
  const [attach, setAttach] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [proposal, setProposal] = useState(null);
  const [running, setRunning] = useState(false);
  const [notes, setNotes] = useState([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profile, setProfile] = useState(null);
  const [config, setConfig] = useState({baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: ''});
  const [configBusy, setConfigBusy] = useState(false);
  const [configNote, setConfigNote] = useState('');
  const [presetId, setPresetId] = useState('deepseek');
  const trigger = useRef(null);
  const input = useRef(null);
  const scroll = useRef(null);
  const request = useRef(null);
  const context = open && planning ? planningAssistantContext(planning) : null;
  const prompts = page === '工艺规划' ? ASSISTANT_GUIDES.slice(0, 3) : ASSISTANT_GUIDES.slice(2);
  const busy = pending || running || !!proposal || settingsOpen;
  const presets = profile?.presets?.length ? profile.presets : [
    {id: 'deepseek', label: 'DeepSeek'}, {id: 'openai', label: 'OpenAI'},
    {id: 'local', label: '本机模型（Ollama）'}, {id: 'custom', label: '自定义兼容服务'},
  ];

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const controller = new AbortController();
    fetch('/api/assistant/status', {signal: controller.signal})
      .then(response => response.ok ? response.json() : null)
      .then(status => {
        if (!controller.signal.aborted) setMode(status?.available === true ? 'model' : 'local');
      })
      .catch(() => {
        if (!controller.signal.aborted) setMode('local');
      });
    return () => controller.abort();
  }, [open]);

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => { setAttach(false); }, [page]);

  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [open, turns, pending, error, proposal, running]);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  function remember(action, result) {
    setNotes(current => [...current, `${describeAssistantAction(action, weldLabels)}：${result.message}`].slice(-ASSISTANT_LIMITS.notes));
  }

  async function sendQuestion(event) {
    event.preventDefault();
    const question = draft.trim();
    if (!question || request.current || !mode || busy) return;
    const summary = attach ? context : null;
    setAttach(false);
    setDraft('');
    setError('');
    if (mode === 'local') {
      setTurns(current => [...current, {kind: 'chat', question, answer: localAssistantAnswer(question, summary), mode}]);
      return;
    }

    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    const history = turns.filter(turn => turn.kind === 'chat' && turn.mode === 'model' && (summary || !turn.sharedContext))
      .slice(-ASSISTANT_LIMITS.history / 2).flatMap(({question, answer}) => [
        {role: 'user', content: question}, {role: 'assistant', content: answer},
      ]);
    try {
      const response = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({question, history, context: summary?.text ?? '', inventory, notes}),
        signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok || (!result.answer && !result.action)) throw Error(result.error || '模型服务未返回文本回复');
      const answer = typeof result.answer === 'string' ? result.answer : '';
      if (answer) {
        setTurns(current => [...current, {kind: 'chat', question, answer, mode, sharedContext: !!summary}]);
      }
      if (result.action) {
        const definition = assistantActionDefinition(result.action.name);
        setProposal({...result.action, description: describeAssistantAction(result.action, weldLabels), danger: !!definition?.danger});
      }
    } catch (failure) {
      setDraft(question);
      if (!controller.signal.aborted) setError(failure instanceof TypeError ? '无法连接本机助手接口，请重试' :
        failure instanceof SyntaxError ? '无法读取模型回复，请重试' : failure.message);
    } finally {
      request.current = null;
      setPending(false);
    }
  }

  function cancelProposal() {
    setProposal(null);
    input.current?.focus();
  }

  async function runProposal() {
    if (!proposal || !onAction || running) return;
    const action = proposal;
    setRunning(true);
    setError('');
    let result;
    try {
      result = await onAction({name: action.name, arguments: action.arguments});
      if (!result || typeof result.ok !== 'boolean') result = {ok: false, message: '本机未返回执行结果'};
    } catch (failure) {
      result = {ok: false, message: failure?.message || '执行失败'};
    }
    setTurns(current => [...current, {
      kind: 'action', question: action.description, answer: result.message, ok: result.ok,
    }]);
    remember(action, result);
    setProposal(null);
    setRunning(false);
    input.current?.focus();
  }

  function stop() {
    request.current?.abort();
  }

  async function openSettings() {
    setSettingsOpen(true);
    setConfigNote('');
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
    const preset = profile?.presets?.find(item => item.id === id);
    if (!preset) return;
    setConfig(current => ({
      ...current,
      baseUrl: preset.baseUrl || current.baseUrl,
      model: preset.model || current.model,
    }));
  }

  async function saveConfig(event) {
    event.preventDefault();
    if (configBusy) return;
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

  return <>
    <button ref={trigger} type="button" className="assistant-trigger" aria-label="AI 助手" title="AI 助手"
      aria-controls={open ? 'weldone-assistant' : undefined} aria-expanded={open} onClick={() => open ? close() : setOpen(true)}>
      <MessageSquareText size={17}/><span>AI 助手</span>
    </button>
    {open && <section id="weldone-assistant" className="weldone-assistant" aria-labelledby="assistant-title"
      onKeyDown={event => {
        if (event.key === 'Escape' && !dialogOpen) {
          event.stopPropagation();
          if (proposal) cancelProposal();
          else close();
        }
      }}>
      <header className="assistant-header">
        <div className="assistant-title-icon"><MessageSquareText size={19}/></div>
        <div className="assistant-heading">
          <h2 id="assistant-title">AI 助手</h2>
          <p>{page} · {mode === 'model' ? '模型问答' : mode === 'local' ? '本地指引' : '正在检查模型服务'}</p>
        </div>
        <button type="button" className="icon assistant-settings-toggle" aria-label="模型服务设置" title="模型服务设置"
          aria-pressed={settingsOpen} onClick={() => settingsOpen ? setSettingsOpen(false) : openSettings()}><Settings size={17}/></button>
        <button type="button" className="assistant-clear" disabled={!turns.length || busy}
          onClick={() => { setTurns([]); setDraft(''); setError(''); setAttach(false); setNotes([]); input.current?.focus(); }}>清空对话</button>
        <button type="button" className="icon assistant-close" aria-label="关闭 AI 助手" onClick={close}><X size={18}/></button>
      </header>

      <div className="assistant-scroll" ref={scroll} role="log" aria-label="助手对话">
        {settingsOpen ? <div className="assistant-settings">
          <h3>模型服务</h3>
          <p className="assistant-settings-note">可随时更换提供商；密钥只保存在本机配置文件，不会进入前端构建产物。</p>
          <form onSubmit={saveConfig}>
            <label>服务预设
              <select value={presetId} onChange={event => choosePreset(event.target.value)}>
                {presets.map(preset => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
              </select>
            </label>
            <label>接口地址
              <input value={config.baseUrl} spellCheck={false} placeholder="https://api.deepseek.com/v1"
                onChange={event => setConfig(current => ({...current, baseUrl: event.target.value}))}/>
            </label>
            <label>模型名称
              <input value={config.model} spellCheck={false} placeholder="deepseek-chat"
                onChange={event => setConfig(current => ({...current, model: event.target.value}))}/>
            </label>
            <label>API Key
              <input type="password" value={config.apiKey} autoComplete="off"
                placeholder={profile?.keyHint ? `已保存 ${profile.keyHint}，更换请重新填写` : '请输入'}
                onChange={event => setConfig(current => ({...current, apiKey: event.target.value}))}/>
            </label>
            {configNote && <p className="assistant-settings-note" role="status">{configNote}</p>}
            <div className="assistant-settings-buttons">
              <button type="button" onClick={() => setSettingsOpen(false)}>返回对话</button>
              <button type="submit" className="assistant-settings-save" disabled={configBusy}>{configBusy ? '正在保存…' : '保存并测试'}</button>
            </div>
          </form>
        </div> : <>
        {!turns.length && !pending && <div className="assistant-start">
          <h3>想了解什么？</h3>
          <p>{mode === 'local' ? '未检测到模型服务，当前使用内置操作指引。点右上角齿轮即可配置或更换模型服务。' :
            '可以提问，也可以让我执行启用、屏蔽、修改属性、删除、合并、应用模板或工艺等操作。每次改动前都会先请你确认。'}</p>
          <div className="assistant-prompts" role="group" aria-label="常用问题">
            {prompts.map(({id, question}) => <button key={id} type="button" onClick={() => {
              setDraft(question);
              input.current?.focus();
            }}>{question}</button>)}
          </div>
        </div>}
        {turns.map((turn, index) => turn.kind === 'action' ? <div key={index} className="assistant-turn">
          <p className="assistant-message assistant-action-log">
            <span className="assistant-message-label">{turn.ok ? '已执行' : '执行失败'}</span>{turn.question}
          </p>
          <p className={'assistant-message ' + (turn.ok ? 'assistant-action-ok' : 'assistant-action-failed')}>{turn.answer}</p>
        </div> : <div key={index} className="assistant-turn">
          <p className="assistant-message assistant-user"><span className="assistant-message-label">我</span>{turn.question}</p>
          <p className="assistant-message assistant-response"><span className="assistant-message-label">{turn.mode === 'model' ? 'AI 助手' : '本地指引'}</span>{turn.answer}</p>
        </div>)}
        {pending && <p className="assistant-feedback">正在生成回复…</p>}
        {error && <p role="alert" className="assistant-feedback assistant-error">{error}</p>}
        </>}
      </div>

      {!settingsOpen && <form className="assistant-composer" onSubmit={sendQuestion}>
        {proposal && <div className={'assistant-action' + (proposal.danger ? ' danger' : '')} role="group" aria-label="待确认操作">
          <p className="assistant-action-head"><ShieldCheck size={15}/><strong>待确认操作</strong>{proposal.danger && <span className="assistant-action-danger">高风险</span>}</p>
          <p className="assistant-action-text">{proposal.description}</p>
          <p className="assistant-action-note">执行前不会修改任何数据；确认后才会写入本机规划。</p>
          <div className="assistant-action-buttons">
            <button type="button" className="assistant-action-cancel" disabled={running} onClick={cancelProposal}>取消</button>
            <button type="button" className="assistant-action-run" disabled={running || !onAction} onClick={runProposal}>
              <Check size={14}/>{running ? '正在执行…' : '确认执行'}</button>
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
        {mode === 'model' && <p className="assistant-send-note">问题、近期对话与本机焊缝快照会发送到已配置的模型服务；操作需你确认后执行。</p>}
      </form>}
    </section>}
  </>;
}
