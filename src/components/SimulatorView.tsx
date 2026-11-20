import { useEffect, useRef, useState, type FormEvent } from 'react';
import { BarChart3, Send, Sparkles, Trash2, Volume2 } from 'lucide-react';
import type { BotConfig, ChatTurn, EnvStatus, PollSpec } from '../bot/types';
import { KritikaAvatar } from './KritikaAvatar';

interface SimulatorViewProps {
  config: BotConfig;
  status: EnvStatus | null;
  onLogUpdate: () => Promise<void>;
}

const QUICK_PROMPTS = [
  'Kya haal hai Kritika? Aaj group itna shant kyun hai?',
  'Chalo koi funny poll ya Truth & Dare start karo!',
  'Ek cute sa voice note bhejo na Hindi mein',
  'Tum mujhse flirt kar rahi ho kya 😉',
];

const SAMPLE_MEMBERS = ['Aarav', 'Rohan', 'Simran', 'Kabir'];

function GifPreviewCard({
  gif,
}: {
  gif: NonNullable<ChatTurn['gif']>;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const isUrl = /^https?:\/\//i.test(gif.url);

  if (!isUrl || imgFailed) {
    return (
      <div className="mt-2 rounded-xl border border-stone-200 bg-stone-100 p-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-zinc-800">{gif.title}</p>
          <p className="text-[11px] text-zinc-500">GIF mood: {gif.mood}</p>
        </div>
        <span className="text-xs font-mono text-zinc-600">GIF</span>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-xl overflow-hidden border border-stone-200 bg-stone-100 max-w-[240px]">
      <img
        src={gif.url}
        alt={gif.title}
        referrerPolicy="no-referrer"
        onError={() => setImgFailed(true)}
        className="w-full max-h-40 object-cover object-top"
      />
      <div className="px-2.5 py-1.5 bg-white text-[11px] text-zinc-600 flex items-center justify-between">
        <span className="truncate">{gif.title}</span>
        <span className="text-zinc-400 shrink-0 ml-2">{gif.mood}</span>
      </div>
    </div>
  );
}

function PollPreviewCard({ poll }: { poll: PollSpec }) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  return (
    <div className="mt-2.5 p-3 rounded-xl bg-stone-50 border border-stone-200 space-y-2">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-rose-600">
        <BarChart3 className="w-3.5 h-3.5" />
        Telegram Group Poll
      </div>
      <p className="text-sm font-semibold text-zinc-900">{poll.question}</p>
      <div className="space-y-1.5">
        {poll.options.map((opt, idx) => {
          const picked = selectedIdx === idx;
          return (
            <button
              key={`${opt}-${idx}`}
              type="button"
              onClick={() => setSelectedIdx(idx)}
              className={`w-full text-left min-h-[38px] px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center justify-between transition-colors ${
                picked
                  ? 'bg-rose-50 border-rose-300 text-rose-800'
                  : 'bg-white border-stone-200 text-zinc-800 hover:bg-stone-100'
              }`}
            >
              <span>{opt}</span>
              {selectedIdx !== null && (
                <span className="font-mono tabular-nums text-[11px] text-zinc-500">
                  {picked ? '100%' : '0%'}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function SimulatorView({ config, status, onLogUpdate }: SimulatorViewProps) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [senderName, setSenderName] = useState('Aarav');
  const [messageInput, setMessageInput] = useState('');
  const [mode, setMode] = useState<'live' | 'preview'>(
    status?.geminiChatConfigured || status?.openRouterConfigured ? 'live' : 'preview'
  );
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const listEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch('/api/simulate/history')
      .then((r) => r.json())
      .then((data: ChatTurn[]) => {
        if (Array.isArray(data)) setTurns(data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (status?.geminiChatConfigured || status?.openRouterConfigured) {
      setMode('live');
    }
  }, [status?.geminiChatConfigured, status?.openRouterConfigured]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, sending]);

  const sendMessage = async (textToSend: string) => {
    const clean = textToSend.trim();
    if (!clean || sending) return;

    setErrorMsg(null);
    setSending(true);

    const optimisticUserTurn: ChatTurn = {
      id: `local-${Date.now()}`,
      senderName,
      text: clean,
      timestamp: new Date().toISOString(),
      role: 'user',
    };
    setTurns((prev) => [...prev, optimisticUserTurn]);
    setMessageInput('');

    try {
      const res = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderName,
          message: clean,
          mode,
        }),
      });
      const data = (await res.json()) as {
        assistantTurn?: ChatTurn;
        decision?: { reactionEmoji?: string | null };
        error?: string;
        voiceError?: string | null;
      };
      if (!res.ok) {
        throw new Error(data.error || 'Failed to simulate reply');
      }

      setTurns((prev) => {
        const updated = prev.map((t) =>
          t.id === optimisticUserTurn.id && data.decision?.reactionEmoji
            ? { ...t, reactionEmoji: data.decision.reactionEmoji }
            : t
        );
        if (data.assistantTurn) {
          return [...updated, data.assistantTurn];
        }
        return updated;
      });

      if (data.voiceError) {
        setErrorMsg(data.voiceError);
      }
      await onLogUpdate();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Simulation error');
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void sendMessage(messageInput);
  };

  const handleClear = async () => {
    await fetch('/api/simulate/history', { method: 'DELETE' });
    setTurns([]);
    setErrorMsg(null);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Main Chat Panel */}
      <section className="lg:col-span-8 bg-white border border-stone-200 rounded-2xl overflow-hidden flex flex-col h-[72vh] min-h-[500px]">
        {/* Chat Header */}
        <div className="px-4 sm:px-5 py-3.5 border-b border-stone-200 flex flex-wrap items-center justify-between gap-3 bg-white">
          <div className="flex items-center gap-3 min-w-0">
            <KritikaAvatar name={config.botName} size="sm" />
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-zinc-900 truncate">
                Channel Discussion Group
              </h2>
              <p className="text-xs text-zinc-500 truncate">
                {config.botName} observes & replies automatically · No /commands needed
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div
              className="flex items-center p-1 bg-stone-100 rounded-xl border border-stone-200"
              role="group"
              aria-label="Simulator Brain Mode"
            >
              <button
                type="button"
                onClick={() => setMode('live')}
                className={`min-h-[36px] px-3 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  mode === 'live'
                    ? 'bg-white text-zinc-900 shadow-xs'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                Live Gemini AI
              </button>
              <button
                type="button"
                onClick={() => setMode('preview')}
                className={`min-h-[36px] px-3 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  mode === 'preview'
                    ? 'bg-white text-zinc-900 shadow-xs'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                Offline Preview
              </button>
            </div>

            <button
              type="button"
              onClick={handleClear}
              aria-label="Clear chat history"
              className="min-h-[44px] min-w-[44px] rounded-xl border border-stone-200 hover:bg-stone-50 flex items-center justify-center text-zinc-700 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Message Feed */}
        <div
          className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 bg-[#F8F7F4]"
          data-testid="simulator-messages"
        >
          {turns.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-4">
              <KritikaAvatar name={config.botName} size="lg" />
              <h3 className="text-base font-semibold text-zinc-900 mt-3">
                Test {config.botName} in Group Chat
              </h3>
              <p className="text-sm text-zinc-600 mt-1 max-w-md">
                Send any Hinglish, Hindi, or English message below — no /command needed. She will observe the vibe and respond with text, emoji reactions, GIFs, or voice notes.
              </p>
            </div>
          ) : (
            turns.map((turn) => {
              const isBot = turn.role === 'assistant';
              return (
                <div
                  key={turn.id}
                  className={`flex gap-2.5 ${isBot ? 'justify-start' : 'justify-end'}`}
                >
                  {isBot && <KritikaAvatar name={config.botName} size="sm" />}

                  <div
                    className={`max-w-[82%] sm:max-w-[72%] rounded-2xl px-4 py-2.5 border ${
                      isBot
                        ? 'bg-white border-stone-200 text-zinc-900'
                        : 'bg-zinc-900 border-zinc-900 text-white'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3 text-[11px] mb-1">
                      <span
                        className={`font-medium ${
                          isBot ? 'text-rose-600' : 'text-zinc-300'
                        }`}
                      >
                        {turn.senderName}
                      </span>
                      <span
                        className={`font-mono tabular-nums ${
                          isBot ? 'text-zinc-400' : 'text-zinc-400'
                        }`}
                      >
                        {new Date(turn.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>

                    {turn.text && (
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">
                        {turn.text}
                      </p>
                    )}

                    {turn.gif && <GifPreviewCard gif={turn.gif} />}

                    {turn.poll && <PollPreviewCard poll={turn.poll} />}

                    {turn.voiceAudioBase64 && (
                      <div className="mt-2.5 p-2.5 rounded-xl bg-stone-50 border border-stone-200">
                        <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-600 mb-1.5">
                          <Volume2 className="w-3.5 h-3.5 text-rose-600" />
                          Voice Note
                        </div>
                        <audio
                          controls
                          src={`data:${turn.voiceMimeType || 'audio/wav'};base64,${turn.voiceAudioBase64}`}
                          className="w-full h-9"
                        />
                      </div>
                    )}

                    {!turn.voiceAudioBase64 && turn.voiceTranscript && (
                      <p className="mt-2 text-xs text-zinc-500 bg-stone-50 border border-stone-200 rounded-xl px-2.5 py-1.5">
                        Voice Note Script: “{turn.voiceTranscript}”
                      </p>
                    )}

                    {!isBot && turn.reactionEmoji && (
                      <div className="mt-1.5 flex justify-end">
                        <span
                          className="text-xs bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-0.5 text-white"
                          aria-label={`Kritika reacted with ${turn.reactionEmoji}`}
                        >
                          {config.botName} reacted {turn.reactionEmoji}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}

          {sending && (
            <div className="flex items-center gap-2.5">
              <KritikaAvatar name={config.botName} size="sm" />
              <div className="bg-white border border-stone-200 rounded-2xl px-4 py-2.5 text-sm text-zinc-500">
                {config.botName} is typing...
              </div>
            </div>
          )}
          <div ref={listEndRef} />
        </div>

        {errorMsg && (
          <div className="px-4 py-2 bg-rose-50 border-t border-rose-200 text-xs text-rose-700">
            {errorMsg}
          </div>
        )}

        {/* Composer */}
        <form
          onSubmit={handleSubmit}
          className="p-3 sm:p-4 bg-white border-t border-stone-200 flex items-center gap-2.5"
        >
          <input
            type="text"
            aria-label="Message to send in group simulator"
            value={messageInput}
            onChange={(e) => setMessageInput(e.target.value)}
            placeholder={`Message as ${senderName}...`}
            className="flex-1 min-h-[44px] px-3.5 py-2 rounded-xl border border-stone-200 bg-stone-50 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-rose-500/30 focus:border-rose-500"
          />
          <button
            type="submit"
            disabled={sending || !messageInput.trim()}
            className="min-h-[44px] px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <Send className="w-4 h-4" /> Send
          </button>
        </form>
      </section>

      {/* Right Column: Sender Controls & Quick Prompts */}
      <aside className="lg:col-span-4 space-y-5">
        <div className="bg-white border border-stone-200 rounded-2xl p-5 space-y-4">
          <div>
            <h3 className="text-base font-semibold text-zinc-900">
              Group Member Identity
            </h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              Simulate multiple people chatting in your Discussion Group.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {SAMPLE_MEMBERS.map((member) => (
              <button
                key={member}
                type="button"
                onClick={() => setSenderName(member)}
                className={`min-h-[40px] px-3.5 py-1.5 rounded-xl text-sm font-medium border transition-colors ${
                  senderName === member
                    ? 'bg-zinc-900 text-white border-zinc-900'
                    : 'bg-white text-zinc-700 border-stone-200 hover:bg-stone-50'
                }`}
              >
                {member}
              </button>
            ))}
          </div>

          <div>
            <label
              htmlFor="custom-sender-input"
              className="block text-xs font-medium text-zinc-700 mb-1"
            >
              Custom Name
            </label>
            <input
              id="custom-sender-input"
              type="text"
              value={senderName}
              onChange={(e) => setSenderName(e.target.value)}
              className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-stone-200 text-sm text-zinc-900"
            />
          </div>
        </div>

        <div className="bg-white border border-stone-200 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-rose-600" />
            <h3 className="text-base font-semibold text-zinc-900">
              Quick Test Messages
            </h3>
          </div>
          <div className="space-y-2">
            {QUICK_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                disabled={sending}
                onClick={() => void sendMessage(prompt)}
                className="w-full text-left min-h-[44px] px-3.5 py-2.5 rounded-xl border border-stone-200 bg-stone-50 hover:bg-stone-100 text-xs sm:text-sm text-zinc-800 transition-colors disabled:opacity-50"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}
