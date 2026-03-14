import React, { useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useDarkMode } from './hooks/useSearch';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import ClassificationsPage from './pages/ClassificationsPage';
import VTRPage from './pages/VTRPage';
import DocumentationPage from './pages/DocumentationPage';
import ToxProfilePage from './pages/ToxProfilePage';


export default function App() {
  const [dark, setDark] = useDarkMode();
  // Mobile: overlay open/close
  const [mobileOpen, setMobileOpen] = useState(false);
  // Desktop: collapsed (icons only) vs expanded
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('toxonomy-sidebar-collapsed') === 'true';
  });

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('toxonomy-sidebar-collapsed', String(next));
  };

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-30 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <Sidebar
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapsed}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header
          dark={dark}
          setDark={setDark}
          onMenuClick={() => setMobileOpen(true)}
        />

        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<ClassificationsPage />} />
            <Route path="/vtr" element={<VTRPage />} />
            <Route path="/tox-profile" element={<ToxProfilePage />} />
            <Route path="/documentation" element={<DocumentationPage />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
