import { useState } from 'react';

type LoginPageProps = {
  loading?: boolean;
  onSubmit: (credentials: { username: string; password: string }) => Promise<void>;
};

export const LoginPage = ({ loading = false, onSubmit }: LoginPageProps) => {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <main className="login-shell">
      <section className="login-card">
        <div>
          <p className="eyebrow">Admin Only</p>
          <h1>登录 TyporAI</h1>
          <p className="login-note">当前实例只开放一个管理员账号。</p>
        </div>

        <form
          className="login-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setError(null);

            try {
              await onSubmit({
                username: username.trim(),
                password,
              });
            } catch (submitError) {
              setError(submitError instanceof Error ? submitError.message : '登录失败');
            }
          }}
        >
          <label className="field">
            <span>用户名</span>
            <input
              autoComplete="username"
              disabled={loading}
              onChange={(event) => setUsername(event.target.value)}
              value={username}
            />
          </label>

          <label className="field">
            <span>密码</span>
            <input
              autoComplete="current-password"
              disabled={loading}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              value={password}
            />
          </label>

          {error ? <p className="login-error">{error}</p> : null}

          <button className="primary-button login-submit" disabled={loading} type="submit">
            {loading ? '登录中...' : '进入工作区'}
          </button>
        </form>
      </section>
    </main>
  );
};
