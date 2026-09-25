import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import LoginScreen from '../components/LoginScreen.jsx';

const SuiteContext = createContext(null);
const POLL_MS = 30000;

// Loads everything the screens show from the server and refreshes it when an app sends
// new data (the server version number changes).
export function SuiteProvider({ children }) {
  const [phase, setPhase] = useState('loading'); // loading | login | ready | offline
  const [data, setData] = useState(null);
  const [me, setMe] = useState(null);
  const [toasts, setToasts] = useState([]);
  const versionRef = useRef(0);

  const notify = useCallback((message, kind = 'success') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3000);
  }, []);

  const load = useCallback(async () => {
    try {
      const [overview, who] = await Promise.all([api.get('/api/overview'), api.get('/api/me')]);
      versionRef.current = overview.version;
      setData(overview);
      setMe(who.user);
      setPhase('ready');
    } catch (err) {
      setPhase(err.status === 401 ? 'login' : err.status === 0 ? 'offline' : 'login');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (phase !== 'ready') return undefined;
    const timer = setInterval(async () => {
      if (document.hidden) return;
      try {
        const { version } = await api.get('/api/version');
        if (version !== versionRef.current) await load();
      } catch (err) {
        if (err.status === 401) setPhase('login');
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [phase, load]);

  // Runs a change on the server, then reloads. Returns the server reply, or null after
  // showing the error.
  const run = useCallback(
    async (fn, success) => {
      try {
        const reply = await fn();
        await load();
        if (success) notify(success);
        return reply || {};
      } catch (err) {
        if (err.status === 401) setPhase('login');
        notify(err.message, 'error');
        return null;
      }
    },
    [load, notify],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/api/logout');
    } finally {
      setMe(null);
      setData(null);
      setPhase('login');
    }
  }, []);

  const value = useMemo(
    () => ({ data, me, isAdmin: me?.role === 'admin', notify, run, reload: load, logout }),
    [data, me, notify, run, load, logout],
  );

  const toastList = (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          {t.message}
        </div>
      ))}
    </div>
  );

  if (phase !== 'ready') {
    return (
      <>
        <LoginScreen phase={phase} onLoggedIn={load} onRetry={load} />
        {toastList}
      </>
    );
  }

  return (
    <SuiteContext.Provider value={value}>
      {children}
      {toastList}
    </SuiteContext.Provider>
  );
}

export function useSuite() {
  return useContext(SuiteContext);
}
