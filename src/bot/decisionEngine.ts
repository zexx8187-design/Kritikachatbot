import {
  detectUserWantsPoll,
  formatMemoryContext,
  validatePollPayload,
} from './features';
import type {
  BotConfig,
  BotDecision,
  ChatTurn,
  GifItem,
  GifMood,
  PollSpec,
  UserMemory,
} from './types';

export const TELEGRAM_ALLOWED_REACTIONS: ReadonlySet<string> = new Set([
  '👍', '👎', '❤️', '🔥', '🥰', '👏', '😁', '🤔', '🤯', '😱', '🤬', '😢',
  '🎉', '🤩', '🤮', '💩', '🙏', '👌', '🕊️', '🤡', '🥱', '🥴', '😍', '🐳',
  '❤️‍🔥', '🌚', '🌭', '💯', '🤣', '⚡', '🍌', '🏆', '💔', '🤨', '😐', '🍓',
  '🍾', '💋', '🖕', '😈', '😴', '😭', '🤓', '👻', '👨‍💻', '👀', '🎃', '🙈',
  '😇', '😨', '🤝', '✍️', '🤗', '🫡', '🎅', '🎄', '☃️', '💅', '🤪', '🗿',
  '🆒', '💘', '🙉', '🦄', '😘', '💊', '🙊', '😎', '👾', '🤷‍♂️', '🤷', '🤷‍♀️', '😡',
]);

const VALID_GIF_MOODS: ReadonlySet<GifMood> = new Set([
  'flirty',
  'laugh',
  'blush',
  'tease',
  'love',
  'shock',
  'angry',
  'bye',
]);

export function clampPercentage(value: number, fallback = 50): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function validateTelegramReaction(emoji?: string | null): string | null {
  if (!emoji || typeof emoji !== 'string') return null;
  const trimmed = emoji.trim();
  if (!trimmed) return null;
  if (TELEGRAM_ALLOWED_REACTIONS.has(trimmed)) {
    return trimmed;
  }
  // Map common unofficial emojis to Telegram-supported reactions
  const aliasMap: Record<string, string> = {
    '😂': '🤣',
    '😊': '🥰',
    '😉': '🤪',
    '😏': '😎',
    '💓': '💘',
    '💖': '❤️‍🔥',
    '💕': '❤️',
    '🤭': '🙈',
    '😳': '😱',
    '✨': '🔥',
  };
  return aliasMap[trimmed] ?? null;
}

export function normalizeGifMood(mood?: string | null): GifMood | null {
  if (!mood || typeof mood !== 'string') return null;
  const lower = mood.trim().toLowerCase() as GifMood;
  return VALID_GIF_MOODS.has(lower) ? lower : null;
}

export function buildKritikaSystemPrompt(
  config: BotConfig,
  options?: { userMemories?: UserMemory[]; allowPoll?: boolean }
): string {
  const langs = config.languages.length > 0 ? config.languages.join(', ') : 'Hinglish, Hindi, English';
  const availableMoods = Array.from(
    new Set(config.customGifLibrary.filter((g) => g.enabled).map((g) => g.mood))
  );
  const moodList = availableMoods.length > 0 ? availableMoods.join(', ') : 'flirty, laugh, blush, tease, love, shock';
  const memorySection =
    config.features?.memoryEnabled !== false && options?.userMemories?.length
      ? formatMemoryContext(options.userMemories)
      : '';
  const pollRule =
    options?.allowPoll !== false && config.features?.pollsEnabled !== false
      ? `- "poll": { "question": string, "options": string[] (2-4 fun choices) } ONLY when someone asks for a poll/game/Truth-or-Dare/vote OR when a fun group poll fits naturally; otherwise null.`
      : `- "poll": always null.`;

  return `${config.systemPrompt.trim()}

Character Profile:
- Name: ${config.botName}
- Vibe & Traits: ${config.personalityTraits}
- Languages: ${langs}${memorySection}

Output Format Instructions (CRITICAL):
Respond with a single valid JSON object (no extra commentary outside JSON) with these exact keys:
{
  "shouldReply": boolean,
  "replyText": string,
  "reactionEmoji": string | null,
  "gifMood": "${moodList}" | null,
  "sendVoice": boolean,
  "voiceText": string | null,
  "memoryNote": string | null,
  "poll": { "question": string, "options": string[] } | null
}

Rules for fields:
- "shouldReply": usually true when someone talks in the chat, false only if a message truly needs zero text reply and only a reaction.
- "replyText": ${config.botName}'s natural conversational reply with emojis where natural. Keep it punchy and human.
- "reactionEmoji": pick ONE emoji from [❤️, 🔥, 🤣, 🥰, 😍, 👀, 😘, 🙈, 😈, 💘, 💋, 👍, 😭, 😡, 😎, 🤪, 💯] that fits the user's message, or null.
- "gifMood": pick one of [${moodList}] ONLY when a GIF genuinely adds fun/drama to the moment, otherwise null.
- "sendVoice": true ONLY when the user asks for voice/audio OR when a playful voice note makes the reply extra lively; otherwise false.
- "voiceText": if sendVoice is true, write the exact short spoken line (1-2 sentences, Hinglish/Hindi/English without emojis) for TTS voice synthesis; otherwise null.
- "memoryNote": if the sender shared a fun personal fact, hobby, nickname, or recurring vibe worth remembering later (max 8 words), write it here; otherwise null.
${pollRule}`;
}

export function formatOpenRouterMessages(
  config: BotConfig,
  history: ChatTurn[],
  incomingUser: { name: string; text: string },
  userMemories?: UserMemory[]
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const maxTurns = Math.max(2, Math.min(30, config.maxHistoryMessages || 16));
  const recent = history.slice(-maxTurns);

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    {
      role: 'system',
      content: buildKritikaSystemPrompt(config, { userMemories }),
    },
  ];

  for (const turn of recent) {
    if (turn.role === 'assistant') {
      messages.push({
        role: 'assistant',
        content: turn.text,
      });
    } else {
      messages.push({
        role: 'user',
        content: `[${turn.senderName}]: ${turn.text}`,
      });
    }
  }

  messages.push({
    role: 'user',
    content: `[${incomingUser.name}]: ${incomingUser.text}`,
  });

  return messages;
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const cleaned = raw.trim();
  // Try fenced JSON first
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : cleaned;

  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Try finding first { ... } block
  }

  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      const sliced = candidate.slice(firstBrace, lastBrace + 1);
      const parsed = JSON.parse(sliced);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }

  return null;
}

export function detectUserWantsVoice(userText: string): boolean {
  const lower = userText.toLowerCase();
  return /\b(voice|audio|bol ke|bolke|sunao|awaaz|awaz|voice note|vn|record)\b/i.test(lower);
}

export function detectUserWantsGif(userText: string): boolean {
  const lower = userText.toLowerCase();
  return /\b(gif|meme|sticker|reaction gif)\b/i.test(lower);
}

export function parseBotDecision(
  rawText: string,
  config: BotConfig,
  context?: {
    userText?: string;
    isIncomingGif?: boolean;
    randValues?: {
      replyRoll?: number;
      reactRoll?: number;
      gifRoll?: number;
      voiceRoll?: number;
    };
  }
): BotDecision {
  const rolls = {
    replyRoll: context?.randValues?.replyRoll ?? Math.random() * 100,
    reactRoll: context?.randValues?.reactRoll ?? Math.random() * 100,
    gifRoll: context?.randValues?.gifRoll ?? Math.random() * 100,
    voiceRoll: context?.randValues?.voiceRoll ?? Math.random() * 100,
  };

  const userText = context?.userText ?? '';
  const explicitVoice = detectUserWantsVoice(userText);
  const explicitGif = Boolean(context?.isIncomingGif) || detectUserWantsGif(userText);
  const explicitPoll = detectUserWantsPoll(userText);

  const parsed = extractJsonObject(rawText);

  let shouldReply = true;
  let replyText = rawText.trim();
  let reactionEmoji: string | null = null;
  let gifMood: GifMood | null = null;
  let sendVoice = false;
  let voiceText: string | null = null;
  let memoryNote: string | null = null;
  let poll: PollSpec | null = null;

  if (parsed) {
    shouldReply = typeof parsed.shouldReply === 'boolean' ? parsed.shouldReply : true;
    replyText = typeof parsed.replyText === 'string' ? parsed.replyText.trim() : '';
    reactionEmoji = validateTelegramReaction(
      typeof parsed.reactionEmoji === 'string' ? parsed.reactionEmoji : null
    );
    gifMood = normalizeGifMood(typeof parsed.gifMood === 'string' ? parsed.gifMood : null);
    sendVoice = Boolean(parsed.sendVoice);
    voiceText = typeof parsed.voiceText === 'string' ? parsed.voiceText.trim() : null;
    memoryNote =
      typeof parsed.memoryNote === 'string' && parsed.memoryNote.trim().length > 0
        ? parsed.memoryNote.trim().slice(0, 140)
        : null;
    if (config.features?.pollsEnabled !== false) {
      poll = validatePollPayload(parsed.poll);
    }
  } else {
    // Plain-text fallback when an uncensored OpenRouter model skips JSON formatting
    replyText = rawText.replace(/^["']|["']$/g, '').trim();
    reactionEmoji = validateTelegramReaction(inferFallbackReaction(userText, replyText));
    gifMood = explicitGif ? 'tease' : null;
  }

  if (explicitPoll && config.features?.pollsEnabled !== false && !poll) {
    poll = {
      question: 'Aaj group mein konsa game khele? 👀🔥',
      options: ['Truth 😇', 'Dare 😈', 'Would You Rather 🤔', 'Sirf gossip & masti 😜'],
    };
  }

  // Respect configured probabilities unless explicitly asked by user
  const replyChance = clampPercentage(config.replyChance, 100);
  if (replyChance === 0) {
    shouldReply = false;
  } else if (
    replyChance < 100 &&
    rolls.replyRoll > replyChance &&
    !explicitVoice &&
    !explicitGif &&
    !explicitPoll
  ) {
    shouldReply = false;
  }

  const reactionChance = clampPercentage(config.reactionChance, 70);
  if (reactionChance === 0 || rolls.reactRoll > reactionChance) {
    reactionEmoji = null;
  } else if (!reactionEmoji && rolls.reactRoll <= reactionChance) {
    reactionEmoji = validateTelegramReaction(inferFallbackReaction(userText, replyText));
  }

  const gifChance = clampPercentage(config.gifChance, 25);
  if (explicitGif && !gifMood && gifChance > 0) {
    gifMood = inferFallbackGifMood(userText, replyText);
  }
  if (!explicitGif && (gifChance === 0 || rolls.gifRoll > gifChance)) {
    gifMood = null;
  }
  if (gifChance === 0) {
    gifMood = null;
  }

  const voiceChance = clampPercentage(config.voiceChance, 20);
  if (explicitVoice) {
    sendVoice = true;
  } else if (voiceChance === 0 || rolls.voiceRoll > voiceChance) {
    sendVoice = false;
  }

  if (sendVoice && !voiceText) {
    voiceText = stripEmojisForSpeech(replyText);
  }
  if (!sendVoice) {
    voiceText = null;
  }

  if (shouldReply && !replyText && !gifMood && !sendVoice && !poll) {
    replyText = 'Haan bolo, kya scene hai aaj? 👀';
  }

  return {
    shouldReply,
    replyText,
    reactionEmoji,
    gifMood,
    sendVoice,
    voiceText,
    memoryNote,
    poll,
  };
}

export function stripEmojisForSpeech(text: string): string {
  return text
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function inferFallbackReaction(userText: string, replyText: string): string {
  const combined = `${userText} ${replyText}`.toLowerCase();
  if (/(haha|lol|lmao|funny|joke|mast|has|pagal)/i.test(combined)) return '🤣';
  if (/(love|pyar|miss|cute|beautiful|hot|sweet|jaan|crush)/i.test(combined)) return '🥰';
  if (/(fire|op|crazy|bawaal|osm|solid)/i.test(combined)) return '🔥';
  if (/(sad|bore|dukhi|rona|tired|thak)/i.test(combined)) return '🤗';
  if (/(kya|sach|really|shock|wtf|omg)/i.test(combined)) return '👀';
  return '❤️';
}

export function inferFallbackGifMood(userText: string, replyText: string): GifMood {
  const combined = `${userText} ${replyText}`.toLowerCase();
  if (/(bye|good\s*night|gn|tata|chalta|chalti|ja\s*raha|ja\s*rahi|see\s*ya)/i.test(combined)) {
    return 'bye';
  }
  if (/(gussa|angry|naraz|chup|marunga|pitai|katti|hate|pagal\s*hai|😡|😤)/i.test(combined)) {
    return 'angry';
  }
  if (/(shock|omg|wtf|kya\s*baat|sach\s*mein|heinn|wait\s*what|😱|🤯)/i.test(combined)) {
    return 'shock';
  }
  if (/(sharma|blush|shy|aww|sweet|cute|🙈|🥰)/i.test(combined)) {
    return 'blush';
  }
  if (/(love|pyar|pyaar|dil|jaan|miss\s*u|miss\s*you|kiss|❤️|💘|😘)/i.test(combined)) {
    return 'love';
  }
  if (/(flirt|wink|date|gf|hot|handsome|sexy|😉|😏)/i.test(combined)) {
    return 'flirty';
  }
  if (/(haha|lol|lmao|funny|joke|comedy|has|hasi|🤣|😂)/i.test(combined)) {
    return 'laugh';
  }
  return 'tease';
}

export function pickGifForMood(
  mood: GifMood | null | undefined,
  library: GifItem[],
  recentGifIds: string[] = []
): GifItem | null {
  if (!mood) return null;
  const enabled = library.filter((item) => item.enabled && item.url.trim().length > 0);
  if (enabled.length === 0) return null;

  const moodMatches = enabled.filter((item) => item.mood === mood);
  const pool = moodMatches.length > 0 ? moodMatches : enabled;

  const nonRecent = pool.filter((item) => !recentGifIds.includes(item.id));
  const candidates = nonRecent.length > 0 ? nonRecent : pool;
  const randomIdx = Math.floor(Math.random() * candidates.length);
  return candidates[randomIdx] ?? candidates[0] ?? null;
}

export function buildOfflinePreviewReply(
  userText: string,
  senderName: string,
  config: BotConfig
): BotDecision {
  const lower = userText.toLowerCase();
  const wantsVoice = detectUserWantsVoice(userText);
  const wantsGif = detectUserWantsGif(userText);

  let replyText = `Arre ${senderName}, itni der se kahan gayab the? Ab aaye ho toh kuch interesting sunao na 😏`;
  let reactionEmoji = '❤️';
  let gifMood: GifMood | null = wantsGif ? 'flirty' : null;
  let sendVoice = wantsVoice;

  if (/(bore|boring|neend|akela)/i.test(lower)) {
    replyText = `Arey mere hote hue bore kaise ho sakte ho ${senderName}? Batao aaj mood kaisa hai — masti karein ya gossip? 😜`;
    reactionEmoji = '🤗';
    gifMood = gifMood ?? 'tease';
  } else if (/(hi|hello|hey|hlo|kya haal|kaise ho)/i.test(lower)) {
    replyText = `Heyy ${senderName}! Main bilkul mast hoon, bas tum logon ki bakwaas miss kar rahi thi 😂 Tum sunao kya chal raha?`;
    reactionEmoji = '🥰';
    gifMood = gifMood ?? 'blush';
  } else if (/(cute|pretty|love|pyar|flirt|date|gf|hot)/i.test(lower)) {
    replyText = `Ohooo itni direct flirting? Careful ${senderName}, kahin mujhe sach mein aadat na lag jaye 😉🔥`;
    reactionEmoji = '💘';
    gifMood = gifMood ?? 'flirty';
  } else if (/(funny|joke|meme|has|lol)/i.test(lower)) {
    replyText = `Hahaha stoppp yaar, pet dukh gaya haste haste 🤣 Waise tumhara sense of humor toh dangerous hai!`;
    reactionEmoji = '🤣';
    gifMood = gifMood ?? 'laugh';
  } else if (wantsVoice) {
    replyText = `Lo suno ${senderName}, tumne bola aur ${config.botName} ne voice note bhej diya! Awaaz kaisi lagi batana zaroor 😉`;
    reactionEmoji = '😘';
  }

  return {
    shouldReply: true,
    replyText,
    reactionEmoji: config.reactionChance > 0 ? validateTelegramReaction(reactionEmoji) : null,
    gifMood: config.gifChance > 0 || wantsGif ? gifMood : null,
    sendVoice,
    voiceText: sendVoice ? stripEmojisForSpeech(replyText) : null,
  };
}
