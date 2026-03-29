import { buildDefaultWorkspace, type WorkspaceSnapshot } from '../../shared/workspace';
import type { AISettings } from '../types/workspace';
import { defaultAISettings } from '../types/workspace';

const AI_SETTINGS_STORAGE_KEY = 'typorai-ai-settings';

export type LoadedWorkspaceSnapshot = WorkspaceSnapshot & {
  aiSettings: AISettings;
  workspaceError?: string | null;
};

const mergeAISettings = (value: Partial<AISettings> | null | undefined): AISettings => ({
  ...defaultAISettings,
  ...value,
  openAICompatible: {
    ...defaultAISettings.openAICompatible,
    ...value?.openAICompatible,
  },
  gemini: {
    ...defaultAISettings.gemini,
    ...value?.gemini,
  },
});

const loadAISettings = (): AISettings => {
  if (typeof window === 'undefined') return defaultAISettings;

  try {
    const raw = window.localStorage.getItem(AI_SETTINGS_STORAGE_KEY);
    if (!raw) return defaultAISettings;
    return mergeAISettings(JSON.parse(raw) as Partial<AISettings>);
  } catch {
    return defaultAISettings;
  }
};

export const loadWorkspaceSnapshot = async (): Promise<LoadedWorkspaceSnapshot> => {
  const aiSettings = loadAISettings();

  try {
    const response = await fetch('/api/workspace', {
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Backend load failed: ${response.status}`);
    }

    const payload = (await response.json()) as { data?: WorkspaceSnapshot };
    if (!payload.data) {
      throw new Error('Backend returned an empty workspace payload.');
    }

    return {
      ...payload.data,
      aiSettings,
      workspaceError: null,
    };
  } catch (error) {
    return {
      ...buildDefaultWorkspace(),
      aiSettings,
      workspaceError:
        error instanceof Error ? error.message : '后端不可用，已回退到默认工作区。',
    };
  }
};

export const persistWorkspaceSnapshot = async (snapshot: WorkspaceSnapshot) => {
  const response = await fetch('/api/workspace', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(snapshot),
  });

  if (!response.ok) {
    const text = await response.text();
    let detail = text.trim();

    try {
      const payload = JSON.parse(text) as {
        error?: {
          message?: string;
        };
      };
      detail = payload.error?.message?.trim() || detail;
    } catch {
      // keep raw text when the backend does not return JSON
    }

    throw new Error(
      detail
        ? `Backend save failed: ${response.status} ${detail}`
        : `Backend save failed: ${response.status}`,
    );
  }

  const payload = (await response.json()) as {
    data?: { savedAt?: string };
  };

  return {
    savedAt: payload.data?.savedAt ?? new Date().toISOString(),
  };
};

export const persistAISettings = async (settings: AISettings) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
};
