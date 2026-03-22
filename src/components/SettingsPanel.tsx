import { useEffect, useState } from 'react';
import type { GithubSettings } from '../types/workspace';

type SettingsPanelProps = {
  open: boolean;
  settings: GithubSettings;
  onClose: () => void;
  onSave: (settings: GithubSettings) => Promise<void>;
};

export const SettingsPanel = ({
  open,
  settings,
  onClose,
  onSave,
}: SettingsPanelProps) => {
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  if (!open) return null;

  return (
    <div className="settings-overlay" onClick={onClose} role="presentation">
      <aside
        className="settings-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="settings-header">
          <div>
            <p className="eyebrow">GitHub Sync</p>
            <h2>远端仓库设置</h2>
          </div>
          <button className="ghost-button" onClick={onClose} type="button">
            关闭
          </button>
        </div>

        <p className="settings-note">
          这里只保存在当前浏览器，用于空闲时把 markdown 自动同步到 GitHub。
        </p>

        <label className="field">
          <span>Owner</span>
          <input
            value={draft.owner}
            onChange={(event) =>
              setDraft((current) => ({ ...current, owner: event.target.value }))
            }
            placeholder="your-name"
          />
        </label>

        <label className="field">
          <span>Repo</span>
          <input
            value={draft.repo}
            onChange={(event) =>
              setDraft((current) => ({ ...current, repo: event.target.value }))
            }
            placeholder="typorai-content"
          />
        </label>

        <label className="field">
          <span>Branch</span>
          <input
            value={draft.branch}
            onChange={(event) =>
              setDraft((current) => ({ ...current, branch: event.target.value }))
            }
            placeholder="main"
          />
        </label>

        <label className="field">
          <span>Content Root</span>
          <input
            value={draft.contentRoot}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                contentRoot: event.target.value,
              }))
            }
            placeholder="content"
          />
        </label>

        <label className="field">
          <span>Token</span>
          <input
            type="password"
            value={draft.token}
            onChange={(event) =>
              setDraft((current) => ({ ...current, token: event.target.value }))
            }
            placeholder="github_pat_..."
          />
        </label>

        <label className="field">
          <span>Author Name</span>
          <input
            value={draft.authorName}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                authorName: event.target.value,
              }))
            }
            placeholder="Your Name"
          />
        </label>

        <label className="field">
          <span>Author Email</span>
          <input
            value={draft.authorEmail}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                authorEmail: event.target.value,
              }))
            }
            placeholder="you@example.com"
          />
        </label>

        <div className="settings-actions">
          <button className="ghost-button" onClick={onClose} type="button">
            取消
          </button>
          <button
            className="primary-button"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              await onSave(draft);
              setSaving(false);
              onClose();
            }}
            type="button"
          >
            {saving ? '保存中...' : '保存设置'}
          </button>
        </div>
      </aside>
    </div>
  );
};

