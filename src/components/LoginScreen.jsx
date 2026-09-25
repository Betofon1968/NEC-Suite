import { useState } from 'react';
import { api } from '../lib/api.js';

export default function LoginScreen({ phase, onLoggedIn, onRetry }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (phase === 'loading') {
    return (
      <div className="login-page">
        <div className="login-card center muted">Loading…</div>
      </div>
    );
  }

  if (phase === 'offline') {
    return (
      <div className="login-page">
        <div className="login-card">
          <h1>Can't reach the server</h1>
          <p className="muted">Check your internet connection. If you run the suite on this computer, make sure it was started with npm run dev.</p>
          <button type="button" className="btn btn-primary" onClick={onRetry}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/api/login', { email, password });
      await onLoggedIn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="brand login-brand">
          <span className="brand-mark">▦</span>
          <span>
            <strong>Suite</strong>
            <small>All company apps in one place</small>
          </span>
        </div>
        <label className="field">
          <span className="field-label">Email</span>
          <input
            type="text"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck="false"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
            required
          />
        </label>
        <label className="field">
          <span className="field-label">Password</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <div className="alert alert-error">{error}</div>}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="muted small">Forgot your password? Ask your admin to set a new one.</p>
      </form>
    </div>
  );
}
