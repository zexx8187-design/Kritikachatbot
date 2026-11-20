import {
  BarChart3,
  Brain,
  Camera,
  Clock,
  Crown,
  Mic,
  RefreshCw,
  ShieldAlert,
  Trash2,
  UserPlus,
} from 'lucide-react';
import type { BotConfig, FeatureFlags, UserMemory } from '../bot/types';

interface PowersViewProps {
  config: BotConfig;
  memories: UserMemory[];
  saving: boolean;
  onChange: (next: BotConfig) => void;
  onSave: () => Promise<void>;
  onRefreshMemories: () => Promise<void>;
  onDeleteMemory: (chatId: string, userId: string) => Promise<void>;
  onClearMemories: () => Promise<void>;
}

interface ToggleRowProps {
  id: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  checked: boolean;
  onToggle: (next: boolean) => void;
}

function ToggleRow({
  id,
  icon,
  title,
  description,
  checked,
  onToggle,
}: ToggleRowProps) {
  return (
    <div className="py-3.5 flex items-start justify-between gap-4 border-b border-stone-100 last:border-b-0">
      <div className="flex items-start gap-3 min-w-0">
        <div className="w-9 h-9 rounded-xl bg-stone-100 text-zinc-700 flex items-center justify-center shrink-0 mt-0.5">
          {icon}
        </div>
        <div className="min-w-0">
          <label
            htmlFor={id}
            className="text-sm font-semibold text-zinc-900 block cursor-pointer"
          >
            {title}
          </label>
          <p className="text-xs text-zinc-600 mt-0.5 leading-relaxed">
            {description}
          </p>
        </div>
      </div>

      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onToggle(!checked)}
        className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-rose-500/30 mt-1 ${
          checked ? 'bg-rose-600' : 'bg-stone-300'
        }`}
      >
        <span className="sr-only">Toggle {title}</span>
        <span
          className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-xs transition ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}

const ADMIN_COMMAND_EXAMPLES: Array<{ phrase: string; effect: string }> = [
  {
    phrase: 'Reply to any message → "Kritika pin kardo"',
    effect: 'Pins that message in the group',
  },
  {
    phrase: 'Reply or type → "Kritika unpin kardo"',
    effect: 'Unpins the replied or latest pinned message',
  },
  {
    phrase: 'Reply to spam → "Kritika delete kardo"',
    effect: 'Deletes that message immediately',
  },
  {
    phrase: 'Reply to a member → "mute 10 min" or "chup kara do"',
    effect: 'Mutes that member for the requested duration',
  },
  {
    phrase: 'Reply to a member → "unmute kardo" or "bolne de"',
    effect: 'Restores chat permissions & clears warnings',
  },
  {
    phrase: 'Reply to a member → "warning de do"',
    effect: 'Issues an official tracked group warning',
  },
];

export function PowersView({
  config,
  memories,
  saving,
  onChange,
  onSave,
  onRefreshMemories,
  onDeleteMemory,
  onClearMemories,
}: PowersViewProps) {
  const features = config.features;

  const updateFeature = <K extends keyof FeatureFlags>(
    key: K,
    value: FeatureFlags[K]
  ) => {
    onChange({
      ...config,
      features: {
        ...features,
        [key]: value,
      },
    });
  };

  const activeCount = [
    features.visionEnabled,
    features.voiceListenEnabled,
    features.welcomeEnabled,
    features.memoryEnabled,
    features.pollsEnabled,
    features.spamGuardEnabled,
    features.ownerAdminControlEnabled,
    config.replyToChannelPosts,
  ].filter(Boolean).length;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left Column: All 8 Group Powers & Threshold Controls */}
      <section className="lg:col-span-7 space-y-6">
        <div className="bg-white border border-stone-200 rounded-2xl p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-stone-200">
            <div>
              <h1 className="text-lg sm:text-xl font-bold text-zinc-900 tracking-tight">
                Group Powers & Admin Guard
              </h1>
              <p className="text-xs sm:text-sm text-zinc-600 mt-0.5">
                Toggle any capability on or off — changes apply live to your Telegram Discussion Group.
              </p>
            </div>
            <div className="text-right">
              <div className="text-sm font-semibold text-zinc-900 font-mono tabular-nums">
                {activeCount} / 8 Active
              </div>
              <div className="text-[11px] text-zinc-500">Group Admin Mode</div>
            </div>
          </div>

          <div className="divide-y divide-stone-100">
            <ToggleRow
              id="toggle-vision"
              icon={<Camera className="w-4 h-4" />}
              title="Photos, Memes & Stickers Vision"
              description="Kritika inspects photos, memes, and stickers sent in the group and replies naturally to what she sees."
              checked={features.visionEnabled}
              onToggle={(val) => updateFeature('visionEnabled', val)}
            />

            <ToggleRow
              id="toggle-voice-listen"
              icon={<Mic className="w-4 h-4" />}
              title="Incoming Voice Note Listening"
              description="Transcribes Hindi, Hinglish, and English Telegram voice notes sent by members and responds in context."
              checked={features.voiceListenEnabled}
              onToggle={(val) => updateFeature('voiceListenEnabled', val)}
            />

            <ToggleRow
              id="toggle-welcome"
              icon={<UserPlus className="w-4 h-4" />}
              title="New Member Welcome"
              description="Greets every new human joining your Discussion Group with a warm, playful Hinglish intro and reaction GIF."
              checked={features.welcomeEnabled}
              onToggle={(val) => updateFeature('welcomeEnabled', val)}
            />

            <ToggleRow
              id="toggle-memory"
              icon={<Brain className="w-4 h-4" />}
              title="Per-User Long-Term Memory"
              description="Remembers regular group members' fun facts, nicknames, and vibes across days for natural inside jokes."
              checked={features.memoryEnabled}
              onToggle={(val) => updateFeature('memoryEnabled', val)}
            />

            <ToggleRow
              id="toggle-polls"
              icon={<BarChart3 className="w-4 h-4" />}
              title="Interactive Polls & Mini-Games"
              description="Creates real Telegram group polls, Truth & Dare prompts, and Would You Rather games on demand."
              checked={features.pollsEnabled}
              onToggle={(val) => updateFeature('pollsEnabled', val)}
            />

            <ToggleRow
              id="toggle-spam-guard"
              icon={<ShieldAlert className="w-4 h-4" />}
              title="Auto Spam & Link Guard"
              description="Deletes unauthorized links, scam promos, and heavy abuse from non-admins, issues warnings, and auto-mutes repeat offenders."
              checked={features.spamGuardEnabled}
              onToggle={(val) => updateFeature('spamGuardEnabled', val)}
            />

            {features.spamGuardEnabled && (
              <div className="py-3.5 pl-12 grid grid-cols-1 sm:grid-cols-2 gap-4 bg-stone-50/70 rounded-xl px-4 my-2 border border-stone-200/80">
                <div>
                  <label
                    htmlFor="spam-max-warnings"
                    className="block text-xs font-medium text-zinc-700 mb-1"
                  >
                    Warnings Before Auto-Mute
                  </label>
                  <input
                    id="spam-max-warnings"
                    type="number"
                    min={1}
                    max={10}
                    value={features.spamMaxWarnings}
                    onChange={(e) =>
                      updateFeature(
                        'spamMaxWarnings',
                        Math.max(1, Math.min(10, Number(e.target.value) || 3))
                      )
                    }
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-stone-200 bg-white text-sm font-mono tabular-nums text-zinc-900"
                  />
                </div>
                <div>
                  <label
                    htmlFor="spam-mute-minutes"
                    className="block text-xs font-medium text-zinc-700 mb-1"
                  >
                    Auto-Mute Duration (Minutes)
                  </label>
                  <input
                    id="spam-mute-minutes"
                    type="number"
                    min={1}
                    max={1440}
                    value={features.spamMuteMinutes}
                    onChange={(e) =>
                      updateFeature(
                        'spamMuteMinutes',
                        Math.max(1, Math.min(1440, Number(e.target.value) || 15))
                      )
                    }
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-stone-200 bg-white text-sm font-mono tabular-nums text-zinc-900"
                  />
                </div>
              </div>
            )}

            <ToggleRow
              id="toggle-owner-admin"
              icon={<Crown className="w-4 h-4" />}
              title="Group Admin Natural Language Control"
              description="Strictly limited to verified Group Admins & Owner inside your group chat. Pin, unpin, delete, mute, unmute, or warn using normal Hinglish."
              checked={features.ownerAdminControlEnabled}
              onToggle={(val) => updateFeature('ownerAdminControlEnabled', val)}
            />

            <ToggleRow
              id="toggle-channel-posts"
              icon={<Clock className="w-4 h-4" />}
              title="Channel Post Smart First Comment"
              description="Automatically drops an engaging first comment whenever a new post arrives from your linked Telegram Channel."
              checked={config.replyToChannelPosts}
              onToggle={(val) => onChange({ ...config, replyToChannelPosts: val })}
            />
          </div>

          {/* Anti-Flood Cooldown */}
          <div className="mt-4 pt-4 border-t border-stone-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <label
                htmlFor="cooldown-slider"
                className="text-sm font-semibold text-zinc-900 block"
              >
                Group Anti-Flood Cooldown:{' '}
                <span className="font-mono tabular-nums text-rose-600">
                  {features.cooldownSeconds}s
                </span>
              </label>
              <p className="text-xs text-zinc-600 mt-0.5">
                Prevents rapid-fire replies in busy chats. Direct mentions, replies to {config.botName}, channel posts, and DMs always respond instantly.
              </p>
            </div>
            <input
              id="cooldown-slider"
              type="range"
              min={0}
              max={30}
              step={1}
              value={features.cooldownSeconds}
              onChange={(e) =>
                updateFeature('cooldownSeconds', Number(e.target.value))
              }
              className="w-full sm:w-44 accent-rose-600 cursor-pointer"
            />
          </div>

          <div className="mt-5 pt-4 border-t border-stone-200 flex justify-end">
            <button
              type="button"
              onClick={() => void onSave()}
              disabled={saving}
              className="min-h-[44px] px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving Powers...' : 'Save Group Powers'}
            </button>
          </div>
        </div>
      </section>

      {/* Right Column: Admin Command Reference & Member Memory Inspector */}
      <aside className="lg:col-span-5 space-y-6">
        <div className="bg-white border border-stone-200 rounded-2xl p-5 sm:p-6">
          <div className="flex items-center gap-2.5">
            <Crown className="w-4 h-4 text-rose-600 shrink-0" />
            <h2 className="text-base font-semibold text-zinc-900">
              Admin Commands (Group Only)
            </h2>
          </div>
          <p className="text-xs text-zinc-600 mt-1 leading-relaxed">
            Verified automatically via Telegram <code className="font-mono text-[11px] text-zinc-800">getChatMember</code>. Non-admins and private DMs cannot trigger moderation actions.
          </p>

          <div className="mt-4 space-y-2.5">
            {ADMIN_COMMAND_EXAMPLES.map((item) => (
              <div
                key={item.phrase}
                className="p-3 rounded-xl bg-stone-50 border border-stone-200/80"
              >
                <div className="text-xs font-medium text-zinc-900">
                  {item.phrase}
                </div>
                <div className="text-[11px] text-zinc-600 mt-0.5">
                  {item.effect}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Member Memory Inspector */}
        <div className="bg-white border border-stone-200 rounded-2xl p-5 sm:p-6">
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-stone-200">
            <div>
              <h2 className="text-base font-semibold text-zinc-900">
                Member Memory Bank
              </h2>
              <p className="text-xs text-zinc-500 mt-0.5 font-mono tabular-nums">
                {memories.length} remembered {memories.length === 1 ? 'member' : 'members'}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void onRefreshMemories()}
                aria-label="Refresh member memories"
                className="min-h-[40px] min-w-[40px] rounded-xl border border-stone-200 hover:bg-stone-50 flex items-center justify-center text-zinc-700"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              {memories.length > 0 && (
                <button
                  type="button"
                  onClick={() => void onClearMemories()}
                  className="min-h-[40px] px-3 rounded-xl border border-stone-200 hover:bg-rose-50 hover:border-rose-200 text-xs font-medium text-zinc-700 hover:text-rose-700 transition-colors"
                >
                  Clear All
                </button>
              )}
            </div>
          </div>

          {memories.length === 0 ? (
            <div className="py-8 text-center">
              <Brain className="w-7 h-7 text-stone-300 mx-auto mb-2" />
              <p className="text-sm font-medium text-zinc-700">
                No member memories saved yet
              </p>
              <p className="text-xs text-zinc-500 mt-1 max-w-xs mx-auto">
                As people chat in your Discussion Group or Live Test, {config.botName} automatically remembers fun facts and vibes here.
              </p>
            </div>
          ) : (
            <div className="mt-3 space-y-2.5 max-h-[360px] overflow-y-auto pr-1">
              {memories.map((mem) => (
                <div
                  key={`${mem.chatId}:${mem.userId}`}
                  className="p-3 rounded-xl bg-stone-50 border border-stone-200 flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-zinc-900 truncate">
                        {mem.name}
                      </span>
                      <span className="text-[11px] font-mono tabular-nums text-zinc-500 shrink-0">
                        {mem.interactions} msgs
                      </span>
                    </div>
                    {mem.notes.length > 0 ? (
                      <ul className="mt-1 space-y-0.5 text-xs text-zinc-600 list-disc pl-4">
                        {mem.notes.map((note, idx) => (
                          <li key={idx}>{note}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-xs text-zinc-500">
                        Active member · learning vibe
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => void onDeleteMemory(mem.chatId, mem.userId)}
                    aria-label={`Forget ${mem.name}`}
                    className="min-h-[36px] min-w-[36px] rounded-lg border border-stone-200 bg-white hover:bg-rose-50 hover:border-rose-200 flex items-center justify-center text-zinc-500 hover:text-rose-600 shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
