import { NavLink } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/', label: 'Overview' },
  { to: '/agents', label: 'Agents' },
  { to: '/enrollment', label: 'Enrollment' },
  { to: '/api-keys', label: 'API Keys' },
  { to: '/policies', label: 'Policies' },
  { to: '/audit', label: 'Audit Log' },
  { to: '/try-it', label: 'Try It' },
  { to: '/settings', label: 'Settings' },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  return (
    <>
      {/* Mobile overlay backdrop */}
      {open && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={onClose}
          aria-label="Close sidebar"
        />
      )}

      <aside
        className={`
          ${open ? 'fixed inset-y-0 left-0 z-50 flex' : 'hidden'}
          w-60 flex-col bg-gray-900 border-r border-gray-800
          lg:relative lg:flex
        `}
      >
        <div className="px-5 py-4">
          <span className="text-lg font-bold text-white tracking-wide">Sonde</span>
        </div>
        <nav className="mt-2 flex flex-col gap-0.5 px-2">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={onClose}
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
    </>
  );
}
