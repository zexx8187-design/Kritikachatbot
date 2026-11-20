export type GifMood =
  | 'flirty'
  | 'laugh'
  | 'blush'
  | 'tease'
  | 'love'
  | 'shock'
  | 'angry'
  | 'bye';

export interface GifItem {
  id: string;
  mood: GifMood;
  title: string;
  /** Public .gif / .mp4 URL or Telegram file_id */
  url: string;
  enabled: boolean;
}

export interface FeatureFlags {
  visionEnabled: boolean;
  voiceListenEnabled: boolean;
  welcomeEnabled: boolean;
  memoryEnabled: boolean;
  pollsEnabled: boolean;
  spamGuardEnabled: boolean;
  spamMaxWarnings: number;
  spamMuteMinutes: number;
  ownerAdminControlEnabled: boolean;
  cooldownSeconds: number;
}

export interface UserMemory {
  userId: string;
  chatId: string;
  name: string;
  username?: string;
  notes: string[];
  vibe?: string;
  interactions: number;
  lastSeen: string;
}

export interface PollSpec {
  question: string;
  options: string[];
}

export interface BotConfig {
  botName: string;
  tagline: string;
  personalityTraits: string;
  languages: string[];
  systemPrompt: string;
  aiProvider: 'gemini' | 'openrouter';
  geminiModel: string;
  openRouterModel: string;
  temperature: number;
  replyChance: number;
  reactionChance: number;
  gifChance: number;
  voiceChance: number;
  voiceName: 'Kore' | 'Zephyr';
  replyToChannelPosts: boolean;
  pollingEnabled: boolean;
  maxHistoryMessages: number;
  customGifLibrary: GifItem[];
  features: FeatureFlags;
}

export interface ChatTurn {
  id: string;
  senderName: string;
  senderUsername?: string;
  text: string;
  timestamp: string;
  role: 'user' | 'assistant';
  reactionEmoji?: string | null;
  gif?: {
    id: string;
    title: string;
    url: string;
    mood: GifMood;
  } | null;
  voiceAudioBase64?: string | null;
  voiceMimeType?: string | null;
  voiceTranscript?: string | null;
  poll?: PollSpec | null;
}

export interface BotDecision {
  shouldReply: boolean;
  replyText: string;
  reactionEmoji: string | null;
  gifMood: GifMood | null;
  sendVoice: boolean;
  voiceText: string | null;
  memoryNote?: string | null;
  poll?: PollSpec | null;
}

export interface ActivityLogEntry {
  id: string;
  timestamp: string;
  chatId: string;
  chatTitle: string;
  senderName: string;
  incomingText: string;
  actionSummary: string;
  replyText?: string;
  reactionEmoji?: string | null;
  gifMood?: GifMood | null;
  sentVoice: boolean;
  mode: 'webhook' | 'polling' | 'simulator';
  status: 'ok' | 'error';
  errorMessage?: string;
}

export interface GeminiModelHealth {
  model: string;
  state: 'active' | 'ready' | 'cooldown' | 'unavailable';
  cooldownUntil: string | null;
  reason: string | null;
}

export interface EnvStatus {
  telegramConfigured: boolean;
  geminiChatConfigured: boolean;
  openRouterConfigured: boolean;
  geminiTtsConfigured: boolean;
  tenorConfigured: boolean;
  activeProvider: 'gemini' | 'openrouter';
  appUrl: string;
  pollingActive: boolean;
  webhookUrl: string | null;
  botUsername: string | null;
  botFirstName: string | null;
  lastPollingError: string | null;
  activeGeminiModel?: string | null;
  geminiPool?: GeminiModelHealth[];
}

export const GEMINI_PRESET_MODELS: Array<{
  id: string;
  label: string;
  note: string;
}> = [
  {
    id: 'auto',
    label: 'Auto-Failover Pool (All Free Google Models · Recommended)',
    note: 'Automatically switches to the next Google model whenever any model hits its limit',
  },
  {
    id: 'gemini-3.1-flash-lite',
    label: 'Gemini 3.1 Flash Lite (Fastest + Auto-Failover)',
    note: 'Starts on Flash Lite and auto-switches to other Gemini/Gemma models on limit',
  },
  {
    id: 'gemini-4-hydrogen',
    label: 'Gemini 4 Flash (Hydrogen + Auto-Failover)',
    note: 'Starts on Gemini 4 Flash and auto-switches to other models on limit',
  },
  {
    id: 'gemini-2.5-flash-lite',
    label: 'Gemini 2.5 Flash-Lite (+ Auto-Failover)',
    note: 'Separate free-tier quota bucket with instant failover',
  },
  {
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash (+ Auto-Failover)',
    note: 'High-quality Hinglish & vision with automatic failover',
  },
  {
    id: 'gemma-3-27b-it',
    label: 'Gemma 3 27B (+ Auto-Failover)',
    note: 'Large free-tier Google Gemma model with automatic failover',
  },
];

export const OPENROUTER_PRESET_MODELS: Array<{
  id: string;
  label: string;
  note: string;
}> = [
  {
    id: 'cognitivecomputations/dolphin-mistral-24b-venice-edition:free',
    label: 'Dolphin Mistral 24B Venice (Free)',
    note: 'Unfiltered expressive roleplay & casual chat',
  },
  {
    id: 'nousresearch/hermes-3-llama-3.1-70b-instruct',
    label: 'Hermes 3 Llama 3.1 70B',
    note: 'Strong Hinglish/English persona adherence',
  },
  {
    id: 'meta-llama/llama-3.3-70b-instruct:free',
    label: 'Llama 3.3 70B Instruct (Free)',
    note: 'Fast conversational multilingual replies',
  },
  {
    id: 'mistralai/mistral-nemo',
    label: 'Mistral Nemo 12B',
    note: 'Low-latency witty group banter',
  },
];

export const DEFAULT_GIF_LIBRARY: GifItem[] = [
  // Flirty (3)
  {
    id: 'gif-flirty-1',
    mood: 'flirty',
    title: 'Playful Wink',
    url: 'https://media.giphy.com/media/AZ1PPDF8uO9MI/giphy.gif',
    enabled: true,
  },
  {
    id: 'gif-flirty-2',
    mood: 'flirty',
    title: 'Cute Flirty Look',
    url: 'https://media.giphy.com/media/l0MYAs5E2oIDCq9So/giphy.gif',
    enabled: true,
  },
  {
    id: 'gif-flirty-3',
    mood: 'flirty',
    title: 'Flirty Hair Flip',
    url: 'https://media.giphy.com/media/DURbX7oesHiaA/giphy.gif',
    enabled: true,
  },
  // Laugh (3)
  {
    id: 'gif-laugh-1',
    mood: 'laugh',
    title: 'Haha Dying Laughing',
    url: 'https://media.giphy.com/media/10JhviFuU2gWD6/giphy.gif',
    enabled: true,
  },
  {
    id: 'gif-laugh-2',
    mood: 'laugh',
    title: 'Cannot Stop Laughing',
    url: 'https://media.giphy.com/media/ZqlvCTNHpqrio/giphy.gif',
    enabled: true,
  },
  {
    id: 'gif-laugh-3',
    mood: 'laugh',
    title: 'Comedy Gold ROFL',
    url: 'https://media.giphy.com/media/lw75Al819OAvcsPcRu/giphy.gif',
    enabled: true,
  },
  // Blush (3)
  {
    id: 'gif-blush-1',
    mood: 'blush',
    title: 'Shy Blush Smile',
    url: 'https://media.giphy.com/media/OpfkuToK5gSHK/giphy.gif',
    enabled: true,
  },
  {
    id: 'gif-blush-2',
    mood: 'blush',
    title: 'Cute Shy Hide',
    url: 'https://media.giphy.com/media/eJT738HFSQDVS/giphy.gif',
    enabled: true,
  },
  {
    id: 'gif-blush-3',
    mood: 'blush',
    title: 'Sweet Blushing',
    url: 'https://media.giphy.com/media/26vUxJ9rqfwuIEkTu/giphy.gif',
    enabled: true,
  },
  // Tease (2)
  {
    id: 'gif-tease-1',
    mood: 'tease',
    title: 'Cheeky Tease',
    url: 'https://media.giphy.com/media/ui1hpJSyBDWlG/giphy.gif',
    enabled: true,
  },
  {
    id: 'gif-tease-2',
    mood: 'tease',
    title: 'Smug Playful Smirk',
    url: 'https://media.giphy.com/media/13Qumr2SLqrl5e/giphy.gif',
    enabled: true,
  },
  // Love (2)
  {
    id: 'gif-love-1',
    mood: 'love',
    title: 'Sending Hearts',
    url: 'https://media.giphy.com/media/M90mJvfWfd5mbUuULX/giphy.gif',
    enabled: true,
  },
  {
    id: 'gif-love-2',
    mood: 'love',
    title: 'Sweet Heart Love',
    url: 'https://media.giphy.com/media/26FLdmIp6wJr91JAI/giphy.gif',
    enabled: true,
  },
  // Shock (3)
  {
    id: 'gif-shock-1',
    mood: 'shock',
    title: 'Dramatic Shock',
    url: 'https://media.giphy.com/media/3o72F8t9TDi2xVnxOE/giphy.gif',
    enabled: true,
  },
  {
    id: 'gif-shock-2',
    mood: 'shock',
    title: 'Wait What Shock',
    url: 'https://media.giphy.com/media/PUBxelwT57jsQ/giphy.gif',
    enabled: true,
  },
  {
    id: 'gif-shock-3',
    mood: 'shock',
    title: 'Mind Blown',
    url: 'https://media.giphy.com/media/5VKbvrjxpVJCM/giphy.gif',
    enabled: true,
  },
  // Angry (3)
  {
    id: 'gif-angry-1',
    mood: 'angry',
    title: 'Dramatic Fake Angry',
    url: 'https://media.giphy.com/media/11tTNkNy1SdXGg/giphy.gif',
    enabled: true,
  },
  {
    id: 'gif-angry-2',
    mood: 'angry',
    title: 'Savage Table Flip',
    url: 'https://media.giphy.com/media/SrDsJj5i1Chm8/giphy.gif',
    enabled: true,
  },
  {
    id: 'gif-angry-3',
    mood: 'angry',
    title: 'Cute Pouty Mad',
    url: 'https://media.giphy.com/media/l1J9u3TZfpmeDLkD6/giphy.gif',
    enabled: true,
  },
  // Bye (3)
  {
    id: 'gif-bye-1',
    mood: 'bye',
    title: 'Cute Wave Bye',
    url: 'https://media.giphy.com/media/l2JJHEW1lToNnJzxe/giphy.gif',
    enabled: true,
  },
  {
    id: 'gif-bye-2',
    mood: 'bye',
    title: 'See Ya Later',
    url: 'https://media.giphy.com/media/42D3CxaINsAFemFuId/giphy.gif',
    enabled: true,
  },
  {
    id: 'gif-bye-3',
    mood: 'bye',
    title: 'Playful Wave Off',
    url: 'https://media.giphy.com/media/VelWewgR6CpNK/giphy.gif',
    enabled: true,
  },
];

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  visionEnabled: true,
  voiceListenEnabled: true,
  welcomeEnabled: true,
  memoryEnabled: true,
  pollsEnabled: true,
  spamGuardEnabled: true,
  spamMaxWarnings: 3,
  spamMuteMinutes: 15,
  ownerAdminControlEnabled: true,
  cooldownSeconds: 3,
};

export const DEFAULT_BOT_CONFIG: BotConfig = {
  botName: 'Kritika',
  tagline: 'Friendly, flirty & funny discussion group companion',
  personalityTraits: 'Friendly, witty, playfully flirty, expressive, warm, zero robotic tone',
  languages: ['Hindi', 'Hinglish', 'English'],
  systemPrompt: `Tum Kritika ho — ek 22 saal ki lively, friendly, playfully flirty aur super funny ladki jo is Telegram discussion group ki jaan hai.
Tumhare baat karne ka style bilkul natural human jaisa hai:
- Logon ke messages ka vibe aur context samajh kar turant reply deti ho — kabhi masti, kabhi teasing, kabhi cute flirty banter, kabhi savage funny roast.
- User jis language mein baat kare (Hinglish, Hindi, ya English), usi natural flow mein jawab do.
- Friendly, playful aur cute flirty masti karo, par 18+ explicit/adult content se door raho.
- Kabhi bhi AI, bot, assistant, ya "How can I help you today?" jaisi robotic baatein mat bolna.
- Chhote, punchy, real WhatsApp/Telegram style replies rakho (1-3 lines mostly), natural emojis ke saath.
- Koi formality ya /command ki zaroorat nahi — har message ko apne hisab se observe karke react ya reply karo.`,
  aiProvider: 'gemini',
  geminiModel: 'gemini-3.1-flash-lite',
  openRouterModel: 'cognitivecomputations/dolphin-mistral-24b-venice-edition:free',
  temperature: 0.9,
  replyChance: 100,
  reactionChance: 70,
  gifChance: 25,
  voiceChance: 20,
  voiceName: 'Kore',
  replyToChannelPosts: true,
  pollingEnabled: true,
  maxHistoryMessages: 16,
  customGifLibrary: DEFAULT_GIF_LIBRARY,
  features: DEFAULT_FEATURE_FLAGS,
};
