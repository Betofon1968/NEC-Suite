import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useSuite } from '../store/SuiteContext.jsx';
import { api } from '../lib/api.js';
import { APP_COLORS } from '../lib/apps.js';
import { Badge, Card, Empty, Field, Modal, PageHeader } from '../components/ui.jsx';

function AppForm({ app, onClose }) {
  const { run } = useSuite();
  const isNew = !app;
  const [form, setForm] = useState({
    name: app?.name || '',
    description: app?.description || '',
    url: app?.url || '',
    icon: app?.icon || '▦',
    color: app?.color || 'blue',
    active: app?.active !== false,
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const ok = await run(() => (isNew ? api.post('/api/apps', form) : api.put(`/api/apps/${app.id}`, form)), isNew ? 'App added' : 'App saved');
    setBusy(false);
    if (ok) onClose();
  };
  const remove = async () => {
    if (!window.confirm(`Remove ${app.name} from the home screen? The app itself and its data are not touched.`)) return;
    if (await run(() => api.del(`/api/apps/${app.id}`), 'App removed')) onClose();
  };

  return (
    <Modal
      title={isNew ? 'Add app' : `Edit ${app.name}`}
      onClose={onClose}
      footer={
        <>
          {!isNew && (
            <button type="button" className="btn btn-danger-outline mr-auto" onClick={remove}>
              Remove
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="app-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form id="app-form" onSubmit={save} className="form-grid">
        <Field label="Name *">
          <input value={form.name} onChange={set('name')} required maxLength={60} />
        </Field>
        <Field label="Web address" hint="For example https://tms-truck.onrender.com">
          <input type="url" value={form.url} onChange={set('url')} placeholder="https://" />
        </Field>
        <Field label="What it is for" wide>
          <input value={form.description} onChange={set('description')} maxLength={160} />
        </Field>
        <Field label="Icon" hint="One emoji">
          <input value={form.icon} onChange={set('icon')} maxLength={8} />
        </Field>
        <Field label="Color">
          <select value={form.color} onChange={set('color')}>
            {APP_COLORS.map((c) => (
              <option key={c} value={c}>
                {c[0].toUpperCase() + c.slice(1)}
              </option>
            ))}
          </select>
        </Field>
        <label className="check field-wide">
          <input type="checkbox" checked={form.active} onChange={set('active')} />
          Show to staff (admins always see every app)
        </label>
      </form>
    </Modal>
  );
}

export default function Apps() {
  const { data, isAdmin, run } = useSuite();
  const [editing, setEditing] = useState(null); // null | 'new' | app
  if (!isAdmin) return <Navigate to="/" replace />;
  const move = (app, dir) => run(() => api.post(`/api/apps/${app.id}/move`, { dir }));

  return (
    <>
      <PageHeader title="Apps" subtitle="The apps on the home screen. Choose who sees each one on the Users page.">
        <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
          + Add app
        </button>
      </PageHeader>
      <Card>
        {data.apps.length === 0 ? (
          <Empty>No apps yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>App</th>
                  <th>Web address</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.apps.map((app, i) => (
                  <tr key={app.id}>
                    <td className="nowrap">
                      <button type="button" className="icon-btn" disabled={i === 0} onClick={() => move(app, 'up')} aria-label="Move up">
                        ↑
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        disabled={i === data.apps.length - 1}
                        onClick={() => move(app, 'down')}
                        aria-label="Move down"
                      >
                        ↓
                      </button>
                    </td>
                    <td>
                      <span className={`tile-icon tile-icon-sm tile-${app.color}`} aria-hidden="true">
                        {app.icon}
                      </span>{' '}
                      <strong>{app.name}</strong>
                      <div className="small muted">{app.description}</div>
                    </td>
                    <td className="small">
                      {app.url ? (
                        <a href={app.url} target={`suite-${app.id}`} rel="noopener noreferrer">
                          {app.url}
                        </a>
                      ) : (
                        <span className="warn">Not set</span>
                      )}
                    </td>
                    <td>{app.active !== false ? <Badge tone="green">Shown</Badge> : <Badge tone="slate">Hidden</Badge>}</td>
                    <td className="right">
                      <button type="button" className="btn btn-sm" onClick={() => setEditing(app)}>
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Why apps open in a new tab">
        <p className="small muted">
          Your apps protect themselves from being shown inside another website, which blocks a common trick to steal logins. So the suite opens each
          app in its own tab, and clicking the same app again brings you back to that tab. Each app still asks for its own sign in the first time on
          each computer.
        </p>
      </Card>
      {editing && <AppForm app={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}
