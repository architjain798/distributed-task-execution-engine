import { NavLink, Outlet } from 'react-router-dom';
import { useTaskStore } from '../../stores/task-store';
import { ApiKeyPicker } from './api-key-picker';

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/tasks', label: 'Tasks', end: false },
  { to: '/analytics', label: 'Analytics', end: false },
];

export function AppShell() {
  const connected = useTaskStore((state) => state.connected);

  return (
    <div className="shell">
      <header className="shell__header">
        <span className="shell__brand">Task Execution Engine</span>

        <nav className="shell__nav">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? 'is-active' : '')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="shell__spacer" />

        <span className="connection">
          <span className={`connection__dot ${connected ? '' : 'connection__dot--off'}`} />
          {connected ? 'Live' : 'Reconnecting'}
        </span>

        <ApiKeyPicker />
      </header>

      <main className="shell__main">
        <Outlet />
      </main>
    </div>
  );
}
