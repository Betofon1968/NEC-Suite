import { useMemo, useState } from 'react';
import { useSuite } from '../store/SuiteContext.jsx';
import { api } from '../lib/api.js';
import { date, dateTime, daysUntil } from '../lib/format.js';
import { Badge, Card, Empty, Modal, PageHeader, SearchInput, Tabs, matches } from './ui.jsx';
import { SOON_DAYS } from '../lib/hub.js';

// A date with a warning when it has passed or comes within 30 days.
export function Expiry({ value, due }) {
  if (!value) return <span className="muted">—</span>;
  const left = daysUntil(value);
  if (left < 0)
    return (
      <Badge tone="red">
        {due ? 'Overdue' : 'Expired'} {date(value)}
      </Badge>
    );
  if (left <= SOON_DAYS) return <Badge tone="amber">{`${due ? 'Due' : 'Expires'} ${left === 0 ? 'today' : `in ${left} days`}`}</Badge>;
  return <span>{date(value)}</span>;
}

export function AppChips({ sources }) {
  return (
    <span className="chips">
      {sources.map((s) => (
        <span key={s.recordId} className="chip" title={`${s.app}: id ${s.externalId}`}>
          {s.app}
        </span>
      ))}
    </span>
  );
}

export function AlertList({ alerts }) {
  if (!alerts.length) return <span className="ok small">OK</span>;
  return (
    <span className="alert-chips">
      {alerts.map((a) => (
        <span key={a.text} className={`alert-chip alert-chip-${a.level}`}>
          {a.text}
        </span>
      ))}
    </span>
  );
}

const needsAttention = (r) => r.alerts.length > 0;

// The Drivers and Trucks & Trailers pages: one row per driver or unit, joined from every app.
export function SharedRecords({ collection, title, subtitle, columns, tabs, details, labelOf, emptyText }) {
  const { data } = useSuite();
  const list = data[collection];
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState(tabs[0].value);
  const [openId, setOpenId] = useState(null);
  const tabDef = tabs.find((t) => t.value === tab);

  const rows = useMemo(
    () =>
      list
        .filter(tabDef.filter)
        .filter((r) => matches(query, labelOf(r), r.phone, r.email, r.vin, r.plate, ...r.sources.map((s) => s.app)))
        .sort((a, b) => Number(b.alerts.some((x) => x.level === 'red')) - Number(a.alerts.some((x) => x.level === 'red'))),
    [list, tabDef, query, labelOf],
  );
  const open = list.find((r) => r.id === openId);

  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      <Card>
        <div className="toolbar">
          <Tabs tabs={tabs.map((t) => ({ ...t, count: list.filter(t.filter).length }))} value={tab} onChange={setTab} />
          <SearchInput value={query} onChange={setQuery} placeholder="Search name, app, VIN, plate" />
        </div>
        {list.length === 0 ? (
          <Empty>{emptyText}</Empty>
        ) : rows.length === 0 ? (
          <Empty>Nothing matches.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table table-hover">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c.header}>{c.header}</th>
                  ))}
                  <th>In apps</th>
                  <th>Attention</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="clickable" onClick={() => setOpenId(r.id)}>
                    {columns.map((c) => (
                      <td key={c.header}>{c.render(r)}</td>
                    ))}
                    <td>
                      <AppChips sources={r.sources} />
                    </td>
                    <td>
                      <AlertList alerts={r.alerts} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {open && <RecordModal collection={collection} record={open} list={list} details={details} labelOf={labelOf} onClose={() => setOpenId(null)} />}
    </>
  );
}

function RecordModal({ collection, record, list, details, labelOf, onClose }) {
  const { isAdmin, run } = useSuite();
  const [joinWith, setJoinWith] = useState('');
  const others = list.filter((r) => r.id !== record.id && (collection !== 'equipment' || r.kind === record.kind));

  const split = (recordId, app) =>
    window.confirm(`Take the ${app} record out and show it on its own?`) &&
    run(() => api.post(`/api/${collection}/split`, { recordId }), 'Separated').then((ok) => ok && onClose());
  const join = () => {
    const other = others.find((r) => r.id === joinWith);
    if (
      !other ||
      !window.confirm(
        `Join ${labelOf(other)} into ${labelOf(record)}? Use this when both are the same ${collection === 'drivers' ? 'person' : 'unit'}.`,
      )
    )
      return;
    run(() => api.post(`/api/${collection}/merge`, { from: other.id, into: record.id }), 'Joined').then(() => setJoinWith(''));
  };

  return (
    <Modal title={labelOf(record)} onClose={onClose} size="lg">
      {record.alerts.length > 0 && (
        <div className="alert alert-error">
          <AlertList alerts={record.alerts} />
        </div>
      )}
      <dl className="dl">
        {details.map(([label, render]) => (
          <div key={label} className="dl-row">
            <dt>{label}</dt>
            <dd>{render(record) || <span className="muted">—</span>}</dd>
          </div>
        ))}
      </dl>

      {record.mismatches.length > 0 && (
        <>
          <h3 className="form-heading">Apps disagree</h3>
          <p className="small muted">Fix the wrong value in the app where it is kept. The suite shows the newest value until then.</p>
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {record.mismatches.map((m) => (
                  <tr key={m.field}>
                    <td>
                      <strong>{m.label}</strong>
                    </td>
                    <td>
                      {m.values.map((v) => (
                        <div key={v.app}>
                          {v.app}: <strong>{String(v.value)}</strong>
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h3 className="form-heading">Where it comes from</h3>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>App</th>
              <th>Id in that app</th>
              <th>Last change</th>
              {isAdmin && record.sources.length > 1 && <th />}
            </tr>
          </thead>
          <tbody>
            {record.sources.map((s) => (
              <tr key={s.recordId}>
                <td>{s.app}</td>
                <td className="small">{s.externalId}</td>
                <td className="small">{dateTime(s.updatedAt)}</td>
                {isAdmin && record.sources.length > 1 && (
                  <td className="right">
                    <button type="button" className="btn btn-sm" onClick={() => split(s.recordId, s.app)}>
                      Not the same, separate
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isAdmin && others.length > 0 && (
        <>
          <h3 className="form-heading">Same {collection === 'drivers' ? 'driver' : 'unit'} in another app?</h3>
          <p className="small muted">
            The suite joins records by {collection === 'drivers' ? 'phone number, employee id, or exact name' : 'VIN, or plate and state'}. Join by
            hand when it missed one.
          </p>
          <div className="toolbar">
            <select value={joinWith} onChange={(e) => setJoinWith(e.target.value)} aria-label="Record to join">
              <option value="">Choose…</option>
              {others.map((r) => (
                <option key={r.id} value={r.id}>
                  {labelOf(r)} ({r.sources.map((s) => s.app).join(', ')})
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-primary btn-sm" disabled={!joinWith} onClick={join}>
              Join
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

export { needsAttention };
