import { Link } from 'react-router-dom';
import { useSuite } from '../store/SuiteContext.jsx';
import { Card, Empty, PageHeader, Stat } from '../components/ui.jsx';

const KIND = { truck: 'Truck', trailer: 'Trailer' };

function greeting() {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

function AppTile({ app, isAdmin }) {
  const body = (
    <>
      <span className={`tile-icon tile-${app.color}`} aria-hidden="true">
        {app.icon}
      </span>
      <span className="tile-text">
        <strong>{app.name}</strong>
        <small>{app.description}</small>
        {!app.url && <small className="warn">{isAdmin ? 'Add its address on the Apps page' : 'Address not set yet'}</small>}
        {app.active === false && <small className="muted">Hidden from staff</small>}
      </span>
      {app.url && (
        <span className="tile-open" aria-hidden="true">
          ↗
        </span>
      )}
    </>
  );
  if (!app.url) {
    return isAdmin ? (
      <Link to="/apps" className="app-tile app-tile-off">
        {body}
      </Link>
    ) : (
      <div className="app-tile app-tile-off">{body}</div>
    );
  }
  // Each app opens in its own tab; clicking again goes back to that same tab.
  return (
    <a href={app.url} target={`suite-${app.id}`} rel="noopener noreferrer" className="app-tile">
      {body}
    </a>
  );
}

export default function Home() {
  const { data, me, isAdmin } = useSuite();
  const activeDrivers = data.drivers.filter((d) => d.active);
  const qualified = activeDrivers.filter((d) => d.qualification?.status === 'qualified').length;
  const units = data.equipment.filter((u) => u.active);
  const alerts = [
    ...data.drivers.flatMap((d) => d.alerts.map((a) => ({ ...a, who: d.name, to: '/drivers', key: `d${d.id}${a.text}` }))),
    ...data.equipment.flatMap((u) =>
      u.alerts.map((a) => ({ ...a, who: `${KIND[u.kind]} ${u.unit || u.vin}`, to: '/equipment', key: `e${u.id}${a.text}` })),
    ),
  ].sort((a, b) => (a.level === b.level ? 0 : a.level === 'red' ? -1 : 1));
  const red = alerts.filter((a) => a.level === 'red').length;

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${me.name.split(' ')[0]}`}
        subtitle="Open any app from here. Apps open in their own tab and keep their own sign in."
      />
      {data.apps.length === 0 ? (
        <Card>
          <Empty>{isAdmin ? 'No apps yet. Add them on the Apps page.' : 'No apps have been given to you yet. Ask your admin.'}</Empty>
        </Card>
      ) : (
        <div className="app-grid">
          {data.apps.map((app) => (
            <AppTile key={app.id} app={app} isAdmin={isAdmin} />
          ))}
        </div>
      )}

      <div className="stats">
        <Stat label="Active drivers" value={activeDrivers.length} sub={`${qualified} qualified`} tone="blue" />
        <Stat label="Trucks & trailers" value={units.length} sub={`${units.filter((u) => u.kind === 'truck').length} trucks`} tone="indigo" />
        <Stat
          label="Needs attention"
          value={alerts.length}
          sub={red ? `${red} urgent` : 'Nothing urgent'}
          tone={red ? 'red' : alerts.length ? 'amber' : 'green'}
        />
        {isAdmin && <Stat label="Connected apps" value={data.connections.filter((c) => c.active).length} sub="sharing data" tone="green" />}
      </div>

      <Card title="Needs attention" actions={alerts.length > 12 && <span className="muted small">Showing 12 of {alerts.length}</span>}>
        {alerts.length === 0 ? (
          <Empty>
            {data.drivers.length + data.equipment.length === 0
              ? 'No shared data yet. When apps are connected, expiring medical cards, CDLs, registrations and inspections show up here.'
              : 'All clear. No expired or expiring documents.'}
          </Empty>
        ) : (
          <ul className="attention">
            {alerts.slice(0, 12).map((a) => (
              <li key={a.key}>
                <span className={`dot dot-${a.level}`} aria-hidden="true" />
                <Link to={a.to}>
                  <strong>{a.who}</strong>
                </Link>
                <span>{a.text}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
