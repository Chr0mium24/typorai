import type { DocumentRecord } from '../types/workspace';
import type { WorkspaceSession } from '../types/workspace';
import {
  CodeIcon,
  DownloadIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PlusIcon,
  RefreshIcon,
  SettingsIcon,
} from './icons';

type TabBarProps = {
  openDocuments: DocumentRecord[];
  activeDocumentId: string | null;
  animatedDocumentId: string | null;
  sidebarCollapsed: boolean;
  browserSaveState: 'idle' | 'saving' | 'saved';
  lastBrowserSaveAt?: string;
  mode: WorkspaceSession['editorMode'];
  onCreateDocument: () => void;
  onActivate: (documentId: string) => void;
  onClose: (documentId: string) => void;
  onExportDocument: () => void;
  exportDisabled?: boolean;
  onOpenSettings: () => void;
  onSyncNow: () => void;
  onToggleMode: () => void;
  onToggleSidebar: () => void;
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

export const TabBar = ({
  openDocuments,
  activeDocumentId,
  animatedDocumentId,
  sidebarCollapsed,
  browserSaveState,
  lastBrowserSaveAt,
  mode,
  onCreateDocument,
  onActivate,
  onClose,
  onExportDocument,
  exportDisabled = false,
  onOpenSettings,
  onSyncNow,
  onToggleMode,
  onToggleSidebar,
}: TabBarProps) => {
  const saveLabel =
    browserSaveState === 'saving'
      ? '保存中'
      : browserSaveState === 'saved'
        ? lastBrowserSaveAt
          ? `已保存 ${formatPastTime(lastBrowserSaveAt)}`
          : '已保存'
        : '等待编辑';

  return (
    <div className="tab-bar">
      <div className="tab-strip" role="tablist" aria-label="打开的文档">
        {openDocuments.length === 0 ? (
          <div className="tab-empty">还没有打开的文档</div>
        ) : null}
        {openDocuments.map((document) => (
          <button
            key={document.id}
            className={`tab-item ${activeDocumentId === document.id ? 'is-active' : ''} ${
              animatedDocumentId === document.id ? 'is-fresh' : ''
            }`}
            onClick={() => onActivate(document.id)}
            type="button"
          >
            <span className="tab-title">{document.title}</span>
            {document.remoteDirty ? <span className="tab-dot" /> : null}
            <span
              className="tab-close"
              onClick={(event) => {
                event.stopPropagation();
                onClose(document.id);
              }}
              role="presentation"
            >
              ×
            </span>
          </button>
        ))}
        <button
          className="tab-item tab-create-button"
          onClick={onCreateDocument}
          title="新建文档"
          type="button"
        >
          <PlusIcon width={15} height={15} />
        </button>
      </div>

      <div className="tab-toolbar">
        <span className={`tab-save-indicator is-${browserSaveState}`}>{saveLabel}</span>
        <button
          className="icon-button"
          disabled={exportDisabled}
          onClick={onExportDocument}
          title={exportDisabled ? '没有可导出的文档' : '导出 Markdown'}
          type="button"
        >
          <DownloadIcon width={16} height={16} />
        </button>
        <button
          className="icon-button"
          onClick={onSyncNow}
          title="立即同步"
          type="button"
        >
          <RefreshIcon width={16} height={16} />
        </button>
        <button
          className={`icon-button ${mode === 'source' ? 'is-active' : ''}`}
          onClick={onToggleMode}
          title={mode === 'source' ? '切回可视编辑' : '切换到源码模式'}
          type="button"
        >
          <CodeIcon width={16} height={16} />
        </button>
        <button
          className="icon-button"
          onClick={onToggleSidebar}
          title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
          type="button"
        >
          {sidebarCollapsed ? (
            <PanelLeftOpenIcon width={16} height={16} />
          ) : (
            <PanelLeftCloseIcon width={16} height={16} />
          )}
        </button>
        <button
          className="icon-button"
          onClick={onOpenSettings}
          title="GitHub 设置"
          type="button"
        >
          <SettingsIcon width={16} height={16} />
        </button>
      </div>
    </div>
  );
};
