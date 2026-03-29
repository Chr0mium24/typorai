export type AuthSession = {
  authenticated: boolean;
  username?: string;
};

type AuthPayload = {
  data?: AuthSession;
  error?: {
    message?: string;
  };
};

const readPayload = async (response: Response): Promise<AuthPayload> => {
  const text = await response.text();
  if (!text.trim()) return {};

  try {
    return JSON.parse(text) as AuthPayload;
  } catch {
    return {
      error: {
        message: text.trim(),
      },
    };
  }
};

export const fetchAuthSession = async (): Promise<AuthSession> => {
  const response = await fetch('/api/auth/session', {
    headers: {
      Accept: 'application/json',
    },
  });
  const payload = await readPayload(response);

  if (!response.ok) {
    throw new Error(payload.error?.message || `Auth session failed: ${response.status}`);
  }

  return payload.data ?? { authenticated: false };
};

export const loginAsAdmin = async (username: string, password: string) => {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ username, password }),
  });
  const payload = await readPayload(response);

  if (!response.ok || !payload.data?.authenticated) {
    throw new Error(payload.error?.message || '登录失败');
  }

  return payload.data;
};

export const logoutAuthSession = async () => {
  const response = await fetch('/api/auth/logout', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
    },
  });
  const payload = await readPayload(response);

  if (!response.ok) {
    throw new Error(payload.error?.message || '退出失败');
  }
};
