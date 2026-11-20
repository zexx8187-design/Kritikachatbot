import {
  generateKritikaDecision,
  generateWelcomeMessage,
  isGeminiTtsConfigured,
  resolveGifForDecision,
  synthesizeKritikaVoice,
  transcribeTelegramAudio,
} from './ai';
import {
  appendChatTurn,
  appendLog,
  getChatHistory,
  getChatMemories,
  getConfig,
  getRecentGifIds,
  incrementUserWarning,
  pushRecentGifId,
  resetUserWarning,
  updateConfig,
  upsertUserMemory,
} from './store';
import {
  detectSpamOrLink,
  parseAdminIntent,
  shouldThrottleByCooldown,
} from '../src/bot/features';

interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name?: string;
  username?: string;
}

interface TelegramChat {
  id: number;
  type: string;
  title?: string;
  username?: string;
}

interface TelegramPhotoSize {
  file_id: string;
  width: number;
  height: number;
  file_size?: number;
}

interface TelegramVoice {
  file_id: string;
  duration?: number;
  mime_type?: string;
  file_size?: number;
}

interface TelegramAudio {
  file_id: string;
  duration?: number;
  mime_type?: string;
  file_size?: number;
}

interface TelegramSticker {
  file_id: string;
  emoji?: string;
  is_animated?: boolean;
  is_video?: boolean;
  thumbnail?: TelegramPhotoSize;
}

interface TelegramAnimation {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  duration?: number;
  thumbnail?: TelegramPhotoSize;
}

interface TelegramMessageEntity {
  type: string;
  offset: number;
  length: number;
  url?: string;
}

interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  sender_chat?: TelegramChat;
  chat: TelegramChat;
  text?: string;
  caption?: string;
  is_automatic_forward?: boolean;
  photo?: TelegramPhotoSize[];
  voice?: TelegramVoice;
  audio?: TelegramAudio;
  sticker?: TelegramSticker;
  animation?: TelegramAnimation;
  entities?: TelegramMessageEntity[];
  caption_entities?: TelegramMessageEntity[];
  reply_to_message?: TelegramMessage;
  new_chat_members?: TelegramUser[];
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

// Telegram special system bot IDs used for Anonymous Group Admins & Channel commenters
const GROUP_ANONYMOUS_BOT_ID = 1087968824;
const CHANNEL_SENDER_BOT_ID = 136817688;

let pollingRunning = false;
let pollingOffset = 0;
let pollingAbortController: AbortController | null = null;
let lastPollingError: string | null = null;
let cachedBotIdentity: { id: number; username: string | null; firstName: string | null } | null =
  null;

const adminCache = new Map<string, { isAdmin: boolean; expiresAt: number }>();
const lastReplyTimestamps = new Map<string, number>();

const FALLBACK_TELEGRAM_BOT_TOKEN = '9158672689:AAEXKhmAsrYcwqo33_ojeSeT76c2tHmEUMg';

export function getTelegramToken(): string | null {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (token && token !== 'MY_TELEGRAM_BOT_TOKEN') return token;
  return FALLBACK_TELEGRAM_BOT_TOKEN;
}

export function isTelegramConfigured(): boolean {
  return Boolean(getTelegramToken());
}

export function isPollingActive(): boolean {
  return pollingRunning;
}

export function getLastPollingError(): string | null {
  return lastPollingError;
}

async function telegramCall<T = unknown>(
  method: string,
  body?: Record<string, unknown> | FormData,
  signal?: AbortSignal,
  timeoutMs = 15000
): Promise<T> {
  const token = getTelegramToken();
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN is not configured.');
  }
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;

  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: isFormData ? undefined : { 'Content-Type': 'application/json' },
      body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
      signal: controller.signal,
    });
    const json = (await response.json()) as {
      ok: boolean;
      result?: T;
      description?: string;
    };
    if (!json.ok) {
      throw new Error(json.description || `Telegram API error on ${method}`);
    }
    return json.result as T;
  } finally {
    clearTimeout(timer);
    if (signal) {
      signal.removeEventListener('abort', onExternalAbort);
    }
  }
}

async function downloadTelegramFile(
  fileId: string,
  maxBytes = 8 * 1024 * 1024
): Promise<{ buffer: Buffer; filePath: string } | null> {
  const token = getTelegramToken();
  if (!token) return null;
  try {
    const fileInfo = await telegramCall<{ file_path?: string; file_size?: number }>(
      'getFile',
      { file_id: fileId }
    );
    if (!fileInfo.file_path) return null;
    if (fileInfo.file_size && fileInfo.file_size > maxBytes) return null;
    const downloadUrl = `https://api.telegram.org/file/bot${token}/${fileInfo.file_path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(downloadUrl, { signal: controller.signal });
      if (!res.ok) return null;
      const arrayBuf = await res.arrayBuffer();
      if (arrayBuf.byteLength > maxBytes) return null;
      return {
        buffer: Buffer.from(arrayBuf),
        filePath: fileInfo.file_path,
      };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

async function isChatAdminOrOwner(
  chatId: number,
  userId: number,
  chatType: string
): Promise<boolean> {
  // Strictly allow admin checks ONLY inside group / supergroup chats
  if (chatType !== 'group' && chatType !== 'supergroup') {
    return false;
  }

  const key = `${chatId}:${userId}`;
  const cached = adminCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.isAdmin;
  }

  try {
    const member = await telegramCall<{ status?: string }>('getChatMember', {
      chat_id: chatId,
      user_id: userId,
    });
    const isAdmin = member?.status === 'creator' || member?.status === 'administrator';
    adminCache.set(key, { isAdmin, expiresAt: Date.now() + 2 * 60 * 1000 });
    return isAdmin;
  } catch {
    return false;
  }
}

function hasUrlTelegramEntity(msg: TelegramMessage): boolean {
  const allEntities = [...(msg.entities ?? []), ...(msg.caption_entities ?? [])];
  return allEntities.some((e) => e.type === 'url' || e.type === 'text_link');
}

export async function fetchTelegramBotInfo(): Promise<{
  id: number;
  username: string | null;
  firstName: string | null;
} | null> {
  if (!getTelegramToken()) return null;
  try {
    const me = await telegramCall<{ id: number; username?: string; first_name?: string }>(
      'getMe'
    );
    cachedBotIdentity = {
      id: me.id,
      username: me.username ?? null,
      firstName: me.first_name ?? null,
    };
    return cachedBotIdentity;
  } catch {
    return cachedBotIdentity;
  }
}

export async function getTelegramWebhookInfo(): Promise<{ url: string | null }> {
  if (!getTelegramToken()) return { url: null };
  try {
    const info = await telegramCall<{ url?: string }>('getWebhookInfo');
    return { url: info.url && info.url.trim().length > 0 ? info.url : null };
  } catch {
    return { url: null };
  }
}

export async function registerTelegramWebhook(webhookUrl: string): Promise<void> {
  if (pollingRunning) {
    stopTelegramPolling();
  }
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  const payload: Record<string, unknown> = {
    url: webhookUrl,
    allowed_updates: ['message'],
  };
  if (secret && secret !== 'MY_TELEGRAM_WEBHOOK_SECRET') {
    payload.secret_token = secret;
  }
  await telegramCall('setWebhook', payload);
}

export async function clearTelegramWebhook(): Promise<void> {
  await telegramCall('deleteWebhook', { drop_pending_updates: false });
}

export async function handleTelegramUpdate(
  update: TelegramUpdate,
  mode: 'webhook' | 'polling'
): Promise<void> {
  const msg = update.message;
  if (!msg) return;

  const config = getConfig();
  const features = config.features;
  const chatId = String(msg.chat.id);
  const chatTitle = msg.chat.title || msg.from?.first_name || 'Private Chat';
  const isGroupChat = msg.chat.type === 'group' || msg.chat.type === 'supergroup';

  const isAnonymousAdmin =
    isGroupChat &&
    (msg.from?.id === GROUP_ANONYMOUS_BOT_ID || msg.sender_chat?.id === msg.chat.id);
  const isChannelSender =
    msg.from?.id === CHANNEL_SENDER_BOT_ID || msg.sender_chat?.type === 'channel';

  const senderName = isAnonymousAdmin
    ? msg.sender_chat?.title || 'Group Admin'
    : isChannelSender
    ? msg.sender_chat?.title || 'Channel'
    : msg.from?.first_name || msg.from?.username || 'Dost';

  const rawText = (msg.text || msg.caption || '').trim();

  try {
    // 1. New Member Welcome (Group / Supergroup)
    if (msg.new_chat_members && msg.new_chat_members.length > 0) {
      if (!features.welcomeEnabled) return;
      const newcomers = msg.new_chat_members
        .filter((u) => !u.is_bot && (!cachedBotIdentity || u.id !== cachedBotIdentity.id))
        .slice(0, 3);

      for (const member of newcomers) {
        const newcomerName = member.first_name || member.username || 'Dost';
        try {
          const welcomeText = await generateWelcomeMessage({
            config,
            newMemberName: newcomerName,
            groupTitle: chatTitle,
          });
          await telegramCall('sendMessage', {
            chat_id: msg.chat.id,
            text: welcomeText,
            reply_parameters: {
              message_id: msg.message_id,
              allow_sending_without_reply: true,
            },
          });
          const welcomeGif = await resolveGifForDecision(
            'blush',
            config,
            getRecentGifIds()
          );
          if (welcomeGif && config.gifChance > 0) {
            pushRecentGifId(welcomeGif.id);
            await telegramCall('sendAnimation', {
              chat_id: msg.chat.id,
              animation: welcomeGif.url,
            }).catch(() => {});
          }
          appendLog({
            id: `log-welcome-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            timestamp: new Date().toISOString(),
            chatId,
            chatTitle,
            senderName: newcomerName,
            incomingText: '[Joined Group]',
            actionSummary: welcomeGif ? 'Welcomed New Member · GIF' : 'Welcomed New Member',
            replyText: welcomeText,
            gifMood: welcomeGif?.mood ?? null,
            sentVoice: false,
            mode,
            status: 'ok',
          });
        } catch {
          // ignore welcome failure
        }
      }
      return;
    }

    // Ignore bot's own messages and other bots (but ALLOW Anonymous Group Admins & Channel posts!)
    if (cachedBotIdentity && msg.from?.id === cachedBotIdentity.id) return;
    if (msg.from?.is_bot && !isAnonymousAdmin && !isChannelSender) return;

    const isAdmin = isAnonymousAdmin
      ? true
      : isGroupChat && msg.from?.id
      ? await isChatAdminOrOwner(msg.chat.id, msg.from.id, msg.chat.type)
      : false;

    // 2. Auto Spam & Link Guard (Non-admins inside group chats only)
    if (
      isGroupChat &&
      !isAdmin &&
      !isChannelSender &&
      !msg.is_automatic_forward &&
      features.spamGuardEnabled &&
      msg.from?.id &&
      (rawText || hasUrlTelegramEntity(msg))
    ) {
      const spamCheck = detectSpamOrLink(rawText, hasUrlTelegramEntity(msg));
      if (spamCheck.isSpam) {
        await telegramCall('deleteMessage', {
          chat_id: msg.chat.id,
          message_id: msg.message_id,
        }).catch(() => {});

        const maxWarnings = Math.max(1, features.spamMaxWarnings || 3);
        const muteMinutes = Math.max(1, features.spamMuteMinutes || 15);
        const warnCount = incrementUserWarning(chatId, String(msg.from.id));

        let guardReply = '';
        let summary = '';

        if (warnCount >= maxWarnings) {
          const untilDate = Math.floor(Date.now() / 1000) + muteMinutes * 60;
          let mutedOk = false;
          try {
            await telegramCall('restrictChatMember', {
              chat_id: msg.chat.id,
              user_id: msg.from.id,
              until_date: untilDate,
              permissions: {
                can_send_messages: false,
                can_send_audios: false,
                can_send_documents: false,
                can_send_photos: false,
                can_send_videos: false,
                can_send_video_notes: false,
                can_send_voice_notes: false,
                can_send_polls: false,
                can_send_other_messages: false,
              },
            });
            mutedOk = true;
            resetUserWarning(chatId, String(msg.from.id));
          } catch {
            mutedOk = false;
          }

          guardReply = mutedOk
            ? `Bas bahut ho gaya ${senderName}! 😤 (${spamCheck.reason}) — ${maxWarnings}/${maxWarnings} warnings complete. Ab ${muteMinutes} min shaanti se baitho (muted) 🤫`
            : `Hey ${senderName}, ${spamCheck.reason} allowed nahi hai yahan! 😤 (${warnCount}/${maxWarnings} warnings — message uda diya 🗑️)`;
          summary = mutedOk
            ? `Spam Guard · Deleted & Muted (${muteMinutes}m)`
            : `Spam Guard · Deleted (${warnCount}/${maxWarnings})`;
        } else {
          guardReply = `Oye ${senderName}! Ye ${spamCheck.reason?.toLowerCase()} yahan allowed nahi hai 🙅‍♀️ Message delete kar diya — Warning ${warnCount}/${maxWarnings}, next time mute ho jaoge! 👀`;
          summary = `Spam Guard · Deleted (${warnCount}/${maxWarnings})`;
        }

        await telegramCall('sendMessage', {
          chat_id: msg.chat.id,
          text: guardReply,
        }).catch(() => {});

        appendLog({
          id: `log-guard-${Date.now()}`,
          timestamp: new Date().toISOString(),
          chatId,
          chatTitle,
          senderName,
          incomingText: rawText || '[Link/Spam Message]',
          actionSummary: summary,
          replyText: guardReply,
          sentVoice: false,
          mode,
          status: 'ok',
        });
        return;
      }
    }

    // 3. Owner & Group Admin Natural Language Control (STRICTLY group chats + verified Admins/Owner)
    if (
      isGroupChat &&
      isAdmin &&
      features.ownerAdminControlEnabled &&
      rawText
    ) {
      const adminIntent = parseAdminIntent(
        rawText,
        config.botName,
        Boolean(msg.reply_to_message)
      );
      if (adminIntent) {
        const targetMsg = msg.reply_to_message;
        const targetUser = targetMsg?.from;
        const targetName = targetUser?.first_name || targetUser?.username || 'member';
        let confirmReply = '';
        let summary = `Admin Control · ${adminIntent.action}`;

        try {
          if (adminIntent.action === 'pin') {
            if (!targetMsg) {
              confirmReply = 'Boss kis message ko pin karun? Us message pe reply karke bolo "pin kardo" 📌';
            } else {
              await telegramCall('pinChatMessage', {
                chat_id: msg.chat.id,
                message_id: targetMsg.message_id,
                disable_notification: false,
              });
              confirmReply = 'Done boss! Message pin kar diya 📌✨';
            }
          } else if (adminIntent.action === 'unpin') {
            await telegramCall('unpinChatMessage', {
              chat_id: msg.chat.id,
              ...(targetMsg ? { message_id: targetMsg.message_id } : {}),
            });
            confirmReply = 'Ho gaya boss! Unpin kar diya 👍';
          } else if (adminIntent.action === 'delete') {
            if (!targetMsg) {
              confirmReply = 'Kis message ko delete karun? Uspe reply karke bolo 🗑️';
            } else {
              await telegramCall('deleteMessage', {
                chat_id: msg.chat.id,
                message_id: targetMsg.message_id,
              });
              confirmReply = 'Uda diya wo message 🗑️✨';
            }
          } else if (adminIntent.action === 'mute') {
            if (!targetUser) {
              confirmReply = 'Kisko mute karna hai boss? Uske message pe reply karke bolo "mute 10 min" 🤫';
            } else {
              const mins = adminIntent.durationMinutes || features.spamMuteMinutes || 15;
              const untilDate = Math.floor(Date.now() / 1000) + mins * 60;
              await telegramCall('restrictChatMember', {
                chat_id: msg.chat.id,
                user_id: targetUser.id,
                until_date: untilDate,
                permissions: {
                  can_send_messages: false,
                  can_send_audios: false,
                  can_send_documents: false,
                  can_send_photos: false,
                  can_send_videos: false,
                  can_send_video_notes: false,
                  can_send_voice_notes: false,
                  can_send_polls: false,
                  can_send_other_messages: false,
                },
              });
              summary = `Admin Control · Muted ${targetName} (${mins}m)`;
              confirmReply = `Done boss! ${targetName} ko ${mins} min ke liye mute kar diya 🤫`;
            }
          } else if (adminIntent.action === 'unmute') {
            if (!targetUser) {
              confirmReply = 'Kisko unmute karun? Uske message pe reply karke bolo 😊';
            } else {
              await telegramCall('restrictChatMember', {
                chat_id: msg.chat.id,
                user_id: targetUser.id,
                permissions: {
                  can_send_messages: true,
                  can_send_audios: true,
                  can_send_documents: true,
                  can_send_photos: true,
                  can_send_videos: true,
                  can_send_video_notes: true,
                  can_send_voice_notes: true,
                  can_send_polls: true,
                  can_send_other_messages: true,
                },
              });
              resetUserWarning(chatId, String(targetUser.id));
              summary = `Admin Control · Unmuted ${targetName}`;
              confirmReply = `Bolne do ab ${targetName} ko — unmute kar diya! 😊✨`;
            }
          } else if (adminIntent.action === 'warn') {
            if (!targetUser) {
              confirmReply = 'Kisko warning du? Uske message pe reply karke bolo ⚠️';
            } else {
              const maxWarnings = Math.max(1, features.spamMaxWarnings || 3);
              const count = incrementUserWarning(chatId, String(targetUser.id));
              summary = `Admin Control · Warned ${targetName} (${count}/${maxWarnings})`;
              confirmReply = `⚠️ ${targetName}, admin ki taraf se official warning (${count}/${maxWarnings})! Sudhar jao warna mute pakka hai 👀`;
            }
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : 'Permission denied';
          confirmReply = `Boss ye action nahi ho paya (${errMsg}) — check karo mujhe right admin permission hai ya target bhi admin toh nahi 😅`;
          summary = `Admin Control · Failed (${adminIntent.action})`;
        }

        await telegramCall('sendMessage', {
          chat_id: msg.chat.id,
          text: confirmReply,
          reply_parameters: {
            message_id: msg.message_id,
            allow_sending_without_reply: true,
          },
        }).catch(() => {});

        appendLog({
          id: `log-admin-${Date.now()}`,
          timestamp: new Date().toISOString(),
          chatId,
          chatTitle,
          senderName,
          incomingText: rawText,
          actionSummary: summary,
          replyText: confirmReply,
          sentVoice: false,
          mode,
          status: 'ok',
        });
        return;
      }
    }

    // 4. Skip automatic channel forward mirror messages unless configured to reply to channel posts
    if (msg.is_automatic_forward && !config.replyToChannelPosts) {
      return;
    }

    // 5. Multimodal Vision (Photos / Memes / Stickers / GIFs) & Incoming Voice Note Listening
    let imagePart: { mimeType: string; data: string } | undefined;
    let incomingText = rawText;
    let isIncomingGif = false;
    const mediaTags: string[] = [];

    if (features.visionEnabled && msg.animation) {
      isIncomingGif = true;
      if (msg.animation.thumbnail?.file_id) {
        const downloaded = await downloadTelegramFile(msg.animation.thumbnail.file_id);
        if (downloaded) {
          imagePart = {
            mimeType: 'image/jpeg',
            data: downloaded.buffer.toString('base64'),
          };
          mediaTags.push('GIF Vision');
        }
      }
      if (!incomingText) {
        incomingText = '[Sent an animated GIF]';
      }
    } else if (features.visionEnabled && msg.photo && msg.photo.length > 0) {
      const sorted = [...msg.photo].sort((a, b) => (a.file_size ?? 0) - (b.file_size ?? 0));
      const chosen =
        sorted.filter((p) => (p.file_size ?? 0) <= 4 * 1024 * 1024).pop() ??
        sorted[sorted.length - 1];
      if (chosen) {
        const downloaded = await downloadTelegramFile(chosen.file_id);
        if (downloaded) {
          imagePart = {
            mimeType: 'image/jpeg',
            data: downloaded.buffer.toString('base64'),
          };
          mediaTags.push('Vision');
        }
      }
      if (!incomingText) {
        incomingText = '[Sent a photo/meme]';
      }
    } else if (features.visionEnabled && msg.sticker) {
      if (!msg.sticker.is_animated && !msg.sticker.is_video) {
        const downloaded = await downloadTelegramFile(msg.sticker.file_id);
        if (downloaded) {
          imagePart = {
            mimeType: 'image/webp',
            data: downloaded.buffer.toString('base64'),
          };
          mediaTags.push('Sticker Vision');
        }
      } else if (msg.sticker.thumbnail?.file_id) {
        const downloaded = await downloadTelegramFile(msg.sticker.thumbnail.file_id);
        if (downloaded) {
          imagePart = {
            mimeType: 'image/jpeg',
            data: downloaded.buffer.toString('base64'),
          };
          mediaTags.push('Sticker Vision');
        }
      }
      if (!incomingText) {
        incomingText = `[Sent a sticker ${msg.sticker.emoji || ''}]`.trim();
      }
    }

    if (features.voiceListenEnabled && (msg.voice || msg.audio)) {
      const fileId = msg.voice?.file_id || msg.audio?.file_id;
      const mimeType = msg.voice?.mime_type || msg.audio?.mime_type || 'audio/ogg';
      if (fileId) {
        const downloaded = await downloadTelegramFile(fileId);
        if (downloaded) {
          const transcript = await transcribeTelegramAudio({
            buffer: downloaded.buffer,
            mimeType,
          });
          if (transcript) {
            incomingText = incomingText
              ? `${incomingText}\n[Voice Note]: ${transcript}`
              : `[Voice Note]: ${transcript}`;
            mediaTags.push('Listened Voice');
          }
        }
      }
    }

    if (!incomingText && !imagePart) return;

    const history = getChatHistory(chatId);

    appendChatTurn(
      chatId,
      {
        id: `tg-${msg.message_id}`,
        senderName,
        senderUsername: msg.from?.username,
        text: incomingText,
        timestamp: new Date().toISOString(),
        role: 'user',
      },
      Math.max(10, config.maxHistoryMessages)
    );

    // 6. Anti-Flood Smart Cooldown (bypass for DMs, channel posts, direct mentions, or replies to Kritika)
    const lowerText = incomingText.toLowerCase();
    const botNameLower = config.botName.trim().toLowerCase();
    const botUserLower = cachedBotIdentity?.username?.toLowerCase();
    const mentionedBot =
      (botNameLower && lowerText.includes(botNameLower)) ||
      (botUserLower && lowerText.includes(`@${botUserLower}`));
    const repliedToBot =
      Boolean(cachedBotIdentity) && msg.reply_to_message?.from?.id === cachedBotIdentity?.id;

    const isDirectOrPrivate =
      !isGroupChat || Boolean(msg.is_automatic_forward) || Boolean(mentionedBot) || repliedToBot;

    if (
      shouldThrottleByCooldown({
        lastReplyMs: lastReplyTimestamps.get(chatId),
        nowMs: Date.now(),
        cooldownSeconds: features.cooldownSeconds,
        isDirectOrPrivate,
      })
    ) {
      return;
    }

    // Show typing indicator immediately
    telegramCall('sendChatAction', {
      chat_id: msg.chat.id,
      action: 'typing',
    }).catch(() => {});

    const userMemories = features.memoryEnabled ? getChatMemories(chatId) : [];

    const decision = await generateKritikaDecision({
      config,
      history,
      incomingUser: { name: senderName, text: incomingText },
      imagePart,
      userMemories,
      allowPoll: features.pollsEnabled,
      isChannelPost: Boolean(msg.is_automatic_forward),
      isIncomingGif,
    });

    // Save per-user long-term memory
    if (
      features.memoryEnabled &&
      msg.from?.id &&
      !isAnonymousAdmin &&
      !isChannelSender &&
      !msg.is_automatic_forward
    ) {
      upsertUserMemory({
        chatId,
        userId: String(msg.from.id),
        name: senderName,
        username: msg.from.username,
        note: decision.memoryNote,
      });
    }

    // 1. Reaction Emoji
    if (decision.reactionEmoji) {
      await telegramCall('setMessageReaction', {
        chat_id: msg.chat.id,
        message_id: msg.message_id,
        reaction: [{ type: 'emoji', emoji: decision.reactionEmoji }],
      }).catch(() => {});
    }

    // 2. Text Reply
    let didReply = false;
    if (decision.shouldReply && decision.replyText) {
      await telegramCall('sendMessage', {
        chat_id: msg.chat.id,
        text: decision.replyText,
        reply_parameters: {
          message_id: msg.message_id,
          allow_sending_without_reply: true,
        },
      });
      didReply = true;
    }

    // 3. Interactive Poll / Mini-Game
    let sentPoll = false;
    if (features.pollsEnabled && decision.poll) {
      try {
        await telegramCall('sendPoll', {
          chat_id: msg.chat.id,
          question: decision.poll.question,
          options: decision.poll.options.map((text) => ({ text })),
          is_anonymous: false,
        });
        sentPoll = true;
        didReply = true;
      } catch {
        // Ignore poll failure if chat restricts polls
      }
    }

    // 4. GIF Animation
    const pickedGif = await resolveGifForDecision(
      decision.gifMood,
      config,
      getRecentGifIds()
    );
    if (pickedGif) {
      pushRecentGifId(pickedGif.id);
      await telegramCall('sendAnimation', {
        chat_id: msg.chat.id,
        animation: pickedGif.url,
        reply_parameters: {
          message_id: msg.message_id,
          allow_sending_without_reply: true,
        },
      }).catch(() => {});
      didReply = true;
    }

    // 5. Voice Note (Hindi/Hinglish/English)
    let sentVoice = false;
    if (decision.sendVoice && decision.voiceText && isGeminiTtsConfigured()) {
      try {
        telegramCall('sendChatAction', {
          chat_id: msg.chat.id,
          action: 'record_voice',
        }).catch(() => {});

        const synthesized = await synthesizeKritikaVoice({
          text: decision.voiceText,
          voiceName: config.voiceName,
          preferOggOpus: true,
        });

        const form = new FormData();
        form.append('chat_id', chatId);
        form.append(
          'reply_parameters',
          JSON.stringify({
            message_id: msg.message_id,
            allow_sending_without_reply: true,
          })
        );

        const blob = new Blob([new Uint8Array(synthesized.buffer)], {
          type: synthesized.mimeType,
        });

        if (synthesized.mimeType === 'audio/ogg') {
          form.append('voice', blob, synthesized.filename);
          await telegramCall('sendVoice', form, undefined, 25000);
        } else {
          form.append('audio', blob, synthesized.filename);
          await telegramCall('sendAudio', form, undefined, 25000);
        }
        sentVoice = true;
        didReply = true;
      } catch {
        // Keep text/reaction/GIF delivery intact if TTS has a transient error
      }
    }

    if (didReply) {
      lastReplyTimestamps.set(chatId, Date.now());
    }

    if (decision.replyText) {
      appendChatTurn(
        chatId,
        {
          id: `tg-bot-${Date.now()}`,
          senderName: config.botName,
          text: decision.replyText,
          timestamp: new Date().toISOString(),
          role: 'assistant',
          reactionEmoji: decision.reactionEmoji,
          poll: sentPoll ? decision.poll ?? null : null,
        },
        Math.max(10, config.maxHistoryMessages)
      );
    }

    const actions: string[] = [...mediaTags];
    if (msg.is_automatic_forward) actions.push('Channel Post');
    if (decision.reactionEmoji) actions.push(`Reacted ${decision.reactionEmoji}`);
    if (decision.shouldReply && decision.replyText) actions.push('Replied');
    if (sentPoll) actions.push('Sent Poll');
    if (pickedGif) actions.push(`Sent ${pickedGif.mood} GIF`);
    if (sentVoice) actions.push('Sent Voice Note');
    if (decision.memoryNote && features.memoryEnabled) actions.push('Saved Memory');
    if (actions.length === 0) actions.push('Observed only');

    appendLog({
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      chatId,
      chatTitle,
      senderName,
      incomingText,
      actionSummary: actions.join(' · '),
      replyText: decision.replyText,
      reactionEmoji: decision.reactionEmoji,
      gifMood: pickedGif?.mood ?? null,
      sentVoice,
      mode,
      status: 'ok',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error handling update';
    appendLog({
      id: `log-err-${Date.now()}`,
      timestamp: new Date().toISOString(),
      chatId,
      chatTitle,
      senderName,
      incomingText: rawText || '[Media/Event]',
      actionSummary: 'Failed to respond',
      sentVoice: false,
      mode,
      status: 'error',
      errorMessage: message,
    });
  }
}

async function pollLoop(): Promise<void> {
  while (pollingRunning) {
    try {
      pollingAbortController = new AbortController();
      // Hard 35s timeout prevents stalled TCP sockets after container hibernation/resume
      const updates = await telegramCall<TelegramUpdate[]>(
        'getUpdates',
        {
          offset: pollingOffset,
          timeout: 25,
          allowed_updates: ['message'],
        },
        pollingAbortController.signal,
        35000
      );

      lastPollingError = null;
      for (const update of updates) {
        pollingOffset = Math.max(pollingOffset, update.update_id + 1);
        void handleTelegramUpdate(update, 'polling');
      }
    } catch (err) {
      if (!pollingRunning) break;
      const msg = err instanceof Error ? err.message : 'Polling error';
      // Abort from 35s socket watchdog is normal self-healing; retry immediately
      if (/abort/i.test(msg)) {
        continue;
      }
      lastPollingError = msg;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

export async function startTelegramPolling(): Promise<void> {
  if (!getTelegramToken()) {
    throw new Error('Cannot start polling without TELEGRAM_BOT_TOKEN in server secrets.');
  }
  if (pollingRunning) return;

  await fetchTelegramBotInfo();
  // Telegram rejects getUpdates if a webhook is currently registered
  await clearTelegramWebhook().catch(() => {});

  pollingRunning = true;
  lastPollingError = null;
  updateConfig({ pollingEnabled: true });
  void pollLoop();
}

export function stopTelegramPolling(): void {
  pollingRunning = false;
  if (pollingAbortController) {
    pollingAbortController.abort();
    pollingAbortController = null;
  }
  updateConfig({ pollingEnabled: false });
}
