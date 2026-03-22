import { useEffect, useMemo, useState } from 'react';
import type { SyncState } from '../types/workspace';

type StatusBarProps = {
  browserSaveState: 'idle' | 'saving' | 'saved';
  lastBrowserSaveAt?: string;
  dirtyDocumentCount: number;
  syncState: SyncState;
  onSyncNow: () => Promise<void>;
};

const formatPastTime = (timestamp?: string) => {
  if (!timestamp) return '尚未保存';
  const distanceMs = Date.now() - new Date(timestamp).getTime();
  const minutes = Math.max(Math.round(distanceMs / 60000), 0);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  return `${hours} 小时前`;
};

const formatFutureTime = (timestamp?: string) => {
  if (!timestamp) return '即将';
  const distanceMs = new Date(timestamp).getTime() - Date.now();
  const minutes = Math.max(Math.ceil(distanceMs / 60000), 0);

  if (minutes <= 1) return '1 分钟内';
  if (minutes < 60) return `${minutes} 分钟内`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} 小时内`;
};

const getSyncLabel = (syncState: SyncState) => {
  switch (syncState.status) {
    case 'queued':
      return syncState.nextSyncAt
        ? `GitHub 同步排队中 · ${formatFutureTime(syncState.nextSyncAt)}`
        : 'GitHub 同步已排队';
    case 'syncing':
      return 'GitHub 正在同步';
    case 'error':
      return syncState.lastError ?? 'GitHub 同步失败';
    case 'setup-required':
      return 'GitHub 未配置';
    default:
      return syncState.lastSyncAt
        ? `GitHub 已同步 · ${formatPastTime(syncState.lastSyncAt)}`
        : 'GitHub 尚未同步';
  }
};

export const StatusBar = ({
  browserSaveState,
  lastBrowserSaveAt,
  dirtyDocumentCount,
  syncState,
  onSyncNow,
}: StatusBarProps) => {
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const browserLabel = useMemo(() => {
    if (browserSaveState === 'saving') return '正在保存到浏览器';
    if (browserSaveState === 'saved') {
      return `浏览器已保存 · ${formatPastTime(lastBrowserSaveAt)}`;
    }
    return '等待编辑';
  }, [browserSaveState, lastBrowserSaveAt]);

  return (
    <footer className="status-bar">
      <div className="status-group">
        <span className="status-pill">{browserLabel}</span>
        <span className="status-pill">
          {dirtyDocumentCount > 0
            ? `${dirtyDocumentCount} 个文档待同步`
            : '远端无待同步内容'}
        </span>
        <span className="status-pill">{getSyncLabel(syncState)}</span>
      </div>

      <button
        className="primary-button status-sync-button"
        onClick={() => void onSyncNow()}
        type="button"
      >
        立即同步
      </button>
    </footer>
  );
};
