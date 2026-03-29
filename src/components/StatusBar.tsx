import { useEffect, useState } from 'react';
import type { PersistenceState } from '../types/workspace';

type StatusBarProps = {
  dirtyDocumentCount: number;
  persistenceState: PersistenceState;
};

const formatPastTime = (timestamp?: string) => {
  if (!timestamp) return '刚刚';
  const distanceMs = Date.now() - new Date(timestamp).getTime();
  const minutes = Math.max(Math.round(distanceMs / 60000), 0);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  return `${hours} 小时前`;
};

const getPersistenceLabel = (persistenceState: PersistenceState) => {
  switch (persistenceState.status) {
    case 'saving':
      return '后端保存中';
    case 'error':
      return persistenceState.lastError ?? '后端保存失败';
    case 'saved':
      return persistenceState.lastSavedAt
        ? `后端已保存 · ${formatPastTime(persistenceState.lastSavedAt)}`
        : '后端已保存';
    default:
      return '等待保存';
  }
};

export const StatusBar = ({
  dirtyDocumentCount,
  persistenceState,
}: StatusBarProps) => {
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 30000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <footer className="status-bar">
      <div className="status-group">
        <span className="status-pill">
          {dirtyDocumentCount > 0 ? `${dirtyDocumentCount} 个文档待保存` : '文档已落盘'}
        </span>
        <span className="status-pill">{getPersistenceLabel(persistenceState)}</span>
      </div>
    </footer>
  );
};
