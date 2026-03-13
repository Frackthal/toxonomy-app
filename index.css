import React from 'react';
import { Sun, Moon, Menu } from 'lucide-react';

export default function Header({ dark, setDark, onMenuClick }) {
  return (
    <header className="h-14 min-h-[3.5rem] flex items-center justify-between px-4 lg:px-6 border-b border-[var(--border-color)] bg-[var(--surface-0)]">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="lg:hidden p-1.5 rounded-lg hover:bg-[var(--surface-100)]"
        >
          <Menu size={20} />
        </button>

        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-tox-600 flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M9 3v6l-3 6a3 3 0 003 3h6a3 3 0 003-3l-3-6V3" />
              <path d="M9 3h6" />
              <circle cx="12" cy="15" r="1" fill="currentColor" />
            </svg>
          </div>
          <h1 className="text-lg font-semibold tracking-tight text-[var(--text-primary)]">
            <span className="font-display italic text-xl">Toxonomy</span>
          </h1>
        </div>
      </div>

      <button
        onClick={() => setDark(!dark)}
        className="p-2 rounded-lg hover:bg-[var(--surface-100)] text-[var(--text-secondary)]"
        title={dark ? 'Mode clair' : 'Mode sombre'}
      >
        {dark ? <Sun size={18} /> : <Moon size={18} />}
      </button>
    </header>
  );
}
