import { useState } from 'react';
import { Play, RefreshCw, Square, Trash2, Volume2 } from 'lucide-react';
import {
  GEMINI_PRESET_MODELS,
  OPENROUTER_PRESET_MODELS,
  type ActivityLogEntry,
  type BotConfig,
  type EnvStatus,
} from '../bot/types';
import { KritikaAvatar } from './KritikaAvatar';

interface StudioViewProps {
  config: BotConfig;
  status: EnvStatus | null;
  logs: ActivityLogEntry[];
  saving: boolean;
  onChange: (next: BotConfig) => void;
  onSave: () => Promise<void>;
  onTogglePolling: (enabled: boolean) => Promise<void>;
  onRefreshStatus: () => Promise<void>;
  onClearLogs: () => Promise<void>;
  onOpenTestTab: () => void;
}

const LANGUAGE_OPTIONS = ['Hindi', 'Hinglish', 'English'];

export function StudioView({
  config,
  status,
  logs,
  saving,
  onChange,
  onSave,
  onTogglePolling,
  onRefreshStatus,
  onClearLogs,
  onOpenTestTab,
}: StudioViewProps) {
  const [testingVoice, setTestingVoice] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [testAudioUrl, setTestAudioUrl] = useState<string | null>(null);
  const [pollingBusy, setPollingBusy] = useState(false);
  const [resettingPool, setResettingPool] = useState(false);

  const handleResetPool = async () => {
    setResettingPool(true);
    try {
      await fetch('/api/models/reset-cooldowns', { method: 'POST' });
      await onRefreshStatus();
    } finally {
      setResettingPool(false);
    }
  };

  const toggleLanguage = (lang: string) => {
    const exists = config.languages.includes(lang);
    const next = exists
      ? config.languages.filter((l) => l !== lang)
      : [...config.languages, lang];
    onChange({
      ...config,
      languages: next.length > 0 ? next : [lang],
    });
  };

  const handleTestVoice = async () => {
    setTestingVoice(true);
    setVoiceError(null);
    try {
      const res = await fetch('/api/tts/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `Heyy! Main ${config.botName} hoon. Aaj group mein kya scene chal raha hai?`,
        }),
      });
      const data = (await res.json()) as {
        audioBase64?: string;
        mimeType?: string;
        error?: string;
      };
      if (!res.ok || !data.audioBase64) {
        throw new Error(data.error || 'Voice test failed');
      }
      const dataUrl = `data:${data.mimeType || 'audio/wav'};base64,${data.audioBase64}`;
      setTestAudioUrl(dataUrl);
      const audio = new Audio(dataUrl);
      await audio.play().catch(() => {});
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : 'Unable to generate test voice');
    } finally {
      setTestingVoice(false);
    }
  };

  const handlePollingClick = async () => {
    setPollingBusy(true);
    try {
      await onTogglePolling(!status?.pollingActive);
    } finally {
      setPollingBusy(false);
    }
  };

  const isPresetModel = OPENROUTER_PRESET_MODELS.some(
    (m) => m.id === config.openRouterModel
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left Column: Persona, Brain & Behavior */}
      <div className="lg:col-span-7 space-y-6">
        {/* Persona Card */}
        <section className="bg-white border border-stone-200 rounded-2xl p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-stone-100">
            <div className="flex items-center gap-4 min-w-0">
              <KritikaAvatar name={config.botName} size="lg" />
              <div className="min-w-0">
                <h1 className="text-xl font-semibold text-zinc-900 truncate">
                  {config.botName || 'Kritika'}
                </h1>
                <p className="text-sm text-zinc-600 mt-0.5">
                  {config.tagline}
                </p>
                <p className="text-xs text-zinc-500 mt-1.5">
                  {`${config.languages.join(' · ')} · Discussion Group Auto-Responder`}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onOpenTestTab}
              className="min-h-[44px] px-4 py-2 rounded-xl border border-stone-200 bg-stone-50 hover:bg-stone-100 text-sm font-medium text-zinc-900 transition-colors whitespace-nowrap shrink-0"
            >
              Open Simulator
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-5">
            <div>
              <label
                htmlFor="bot-name-input"
                className="block text-sm font-medium text-zinc-800 mb-1.5"
              >
                Bot Character Name
              </label>
              <input
                id="bot-name-input"
                type="text"
                value={config.botName}
                onChange={(e) => onChange({ ...config, botName: e.target.value })}
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-stone-200 bg-white text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-rose-500/30 focus:border-rose-500"
                placeholder="Kritika"
              />
            </div>

            <div>
              <label
                htmlFor="bot-traits-input"
                className="block text-sm font-medium text-zinc-800 mb-1.5"
              >
                Personality Vibe
              </label>
              <input
                id="bot-traits-input"
                type="text"
                value={config.personalityTraits}
                onChange={(e) =>
                  onChange({ ...config, personalityTraits: e.target.value })
                }
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-stone-200 bg-white text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-rose-500/30 focus:border-rose-500"
                placeholder="Friendly, flirty, funny"
              />
            </div>
          </div>

          <div className="mt-4">
            <span className="block text-sm font-medium text-zinc-800 mb-2">
              Active Chat Languages
            </span>
            <div className="flex flex-wrap gap-2">
              {LANGUAGE_OPTIONS.map((lang) => {
                const active = config.languages.includes(lang);
                return (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => toggleLanguage(lang)}
                    aria-pressed={active}
                    className={`min-h-[44px] px-4 py-2 rounded-xl text-sm font-medium transition-colors whitespace-nowrap shrink-0 border ${
                      active
                        ? 'bg-zinc-900 text-white border-zinc-900'
                        : 'bg-white text-zinc-700 border-stone-200 hover:bg-stone-50'
                    }`}
                  >
                    {lang}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-4">
            <label
              htmlFor="system-prompt-textarea"
              className="block text-sm font-medium text-zinc-800 mb-1.5"
            >
              Character Instructions
            </label>
            <textarea
              id="system-prompt-textarea"
              rows={6}
              value={config.systemPrompt}
              onChange={(e) => onChange({ ...config, systemPrompt: e.target.value })}
              className="w-full px-3.5 py-2.5 rounded-xl border border-stone-200 bg-white text-sm text-zinc-900 leading-relaxed focus:outline-none focus:ring-2 focus:ring-rose-500/30 focus:border-rose-500"
            />
          </div>
        </section>

        {/* AI Brain & Probabilities */}
        <section className="bg-white border border-stone-200 rounded-2xl p-5 sm:p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-zinc-900">
                AI Brain & Response Mix
              </h2>
              <p className="text-sm text-zinc-600 mt-0.5">
                Using Google Gemini API for friendly, flirty & funny banter (no 18+ adult content).
              </p>
            </div>
            <div
              className="inline-flex items-center p-1 bg-stone-100 rounded-xl border border-stone-200 shrink-0"
              role="group"
              aria-label="AI Provider Selection"
            >
              <button
                type="button"
                onClick={() => onChange({ ...config, aiProvider: 'gemini' })}
                className={`min-h-[36px] px-3 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  (config.aiProvider || 'gemini') === 'gemini'
                    ? 'bg-white text-zinc-900 shadow-xs'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                Google Gemini
              </button>
              <button
                type="button"
                onClick={() => onChange({ ...config, aiProvider: 'openrouter' })}
                className={`min-h-[36px] px-3 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  config.aiProvider === 'openrouter'
                    ? 'bg-white text-zinc-900 shadow-xs'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                OpenRouter
              </button>
            </div>
          </div>

          {(config.aiProvider || 'gemini') === 'gemini' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="gemini-model-select"
                  className="block text-sm font-medium text-zinc-800 mb-1.5"
                >
                  Google Gemini Model
                </label>
                <select
                  id="gemini-model-select"
                  value={config.geminiModel || 'gemini-3.1-flash-lite'}
                  onChange={(e) =>
                    onChange({ ...config, geminiModel: e.target.value })
                  }
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-stone-200 bg-white text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-rose-500/30 focus:border-rose-500"
                >
                  {GEMINI_PRESET_MODELS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <span className="block text-sm font-medium text-zinc-800 mb-1.5">
                  Auto-Failover Pool
                </span>
                <div className="min-h-[44px] px-3.5 py-2.5 rounded-xl border border-stone-200 bg-stone-50 text-xs text-zinc-700 flex items-center">
                  Automatically switches across all available free Google Gemini &amp; Gemma models when any model reaches its limit.
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="openrouter-preset-select"
                  className="block text-sm font-medium text-zinc-800 mb-1.5"
                >
                  OpenRouter Model Preset
                </label>
                <select
                  id="openrouter-preset-select"
                  value={isPresetModel ? config.openRouterModel : '__custom__'}
                  onChange={(e) => {
                    if (e.target.value !== '__custom__') {
                      onChange({ ...config, openRouterModel: e.target.value });
                    }
                  }}
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-stone-200 bg-white text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-rose-500/30 focus:border-rose-500"
                >
                  {OPENROUTER_PRESET_MODELS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                  {!isPresetModel && (
                    <option value="__custom__">Custom Model ID</option>
                  )}
                </select>
              </div>

              <div>
                <label
                  htmlFor="openrouter-custom-input"
                  className="block text-sm font-medium text-zinc-800 mb-1.5"
                >
                  Model ID
                </label>
                <input
                  id="openrouter-custom-input"
                  type="text"
                  value={config.openRouterModel}
                  onChange={(e) =>
                    onChange({ ...config, openRouterModel: e.target.value })
                  }
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-stone-200 bg-white text-sm font-mono text-zinc-900 focus:outline-none focus:ring-2 focus:ring-rose-500/30 focus:border-rose-500"
                  placeholder="provider/model-name"
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pt-2">
            <div>
              <div className="flex items-center justify-between text-sm mb-1.5">
                <label htmlFor="reply-chance" className="font-medium text-zinc-800">
                  Instant Reply Rate
                </label>
                <span className="font-mono tabular-nums text-zinc-600">
                  {config.replyChance}%
                </span>
              </div>
              <input
                id="reply-chance"
                type="range"
                min={0}
                max={100}
                step={5}
                value={config.replyChance}
                onChange={(e) =>
                  onChange({ ...config, replyChance: Number(e.target.value) })
                }
                className="w-full accent-rose-600"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-sm mb-1.5">
                <label htmlFor="reaction-chance" className="font-medium text-zinc-800">
                  Emoji Reaction Rate
                </label>
                <span className="font-mono tabular-nums text-zinc-600">
                  {config.reactionChance}%
                </span>
              </div>
              <input
                id="reaction-chance"
                type="range"
                min={0}
                max={100}
                step={5}
                value={config.reactionChance}
                onChange={(e) =>
                  onChange({ ...config, reactionChance: Number(e.target.value) })
                }
                className="w-full accent-rose-600"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-sm mb-1.5">
                <label htmlFor="gif-chance" className="font-medium text-zinc-800">
                  GIF Reply Rate
                </label>
                <span className="font-mono tabular-nums text-zinc-600">
                  {config.gifChance}%
                </span>
              </div>
              <input
                id="gif-chance"
                type="range"
                min={0}
                max={100}
                step={5}
                value={config.gifChance}
                onChange={(e) =>
                  onChange({ ...config, gifChance: Number(e.target.value) })
                }
                className="w-full accent-rose-600"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-sm mb-1.5">
                <label htmlFor="voice-chance" className="font-medium text-zinc-800">
                  Voice Note Rate
                </label>
                <span className="font-mono tabular-nums text-zinc-600">
                  {config.voiceChance}%
                </span>
              </div>
              <input
                id="voice-chance"
                type="range"
                min={0}
                max={100}
                step={5}
                value={config.voiceChance}
                onChange={(e) =>
                  onChange({ ...config, voiceChance: Number(e.target.value) })
                }
                className="w-full accent-rose-600"
              />
            </div>
          </div>

          <div className="pt-3 border-t border-stone-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <label htmlFor="voice-select" className="text-sm font-medium text-zinc-800">
                Female Voice
              </label>
              <select
                id="voice-select"
                value={config.voiceName}
                onChange={(e) =>
                  onChange({
                    ...config,
                    voiceName: e.target.value === 'Zephyr' ? 'Zephyr' : 'Kore',
                  })
                }
                className="min-h-[44px] px-3 py-2 rounded-xl border border-stone-200 bg-white text-sm text-zinc-900"
              >
                <option value="Kore">Kore (Warm & Expressive)</option>
                <option value="Zephyr">Zephyr (Bright & Playful)</option>
              </select>
            </div>

            <button
              type="button"
              onClick={handleTestVoice}
              disabled={testingVoice}
              className="min-h-[44px] px-4 py-2 rounded-xl border border-stone-200 bg-stone-50 hover:bg-stone-100 text-sm font-medium text-zinc-900 inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <Volume2 className="w-4 h-4" />
              {testingVoice ? 'Generating Voice...' : 'Test Voice'}
            </button>
          </div>

          {voiceError && (
            <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3.5 py-2.5">
              {voiceError}
            </p>
          )}

          {testAudioUrl && (
            <div className="bg-stone-50 border border-stone-200 rounded-xl p-3">
              <audio controls src={testAudioUrl} className="w-full h-10" />
            </div>
          )}

          <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2.5 text-sm text-zinc-700 cursor-pointer min-h-[44px]">
              <input
                type="checkbox"
                checked={config.replyToChannelPosts}
                onChange={(e) =>
                  onChange({ ...config, replyToChannelPosts: e.target.checked })
                }
                className="w-4 h-4 accent-rose-600 rounded"
              />
              Comment automatically on new channel posts forwarded to Discussion Group
            </label>

            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="min-h-[44px] px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </section>
      </div>

      {/* Right Column: Live Connection & Activity Feed */}
      <div className="lg:col-span-5 space-y-6">
        <section className="bg-white border border-stone-200 rounded-2xl p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3 pb-4 border-b border-stone-100">
            <div>
              <h2 className="text-lg font-semibold text-zinc-900">
                Server Environment
              </h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                Live Telegram & Google Gemini connection
              </p>
            </div>
            <button
              type="button"
              onClick={onRefreshStatus}
              aria-label="Refresh server status"
              className="min-h-[44px] min-w-[44px] rounded-xl border border-stone-200 hover:bg-stone-50 flex items-center justify-center text-zinc-700 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          <dl className="divide-y divide-stone-100 text-sm mt-2">
            <div className="py-3 flex items-center justify-between gap-4">
              <dt className="text-zinc-600">Telegram Bot Token</dt>
              <dd className="font-medium tabular-nums">
                {status?.telegramConfigured ? (
                  <span className="text-emerald-700">
                    Connected{status.botUsername ? ` (@${status.botUsername})` : ''}
                  </span>
                ) : (
                  <span className="text-amber-700">Missing in Secrets</span>
                )}
              </dd>
            </div>

            <div className="py-3 flex items-center justify-between gap-4">
              <dt className="text-zinc-600">Google Gemini Brain</dt>
              <dd className="font-medium text-right">
                {status?.geminiChatConfigured ? (
                  <span className="text-emerald-700 font-mono text-xs">
                    {status.activeGeminiModel || 'Auto-Failover Ready'}
                  </span>
                ) : (
                  <span className="text-amber-700">Missing in Secrets</span>
                )}
              </dd>
            </div>

            <div className="py-3 flex items-center justify-between gap-4">
              <dt className="text-zinc-600">Gemini TTS Voice</dt>
              <dd className="font-medium">
                {status?.geminiTtsConfigured ? (
                  <span className="text-emerald-700">Ready</span>
                ) : (
                  <span className="text-amber-700">Missing in Secrets</span>
                )}
              </dd>
            </div>

            <div className="py-3 flex items-center justify-between gap-4">
              <dt className="text-zinc-600">Webhook</dt>
              <dd className="font-mono text-xs text-zinc-700 truncate max-w-[200px]">
                {status?.webhookUrl ? status.webhookUrl : 'Polling Mode Active'}
              </dd>
            </div>
          </dl>

          {status?.geminiPool && status.geminiPool.length > 0 && (
            <div className="mt-3 pt-3 border-t border-stone-100">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs font-semibold text-zinc-800">
                  Auto-Failover Pool ({status.geminiPool.filter((m) => m.state === 'active' || m.state === 'ready').length}/{status.geminiPool.length} Ready)
                </span>
                <button
                  type="button"
                  onClick={handleResetPool}
                  disabled={resettingPool}
                  className="text-xs font-medium text-rose-600 hover:text-rose-700 disabled:opacity-50"
                >
                  {resettingPool ? 'Resetting...' : 'Reset Limits'}
                </button>
              </div>
              <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                {status.geminiPool.map((item) => (
                  <div
                    key={item.model}
                    className="flex items-center justify-between gap-2 text-xs py-1 border-b border-stone-100 last:border-b-0"
                  >
                    <span className="font-mono text-zinc-800 truncate">
                      {item.model}
                    </span>
                    <span
                      className={`shrink-0 font-medium ${
                        item.state === 'active'
                          ? 'text-emerald-700'
                          : item.state === 'ready'
                          ? 'text-zinc-500'
                          : 'text-amber-700'
                      }`}
                    >
                      {item.state === 'active'
                        ? 'Active'
                        : item.state === 'ready'
                        ? 'Ready'
                        : item.reason || 'Cooling Down'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="pt-4 mt-2 border-t border-stone-100 flex items-center justify-between gap-3">
            <div className="text-sm">
              <span className="font-medium text-zinc-900 block">
                Live Polling Mode
              </span>
              <span className="text-xs text-zinc-500">
                {status?.pollingActive
                  ? 'Listening for Telegram messages'
                  : 'Paused — start for instant testing'}
              </span>
            </div>

            <button
              type="button"
              onClick={handlePollingClick}
              disabled={pollingBusy || !status?.telegramConfigured}
              className={`min-h-[44px] px-4 py-2 rounded-xl text-sm font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 ${
                status?.pollingActive
                  ? 'bg-zinc-900 hover:bg-zinc-800 text-white'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white'
              }`}
            >
              {status?.pollingActive ? (
                <>
                  <Square className="w-3.5 h-3.5" /> Stop Bot
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" /> Start Polling
                </>
              )}
            </button>
          </div>

          {status?.lastPollingError && (
            <p className="mt-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3.5 py-2.5">
              {status.lastPollingError}
            </p>
          )}
        </section>

        {/* Activity Feed */}
        <section className="bg-white border border-stone-200 rounded-2xl p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3 pb-4 border-b border-stone-100">
            <div>
              <h2 className="text-lg font-semibold text-zinc-900">
                Recent Group Activity
              </h2>
              <p className="text-xs text-zinc-500 mt-0.5 tabular-nums">
                {logs.length} recent events
              </p>
            </div>
            {logs.length > 0 && (
              <button
                type="button"
                onClick={onClearLogs}
                aria-label="Clear activity logs"
                className="min-h-[44px] px-3 py-2 rounded-xl border border-stone-200 hover:bg-stone-50 text-xs font-medium text-zinc-700 inline-flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" /> Clear
              </button>
            )}
          </div>

          {logs.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm font-medium text-zinc-800">
                No activity recorded yet
              </p>
              <p className="text-xs text-zinc-500 mt-1 max-w-xs mx-auto">
                Test Kritika in the Live Simulator or start Telegram polling to watch replies, reactions, GIFs, and voice notes appear here.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-stone-100 mt-2 max-h-[420px] overflow-y-auto">
              {logs.slice(0, 15).map((entry) => (
                <li key={entry.id} className="py-3 space-y-1">
                  <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
                    <span className="font-medium text-zinc-800 truncate">
                      {entry.senderName} · {entry.chatTitle}
                    </span>
                    <span className="font-mono tabular-nums shrink-0">
                      {new Date(entry.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-600 line-clamp-1">
                    “{entry.incomingText}”
                  </p>
                  <p
                    className={`text-xs font-medium ${
                      entry.status === 'error' ? 'text-rose-700' : 'text-zinc-800'
                    }`}
                  >
                    {entry.status === 'error'
                      ? entry.errorMessage || 'Error'
                      : entry.actionSummary}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
