import { NavLink } from 'react-router-dom';

type Role = 'owner' | 'admin' | 'member';

interface NavItem {
  to: string;
  label: string;
  minimumRole?: Role;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Overview' },
  { to: '/agents', label: 'Agents' },
  { to: '/enrollment', label: 'Enrollment' },
  { to: '/api-keys', label: 'API Keys' },
  { to: '/policies', label: 'Policies', minimumRole: 'admin' },
  { to: '/integrations', label: 'Integrations' },
  { to: '/audit', label: 'Audit Log', minimumRole: 'admin' },
  { to: '/try-it', label: 'Try It' },
  { to: '/settings', label: 'Settings', minimumRole: 'owner' },
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
  // Role-based filtering is wired but currently all items are visible
  // because useAuth is not consumed here yet (Phase 8a.3 will enable it).
  const userRole: string | undefined = undefined;

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
            <SidebarItem key={item.to} item={item} userRole={userRole} onClose={onClose} />
          ))}
        </nav>
      </aside>
    </>
  );
}
