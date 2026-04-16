import { NavLink } from 'react-router-dom';

export interface NavEntry {
  to: string;
  label: string;
}

export const NAV_ITEMS: readonly NavEntry[] = [
  { to: '/', label: 'Home' },
  { to: '/chat', label: 'Chat' },
  { to: '/agents', label: 'Agents' },
  { to: '/memory', label: 'Memory' },
  { to: '/skills', label: 'Skills' },
  { to: '/scheduler', label: 'Scheduler' },
  { to: '/health', label: 'Health' },
  { to: '/costs', label: 'Costs' },
  { to: '/audit', label: 'Audit' },
  { to: '/settings', label: 'Settings' },
];

/** Sidebar navigation — one link per dashboard route. */
export function Sidebar() {
  return (
    <nav
      aria-label="Primary"
      className="w-56 shrink-0 border-r border-slate-200 bg-slate-50 p-4"
    >
      <div className="mb-6 text-lg font-semibold text-slate-900">Open Hipp0</div>
      <ul className="space-y-1">
        {NAV_ITEMS.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `block rounded px-3 py-1.5 text-sm ${
                  isActive
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-700 hover:bg-slate-200'
                }`
              }
            >
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
