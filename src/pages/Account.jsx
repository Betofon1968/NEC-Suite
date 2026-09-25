import { useState } from 'react';
import { useSuite } from '../store/SuiteContext.jsx';
import { api } from '../lib/api.js';
import { Card, Field, PageHeader } from '../components/ui.jsx';
import { ROLES } from './Users.jsx';

export default function Account() {
  const { me, notify, logout } = useSuite();
  const [form, setForm] = useState({ current: '', next: '', again: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const change = async (e) => {
    e.preventDefault();
    if (form.next !== form.again) return notify('The two new passwords do not match.', 'error');
    setBusy(true);
    try {
      await api.post('/api/password', { current: form.current, next: form.next });
      setForm({ current: '', next: '', again: '' });
      notify('Password changed. Your other computers were signed out.');
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="My account" subtitle="Your sign in details" />
      <div className="grid-2">
        <Card title="Profile">
          <dl className="dl">
            <dt>Name</dt>
            <dd>{me.name}</dd>
            <dt>Email</dt>
            <dd>{me.email}</dd>
            <dt>Role</dt>
            <dd>{ROLES.find((r) => r.value === me.role)?.label || me.role}</dd>
          </dl>
          <p className="small muted">To change your name or email, ask an admin.</p>
          <button type="button" className="btn btn-sm" onClick={logout}>
            Sign out
          </button>
        </Card>
        <Card title="Change password">
          {me.owner ? (
            <p className="small muted">
              The owner password is the SUITE_PASSWORD setting on the server (Render → the suite service → Environment). Changing it there signs the
              owner out everywhere.
            </p>
          ) : (
            <form onSubmit={change}>
              <div className="form-grid">
                <Field label="Current password" wide>
                  <input type="password" value={form.current} onChange={set('current')} autoComplete="current-password" required />
                </Field>
                <Field label="New password" hint="At least 10 characters">
                  <input type="password" value={form.next} onChange={set('next')} autoComplete="new-password" minLength={10} required />
                </Field>
                <Field label="New password again">
                  <input type="password" value={form.again} onChange={set('again')} autoComplete="new-password" minLength={10} required />
                </Field>
              </div>
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
                {busy ? 'Saving…' : 'Change password'}
              </button>
            </form>
          )}
        </Card>
      </div>
    </>
  );
}
