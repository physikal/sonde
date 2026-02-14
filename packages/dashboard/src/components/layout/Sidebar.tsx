import { NavLink } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/', label: 'Overview' },
  { to: '/agents', label: 'Agents' },
  { to: '/enrollment', label: 'Enrollment' },
  { to: '/api-keys', label: 'API Keys' },
  { to: '/policies', label: 'Policies' },
  { to: '/audit', label: 'Audit Log' },
  { to: '/settings', label: 'Settings' },
];

export function Sidebar() {
  return (
    <aside className="flex w-60 flex-col bg-gray-900 border-r border-gray-800">
      <div className="px-5 py-4">
        <span className="text-lg font-bold text-white tracking-wide">Sonde</span>
      </div>
      <nav className="mt-2 flex flex-col gap-0.5 px-2">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-gray-800 text-white'
                  : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
