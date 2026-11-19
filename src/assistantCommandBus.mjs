import {useEffect, useRef} from 'react';

// 模块级命令总线：各工作区把可被助手调用的命令注册进来，
// App 的执行器按名称分发，避免把所有模块状态提升到根组件。
const registry = new Map();

export function useAssistantCommands(owner, commands) {
  const latest = useRef(commands);
  latest.current = commands;
  useEffect(() => {
    const dispatch = (name, args) => {
      const handler = latest.current?.[name];
      return handler ? handler(args) : undefined;
    };
    registry.set(owner, dispatch);
    return () => {
      if (registry.get(owner) === dispatch) registry.delete(owner);
    };
  }, [owner]);
}

export async function runAssistantCommand(name, args) {
  for (const dispatch of registry.values()) {
    const result = await dispatch(name, args);
    if (result !== undefined) return result;
  }
  return undefined;
}
