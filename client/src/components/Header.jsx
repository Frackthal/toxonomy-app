import React from 'react';

function Header() {
  return (
    <header className="bg-white shadow p-4 flex items-center gap-3">
      <img src="/logo-fiole.png" alt="Logo Toxonomy" className="h-10 w-auto" />
      <h1 className="text-xl font-bold text-blue-900 tracking-wide">TOXONOMY</h1>
    </header>
  );
}

export default Header;