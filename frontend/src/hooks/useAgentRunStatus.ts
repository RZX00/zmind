import { useEffect, useMemo, useState } from 'react';

export type AgentRunStatus =
  | 'idle'
  | 'running'
  | 'connecting'
  | 'streaming'
  | 'completed'
  | 'stopped'
  | 'failed'
  | 'error'
  | 'agent_not_running'
  | string;

const RUNNING_STATUSES = new Set(['running', 'connecting', 'streaming']);

const readStoredStatus = (): AgentRunStatus => {
  if (typeof window === 'undefined') return 'idle';
  try {
    const raw = (window as any).__agentRunStatus;
    if (typeof raw === 'string' && raw.trim()) return raw;
  } catch {}
  return 'idle';
};

const writeStoredStatus = (status: string) => {
  if (typeof window === 'undefined') return;
  try {
    (window as any).__agentRunStatus = status;
  } catch {}
};

export const requestStopAgentRun = () => {
  try {
    window.dispatchEvent(new CustomEvent('agent:request-stop'));
  } catch {}
};

export const setAgentRunStatus = (status: string) => {
  writeStoredStatus(status);
  try {
    window.dispatchEvent(
      new CustomEvent('agent:run-status', { detail: { status } }),
    );
  } catch {}
};

export const useAgentRunStatus = () => {
  const [status, setStatus] = useState<AgentRunStatus>(() => readStoredStatus());

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const next = String(detail.status || 'idle');
      writeStoredStatus(next);
      setStatus(next);
    };
    window.addEventListener('agent:run-status', handler as any);
    return () => window.removeEventListener('agent:run-status', handler as any);
  }, []);

  const isRunning = useMemo(
    () => RUNNING_STATUSES.has(String(status)),
    [status],
  );

  return { status, isRunning };
};
