import type { PollSpec, UserMemory } from './types';

export type AdminActionType =
  | 'pin'
  | 'unpin'
  | 'delete'
  | 'mute'
  | 'unmute'
  | 'warn';

export interface AdminIntent {
  action: AdminActionType;
  durationMinutes?: number;
}

const URL_OR_INVITE_REGEX =
  /(https?:\/\/\S+|www\.\S+|t\.me\/\S+|telegram\.me\/\S+|\b[a-z0-9-]+\.(com|in|xyz|net|org|io|vip|bet|club|online|shop|click)\b)/i;

const SPAM_SCAM_REGEX =
  /\b(free\s+crypto|usdt\s+earn|daily\s+income|guaranteed\s+profit|dm\s+for\s+paid|join\s+my\s+channel|betting\s+tips|airdrop\s+claim|100%\s+sure\s+signal)\b/i;

const HEAVY_ABUSE_REGEX =
  /\b(madarchod|bhenchod|behenchod|bhosdike|bsdk|chutiya|chutiye|gandu|randi|mc\b|bc\b|haramkhor|motherfucker|bitch)\b/i;

export function detectSpamOrLink(
  text: string,
  hasTelegramUrlEntity = false
): { isSpam: boolean; reason: string | null } {
  const clean = (text || '').trim();
  if (hasTelegramUrlEntity || URL_OR_INVITE_REGEX.test(clean)) {
    return { isSpam: true, reason: 'Unauthorized link / promotion' };
  }
  if (SPAM_SCAM_REGEX.test(clean)) {
    return { isSpam: true, reason: 'Spam / scam promotion' };
  }
  if (HEAVY_ABUSE_REGEX.test(clean)) {
    return { isSpam: true, reason: 'Abusive language' };
  }
  return { isSpam: false, reason: null };
}

export function extractDurationMinutes(text: string, defaultMinutes = 15): number {
  const lower = text.toLowerCase();
  const hourMatch = lower.match(/(\d+)\s*(h|hr|hrs|hour|hours|ghanta|ghante)/i);
  if (hourMatch) {
    const hrs = Math.max(1, Math.min(24, Number(hourMatch[1])));
    return hrs * 60;
  }
  const minMatch = lower.match(/(\d+)\s*(m|min|mins|minute|minutes|mint)/i);
  if (minMatch) {
    return Math.max(1, Math.min(1440, Number(minMatch[1])));
  }
  return defaultMinutes;
}

export function parseAdminIntent(
  text: string,
  botName = 'Kritika',
  hasRepliedMessage = false
): AdminIntent | null {
  const clean = (text || '').trim();
  if (!clean) return null;
  const lower = clean.toLowerCase();

  const botPattern = new RegExp(`\\b${botName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  const directed = hasRepliedMessage || botPattern.test(clean) || /^\/(pin|unpin|del|delete|mute|unmute|warn)\b/i.test(clean);
  if (!directed) return null;

  if (/\bunpin\b|pin\s*hata/i.test(lower)) {
    return { action: 'unpin' };
  }
  if (/\bpin\b(\s*(kar|kr|kardo|karo|this|it|message|msg))?/i.test(lower) && (hasRepliedMessage || botPattern.test(clean) || lower.startsWith('/pin'))) {
    return { action: 'pin' };
  }
  if (/\bunmute\b|bolne\s*de/i.test(lower)) {
    return { action: 'unmute' };
  }
  if (/\bmute\b|chup\s*(kara|karwa|krwa)/i.test(lower)) {
    return {
      action: 'mute',
      durationMinutes: extractDurationMinutes(lower, 15),
    };
  }
  if (/\b(delete|del)\b\s*(kar|kr|kardo|karo|this|it|ye|yeh|msg|message)?|^(hatao|hata\s*de)\b/i.test(lower)) {
    if (hasRepliedMessage || lower.startsWith('/del')) {
      return { action: 'delete' };
    }
  }
  if (/\bwarn(ing)?\b\s*(de|do|kar|kr|kardo)?/i.test(lower)) {
    if (hasRepliedMessage || lower.startsWith('/warn')) {
      return { action: 'warn' };
    }
  }

  return null;
}

export function detectUserWantsPoll(text: string): boolean {
  const lower = (text || '').toLowerCase();
  return /\b(poll|vote|voting|truth\s*(or|and|ya|&)\s*dare|would\s+you\s+rather|game\s+khel|quiz\s+khel|koi\s+game)\b/i.test(
    lower
  );
}

export function validatePollPayload(raw: unknown): PollSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as { question?: unknown; options?: unknown };
  const question = typeof obj.question === 'string' ? obj.question.trim().slice(0, 250) : '';
  if (!question || !Array.isArray(obj.options)) return null;

  const seen = new Set<string>();
  const cleanOptions: string[] = [];
  for (const item of obj.options) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim().slice(0, 95);
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleanOptions.push(trimmed);
    if (cleanOptions.length >= 6) break;
  }

  if (cleanOptions.length < 2) return null;
  return { question, options: cleanOptions };
}

export function shouldThrottleByCooldown(params: {
  lastReplyMs: number | undefined;
  nowMs: number;
  cooldownSeconds: number;
  isDirectOrPrivate: boolean;
}): boolean {
  if (params.isDirectOrPrivate) return false;
  if (!params.cooldownSeconds || params.cooldownSeconds <= 0) return false;
  if (!params.lastReplyMs) return false;
  return params.nowMs - params.lastReplyMs < params.cooldownSeconds * 1000;
}

export function mergeUserMemory(
  existing: UserMemory | undefined,
  patch: {
    userId: string;
    chatId: string;
    name: string;
    username?: string;
    note?: string | null;
    nowIso?: string;
  }
): UserMemory {
  const nowIso = patch.nowIso || new Date().toISOString();
  const baseNotes = existing?.notes ? [...existing.notes] : [];
  const cleanNote = patch.note?.trim().slice(0, 140);
  if (
    cleanNote &&
    !baseNotes.some((n) => n.toLowerCase() === cleanNote.toLowerCase())
  ) {
    baseNotes.push(cleanNote);
  }
  const cappedNotes = baseNotes.slice(-6);

  return {
    userId: patch.userId,
    chatId: patch.chatId,
    name: patch.name || existing?.name || 'Dost',
    username: patch.username || existing?.username,
    notes: cappedNotes,
    interactions: (existing?.interactions ?? 0) + 1,
    lastSeen: nowIso,
  };
}

export function formatMemoryContext(memories: UserMemory[]): string {
  const withNotes = memories.filter((m) => m.notes.length > 0);
  if (withNotes.length === 0) return '';
  const lines = withNotes.slice(0, 8).map(
    (m) => `- ${m.name} (${m.interactions} msgs): ${m.notes.join('; ')}`
  );
  return `\n\nMembers You Remember In This Group:\n${lines.join('\n')}`;
}
