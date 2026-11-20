import { useCallback, useEffect, useState } from 'react';
import { Image, MessageSquare, Rocket, Sliders, Zap } from 'lucide-react';
import {
  DEFAULT_BOT_CONFIG,
  type ActivityLogEntry,
  type BotConfig,
  type EnvStatus,
  type UserMemory,
} from './bot/types';
import { DeployGuideView } from './components/DeployGuideView';
import { GifLibraryView } from './components/GifLibraryView';
import { PowersView } from './components/PowersView';
import { SimulatorView } from './components/SimulatorView';
import { StudioView } from './components/StudioView';

type TabKey = 'studio' | 'powers' | 'simulator' | 'gifs' | 'deploy';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('studio');
  const [config, setConfig] = useState<BotConfig>(DEFAULT_BOT_CONFIG);
  const [status, setStatus] = useState<EnvStatus | null>(null);
  const [logs, setLogs] = useState<ActivityLogEntry[]>([]);
  const [memories, setMemories] = useState<UserMemory[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const data = (await res.json()) as EnvStatus;
        setStatus(data);
      }
    } catch {
      // ignore transient network check error
    }
  }, []);

  const loadLogs = useCallback(async () => {
    try {
      const res = await fetch('/api/logs');
      if (res.ok) {
        const data = (await res.json()) as ActivityLogEntry[];
        if (Array.isArray(data)) setLogs(data);
      }
    } catch {
      // ignore
    }
  }, []);

  const loadMemories = useCallback(async () => {
    try {
      const res = await fetch('/api/memories');
      if (res.ok) {
        const data = (await res.json()) as UserMemory[];
        if (Array.isArray(data)) setMemories(data);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    Promise.all([
      fetch('/api/config').then((r) => (r.ok ? r.json() : DEFAULT_BOT_CONFIG)),
      loadStatus(),
      loadLogs(),
      loadMemories(),
    ])
      .then(([cfg]) => {
        if (cfg && typeof cfg === 'object') {
          setConfig(cfg as BotConfig);
        }
      })
      .finally(() => setLoading(false));
  }, [loadStatus, loadLogs, loadMemories]);

  const handleSaveConfig = async () => {
    setSaving(true);
    setSaveNotice(null);
    try {
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!res.ok) throw new Error('Save failed');
      const saved = (await res.json()) as BotConfig;
      setConfig(saved);
      setSaveNotice('Saved');
      setTimeout(() => setSaveNotice(null), 2000);
    } catch {
      setSaveNotice('Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleTogglePolling = async (enabled: boolean) => {
    await fetch('/api/bot/polling', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    await loadStatus();
  };

  const handleClearLogs = async () => {
    await fetch('/api/logs', { method: 'DELETE' });
    setLogs([]);
  };

  const handleDeleteMemory = async (chatId: string, userId: string) => {
    await fetch(
      `/api/memories/${encodeURIComponent(chatId)}/${encodeURIComponent(userId)}`,
      { method: 'DELETE' }
    );
    await loadMemories();
  };

  const handleClearMemories = async () => {
    await fetch('/api/memories', { method: 'DELETE' });
    setMemories([]);
  };

  const handleSimulatorLogAndMemoryUpdate = useCallback(async () => {
    await Promise.all([loadLogs(), loadMemories()]);
  }, [loadLogs, loadMemories]);

  const navItems: Array<{ key: TabKey; label: string }> = [
    { key: 'studio', label: 'Studio' },
    { key: 'powers', label: 'Powers' },
    { key: 'simulator', label: 'Live Test' },
    { key: 'gifs', label: 'GIF Library' },
    { key: 'deploy', label: '24/7 Deploy' },
  ];

  return (
    <div className="min-h-screen bg-[#F8F7F4] text-zinc-900 flex flex-col pb-20 md:pb-8">
      {/* Three-Zone Single-Row Top Bar */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-stone-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 md:h-16 flex items-center justify-between gap-6">
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('studio');
            }}
            className="text-base sm:text-lg font-bold tracking-tight text-zinc-900 whitespace-nowrap shrink-0"
          >
            Kritika Studio
          </a>

          <nav
            aria-label="Primary sections"
            className="hidden md:flex items-center gap-6 text-sm font-medium"
          >
            {navItems.map((item) => {
              const active = activeTab === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActiveTab(item.key)}
                  className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                    active
                      ? 'text-zinc-900 border-rose-600'
                      : 'text-zinc-600 border-transparent hover:text-zinc-900'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={handleSaveConfig}
              disabled={saving || loading}
              className="min-h-[40px] px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs sm:text-sm font-medium transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              {saving ? 'Saving...' : saveNotice || 'Save Changes'}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">
        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 h-96 bg-white border border-stone-200 rounded-2xl animate-pulse" />
            <div className="lg:col-span-5 h-72 bg-white border border-stone-200 rounded-2xl animate-pulse" />
          </div>
        ) : (
          <>
            {activeTab === 'studio' && (
              <StudioView
                config={config}
                status={status}
                logs={logs}
                saving={saving}
                onChange={setConfig}
                onSave={handleSaveConfig}
                onTogglePolling={handleTogglePolling}
                onRefreshStatus={loadStatus}
                onClearLogs={handleClearLogs}
                onOpenTestTab={() => setActiveTab('simulator')}
              />
            )}
            {activeTab === 'powers' && (
              <PowersView
                config={config}
                memories={memories}
                saving={saving}
                onChange={setConfig}
                onSave={handleSaveConfig}
                onRefreshMemories={loadMemories}
                onDeleteMemory={handleDeleteMemory}
                onClearMemories={handleClearMemories}
              />
            )}
            {activeTab === 'simulator' && (
              <SimulatorView
                config={config}
                status={status}
                onLogUpdate={handleSimulatorLogAndMemoryUpdate}
              />
            )}
            {activeTab === 'gifs' && (
              <GifLibraryView
                config={config}
                onChange={setConfig}
                onSave={handleSaveConfig}
                saving={saving}
              />
            )}
            {activeTab === 'deploy' && (
              <DeployGuideView
                status={status}
                onRefreshStatus={loadStatus}
              />
            )}
          </>
        )}
      </main>

      {/* Mobile Bottom Thumb-Zone Navigation (<= 64px height) */}
      <nav
        aria-label="Mobile sections"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-stone-200 grid grid-cols-5 h-16"
      >
        <button
          type="button"
          onClick={() => setActiveTab('studio')}
          className={`flex flex-col items-center justify-center gap-0.5 min-h-[44px] text-[11px] font-medium ${
            activeTab === 'studio' ? 'text-rose-600' : 'text-zinc-600'
          }`}
        >
          <Sliders className="w-5 h-5" />
          <span>Studio</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('powers')}
          className={`flex flex-col items-center justify-center gap-0.5 min-h-[44px] text-[11px] font-medium ${
            activeTab === 'powers' ? 'text-rose-600' : 'text-zinc-600'
          }`}
        >
          <Zap className="w-5 h-5" />
          <span>Powers</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('simulator')}
          className={`flex flex-col items-center justify-center gap-0.5 min-h-[44px] text-[11px] font-medium ${
            activeTab === 'simulator' ? 'text-rose-600' : 'text-zinc-600'
          }`}
        >
          <MessageSquare className="w-5 h-5" />
          <span>Test</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('gifs')}
          className={`flex flex-col items-center justify-center gap-0.5 min-h-[44px] text-[11px] font-medium ${
            activeTab === 'gifs' ? 'text-rose-600' : 'text-zinc-600'
          }`}
        >
          <Image className="w-5 h-5" />
          <span>GIFs</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('deploy')}
          className={`flex flex-col items-center justify-center gap-0.5 min-h-[44px] text-[11px] font-medium ${
            activeTab === 'deploy' ? 'text-rose-600' : 'text-zinc-600'
          }`}
        >
          <Rocket className="w-5 h-5" />
          <span>Deploy</span>
        </button>
      </nav>
    </div>
  );
}
