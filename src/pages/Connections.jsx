import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useSuite } from '../store/SuiteContext.jsx';
import { api } from '../lib/api.js';
import { dateTime } from '../lib/format.js';
import { Badge, Card, Empty, Field, Modal, PageHeader } from '../components/ui.jsx';

// Suggested permissions for the apps this company runs.
const PRESETS = [
  { label: 'TMS Truck', scopes: ['drivers:write', 'drivers:read', 'equipment:write', 'equipment:read'] },
  { label: 'NEC Trucking Compliance', scopes: ['drivers:write', 'qualification:write'] },
  { label: "Newman's Dashboard", scopes: ['drivers:write', 'drivers:read', 'equipment:write', 'equipment:read'] },
];

function KeyModal({ name, keyValue, onClose }) {
  const { notify } = useSuite();
  const hubUrl = `${window.location.origin}/api/hub/v1`;
  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      notify('Copied');
    } catch {
      notify('Select the text and copy it by hand.', 'error');
    }
  };
  return (
    <Modal
      title={`Key for ${name}`}
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          I saved it
        </button>
      }
    >
      <div className="alert alert-info">
        This key is shown only once. Copy it now and put it in the settings of {name}. If it is lost, make a new one.
      </div>
      <Field label="Suite address (SUITE_URL)">
        <div className="copy-row">
          <code>{window.location.origin}</code>
          <button type="button" className="btn btn-sm" onClick={() => copy(window.location.origin)}>
            Copy
          </button>
        </div>
      </Field>
      <Field label="Key (SUITE_API_KEY)">
        <div className="copy-row">
          <code className="key">{keyValue}</code>
          <button type="button" className="btn btn-sm" onClick={() => copy(keyValue)}>
            Copy
          </button>
        </div>
      </Field>
      <p className="small muted">
        The app sends its data to <code>{hubUrl}</code> from its own server with this key. Never put the key in a web page or a phone app, where
        anyone could read it.
      </p>
    </Modal>
  );
}

function ConnectionForm({ connection, onClose, onKey }) {
  const { data, run } = useSuite();
  const isNew = !connection;
  const [form, setForm] = useState({
    name: connection?.name || '',
    appId: connection?.appId || '',
    scopes: connection?.scopes || [],
    active: connection?.active !== false,
  });
  const [busy, setBusy] = useState(false);
  const toggle = (scope) => setForm((f) => ({ ...f, scopes: f.scopes.includes(scope) ? f.scopes.filter((s) => s !== scope) : [...f.scopes, scope] }));

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const body = { ...form, appId: form.appId || null };
    const reply = await run(
      () => (isNew ? api.post('/api/connections', body) : api.put(`/api/connections/${connection.id}`, body)),
      isNew ? null : 'Saved',
    );
    setBusy(false);
    if (!reply) return;
    if (isNew) onKey(form.name, reply.key);
    onClose();
  };
  const newKey = async () => {
    if (!window.confirm(`Make a new key for ${connection.name}? The old key stops working right away, so ${connection.name} must get the new one.`))
      return;
    const reply = await run(() => api.post(`/api/connections/${connection.id}/key`));
    if (reply) {
      onKey(connection.name, reply.key);
      onClose();
    }
  };
  const remove = async () => {
    if (!window.confirm(`Remove ${connection.name}? Its key stops working and every driver, truck and trailer it sent is removed from the suite.`))
      return;
    if (await run(() => api.del(`/api/connections/${connection.id}`), 'Connection removed')) onClose();
  };

  return (
    <Modal
      title={isNew ? 'Connect an app' : `Edit ${connection.name}`}
      onClose={onClose}
      footer={
        <>
          {!isNew && (
            <>
              <button type="button" className="btn btn-danger-outline" onClick={remove}>
                Remove
              </button>
              <button type="button" className="btn mr-auto" onClick={newKey}>
                New key
              </button>
            </>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="conn-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : isNew ? 'Connect and show key' : 'Save'}
          </button>
        </>
      }
    >
      <form id="conn-form" onSubmit={save} className="form-grid">
        {isNew && (
          <div className="field-wide small quick-fill">
            Quick fill:{' '}
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                className="link-btn"
                onClick={() =>
                  setForm((f) => ({ ...f, name: p.label, scopes: p.scopes, appId: data.apps.find((a) => a.name === p.label)?.id || f.appId }))
                }
              >
                {p.label}
              </button>
            )).reduce((acc, el, i) => (i ? [...acc, ' · ', el] : [el]), [])}
          </div>
        )}
        <Field label="Name *" hint="Shown next to the data it sends">
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required maxLength={60} />
        </Field>
        <Field label="App on the home screen">
          <select value={form.appId} onChange={(e) => setForm((f) => ({ ...f, appId: e.target.value }))}>
            <option value="">None</option>
            {data.apps.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="field-wide">
          <span className="field-label">This app may</span>
          <div className="check-grid">
            {Object.entries(data.scopes).map(([scope, label]) => (
              <label key={scope} className="check">
                <input type="checkbox" checked={form.scopes.includes(scope)} onChange={() => toggle(scope)} />
                {label}
              </label>
            ))}
          </div>
          <span className="field-hint">Give each app only what it needs. Only the compliance app should send qualification.</span>
        </div>
        {!isNew && (
          <label className="check field-wide">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
            Turned on (turn off to block its key without removing its data)
          </label>
        )}
      </form>
    </Modal>
  );
}

function lastSync(sync) {
  if (!sync?.at) return <span className="muted">Never</span>;
  return (
    <>
      {dateTime(sync.at)}
      <div className="small muted">
        {sync.added} new, {sync.updated} changed, {sync.removed} removed
        {sync.ignoredFields?.length > 0 && `, ignored: ${sync.ignoredFields.join(', ')}`}
      </div>
    </>
  );
}

export default function Connections() {
  const { data, isAdmin } = useSuite();
  const [editing, setEditing] = useState(null); // null | 'new' | connection
  const [shownKey, setShownKey] = useState(null);
  if (!isAdmin) return <Navigate to="/" replace />;
  const scopeText = (c) => c.scopes.map((s) => data.scopes[s]).join(', ');

  return (
    <>
      <PageHeader
        title="Connections"
        subtitle="Apps that share drivers, trucks and trailers through the suite. Each app has its own key and permissions."
      >
        <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
          + Connect an app
        </button>
      </PageHeader>
      <Card>
        {data.connections.length === 0 ? (
          <Empty>No apps connected yet. Start with TMS Truck: click Connect an app, then put the address and key in its Render settings.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>App</th>
                  <th>May</th>
                  <th>Drivers last sent</th>
                  <th>Equipment last sent</th>
                  <th>Last contact</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.connections.map((c) => (
                  <tr key={c.id} className="clickable" onClick={() => setEditing(c)}>
                    <td>
                      <strong>{c.name}</strong>
                      <div className="small muted">{c.keyHint}</div>
                    </td>
                    <td className="small">{scopeText(c)}</td>
                    <td className="small">{lastSync(c.lastSync.drivers)}</td>
                    <td className="small">{lastSync(c.lastSync.equipment)}</td>
                    <td className="small">{c.lastContactAt ? dateTime(c.lastContactAt) : <span className="muted">Not since restart</span>}</td>
                    <td>{c.active ? <Badge tone="green">On</Badge> : <Badge tone="slate">Off</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div className="grid-2">
        <Card title="How an app connects">
          <ol className="small steps">
            <li>Click Connect an app, choose what it may do, and copy the address and key.</li>
            <li>
              Put them in that app's server settings as <code>SUITE_URL</code> and <code>SUITE_API_KEY</code>. TMS Truck already knows what to do with
              them.
            </li>
            <li>The app sends its full list of drivers, trucks and trailers every few minutes and when something changes.</li>
            <li>Apps that may read get back the combined record, for example the qualification from the compliance app.</li>
          </ol>
          <p className="small muted">The full API is in CONNECT.md in the NEC-Suite repository.</p>
        </Card>
        <Card title="Recent activity">
          {data.activity.length === 0 ? (
            <p className="small muted">Nothing yet.</p>
          ) : (
            <ul className="plain-list small">
              {data.activity.slice(0, 12).map((a, i) => (
                <li key={i}>
                  <span className="muted">{dateTime(a.ts)}</span> · <strong>{a.by}</strong>: {a.text}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      {editing && (
        <ConnectionForm
          connection={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onKey={(name, key) => setShownKey({ name, key })}
        />
      )}
      {shownKey && <KeyModal name={shownKey.name} keyValue={shownKey.key} onClose={() => setShownKey(null)} />}
    </>
  );
}
