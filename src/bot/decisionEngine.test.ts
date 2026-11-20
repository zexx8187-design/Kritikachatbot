import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BOT_CONFIG } from './types';
import {
  buildKritikaSystemPrompt,
  buildOfflinePreviewReply,
  formatOpenRouterMessages,
  parseBotDecision,
  pickGifForMood,
  stripEmojisForSpeech,
  validateTelegramReaction,
} from './decisionEngine';

test('validateTelegramReaction keeps official Telegram reactions and maps common aliases', () => {
  assert.equal(validateTelegramReaction('❤️'), '❤️');
  assert.equal(validateTelegramReaction('🔥'), '🔥');
  assert.equal(validateTelegramReaction('😂'), '🤣');
  assert.equal(validateTelegramReaction('😉'), '🤪');
  assert.equal(validateTelegramReaction('unsupported_text'), null);
  assert.equal(validateTelegramReaction(null), null);
});

test('buildKritikaSystemPrompt includes Kritika identity, traits, languages, and JSON schema', () => {
  const prompt = buildKritikaSystemPrompt(DEFAULT_BOT_CONFIG);
  assert.match(prompt, /Kritika/);
  assert.match(prompt, /Hinglish/);
  assert.match(prompt, /"reactionEmoji"/);
  assert.match(prompt, /"sendVoice"/);
});

test('parseBotDecision parses fenced JSON from OpenRouter cleanly', () => {
  const raw = [
    '```json',
    JSON.stringify({
      shouldReply: true,
      replyText: 'Arre wah, bade dino baad dikhe!',
      reactionEmoji: '🔥',
      gifMood: 'flirty',
      sendVoice: true,
      voiceText: 'Arre wah, bade dino baad dikhe!',
    }),
    '```',
  ].join('\n');

  const decision = parseBotDecision(raw, DEFAULT_BOT_CONFIG, {
    userText: 'Hey Kritika!',
    randValues: { replyRoll: 10, reactRoll: 10, gifRoll: 10, voiceRoll: 5 },
  });

  assert.equal(decision.shouldReply, true);
  assert.equal(decision.replyText, 'Arre wah, bade dino baad dikhe!');
  assert.equal(decision.reactionEmoji, '🔥');
  assert.equal(decision.gifMood, 'flirty');
  assert.equal(decision.sendVoice, true);
  assert.equal(decision.voiceText, 'Arre wah, bade dino baad dikhe!');
});

test('parseBotDecision handles plain text output from uncensored OpenRouter models', () => {
  const raw = 'Haha sach mein? Tum bade naughty ho yaar 😜';
  const decision = parseBotDecision(raw, DEFAULT_BOT_CONFIG, {
    userText: 'Aaj voice note bhejo Kritika!',
    randValues: { replyRoll: 10, reactRoll: 20, gifRoll: 99, voiceRoll: 99 },
  });

  assert.equal(decision.shouldReply, true);
  assert.equal(decision.replyText, raw);
  assert.equal(decision.reactionEmoji, '🤣');
  assert.equal(decision.sendVoice, true);
  assert.equal(decision.voiceText, 'Haha sach mein? Tum bade naughty ho yaar');
});

test('pickGifForMood avoids recently sent GIFs when alternatives exist', () => {
  const library = [
    { id: 'g1', mood: 'laugh' as const, title: 'Laugh 1', url: 'https://example.com/1.gif', enabled: true },
    { id: 'g2', mood: 'laugh' as const, title: 'Laugh 2', url: 'https://example.com/2.gif', enabled: true },
  ];

  const picked = pickGifForMood('laugh', library, ['g1']);
  assert.equal(picked?.id, 'g2');
});

test('formatOpenRouterMessages preserves speaker tags and history limit', () => {
  const history = [
    {
      id: '1',
      senderName: 'Rohan',
      text: 'Kya haal hai sabke?',
      timestamp: '2026-01-01T00:00:00Z',
      role: 'user' as const,
    },
    {
      id: '2',
      senderName: 'Kritika',
      text: 'Main toh mast hoon!',
      timestamp: '2026-01-01T00:00:05Z',
      role: 'assistant' as const,
    },
  ];

  const formatted = formatOpenRouterMessages(DEFAULT_BOT_CONFIG, history, {
    name: 'Aarav',
    text: 'Aur Kritika kya chal raha?',
  });

  assert.equal(formatted[0].role, 'system');
  assert.equal(formatted[1].content, '[Rohan]: Kya haal hai sabke?');
  assert.equal(formatted[2].role, 'assistant');
  assert.equal(formatted[3].content, '[Aarav]: Aur Kritika kya chal raha?');
});

test('stripEmojisForSpeech and buildOfflinePreviewReply behave cleanly', () => {
  assert.equal(stripEmojisForSpeech('Heyy cutie 😉🔥'), 'Heyy cutie');
  const preview = buildOfflinePreviewReply('Ek voice note bhejo', 'Aarav', DEFAULT_BOT_CONFIG);
  assert.equal(preview.shouldReply, true);
  assert.equal(preview.sendVoice, true);
  assert.ok(preview.voiceText && preview.voiceText.length > 0);
});

test('DEFAULT_GIF_LIBRARY covers all 8 moods and incoming GIFs trigger mood-matched counter-GIFs', () => {
  const moods = ['flirty', 'laugh', 'blush', 'tease', 'love', 'shock', 'angry', 'bye'] as const;
  for (const mood of moods) {
    const count = DEFAULT_BOT_CONFIG.customGifLibrary.filter(
      (g) => g.mood === mood && g.enabled
    ).length;
    assert.ok(count >= 2, `Expected at least 2 enabled GIFs for mood "${mood}", got ${count}`);
  }

  const incomingGifDecision = parseBotDecision(
    JSON.stringify({
      shouldReply: true,
      replyText: 'Arey itna gussa mat karo yaar 😤',
      reactionEmoji: '😡',
      gifMood: null,
      sendVoice: false,
      voiceText: null,
    }),
    DEFAULT_BOT_CONFIG,
    {
      userText: '[Sent an animated GIF]',
      isIncomingGif: true,
      randValues: { replyRoll: 10, reactRoll: 10, gifRoll: 99, voiceRoll: 99 },
    }
  );
  assert.equal(incomingGifDecision.gifMood, 'angry');
});

