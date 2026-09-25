import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useSuite } from '../store/SuiteContext.jsx';
import { api } from '../lib/api.js';
import { Badge, Card, Empty, Field, Modal, PageHeader } from '../components/ui.jsx';
import { dateTime } from '../lib/format.js';

export const ROLES = [
  { value: 'staff', label: 'Staff', note: 'The apps chosen below, plus the Drivers and Trucks & Trailers pages' },
  { value: 'admin', label: 'Admin', note: 'Every app, plus Apps, Connections and Users' },
];
const roleLabel = (r) => ROLES.find((x) => x.value === r)?.label || r;

function UserForm({ user, me, apps, onClose, onSaved }) {
  const { notify } = useSuite();
  const isNew = !user;
  const self = user?.id === me.id;
  const [form, setForm] = useState({
    name: user?.name || '',
    email: user?.email || '',
    role: user?.role || 'staff',
    active: user?.active !== false,
    password: '',
    allApps: !user || user.apps === null,
    apps: user?.apps || [],
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const toggleApp = (id) => setForm((f) => ({ ...f, apps: f.apps.includes(id) ? f.apps.filter((a) => a !== id) : [...f.apps, id] }));

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = {
        name: form.name,
        email: form.email,
        role: form.role,
        active: form.active,
        apps: form.allApps ? null : form.apps,
        ...(form.password ? { password: form.password } : {}),
      };
      const reply = isNew ? await api.post('/api/users', body) : await api.put(`/api/users/${user.id}`, body);
      notify(isNew ? `${reply.user.name} can now sign in` : 'User updated');
      onSaved();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete ${user.name}? They will be signed out and cannot sign in again.`)) return;
    try {
      await api.del(`/api/users/${user.id}`);
      notify('User deleted');
      onSaved();
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  return (
    <Modal
      title={isNew ? 'Add user' : `Edit ${user.name}`}
      onClose={onClose}
      footer={
        <>
          {!isNew && !self && (
            <button type="button" className="btn btn-danger-outline mr-auto" onClick={remove}>
              Delete
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="user-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form id="user-form" onSubmit={save} className="form-grid">
        <Field label="Full name *">
          <input value={form.name} onChange={set('name')} required />
        </Field>
        <Field label="Email *" hint="Used to sign in">
          <input type="email" value={form.email} onChange={set('email')} required autoComplete="off" />
        </Field>
        <Field label="Role" hint={ROLES.find((r) => r.value === form.role)?.note}>
          <select value={form.role} onChange={set('role')} disabled={self}>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={isNew ? 'Temporary password *' : 'New password'}
          hint={
            isNew ? 'At least 10 characters. They can change it in My account.' : 'Leave empty to keep their password. Setting one signs them out.'
          }
        >
          <input type="text" value={form.password} onChange={set('password')} required={isNew} minLength={10} autoComplete="new-password" />
        </Field>
        {form.role === 'staff' && (
          <div className="field-wide">
            <span className="field-label">Apps on their home screen</span>
            <label className="check">
              <input type="checkbox" checked={form.allApps} onChange={set('allApps')} />
              All apps, including apps added later
            </label>
            {!form.allApps && (
              <div className="check-grid">
                {apps.map((a) => (
                  <label key={a.id} className="check">
                    <input type="checkbox" checked={form.apps.includes(a.id)} onChange={() => toggleApp(a.id)} />
                    {a.icon} {a.name}
                  </label>
                ))}
              </div>
            )}
            <span className="field-hint">Each app still has its own login and decides what they can do inside it.</span>
          </div>
        )}
        {!isNew && !self && (
          <label className="check field-wide">
            <input type="checkbox" checked={form.active} onChange={set('active')} />
            Can sign in (turn off when someone leaves the company)
          </label>
        )}
      </form>
    </Modal>
  );
}

export default function Users() {
  const { me, isAdmin, notify, data } = useSuite();
  const [users, setUsers] = useState(null);
  const [editing, setEditing] = useState(null); // null | 'new' | user

  const load = useCallback(() => {
    api
      .get('/api/users')
      .then((r) => setUsers(r.users))
      .catch((err) => notify(err.message, 'error'));
  }, [notify]);
  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  if (!isAdmin) return <Navigate to="/" replace />;
  const appNames = (u) =>
    u.role === 'admin' || u.apps === null
      ? 'All apps'
      : data.apps
          .filter((a) => u.apps.includes(a.id))
          .map((a) => a.name)
          .join(', ') || 'None';

  return (
    <>
      <PageHeader title="Users" subtitle="Everyone who signs in to the suite, and which apps they see">
        <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
          + Add user
        </button>
      </PageHeader>
      <Card title="NEC Suite users">
        {!users ? (
          <p className="muted">Loading…</p>
        ) : users.length === 0 ? (
          <Empty>No users yet. Add one login for each person in the office.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Apps</th>
                  <th>Last sign in</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="clickable" onClick={() => setEditing(u)}>
                    <td>
                      <strong>{u.name}</strong>
                      {u.id === me.id && <span className="muted small"> (you)</span>}
                    </td>
                    <td>{u.email}</td>
                    <td>{roleLabel(u.role)}</td>
                    <td className="small">{appNames(u)}</td>
                    <td>{u.lastLoginAt ? dateTime(u.lastLoginAt) : <span className="muted">Never</span>}</td>
                    <td>{u.active ? <Badge tone="green">Active</Badge> : <Badge tone="slate">Turned off</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Owner account">
        <p className="small muted">
          The owner signs in with the email <strong>owner</strong> and the password saved in the server settings (SUITE_PASSWORD on Render). It is
          always an admin, so you can never be locked out. Keep that password private and give everyone else their own login above.
        </p>
      </Card>
      {editing && (
        <UserForm
          user={editing === 'new' ? null : editing}
          me={me}
          apps={data.apps}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </>
  );
}
