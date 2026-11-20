import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {
  generateKritikaDecision,
  getGeminiPoolStatus,
  isGeminiChatConfigured,
  isGeminiTtsConfigured,
  isOpenRouterConfigured,
  isTenorConfigured,
  resetGeminiModelCooldowns,
  resolveGifForDecision,
  synthesizeKritikaVoice,
} from './server/ai';
import {
  appendChatTurn,
  appendLog,
  clearAllMemories,
  clearChatHistory,
  clearLogs,
  deleteUserMemory,
  getAllMemories,
  getChatHistory,
  getChatMemories,
  getConfig,
  getLogs,
  getRecentGifIds,
  pushRecentGifId,
  updateConfig,
  upsertUserMemory,
} from './server/store';
import {
  clearTelegramWebhook,
  fetchTelegramBotInfo,
  getLastPollingError,
  getTelegramWebhookInfo,
  handleTelegramUpdate,
  isPollingActive,
  isTelegramConfigured,
  registerTelegramWebhook,
  startTelegramPolling,
  stopTelegramPolling,
  type TelegramUpdate,
} from './server/telegram';
import { buildOfflinePreviewReply } from './src/bot/decisionEngine';
import type { BotConfig, EnvStatus } from './src/bot/types';

const app = express();
app.use(express.json({ limit: '2mb' }));

const PORT = Number(process.env.PORT) || 3000;

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'kritika-bot-studio' });
});

app.get('/api/status', async (_req, res) => {
  const cfg = getConfig();
  const [botInfo, webhookInfo, poolStatus] = await Promise.all([
    fetchTelegramBotInfo(),
    getTelegramWebhookInfo(),
    getGeminiPoolStatus(cfg.geminiModel),
  ]);

  const status: EnvStatus = {
    telegramConfigured: isTelegramConfigured(),
    geminiChatConfigured: isGeminiChatConfigured(),
    openRouterConfigured: isOpenRouterConfigured(),
    geminiTtsConfigured: isGeminiTtsConfigured(),
    tenorConfigured: isTenorConfigured(),
    activeProvider: cfg.aiProvider || 'gemini',
    appUrl: process.env.APP_URL?.trim() || '',
    pollingActive: isPollingActive(),
    webhookUrl: webhookInfo.url,
    botUsername: botInfo?.username ?? null,
    botFirstName: botInfo?.firstName ?? null,
    lastPollingError: getLastPollingError(),
    activeGeminiModel: poolStatus.activeModel,
    geminiPool: poolStatus.pool,
  };

  res.json(status);
});

app.post('/api/models/reset-cooldowns', async (_req, res) => {
  resetGeminiModelCooldowns();
  const cfg = getConfig();
  const poolStatus = await getGeminiPoolStatus(cfg.geminiModel);
  res.json({ ok: true, ...poolStatus });
});

app.get('/api/config', (_req, res) => {
  res.json(getConfig());
});

app.put('/api/config', (req, res) => {
  const body = req.body as Partial<BotConfig>;
  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'Invalid configuration payload.' });
    return;
  }
  const updated = updateConfig(body);
  res.json(updated);
});

app.get('/api/logs', (_req, res) => {
  res.json(getLogs());
});

app.delete('/api/logs', (_req, res) => {
  clearLogs();
  res.json({ ok: true });
});

app.get('/api/memories', (_req, res) => {
  res.json(getAllMemories());
});

app.delete('/api/memories/:chatId/:userId', (req, res) => {
  const { chatId, userId } = req.params;
  deleteUserMemory(chatId, userId);
  res.json({ ok: true });
});

app.delete('/api/memories', (_req, res) => {
  clearAllMemories();
  res.json({ ok: true });
});

app.post('/api/bot/polling', async (req, res) => {
  const { enabled } = (req.body || {}) as { enabled?: boolean };
  try {
    if (enabled) {
      await startTelegramPolling();
    } else {
      stopTelegramPolling();
    }
    res.json({ pollingActive: isPollingActive() });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to toggle polling';
    res.status(400).json({ error: message });
  }
});

app.post('/api/bot/webhook/register', async (req, res) => {
  try {
    const customBase = (req.body as { baseUrl?: string })?.baseUrl?.trim();
    const base = (customBase || process.env.APP_URL?.trim() || '').replace(/\/+$/, '');
    if (!base || base === 'MY_APP_URL') {
      res.status(400).json({
        error: 'APP_URL is missing. Enter your public https host URL to register the Telegram webhook.',
      });
      return;
    }
    const webhookUrl = `${base}/api/telegram/webhook`;
    await registerTelegramWebhook(webhookUrl);
    res.json({ ok: true, webhookUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Webhook registration failed';
    res.status(400).json({ error: message });
  }
});

app.post('/api/bot/webhook/clear', async (_req, res) => {
  try {
    await clearTelegramWebhook();
    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to clear webhook';
    res.status(400).json({ error: message });
  }
});

app.post('/api/telegram/webhook', async (req, res) => {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (expectedSecret && expectedSecret !== 'MY_TELEGRAM_WEBHOOK_SECRET') {
    const headerSecret = req.headers['x-telegram-bot-api-secret-token'];
    if (headerSecret !== expectedSecret) {
      res.status(401).json({ error: 'Invalid webhook secret token.' });
      return;
    }
  }

  const update = req.body as TelegramUpdate;
  if (update && typeof update.update_id === 'number') {
    // Wait up to 22s so serverless hosts (Cloud Run / Render) keep CPU active until reply sends
    await Promise.race([
      handleTelegramUpdate(update, 'webhook').catch((err) => {
        console.error('Webhook update handling failed:', err);
      }),
      new Promise((resolve) => setTimeout(resolve, 22000)),
    ]);
  }
  res.json({ ok: true });
});

app.get('/api/simulate/history', (_req, res) => {
  res.json(getChatHistory('simulator-group'));
});

app.delete('/api/simulate/history', (_req, res) => {
  clearChatHistory('simulator-group');
  res.json({ ok: true });
});

app.post('/api/simulate', async (req, res) => {
  try {
    const {
      senderName,
      message,
      mode,
    } = (req.body || {}) as {
      senderName?: string;
      message?: string;
      mode?: 'live' | 'preview';
    };

    const cleanMessage = (message || '').trim();
    const cleanSender = (senderName || 'Aarav').trim() || 'Aarav';
    if (!cleanMessage) {
      res.status(400).json({ error: 'Message cannot be empty.' });
      return;
    }

    const config = getConfig();
    const chatId = 'simulator-group';
    const history = getChatHistory(chatId);

    const userTurnId = `sim-user-${Date.now()}`;
    appendChatTurn(
      chatId,
      {
        id: userTurnId,
        senderName: cleanSender,
        text: cleanMessage,
        timestamp: new Date().toISOString(),
        role: 'user',
      },
      Math.max(10, config.maxHistoryMessages)
    );

    const usePreview = mode === 'preview';
    const userMemories = config.features.memoryEnabled
      ? getChatMemories(chatId)
      : [];

    const decision = usePreview
      ? buildOfflinePreviewReply(cleanMessage, cleanSender, config)
      : await generateKritikaDecision({
          config,
          history,
          incomingUser: { name: cleanSender, text: cleanMessage },
          userMemories,
          allowPoll: config.features.pollsEnabled,
        });

    if (config.features.memoryEnabled) {
      upsertUserMemory({
        chatId,
        userId: `sim-${cleanSender.toLowerCase().replace(/[^a-z0-9]/g, '') || 'user'}`,
        name: cleanSender,
        note: decision.memoryNote,
      });
    }

    const gif = await resolveGifForDecision(
      decision.gifMood,
      config,
      getRecentGifIds()
    );
    if (gif) {
      pushRecentGifId(gif.id);
    }

    let voiceAudioBase64: string | null = null;
    let voiceMimeType: string | null = null;
    let voiceError: string | null = null;

    if (decision.sendVoice && decision.voiceText) {
      if (isGeminiTtsConfigured()) {
        try {
          const synth = await synthesizeKritikaVoice({
            text: decision.voiceText,
            voiceName: config.voiceName,
            preferOggOpus: false,
          });
          voiceAudioBase64 = synth.buffer.toString('base64');
          voiceMimeType = synth.mimeType;
        } catch (err) {
          voiceError =
            err instanceof Error ? err.message : 'Voice generation failed';
        }
      } else {
        voiceError = 'GEMINI_API_KEY not set — showing voice transcript only.';
      }
    }

    const assistantTurn = {
      id: `sim-bot-${Date.now()}`,
      senderName: config.botName,
      text: decision.replyText,
      timestamp: new Date().toISOString(),
      role: 'assistant' as const,
      reactionEmoji: decision.reactionEmoji,
      gif: gif
        ? { id: gif.id, title: gif.title, url: gif.url, mood: gif.mood }
        : null,
      voiceAudioBase64,
      voiceMimeType,
      voiceTranscript: decision.voiceText,
      poll: config.features.pollsEnabled ? decision.poll ?? null : null,
    };

    if (decision.shouldReply || gif || decision.sendVoice || assistantTurn.poll) {
      appendChatTurn(
        chatId,
        assistantTurn,
        Math.max(10, config.maxHistoryMessages)
      );
    }

    const actions: string[] = [];
    if (decision.reactionEmoji) actions.push(`Reacted ${decision.reactionEmoji}`);
    if (decision.shouldReply && decision.replyText) actions.push('Replied');
    if (assistantTurn.poll) actions.push('Sent Poll');
    if (gif) actions.push(`Sent ${gif.mood} GIF`);
    if (decision.sendVoice) actions.push('Voice Note');
    if (decision.memoryNote && config.features.memoryEnabled) actions.push('Saved Memory');

    appendLog({
      id: `sim-log-${Date.now()}`,
      timestamp: new Date().toISOString(),
      chatId,
      chatTitle: usePreview
        ? 'Simulator (Preview)'
        : config.aiProvider === 'openrouter'
        ? 'Simulator (OpenRouter)'
        : 'Simulator (Google Gemini)',
      senderName: cleanSender,
      incomingText: cleanMessage,
      actionSummary: actions.join(' · ') || 'Observed',
      replyText: decision.replyText,
      reactionEmoji: decision.reactionEmoji,
      gifMood: gif?.mood ?? null,
      sentVoice: Boolean(voiceAudioBase64),
      mode: 'simulator',
      status: 'ok',
    });

    res.json({
      decision,
      assistantTurn,
      userTurnId,
      voiceError,
      mode: usePreview ? 'preview' : 'live',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Simulation failed';
    res.status(500).json({ error: message });
  }
});

app.post('/api/tts/test', async (req, res) => {
  try {
    const { text } = (req.body || {}) as { text?: string };
    const sample =
      text?.trim() ||
      'Heyy! Main Kritika bol rahi hoon, batao aaj group mein kya masti chal rahi hai?';
    const config = getConfig();
    const synth = await synthesizeKritikaVoice({
      text: sample,
      voiceName: config.voiceName,
      preferOggOpus: false,
    });
    res.json({
      audioBase64: synth.buffer.toString('base64'),
      mimeType: synth.mimeType,
      transcript: sample,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'TTS failed';
    res.status(400).json({ error: message });
  }
});

app.get('/api/export/render-yaml', (_req, res) => {
  const renderPath = path.resolve(process.cwd(), 'render.yaml');
  const content = fs.existsSync(renderPath)
    ? fs.readFileSync(renderPath, 'utf-8')
    : '';
  res.type('text/yaml').send(content);
});

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', async () => {
    console.log(`Kritika Bot Studio listening on http://0.0.0.0:${PORT}`);
    const cfg = getConfig();
    if (cfg.pollingEnabled && isTelegramConfigured()) {
      const existingWebhook = await getTelegramWebhookInfo().catch(() => ({ url: null }));
      if (existingWebhook.url) {
        console.log(`Telegram webhook active (${existingWebhook.url}); skipping polling auto-start.`);
        return;
      }
      startTelegramPolling().catch((err) => {
        console.error('Auto-start polling failed:', err);
      });
    }
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
