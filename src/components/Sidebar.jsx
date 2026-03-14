import React from 'react';
import { NavLink } from 'react-router-dom';
import { ListTree, BookOpen, HelpCircle, X, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { FlaskConical } from 'lucide-react';


const navItems = [
  { to: '/', icon: ListTree, label: 'Classifications' },
  { to: '/vtr', icon: BookOpen, label: 'Valeurs de référence' },
  { to: '/tox-profile', icon: FlaskConical, label: 'Profils toxicologiques' },
  { to: '/documentation', icon: HelpCircle, label: 'Documentation' },
];

export default function Sidebar({ mobileOpen, onMobileClose, collapsed, onToggleCollapse }) {
  return (
    <aside className={`
      fixed lg:static inset-y-0 left-0 z-40
      ${collapsed ? 'lg:w-[52px]' : 'lg:w-56'}
      w-60
      bg-[var(--surface-0)] border-r border-[var(--border-color)]
      flex flex-col
      transform transition-all duration-200 ease-out
      ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
    `}>
      {/* Header */}
      <div className={`h-14 min-h-[3.5rem] flex items-center ${collapsed ? 'justify-center' : 'justify-between'} px-3 border-b border-[var(--border-color)]`}>
        {!collapsed && (
          <span className="text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wider">
            Menu
          </span>
        )}

        {/* Mobile close */}
        <button
          onClick={onMobileClose}
          className="lg:hidden p-1.5 rounded-lg hover:bg-[var(--surface-100)] text-[var(--text-secondary)]"
        >
          <X size={16} />
        </button>

        {/* Desktop collapse toggle */}
        <button
          onClick={onToggleCollapse}
          className="hidden lg:flex p-1.5 rounded-lg hover:bg-[var(--surface-100)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
          title={collapsed ? 'Ouvrir le menu' : 'Réduire le menu'}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      {/* Nav links */}
      <nav className={`flex-1 ${collapsed ? 'px-1.5 py-2' : 'p-2'} space-y-0.5`}>
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            onClick={onMobileClose}
            title={collapsed ? label : undefined}
            className={({ isActive }) => `
              flex items-center ${collapsed ? 'justify-center' : ''} gap-2.5
              ${collapsed ? 'px-0 py-2.5' : 'px-3 py-2'}
              rounded-lg text-sm font-medium
              transition-colors duration-100 relative group
              ${isActive
                ? 'bg-tox-50 text-tox-700 dark:bg-tox-950 dark:text-tox-400'
                : 'text-[var(--text-secondary)] hover:bg-[var(--surface-100)] hover:text-[var(--text-primary)]'
              }
            `}
          >
            <Icon size={16} className="shrink-0" />
            {!collapsed && <span className="truncate">{label}</span>}

            {/* Tooltip on collapsed mode */}
            {collapsed && (
              <span className="
                absolute left-full ml-2 px-2.5 py-1 rounded-md
                bg-[var(--surface-800)] text-[var(--surface-0)] text-xs font-medium whitespace-nowrap
                opacity-0 pointer-events-none group-hover:opacity-100
                transition-opacity duration-150 z-50
                shadow-lg
              ">
                {label}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer — only when expanded */}
      {!collapsed && (
        <div className="p-3 border-t border-[var(--border-color)]">
          <p className="text-[10px] text-[var(--text-tertiary)] leading-relaxed">
            Toxonomy v2.0
          </p>
        </div>
      )}
    </aside>
  );
}
