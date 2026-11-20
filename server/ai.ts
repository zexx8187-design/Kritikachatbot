import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  buildKritikaSystemPrompt,
  formatOpenRouterMessages,
  parseBotDecision,
  pickGifForMood,
} from '../src/bot/decisionEngine';
import { detectUserWantsPoll } from '../src/bot/features';
import {
  buildOrderedFailoverPool,
  classifyGeminiError,
  CURATED_FREE_GEMINI_POOL,
  isAllowedFreeTierChatModel,
  isGemmaModel,
} from '../src/bot/modelPool';
import type {
  BotConfig,
  BotDecision,
  ChatTurn,
  GeminiModelHealth,
  GifItem,
  GifMood,
  UserMemory,
} from '../src/bot/types';

const execFileAsync = promisify(execFile);

let geminiClient: GoogleGenAI | null = null;
let discoveredModelsCache: { models: string[]; fetchedAt: number } | null = null;
let lastActiveGeminiModel: string | null = null;

const modelCooldowns = new Map<
  string,
  { untilMs: number; kind: 'quota' | 'transient' | 'unavailable' | 'other'; reason: string }
>();

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return geminiClient;
}

export function isGeminiChatConfigured(): boolean {
  return Boolean(getGeminiClient());
}

export function isOpenRouterConfigured(): boolean {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  return Boolean(key && key !== 'MY_OPENROUTER_API_KEY');
}

export function isGeminiTtsConfigured(): boolean {
  return Boolean(getGeminiClient());
}

export function isTenorConfigured(): boolean {
  const key = process.env.TENOR_API_KEY?.trim();
  return Boolean(key);
}

async function discoverGoogleChatModels(): Promise<string[]> {
  const now = Date.now();
  if (discoveredModelsCache && now - discoveredModelsCache.fetchedAt < 60 * 60 * 1000) {
    return discoveredModelsCache.models;
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return [...CURATED_FREE_GEMINI_POOL];
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?pageSize=100&key=${encodeURIComponent(
          apiKey
        )}`,
        {
          headers: { 'User-Agent': 'aistudio-build' },
          signal: controller.signal,
        }
      );
      if (!res.ok) {
        return [...CURATED_FREE_GEMINI_POOL];
      }
      const data = (await res.json()) as {
        models?: Array<{
          name?: string;
          supportedGenerationMethods?: string[];
        }>;
      };
      const found = (data.models ?? [])
        .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
        .map((m) => (m.name || '').replace(/^models\//, '').trim())
        .filter((id) => isAllowedFreeTierChatModel(id));

      discoveredModelsCache = { models: found, fetchedAt: now };
      return found;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return discoveredModelsCache?.models ?? [...CURATED_FREE_GEMINI_POOL];
  }
}

export function resetGeminiModelCooldowns(): void {
  modelCooldowns.clear();
  discoveredModelsCache = null;
}

export async function getGeminiPoolStatus(
  preferredModel?: string
): Promise<{ activeModel: string | null; pool: GeminiModelHealth[] }> {
  const discovered = await discoverGoogleChatModels();
  const now = Date.now();

  const seen = new Set<string>();
  const all: string[] = [];
  const pushUnique = (id?: string) => {
    if (!id) return;
    const clean = id.replace(/^models\//, '').trim();
    if (!clean || clean === 'auto' || !isAllowedFreeTierChatModel(clean) || seen.has(clean)) {
      return;
    }
    seen.add(clean);
    all.push(clean);
  };

  pushUnique(preferredModel);
  for (const m of CURATED_FREE_GEMINI_POOL) pushUnique(m);
  for (const m of discovered) pushUnique(m);

  const pool: GeminiModelHealth[] = all.map((model) => {
    const cd = modelCooldowns.get(model);
    if (cd && cd.untilMs > now) {
      return {
        model,
        state: cd.kind === 'unavailable' ? 'unavailable' : 'cooldown',
        cooldownUntil: new Date(cd.untilMs).toISOString(),
        reason: cd.reason,
      };
    }
    return {
      model,
      state: lastActiveGeminiModel === model ? 'active' : 'ready',
      cooldownUntil: null,
      reason: null,
    };
  });

  // Hide unavailable models from the visible summary if there are plenty of working ones
  const visiblePool = pool.filter((p) => p.state !== 'unavailable');
  return {
    activeModel: lastActiveGeminiModel,
    pool: visiblePool.length > 0 ? visiblePool : pool,
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export interface DecisionRequestParams {
  config: BotConfig;
  history: ChatTurn[];
  incomingUser: { name: string; text: string };
  imagePart?: { mimeType: string; data: string };
  userMemories?: UserMemory[];
  allowPoll?: boolean;
  isChannelPost?: boolean;
  isIncomingGif?: boolean;
}

export async function transcribeTelegramAudio(params: {
  buffer: Buffer;
  mimeType: string;
}): Promise<string | null> {
  const ai = getGeminiClient();
  if (!ai) return null;

  const base64Audio = params.buffer.toString('base64');
  const candidateModels = [
    'gemini-3.5-transcribe',
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
  ];

  for (const model of candidateModels) {
    try {
      const response = await withTimeout(
        ai.models.generateContent({
          model,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  inlineData: {
                    mimeType: params.mimeType || 'audio/ogg',
                    data: base64Audio,
                  },
                },
                {
                  text: 'Transcribe this voice message accurately in the original spoken language (Hindi, Hinglish, or English). Return only the plain transcript text, nothing else.',
                },
              ],
            },
          ],
        }),
        15000,
        `Transcribe (${model})`
      );
      const text = response.text?.trim();
      if (text) return text;
    } catch {
      // Try next fallback model
    }
  }
  return null;
}

export async function generateWelcomeMessage(params: {
  config: BotConfig;
  newMemberName: string;
  groupTitle: string;
}): Promise<string> {
  const fallback = `Arre welcome ${params.newMemberName}! 🎉 ${params.groupTitle} mein entry maar li finally — ab chup mat baithna, intro do aur masti shuru karo! 😉✨`;
  const ai = getGeminiClient();
  if (!ai) return fallback;

  const discovered = await discoverGoogleChatModels();
  const candidates = buildOrderedFailoverPool({
    preferredModel: params.config.geminiModel,
    discoveredModels: discovered,
    cooldowns: modelCooldowns,
  }).slice(0, 4);

  const welcomePrompt = `Write a short, warm, playful 1-2 line Hinglish welcome message from ${params.config.botName} to a brand new member named "${params.newMemberName}" who just joined the Telegram group "${params.groupTitle}". Include 1-2 natural emojis. Keep it friendly, funny, and welcoming (no explicit content). Return only the welcome message text.`;

  for (const model of candidates) {
    try {
      const gemma = isGemmaModel(model);
      const response = await withTimeout(
        ai.models.generateContent({
          model,
          contents: gemma
            ? `${params.config.systemPrompt}\n\n${welcomePrompt}`
            : welcomePrompt,
          config: gemma
            ? undefined
            : {
                systemInstruction: params.config.systemPrompt,
              },
        }),
        10000,
        `Gemini Welcome (${model})`
      );
      const text = response.text?.trim();
      if (text) {
        lastActiveGeminiModel = model;
        return text;
      }
    } catch (err) {
      const classified = classifyGeminiError(err);
      modelCooldowns.set(model, {
        untilMs: Date.now() + classified.cooldownMs,
        kind: classified.kind,
        reason: classified.shortReason,
      });
    }
  }
  return fallback;
}

export async function generateKritikaGeminiDecision(
  params: DecisionRequestParams
): Promise<BotDecision> {
  const ai = getGeminiClient();
  if (!ai) {
    throw new Error(
      'GEMINI_API_KEY is not available on the server. Check Settings > Secrets.'
    );
  }

  const maxTurns = Math.max(2, Math.min(30, params.config.maxHistoryMessages || 16));
  const recent = params.history.slice(-maxTurns);
  const transcriptLines = recent.map((turn) =>
    turn.role === 'assistant'
      ? `[${params.config.botName}]: ${turn.text}`
      : `[${turn.senderName}]: ${turn.text}`
  );
  const effectiveUserText =
    params.incomingUser.text.trim().toLowerCase() === '/start'
      ? 'Hey Kritika! (Just started chatting with you)'
      : params.incomingUser.text;
  transcriptLines.push(`[${params.incomingUser.name}]: ${effectiveUserText}`);

  const discovered = await discoverGoogleChatModels();
  const candidateModels = buildOrderedFailoverPool({
    preferredModel: params.config.geminiModel,
    discoveredModels: discovered,
    cooldowns: modelCooldowns,
    requireVision: Boolean(params.imagePart),
  });

  const contextHint = params.isChannelPost
    ? `\n\nThis is a brand new post forwarded from the linked Telegram Channel. Drop an engaging, witty, friendly FIRST comment as ${params.config.botName} to spark discussion in the group!`
    : params.isIncomingGif
    ? `\n\n[${params.incomingUser.name}] just sent an animated GIF! Look closely at the attached GIF preview frame, match the exact emotion/vibe of their GIF (flirty, laugh, blush, tease, love, shock, angry, or bye), react directly to what's happening in their GIF in natural Hinglish, AND ALWAYS choose the best matching "gifMood" to reply back with a counter-GIF!`
    : params.imagePart
    ? `\n\n[${params.incomingUser.name}] just sent the attached photo/meme/sticker. Look at it closely and react/comment naturally as ${params.config.botName}!`
    : `\n\nRespond to [${params.incomingUser.name}]'s latest message as ${params.config.botName}.`;

  const wantsPoll =
    params.allowPoll !== false &&
    params.config.features?.pollsEnabled !== false &&
    detectUserWantsPoll(params.incomingUser.text);

  const pollHint = wantsPoll
    ? `\n\nIMPORTANT: The user asked for a poll or group game! You MUST populate the JSON "poll" object with a fun Hinglish/English "question" and 3-4 creative short "options" (each under 60 chars).`
    : '';

  const promptContents = `Recent Discussion Group Conversation:\n${transcriptLines.join('\n')}${contextHint}${pollHint}`;
  const systemInstruction = buildKritikaSystemPrompt(params.config, {
    userMemories: params.userMemories,
    allowPoll: params.allowPoll,
  });

  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      shouldReply: {
        type: Type.BOOLEAN,
        description: 'Whether Kritika should send a text reply to this message.',
      },
      replyText: {
        type: Type.STRING,
        description: 'Natural Hinglish/Hindi/English reply from Kritika.',
      },
      reactionEmoji: {
        type: Type.STRING,
        nullable: true,
        description: 'One official Telegram reaction emoji or null.',
      },
      gifMood: {
        type: Type.STRING,
        nullable: true,
        description:
          'One of flirty, laugh, blush, tease, love, shock, angry, bye, or null.',
      },
      sendVoice: {
        type: Type.BOOLEAN,
        description: 'True when a short voice note should also be sent.',
      },
      voiceText: {
        type: Type.STRING,
        nullable: true,
        description:
          'Spoken line without emojis for TTS voice note when sendVoice is true.',
      },
      memoryNote: {
        type: Type.STRING,
        nullable: true,
        description:
          'Short personal fact/hobby/vibe about the sender (max 8 words) to remember later, or null.',
      },
      poll: {
        type: Type.OBJECT,
        nullable: true,
        description:
          'Optional interactive group poll/game question + 2-4 fun options when requested or fitting.',
        properties: {
          question: { type: Type.STRING },
          options: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
        required: ['question', 'options'],
      },
    },
    required: ['shouldReply', 'replyText'],
  };

  let lastError: unknown = null;

  for (const model of candidateModels) {
    const gemma = isGemmaModel(model);
    const supportsLowThinking =
      !gemma &&
      /^gemini-[34]/i.test(model) &&
      !model.includes('flash-lite');

    const requestContents = gemma
      ? `${systemInstruction}\n\n${promptContents}`
      : params.imagePart
      ? {
          parts: [
            {
              inlineData: {
                mimeType: params.imagePart.mimeType,
                data: params.imagePart.data,
              },
            },
            { text: promptContents },
          ],
        }
      : promptContents;

    try {
      const response = await withTimeout(
        ai.models.generateContent({
          model,
          contents: requestContents,
          config: gemma
            ? undefined
            : {
                systemInstruction,
                thinkingConfig: supportsLowThinking
                  ? { thinkingLevel: ThinkingLevel.LOW }
                  : undefined,
                responseMimeType: 'application/json',
                responseSchema,
              },
        }),
        gemma ? 16000 : 12000,
        `Gemini (${model})`
      );

      const rawText = response.text?.trim() || '';
      if (rawText) {
        lastActiveGeminiModel = model;
        // Clear any stale cooldown if this model succeeded
        modelCooldowns.delete(model);
        return parseBotDecision(rawText, params.config, {
          userText: params.incomingUser.text,
          isIncomingGif: params.isIncomingGif,
        });
      }
      lastError = new Error(`Model ${model} returned an empty response.`);
    } catch (err) {
      lastError = err;
      const classified = classifyGeminiError(err);
      modelCooldowns.set(model, {
        untilMs: Date.now() + classified.cooldownMs,
        kind: classified.kind,
        reason: classified.shortReason,
      });
      // Immediately fail over to the next healthy Google model in the pool
      continue;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(
        'All Google models in the auto-failover pool hit their free quota or are temporarily busy. Please try again shortly.'
      );
}

export async function generateKritikaOpenRouterDecision(
  params: DecisionRequestParams
): Promise<BotDecision> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_OPENROUTER_API_KEY') {
    throw new Error(
      'OPENROUTER_API_KEY is not configured in server secrets. Switch AI Brain to Google Gemini or add OPENROUTER_API_KEY.'
    );
  }

  const messages = formatOpenRouterMessages(
    params.config,
    params.history,
    params.incomingUser,
    params.userMemories
  );

  const model =
    params.config.openRouterModel?.trim() ||
    process.env.OPENROUTER_MODEL?.trim() ||
    'cognitivecomputations/dolphin-mistral-24b-venice-edition:free';

  const appUrl = process.env.APP_URL?.trim() || 'http://localhost:3000';

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': appUrl,
      'X-Title': `${params.config.botName} Telegram AI Studio`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: params.config.temperature ?? 0.9,
      max_tokens: 450,
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };

  if (!response.ok) {
    const errMsg =
      payload?.error?.message || `OpenRouter API returned status ${response.status}`;
    throw new Error(errMsg);
  }

  const rawContent = payload?.choices?.[0]?.message?.content;
  if (!rawContent || typeof rawContent !== 'string') {
    throw new Error('OpenRouter returned an empty completion.');
  }

  return parseBotDecision(rawContent, params.config, {
    userText: params.incomingUser.text,
  });
}

export async function generateKritikaDecision(
  params: DecisionRequestParams
): Promise<BotDecision> {
  // Always use Gemini when an image/meme/sticker is attached for reliable multimodal vision
  if (
    !params.imagePart &&
    params.config.aiProvider === 'openrouter' &&
    isOpenRouterConfigured()
  ) {
    return generateKritikaOpenRouterDecision(params);
  }
  return generateKritikaGeminiDecision(params);
}

export async function resolveGifForDecision(
  mood: GifMood | null,
  config: BotConfig,
  recentGifIds: string[]
): Promise<GifItem | null> {
  if (!mood) return null;

  const tenorKey = process.env.TENOR_API_KEY?.trim();
  if (tenorKey) {
    try {
      const queryMap: Record<GifMood, string> = {
        flirty: 'cute wink flirt anime girl',
        laugh: 'laughing lol funny reaction',
        blush: 'cute shy blush smile',
        tease: 'playful tease smirk',
        love: 'sending hearts love cute',
        shock: 'surprised shocked reaction',
        angry: 'cute fake angry pout',
        bye: 'cute wave bye',
      };
      const q = encodeURIComponent(queryMap[mood] || mood);
      const res = await fetch(
        `https://tenor.googleapis.com/v2/search?q=${q}&key=${encodeURIComponent(
          tenorKey
        )}&limit=5&media_filter=gif`
      );
      if (res.ok) {
        const data = (await res.json()) as {
          results?: Array<{
            id: string;
            content_description?: string;
            media_formats?: { gif?: { url?: string } };
          }>;
        };
        const hit = data.results?.find((r) => r.media_formats?.gif?.url);
        if (hit?.media_formats?.gif?.url) {
          return {
            id: `tenor-${hit.id}`,
            mood,
            title: hit.content_description || `${mood} GIF`,
            url: hit.media_formats.gif.url,
            enabled: true,
          };
        }
      }
    } catch {
      // Fallback cleanly to custom GIF library
    }
  }

  return pickGifForMood(mood, config.customGifLibrary, recentGifIds);
}

async function convertWavBufferToOggOpus(wavBuffer: Buffer): Promise<Buffer | null> {
  const tmpId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const wavPath = path.join(os.tmpdir(), `kritika-${tmpId}.wav`);
  const oggPath = path.join(os.tmpdir(), `kritika-${tmpId}.ogg`);

  try {
    fs.writeFileSync(wavPath, wavBuffer);
    await execFileAsync('ffmpeg', [
      '-y',
      '-i',
      wavPath,
      '-c:a',
      'libopus',
      '-b:a',
      '48k',
      '-ac',
      '1',
      '-ar',
      '48000',
      oggPath,
    ]);
    return fs.readFileSync(oggPath);
  } catch {
    return null;
  } finally {
    try {
      if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);
      if (fs.existsSync(oggPath)) fs.unlinkSync(oggPath);
    } catch {
      // ignore temp cleanup failure
    }
  }
}

function ensureWavBuffer(rawBuffer: Buffer): Buffer {
  // Check if already starts with RIFF header
  if (
    rawBuffer.length >= 12 &&
    rawBuffer.subarray(0, 4).toString('ascii') === 'RIFF'
  ) {
    return rawBuffer;
  }
  // Wrap raw 24kHz mono 16-bit PCM into a valid 44-byte WAV header
  const sampleRate = 24000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + rawBuffer.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(rawBuffer.length, 40);
  return Buffer.concat([header, rawBuffer]);
}

function formatReadableError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } };
    if (parsed?.error?.message) {
      return parsed.error.message.split('\n')[0];
    }
  } catch {
    // not JSON
  }
  return raw;
}

export async function synthesizeKritikaVoice(params: {
  text: string;
  voiceName: 'Kore' | 'Zephyr';
  preferOggOpus?: boolean;
}): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY is not configured in server secrets for Hindi/Hinglish/English voice synthesis.'
    );
  }

  const cleanText = params.text.trim().slice(0, 450);
  if (!cleanText) {
    throw new Error('Voice text cannot be empty.');
  }

  const voiceName = params.voiceName || 'Kore';
  let base64Audio: string | undefined;
  let lastError: unknown = null;

  // Try Gemini TTS models cleanly without invalid payload fields
  const attempts: Array<{ model: string; apiVersion?: string; prompt: string }> = [
    {
      model: 'gemini-2.5-flash-preview-tts',
      apiVersion: 'v1beta',
      prompt: `Speak naturally as a friendly, playful young Indian woman in casual Hinglish/Hindi/English: ${cleanText}`,
    },
    {
      model: 'gemini-3.8-flash-lite-tts',
      apiVersion: 'v1alpha',
      prompt: cleanText,
    },
  ];

  for (const attempt of attempts) {
    try {
      const client = new GoogleGenAI({
        apiKey,
        apiVersion: attempt.apiVersion,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });
      const response = await client.models.generateContent({
        model: attempt.model,
        contents: [
          {
            role: 'user',
            parts: [{ text: attempt.prompt }],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName,
              },
            },
          },
        },
      });
      const data =
        response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (data) {
        base64Audio = data;
        break;
      }
    } catch (err) {
      lastError = err;
    }
  }

  if (!base64Audio) {
    throw new Error(
      lastError
        ? `Voice synthesis unavailable: ${formatReadableError(lastError)}`
        : 'Gemini TTS did not return audio data.'
    );
  }

  const wavBuffer = ensureWavBuffer(Buffer.from(base64Audio, 'base64'));

  if (params.preferOggOpus) {
    const oggBuffer = await convertWavBufferToOggOpus(wavBuffer);
    if (oggBuffer) {
      return {
        buffer: oggBuffer,
        mimeType: 'audio/ogg',
        filename: 'kritika-voice.ogg',
      };
    }
  }

  return {
    buffer: wavBuffer,
    mimeType: 'audio/wav',
    filename: 'kritika-voice.wav',
  };
}
