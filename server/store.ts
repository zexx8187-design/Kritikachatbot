import fs from 'node:fs';
import path from 'node:path';
import { mergeUserMemory } from '../src/bot/features';
import {
  DEFAULT_BOT_CONFIG,
  DEFAULT_FEATURE_FLAGS,
  type ActivityLogEntry,
  type BotConfig,
  type ChatTurn,
  type UserMemory,
} from '../src/bot/types';

interface PersistedState {
  config: BotConfig;
  histories: Record<string, ChatTurn[]>;
  recentGifIds: string[];
  logs: ActivityLogEntry[];
  memories: Record<string, UserMemory>;
  warnings: Record<string, number>;
  gifPackVersion?: number;
}

const CURRENT_GIF_PACK_VERSION = 2;

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'kritika-state.json');

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function defaultState(): PersistedState {
  const modelFromEnv = process.env.OPENROUTER_MODEL?.trim();
  return {
    config: {
      ...DEFAULT_BOT_CONFIG,
      openRouterModel: modelFromEnv || DEFAULT_BOT_CONFIG.openRouterModel,
      features: { ...DEFAULT_FEATURE_FLAGS },
    },
    histories: {},
    recentGifIds: [],
    logs: [],
    memories: {},
    warnings: {},
    gifPackVersion: CURRENT_GIF_PACK_VERSION,
  };
}

let stateCache: PersistedState | null = null;

export function loadState(): PersistedState {
  if (stateCache) return stateCache;
  ensureDataDir();
  if (!fs.existsSync(STATE_FILE)) {
    stateCache = defaultState();
    saveState(stateCache);
    return stateCache;
  }
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    const fallback = defaultState();
    const existingGifs =
      Array.isArray(parsed.config?.customGifLibrary) &&
      parsed.config.customGifLibrary.length > 0
        ? parsed.config.customGifLibrary
        : fallback.config.customGifLibrary;

    const needsGifPackUpgrade = (parsed.gifPackVersion ?? 0) < CURRENT_GIF_PACK_VERSION;
    let mergedGifs = existingGifs;
    if (needsGifPackUpgrade) {
      const existingIds = new Set(existingGifs.map((g) => g.id));
      const newDefaults = fallback.config.customGifLibrary.filter(
        (g) => !existingIds.has(g.id)
      );
      mergedGifs = [...existingGifs, ...newDefaults];
    }

    stateCache = {
      config: {
        ...fallback.config,
        ...(parsed.config ?? {}),
        features: {
          ...DEFAULT_FEATURE_FLAGS,
          ...(parsed.config?.features ?? {}),
        },
        customGifLibrary: mergedGifs,
      },
      histories: parsed.histories ?? {},
      recentGifIds: Array.isArray(parsed.recentGifIds) ? parsed.recentGifIds : [],
      logs: Array.isArray(parsed.logs) ? parsed.logs : [],
      memories: parsed.memories && typeof parsed.memories === 'object' ? parsed.memories : {},
      warnings: parsed.warnings && typeof parsed.warnings === 'object' ? parsed.warnings : {},
      gifPackVersion: CURRENT_GIF_PACK_VERSION,
    };
    if (needsGifPackUpgrade) {
      saveState(stateCache);
    }
    return stateCache;
  } catch {
    stateCache = defaultState();
    saveState(stateCache);
    return stateCache;
  }
}

function saveState(next: PersistedState): void {
  ensureDataDir();
  stateCache = next;
  fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2), 'utf-8');
}

export function getConfig(): BotConfig {
  return loadState().config;
}

export function updateConfig(partial: Partial<BotConfig>): BotConfig {
  const current = loadState();
  const merged: BotConfig = {
    ...current.config,
    ...partial,
    features: {
      ...DEFAULT_FEATURE_FLAGS,
      ...(current.config.features ?? {}),
      ...(partial.features ?? {}),
    },
  };
  saveState({
    ...current,
    config: merged,
  });
  return merged;
}

export function getChatHistory(chatId: string): ChatTurn[] {
  const state = loadState();
  return state.histories[chatId] ?? [];
}

export function appendChatTurn(chatId: string, turn: ChatTurn, maxKeep = 24): void {
  const state = loadState();
  const existing = state.histories[chatId] ?? [];
  const nextHistory = [...existing, turn].slice(-maxKeep);
  saveState({
    ...state,
    histories: {
      ...state.histories,
      [chatId]: nextHistory,
    },
  });
}

export function clearChatHistory(chatId: string): void {
  const state = loadState();
  const nextHistories = { ...state.histories };
  delete nextHistories[chatId];
  saveState({
    ...state,
    histories: nextHistories,
  });
}

export function getRecentGifIds(): string[] {
  return loadState().recentGifIds;
}

export function pushRecentGifId(gifId: string): void {
  const state = loadState();
  const next = [gifId, ...state.recentGifIds.filter((id) => id !== gifId)].slice(0, 8);
  saveState({
    ...state,
    recentGifIds: next,
  });
}

export function getLogs(): ActivityLogEntry[] {
  return loadState().logs;
}

export function appendLog(entry: ActivityLogEntry): void {
  const state = loadState();
  const nextLogs = [entry, ...state.logs].slice(0, 100);
  saveState({
    ...state,
    logs: nextLogs,
  });
}

export function clearLogs(): void {
  const state = loadState();
  saveState({
    ...state,
    logs: [],
  });
}

export function getChatMemories(chatId: string): UserMemory[] {
  const state = loadState();
  return Object.values(state.memories)
    .filter((m) => m.chatId === chatId)
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}

export function getAllMemories(): UserMemory[] {
  const state = loadState();
  return Object.values(state.memories).sort((a, b) =>
    b.lastSeen.localeCompare(a.lastSeen)
  );
}

export function upsertUserMemory(params: {
  chatId: string;
  userId: string;
  name: string;
  username?: string;
  note?: string | null;
}): UserMemory {
  const state = loadState();
  const key = `${params.chatId}:${params.userId}`;
  const updated = mergeUserMemory(state.memories[key], params);
  saveState({
    ...state,
    memories: {
      ...state.memories,
      [key]: updated,
    },
  });
  return updated;
}

export function deleteUserMemory(chatId: string, userId: string): void {
  const state = loadState();
  const key = `${chatId}:${userId}`;
  const next = { ...state.memories };
  delete next[key];
  saveState({
    ...state,
    memories: next,
  });
}

export function clearAllMemories(): void {
  const state = loadState();
  saveState({
    ...state,
    memories: {},
  });
}

export function incrementUserWarning(chatId: string, userId: string): number {
  const state = loadState();
  const key = `${chatId}:${userId}`;
  const nextCount = (state.warnings[key] ?? 0) + 1;
  saveState({
    ...state,
    warnings: {
      ...state.warnings,
      [key]: nextCount,
    },
  });
  return nextCount;
}

export function resetUserWarning(chatId: string, userId: string): void {
  const state = loadState();
  const key = `${chatId}:${userId}`;
  const next = { ...state.warnings };
  delete next[key];
  saveState({
    ...state,
    warnings: next,
  });
}
