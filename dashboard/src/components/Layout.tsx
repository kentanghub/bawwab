import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Server, FileText, Settings, Activity } from 'lucide-react';

const navItems = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { path: '/providers', icon: Server, label: 'Providers' },
  { path: '/logs', icon: FileText, label: 'Logs' },
  { path: '/settings', icon: Settings, label: 'Settings' },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-900 border-r border-gray-800 fixed h-full">
        <div className="p-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center">
              <Activity className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Bawwab</h1>
              <p className="text-xs text-gray-500">AI Gateway</p>
            </div>
          </div>
        </div>

        <nav className="px-3 py-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg mb-1 transition-colors ${
                  isActive
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="font-medium">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 ml-64">
        <header className="h-16 bg-gray-900/80 backdrop-blur border-b border-gray-800 fixed top-0 right-0 left-64 z-10">
          <div className="h-full px-8 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">
              {navItems.find((i) => i.path === location.pathname)?.label || 'Dashboard'}
            </h2>
            <div className="flex items-center gap-4">
              <ConnectionStatus />
            </div>
          </div>
        </header>

        <div className="pt-16 p-8">
          {children}
        </div>
      </main>
    </div>
  );
}

function ConnectionStatus() {
  const [connected, setConnected] = React.useState(false);

  React.useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch('/api/health');
        setConnected(res.ok);
      } catch {
        setConnected(false);
      }
    };
    check();
    const interval = setInterval(check, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center gap-2">
      <div className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-400'}`} />
      <span className={`text-sm ${connected ? 'text-emerald-400' : 'text-red-400'}`}>
        {connected ? 'Connected' : 'Disconnected'}
      </span>
    </div>
  );
}
