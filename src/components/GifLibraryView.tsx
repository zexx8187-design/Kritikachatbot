import { useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { BotConfig, GifItem, GifMood } from '../bot/types';

interface GifLibraryViewProps {
  config: BotConfig;
  onChange: (next: BotConfig) => void;
  onSave: () => Promise<void>;
  saving: boolean;
}

const MOODS: GifMood[] = [
  'flirty',
  'laugh',
  'blush',
  'tease',
  'love',
  'shock',
  'angry',
  'bye',
];

function GifThumb({ item }: { item: GifItem }) {
  const [failed, setFailed] = useState(false);
  const isUrl = /^https?:\/\//i.test(item.url);

  if (!isUrl || failed) {
    return (
      <div className="h-36 rounded-xl bg-stone-100 border border-stone-200 flex flex-col items-center justify-center p-3 text-center">
        <span className="text-xs font-mono text-zinc-500">
          {isUrl ? 'Preview unavailable' : 'Telegram file_id'}
        </span>
        <span className="text-sm font-medium text-zinc-800 mt-1">
          {item.title}
        </span>
      </div>
    );
  }

  return (
    <img
      src={item.url}
      alt={item.title}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="h-36 w-full object-cover object-top rounded-xl border border-stone-200 bg-stone-100"
    />
  );
}

export function GifLibraryView({
  config,
  onChange,
  onSave,
  saving,
}: GifLibraryViewProps) {
  const [title, setTitle] = useState('');
  const [mood, setMood] = useState<GifMood>('flirty');
  const [url, setUrl] = useState('');
  const [filterMood, setFilterMood] = useState<'all' | GifMood>('all');
  const [formError, setFormError] = useState<string | null>(null);

  const handleAdd = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !url.trim()) {
      setFormError('Please provide both a title and a GIF URL or Telegram file_id.');
      return;
    }
    setFormError(null);
    const nextItem: GifItem = {
      id: `gif-${Date.now()}`,
      mood,
      title: title.trim(),
      url: url.trim(),
      enabled: true,
    };
    onChange({
      ...config,
      customGifLibrary: [nextItem, ...config.customGifLibrary],
    });
    setTitle('');
    setUrl('');
  };

  const handleToggle = (id: string) => {
    onChange({
      ...config,
      customGifLibrary: config.customGifLibrary.map((g) =>
        g.id === id ? { ...g, enabled: !g.enabled } : g
      ),
    });
  };

  const handleDelete = (id: string) => {
    onChange({
      ...config,
      customGifLibrary: config.customGifLibrary.filter((g) => g.id !== id),
    });
  };

  const visibleItems =
    filterMood === 'all'
      ? config.customGifLibrary
      : config.customGifLibrary.filter((g) => g.mood === filterMood);

  return (
    <div className="space-y-6">
      <div className="bg-white border border-stone-200 rounded-2xl p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-stone-100">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">
              GIF Mood Library
            </h2>
            <p className="text-sm text-zinc-600 mt-0.5">
              Kritika picks from enabled GIFs matching her mood (or searches Tenor automatically if TENOR_API_KEY is configured).
            </p>
          </div>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="min-h-[44px] px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Library'}
          </button>
        </div>

        <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-12 gap-3 pt-5">
          <div className="md:col-span-3">
            <label htmlFor="gif-title" className="block text-xs font-medium text-zinc-700 mb-1">
              Label
            </label>
            <input
              id="gif-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Cheeky Smile"
              className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-stone-200 text-sm text-zinc-900"
            />
          </div>

          <div className="md:col-span-2">
            <label htmlFor="gif-mood" className="block text-xs font-medium text-zinc-700 mb-1">
              Mood
            </label>
            <select
              id="gif-mood"
              value={mood}
              onChange={(e) => setMood(e.target.value as GifMood)}
              className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-stone-200 bg-white text-sm text-zinc-900"
            >
              {MOODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-5">
            <label htmlFor="gif-url" className="block text-xs font-medium text-zinc-700 mb-1">
              GIF URL or Telegram file_id
            </label>
            <input
              id="gif-url"
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://...gif or Telegram file_id"
              className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-stone-200 text-sm text-zinc-900"
            />
          </div>

          <div className="md:col-span-2 flex items-end">
            <button
              type="submit"
              className="w-full min-h-[44px] px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-medium inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <Plus className="w-4 h-4" /> Add GIF
            </button>
          </div>
        </form>

        {formError && (
          <p className="mt-3 text-xs text-rose-700">{formError}</p>
        )}
      </div>

      {/* Mood Filter Bar */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setFilterMood('all')}
          className={`min-h-[40px] px-3.5 py-1.5 rounded-xl text-sm font-medium border transition-colors ${
            filterMood === 'all'
              ? 'bg-zinc-900 text-white border-zinc-900'
              : 'bg-white text-zinc-700 border-stone-200 hover:bg-stone-50'
          }`}
        >
          All ({config.customGifLibrary.length})
        </button>
        {MOODS.map((m) => {
          const count = config.customGifLibrary.filter((g) => g.mood === m).length;
          return (
            <button
              key={m}
              type="button"
              onClick={() => setFilterMood(m)}
              className={`min-h-[40px] px-3.5 py-1.5 rounded-xl text-sm font-medium border transition-colors capitalize ${
                filterMood === m
                  ? 'bg-zinc-900 text-white border-zinc-900'
                  : 'bg-white text-zinc-700 border-stone-200 hover:bg-stone-50'
              }`}
            >
              {m} <span className="font-mono tabular-nums opacity-70">({count})</span>
            </button>
          );
        })}
      </div>

      {visibleItems.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-2xl p-8 text-center">
          <p className="text-sm font-medium text-zinc-800">
            No GIFs in this mood yet
          </p>
          <p className="text-xs text-zinc-500 mt-1">
            Add a GIF URL or Telegram file_id above so Kritika can send animations for this mood.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleItems.map((item) => (
            <article
              key={item.id}
              className="bg-white border border-stone-200 rounded-2xl p-4 flex flex-col gap-3"
            >
              <GifThumb item={item} />
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-zinc-900 truncate">
                    {item.title}
                  </h3>
                  <p className="text-xs text-zinc-500 mt-0.5 capitalize">
                    {item.mood}
                    <span className="mx-1.5" aria-hidden="true">·</span>
                    {item.enabled ? 'Enabled' : 'Disabled'}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleToggle(item.id)}
                    className="min-h-[36px] px-2.5 py-1 rounded-lg border border-stone-200 text-xs font-medium text-zinc-700 hover:bg-stone-50"
                  >
                    {item.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(item.id)}
                    aria-label={`Delete ${item.title}`}
                    className="min-h-[36px] min-w-[36px] rounded-lg border border-stone-200 text-zinc-600 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
