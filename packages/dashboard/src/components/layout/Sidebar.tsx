import { NavLink } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

type Role = 'owner' | 'admin' | 'member';

interface NavItem {
  to: string;
  label: string;
  minimumRole?: Role;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Fleet',
    items: [
      { to: '/', label: 'Overview' },
      { to: '/agents', label: 'Agents' },
    ],
  },
  {
    title: 'Manage',
    items: [
      { to: '/enrollment', label: 'Enrollment' },
      { to: '/api-keys', label: 'API Keys' },
      { to: '/users', label: 'Users', minimumRole: 'admin' },
      { to: '/access-groups', label: 'Access Groups', minimumRole: 'admin' },
      { to: '/integrations', label: 'Integrations' },
    ],
  },
  {
    title: 'Diagnostics',
    items: [
      { to: '/try-it', label: 'Try It' },
      { to: '/audit', label: 'Audit Log', minimumRole: 'admin' },
      { to: '/policies', label: 'Policies', minimumRole: 'admin' },
    ],
  },
  {
    title: 'Settings',
    items: [{ to: '/settings', label: 'SSO Configuration', minimumRole: 'owner' }],
  },
];

/** Role hierarchy for visibility checks (lower index = more privileged). */
const ROLE_RANK: Record<Role, number> = { owner: 0, admin: 1, member: 2 };

function hasRole(userRole: string | undefined, minimum: Role): boolean {
  const rank = ROLE_RANK[userRole as Role];
  return rank !== undefined && rank <= ROLE_RANK[minimum];
}

interface SidebarItemProps {
  item: NavItem;
  userRole?: string;
  onClose: () => void;
}

/** Renders a sidebar nav link. Hidden if the user's role is below minimumRole. */
function SidebarItem({ item, userRole, onClose }: SidebarItemProps) {
  if (item.minimumRole && !hasRole(userRole, item.minimumRole)) {
    return null;
  }

  return (
    <NavLink
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
  );
}

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const { user } = useAuth();
  const userRole = user?.role;

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
        <nav className="mt-2 flex flex-1 flex-col gap-4 px-2 pb-4">
          {NAV_SECTIONS.map((section) => {
            const visibleItems = section.items.filter(
              (item) => !item.minimumRole || hasRole(userRole, item.minimumRole),
            );
            if (visibleItems.length === 0) return null;

            return (
              <div key={section.title}>
                <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  {section.title}
                </p>
                <div className="flex flex-col gap-0.5">
                  {visibleItems.map((item) => (
                    <SidebarItem key={item.to} item={item} userRole={userRole} onClose={onClose} />
                  ))}
                </div>
              </div>
            );
          })}
          <a
            href="/docs"
            className="mt-auto rounded-md px-3 py-2 text-sm font-medium text-gray-400 hover:bg-gray-800/50 hover:text-gray-200 transition-colors"
          >
            Documentation
          </a>
        </nav>
      </aside>
    </>
  );
}
