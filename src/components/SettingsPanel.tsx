import { useEffect, useState } from 'react';
import type { AISettings } from '../types/workspace';

type SettingsPanelProps = {
  open: boolean;
  aiSettings: AISettings;
  onClose: () => void;
  onLogout: () => Promise<void>;
  onSaveAI: (settings: AISettings) => Promise<void>;
};

export const SettingsPanel = ({
  open,
  aiSettings,
  onClose,
  onLogout,
  onSaveAI,
}: SettingsPanelProps) => {
  const [aiDraft, setAiDraft] = useState(aiSettings);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setAiDraft(aiSettings);
  }, [aiSettings]);

  if (!open) return null;

  return (
    <div className="settings-overlay" onClick={onClose} role="presentation">
      <aside
        className="settings-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="settings-header">
          <div>
            <p className="eyebrow">Workspace Settings</p>
            <h2>AI 设置</h2>
          </div>
          <button className="ghost-button" onClick={onClose} type="button">
            关闭
          </button>
        </div>

        <section className="settings-section">
          <div className="settings-section-heading">
            <p className="eyebrow">AI Writing</p>
            <h3>模型与鉴权</h3>
          </div>

          <p className="settings-note">
            AI 配置只保存在当前浏览器。`OpenAI-compatible` 会请求
            `baseUrl/v1/chat/completions`，`Gemini` 会请求 Google 的流式接口。
          </p>

          <label className="field">
            <span>Provider</span>
            <select
              value={aiDraft.provider}
              onChange={(event) =>
                setAiDraft((current) => ({
                  ...current,
                  provider: event.target.value as AISettings['provider'],
                }))
              }
            >
              <option value="openai-compatible">OpenAI-compatible</option>
              <option value="gemini">Gemini</option>
            </select>
          </label>

          {aiDraft.provider === 'openai-compatible' ? (
            <>
              <label className="field">
                <span>Base URL</span>
                <input
                  value={aiDraft.openAICompatible.baseUrl}
                  onChange={(event) =>
                    setAiDraft((current) => ({
                      ...current,
                      openAICompatible: {
                        ...current.openAICompatible,
                        baseUrl: event.target.value,
                      },
                    }))
                  }
                  placeholder="https://api.openai.com"
                />
              </label>

              <label className="field">
                <span>API Key</span>
                <input
                  type="password"
                  value={aiDraft.openAICompatible.apiKey}
                  onChange={(event) =>
                    setAiDraft((current) => ({
                      ...current,
                      openAICompatible: {
                        ...current.openAICompatible,
                        apiKey: event.target.value,
                      },
                    }))
                  }
                  placeholder="sk-..."
                />
              </label>

              <label className="field">
                <span>Model</span>
                <input
                  value={aiDraft.openAICompatible.model}
                  onChange={(event) =>
                    setAiDraft((current) => ({
                      ...current,
                      openAICompatible: {
                        ...current.openAICompatible,
                        model: event.target.value,
                      },
                    }))
                  }
                  placeholder="gpt-4.1-mini"
                />
              </label>
            </>
          ) : (
            <>
              <label className="field">
                <span>Base URL</span>
                <input
                  value={aiDraft.gemini.baseUrl}
                  onChange={(event) =>
                    setAiDraft((current) => ({
                      ...current,
                      gemini: {
                        ...current.gemini,
                        baseUrl: event.target.value,
                      },
                    }))
                  }
                  placeholder="https://generativelanguage.googleapis.com"
                />
              </label>

              <label className="field">
                <span>API Key</span>
                <input
                  type="password"
                  value={aiDraft.gemini.apiKey}
                  onChange={(event) =>
                    setAiDraft((current) => ({
                      ...current,
                      gemini: {
                        ...current.gemini,
                        apiKey: event.target.value,
                      },
                    }))
                  }
                  placeholder="AIza..."
                />
              </label>

              <label className="field">
                <span>Model</span>
                <input
                  value={aiDraft.gemini.model}
                  onChange={(event) =>
                    setAiDraft((current) => ({
                      ...current,
                      gemini: {
                        ...current.gemini,
                        model: event.target.value,
                      },
                    }))
                  }
                  placeholder="gemini-2.5-flash"
                />
              </label>
            </>
          )}

          <label className="field">
            <span>Temperature</span>
            <input
              max={2}
              min={0}
              step={0.1}
              type="number"
              value={aiDraft.temperature}
              onChange={(event) =>
                setAiDraft((current) => ({
                  ...current,
                  temperature: Number(event.target.value),
                }))
              }
            />
          </label>

          <label className="field">
            <span>System Prompt</span>
            <textarea
              value={aiDraft.systemPrompt}
              onChange={(event) =>
                setAiDraft((current) => ({
                  ...current,
                  systemPrompt: event.target.value,
                }))
              }
              placeholder="告诉 AI 你希望它默认如何写。"
              rows={5}
            />
          </label>
        </section>

        <div className="settings-actions">
          <button className="ghost-button" onClick={() => void onLogout()} type="button">
            退出登录
          </button>
          <button className="ghost-button" onClick={onClose} type="button">
            取消
          </button>
          <button
            className="primary-button"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              await onSaveAI(aiDraft);
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
