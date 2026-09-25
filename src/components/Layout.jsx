import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useSuite } from '../store/SuiteContext.jsx';

const NAV = [
  { to: '/', label: 'Home', icon: '▦', end: true },
  { section: 'Shared data' },
  { to: '/drivers', label: 'Drivers', icon: '👤', badge: 'drivers' },
  { to: '/equipment', label: 'Trucks & Trailers', icon: '⛟', badge: 'equipment' },
  { section: 'Setup', admin: true },
  { to: '/apps', label: 'Apps', icon: '◫', admin: true },
  { to: '/connections', label: 'Connections', icon: '⇄', admin: true },
  { to: '/users', label: 'Users', icon: '👥', admin: true },
];

const ROLE_LABEL = { admin: 'Admin', staff: 'Staff' };

function initials(name) {
  const parts = String(name || '?')
    .trim()
    .split(/\s+/);
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export default function Layout() {
  const { data, me, isAdmin, logout } = useSuite();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);

  const red = (list) => list.filter((x) => x.alerts.some((a) => a.level === 'red')).length;
  const badges = { drivers: red(data.drivers), equipment: red(data.equipment) };

  return (
    <div className={`app ${open ? 'nav-open' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">▦</span>
          <span>
            <strong>NEC Suite</strong>
            <small>All company apps</small>
          </span>
        </div>
        <nav>
          {NAV.filter((item) => !item.admin || isAdmin).map((item) =>
            item.section ? (
              <div key={item.section} className="nav-section">
                {item.section}
              </div>
            ) : (
              <NavLink key={item.to} to={item.to} end={item.end} className="nav-link">
                <span className="nav-icon" aria-hidden="true">
                  {item.icon}
                </span>
                {item.label}
                {badges[item.badge] > 0 && <span className="nav-badge">{badges[item.badge]}</span>}
              </NavLink>
            ),
          )}
        </nav>
        <div className="sidebar-foot">
          {me && (
            <NavLink to="/account" className="sidebar-user" title="My account">
              <span className="avatar" aria-hidden="true">
                {initials(me.name)}
              </span>
              <span>
                <strong>{me.name}</strong>
                <small>{ROLE_LABEL[me.role] || me.role}</small>
              </span>
            </NavLink>
          )}
          Times shown in New York (ET)
          <div>
            <button type="button" className="sidebar-logout" onClick={logout}>
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button type="button" className="icon-btn menu-btn" onClick={() => setOpen((o) => !o)} aria-label="Menu">
            ☰
          </button>
          <span className="topbar-title">NEC Suite</span>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
    </div>
  );
}
