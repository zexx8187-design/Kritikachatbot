import { useState } from 'react';
import { Check, Copy, Download, Globe } from 'lucide-react';
import type { EnvStatus } from '../bot/types';

interface DeployGuideViewProps {
  status: EnvStatus | null;
  onRefreshStatus: () => Promise<void>;
}

export function DeployGuideView({ status, onRefreshStatus }: DeployGuideViewProps) {
  const [customHostUrl, setCustomHostUrl] = useState(
    status?.appUrl || (typeof window !== 'undefined' ? window.location.origin : '')
  );
  const [webhookBusy, setWebhookBusy] = useState(false);
  const [webhookFeedback, setWebhookFeedback] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopy = async (id: string, text: string) => {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const handleRegisterWebhook = async () => {
    setWebhookBusy(true);
    setWebhookFeedback(null);
    try {
      const res = await fetch('/api/bot/webhook/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: customHostUrl }),
      });
      const data = (await res.json()) as { webhookUrl?: string; error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Webhook setup failed');
      }
      setWebhookFeedback(`Webhook active at ${data.webhookUrl}`);
      await onRefreshStatus();
    } catch (err) {
      setWebhookFeedback(
        err instanceof Error ? err.message : 'Unable to register webhook'
      );
    } finally {
      setWebhookBusy(false);
    }
  };

  const handleClearWebhook = async () => {
    setWebhookBusy(true);
    setWebhookFeedback(null);
    try {
      const res = await fetch('/api/bot/webhook/clear', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to clear webhook');
      setWebhookFeedback('Webhook cleared. You can use Polling mode now.');
      await onRefreshStatus();
    } catch (err) {
      setWebhookFeedback(err instanceof Error ? err.message : 'Error');
    } finally {
      setWebhookBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      <div className="lg:col-span-7 space-y-5">
        <section className="bg-white border border-stone-200 rounded-2xl p-5 sm:p-6 space-y-4">
          <h2 className="text-lg font-semibold text-zinc-900">
            Mobile Setup Checklist for Discussion Group
          </h2>
          <p className="text-sm text-zinc-600">
            Follow these 4 steps on your phone so Kritika sees every discussion message immediately with zero /commands.
          </p>

          <ol className="space-y-4 pt-2">
            <li className="p-4 rounded-xl bg-stone-50 border border-stone-200 space-y-2">
              <h3 className="text-sm font-semibold text-zinc-900">
                1. Turn OFF Group Privacy in @BotFather
              </h3>
              <p className="text-xs text-zinc-600 leading-relaxed">
                By default Telegram bots only read slash commands. Open @BotFather on Telegram, send <code className="font-mono bg-white px-1.5 py-0.5 rounded border border-stone-200">/setprivacy</code>, pick Kritika, and select <strong>Disable</strong>.
              </p>
              <button
                type="button"
                onClick={() => void handleCopy('privacy', '/setprivacy')}
                className="min-h-[40px] px-3 py-1.5 rounded-lg bg-white border border-stone-200 text-xs font-medium text-zinc-800 inline-flex items-center gap-1.5"
              >
                {copiedKey === 'privacy' ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" /> Copy /setprivacy
                  </>
                )}
              </button>
            </li>

            <li className="p-4 rounded-xl bg-stone-50 border border-stone-200 space-y-1.5">
              <h3 className="text-sm font-semibold text-zinc-900">
                2. Add Kritika to Your Channel’s Discussion Group
              </h3>
              <p className="text-xs text-zinc-600 leading-relaxed">
                Open your Telegram Channel Settings → Discussion → Link or open the group → Add Kritika as a member (making her Admin also guarantees she receives every message and can react freely).
              </p>
            </li>

            <li className="p-4 rounded-xl bg-stone-50 border border-stone-200 space-y-2">
              <h3 className="text-sm font-semibold text-zinc-900">
                3. Set Server Environment Variables
              </h3>
              <p className="text-xs text-zinc-600 leading-relaxed">
                Add these in AI Studio <strong>Settings &gt; Secrets</strong> (for testing) or in your 24/7 cloud host (Render / Koyeb / Railway) Environment tab:
              </p>
              <ul className="text-xs font-mono text-zinc-700 space-y-1 bg-white p-3 rounded-lg border border-stone-200">
                <li>TELEGRAM_BOT_TOKEN — from @BotFather</li>
                <li>OPENROUTER_API_KEY — from openrouter.ai/keys</li>
                <li>GEMINI_API_KEY — for Hindi/Hinglish/English voice notes</li>
              </ul>
            </li>

            <li className="p-4 rounded-xl bg-stone-50 border border-stone-200 space-y-2">
              <h3 className="text-sm font-semibold text-zinc-900">
                4. Keep Her Live 24/7 Without a PC
              </h3>
              <p className="text-xs text-zinc-600 leading-relaxed">
                For continuous 24/7 replies, deploy this project from GitHub on <strong>Render</strong> or <strong>Koyeb</strong> using the included <code className="font-mono bg-white px-1 py-0.5 rounded border border-stone-200">render.yaml</code> blueprint, then register your public webhook URL on the right.
              </p>
              <a
                href="/api/export/render-yaml"
                download="render.yaml"
                className="min-h-[40px] px-3.5 py-2 rounded-lg bg-zinc-900 text-white text-xs font-medium inline-flex items-center gap-1.5 hover:bg-zinc-800 transition-colors"
              >
                <Download className="w-3.5 h-3.5" /> Download render.yaml
              </a>
            </li>
          </ol>
        </section>
      </div>

      {/* Right Column: Webhook Setup */}
      <div className="lg:col-span-5 space-y-5">
        <section className="bg-white border border-stone-200 rounded-2xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-rose-600" />
            <h2 className="text-lg font-semibold text-zinc-900">
              24/7 Telegram Webhook
            </h2>
          </div>

          <p className="text-sm text-zinc-600">
            Webhooks wake your cloud server instantly whenever anyone sends a message in your discussion group.
          </p>

          <div>
            <label
              htmlFor="webhook-base-url"
              className="block text-sm font-medium text-zinc-800 mb-1.5"
            >
              Public HTTPS App URL
            </label>
            <input
              id="webhook-base-url"
              type="url"
              value={customHostUrl}
              onChange={(e) => setCustomHostUrl(e.target.value)}
              placeholder="https://your-bot-host.onrender.com"
              className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-stone-200 text-sm font-mono text-zinc-900"
            />
            <p className="text-xs text-zinc-500 mt-1.5 font-mono truncate">
              Target: {(customHostUrl || '').replace(/\/+$/, '')}/api/telegram/webhook
            </p>
          </div>

          <div className="flex flex-wrap gap-2.5">
            <button
              type="button"
              onClick={handleRegisterWebhook}
              disabled={webhookBusy || !status?.telegramConfigured}
              className="min-h-[44px] px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium transition-colors whitespace-nowrap disabled:opacity-50"
            >
              {webhookBusy ? 'Updating...' : 'Register Webhook'}
            </button>

            <button
              type="button"
              onClick={handleClearWebhook}
              disabled={webhookBusy || !status?.telegramConfigured}
              className="min-h-[44px] px-4 py-2 rounded-xl border border-stone-200 bg-white hover:bg-stone-50 text-zinc-800 text-sm font-medium transition-colors whitespace-nowrap disabled:opacity-50"
            >
              Clear Webhook
            </button>
          </div>

          {!status?.telegramConfigured && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-2.5">
              Set TELEGRAM_BOT_TOKEN in server secrets before registering a webhook.
            </p>
          )}

          {webhookFeedback && (
            <p className="text-xs text-zinc-800 bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 break-all">
              {webhookFeedback}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
