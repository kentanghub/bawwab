import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Server, FileText, Settings, Activity,
  Image, Scale, BrainCircuit, Zap, Gauge
} from 'lucide-react';

const navItems = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { path: '/image-gen', icon: Image, label: 'Image Gen' },
  { path: '/compare', icon: Scale, label: 'Compare' },
  { path: '/embeddings', icon: BrainCircuit, label: 'Embeddings' },
  { path: '/providers', icon: Server, label: 'Providers' },
  { path: '/combos', icon: Zap, label: 'Combos' },
  { path: '/quota', icon: Gauge, label: 'Quota' },
  { path: '/logs', icon: FileText, label: 'Logs' },
  { path: '/settings', icon: Settings, label: 'Settings' },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  return (
    <div className="min-h-screen flex bg-black">
      {/* Sidebar */}
      <aside className="w-56 bg-black border-r border-[#2a2a2a] fixed h-full">
        <div className="p-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-white rounded-lg flex items-center justify-center">
              <Activity className="w-5 h-5 text-black" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white tracking-tight">Bawwab</h1>
              <p className="text-[10px] text-[#555555] uppercase tracking-wider">AI Gateway</p>
            </div>
          </div>
        </div>

        <nav className="px-2 py-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg mb-0.5 text-sm transition-colors ${
                  isActive
                    ? 'bg-[#1a1a1a] text-white'
                    : 'text-[#888888] hover:bg-[#111111] hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="font-medium">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 ml-56">
        <header className="h-14 bg-black/80 backdrop-blur border-b border-[#2a2a2a] fixed top-0 right-0 left-56 z-10">
          <div className="h-full px-6 flex items-center justify-between">
            <h2 className="text-sm font-medium text-white">
              {navItems.find((i) => i.path === location.pathname)?.label || 'Dashboard'}
            </h2>
            <div className="flex items-center gap-3">
              <ConnectionStatus />
            </div>
          </div>
        </header>

        <div className="pt-14 p-6">
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
        const res = await fetch('/health');
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
    <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#111111] border border-[#2a2a2a]">
      <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-white' : 'bg-[#555555]'}`} />
      <span className={`text-xs ${connected ? 'text-white' : 'text-[#555555]'}`}>
        {connected ? 'Online' : 'Offline'}
      </span>
    </div>
  );
}
