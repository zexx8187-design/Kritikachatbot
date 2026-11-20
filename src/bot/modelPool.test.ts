import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOrderedFailoverPool,
  classifyGeminiError,
  isAllowedFreeTierChatModel,
  isGemmaModel,
} from './modelPool';

test('isAllowedFreeTierChatModel allows current free Gemini/Gemma models and blocks deprecated or paid-only models', () => {
  assert.equal(isAllowedFreeTierChatModel('gemini-3.1-flash-lite'), true);
  assert.equal(isAllowedFreeTierChatModel('gemini-4-hydrogen'), true);
  assert.equal(isAllowedFreeTierChatModel('gemini-2.5-flash'), true);
  assert.equal(isAllowedFreeTierChatModel('gemini-2.5-flash-lite'), true);
  assert.equal(isAllowedFreeTierChatModel('gemma-3-27b-it'), true);

  // Deprecated models strictly blocked
  assert.equal(isAllowedFreeTierChatModel('gemini-1.5-flash'), false);
  assert.equal(isAllowedFreeTierChatModel('gemini-2.0-flash'), false);
  assert.equal(isAllowedFreeTierChatModel('gemini-pro'), false);

  // Paid-only & specialized models blocked from free chat pool
  assert.equal(isAllowedFreeTierChatModel('gemini-4-neon'), false);
  assert.equal(isAllowedFreeTierChatModel('gemini-4-carbon'), false);
  assert.equal(isAllowedFreeTierChatModel('gemini-3.8-flash-lite-tts'), false);
  assert.equal(isAllowedFreeTierChatModel('gemini-3.5-transcribe'), false);
});

test('classifyGeminiError distinguishes daily quota, RPM, 503 overload, and 404 unavailable', () => {
  const daily = classifyGeminiError(
    new Error('429 RESOURCE_EXHAUSTED GenerateRequestsPerDayPerProjectPerModel-FreeTier Please retry in 18h41m48s')
  );
  assert.equal(daily.kind, 'quota');
  assert.equal(daily.shortReason, 'Daily limit reached');
  assert.ok(daily.cooldownMs >= 30 * 60 * 1000);

  const rpm = classifyGeminiError(
    new Error('429 RESOURCE_EXHAUSTED Please retry in 32s')
  );
  assert.equal(rpm.kind, 'quota');
  assert.equal(rpm.shortReason, 'Rate limit reached');
  assert.equal(rpm.cooldownMs, 32000);

  const busy = classifyGeminiError(new Error('503 UNAVAILABLE high demand'));
  assert.equal(busy.kind, 'transient');

  const missing = classifyGeminiError(new Error('404 NOT_FOUND model not found'));
  assert.equal(missing.kind, 'unavailable');
});

test('buildOrderedFailoverPool skips exhausted/unavailable models and rotates to next healthy model', () => {
  const now = 1_000_000;
  const cooldowns = new Map<string, { untilMs: number; kind: string }>([
    ['gemini-3.1-flash-lite', { untilMs: now + 600_000, kind: 'quota' }],
    ['gemini-4-hydrogen', { untilMs: now + 600_000, kind: 'quota' }],
    ['gemini-3-flash-preview', { untilMs: now + 600_000, kind: 'unavailable' }],
  ]);

  const ordered = buildOrderedFailoverPool({
    preferredModel: 'gemini-3.1-flash-lite',
    discoveredModels: ['gemini-2.5-flash', 'gemma-3-27b-it'],
    cooldowns,
    nowMs: now,
  });

  // First candidate should immediately be the first healthy non-exhausted model
  assert.equal(ordered[0], 'gemini-3.5-flash-lite');
  assert.equal(ordered[1], 'gemini-3.5-flash');
  assert.ok(!ordered.includes('gemini-3-flash-preview'));
  assert.equal(isGemmaModel('gemma-3-27b-it'), true);

  // Vision requests exclude Gemma models
  const visionOrdered = buildOrderedFailoverPool({
    preferredModel: 'auto',
    cooldowns: new Map(),
    nowMs: now,
    requireVision: true,
  });
  assert.ok(visionOrdered.every((m) => !isGemmaModel(m)));
});
