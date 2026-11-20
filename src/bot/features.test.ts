import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectSpamOrLink,
  detectUserWantsPoll,
  formatMemoryContext,
  mergeUserMemory,
  parseAdminIntent,
  shouldThrottleByCooldown,
  validatePollPayload,
} from './features';

test('detectSpamOrLink flags unauthorized URLs, Telegram invite links, scams, and heavy abuse', () => {
  assert.equal(detectSpamOrLink('Join now https://t.me/mychannel').isSpam, true);
  assert.equal(detectSpamOrLink('Check www.scamsite.xyz for free money').isSpam, true);
  assert.equal(detectSpamOrLink('Guaranteed profit daily income crypto').isSpam, true);
  assert.equal(detectSpamOrLink('normal text', true).isSpam, true);
  assert.equal(detectSpamOrLink('Hey Kritika kya haal hai?').isSpam, false);
});

test('parseAdminIntent detects natural Hinglish/English admin commands accurately', () => {
  assert.deepEqual(
    parseAdminIntent('Kritika isko pin kar de', 'Kritika', true),
    { action: 'pin' }
  );
  assert.deepEqual(
    parseAdminIntent('unpin kar do', 'Kritika', true),
    { action: 'unpin' }
  );
  assert.deepEqual(
    parseAdminIntent('Kritika isko 20 min mute kar', 'Kritika', true),
    { action: 'mute', durationMinutes: 20 }
  );
  assert.deepEqual(
    parseAdminIntent('Kritika isko 2 hour mute kar', 'Kritika', true),
    { action: 'mute', durationMinutes: 120 }
  );
  assert.deepEqual(
    parseAdminIntent('unmute kar de', 'Kritika', true),
    { action: 'unmute' }
  );
  assert.deepEqual(
    parseAdminIntent('delete kar ye', 'Kritika', true),
    { action: 'delete' }
  );
  assert.equal(
    parseAdminIntent('Aaj mausam mast hai', 'Kritika', false),
    null
  );
});

test('shouldThrottleByCooldown respects cooldown in busy groups but never blocks direct mentions or DMs', () => {
  assert.equal(
    shouldThrottleByCooldown({
      lastReplyMs: 10000,
      nowMs: 12000,
      cooldownSeconds: 5,
      isDirectOrPrivate: false,
    }),
    true
  );
  assert.equal(
    shouldThrottleByCooldown({
      lastReplyMs: 10000,
      nowMs: 16000,
      cooldownSeconds: 5,
      isDirectOrPrivate: false,
    }),
    false
  );
  assert.equal(
    shouldThrottleByCooldown({
      lastReplyMs: 10000,
      nowMs: 11000,
      cooldownSeconds: 5,
      isDirectOrPrivate: true,
    }),
    false
  );
});

test('mergeUserMemory deduplicates notes and caps history cleanly', () => {
  let mem = mergeUserMemory(undefined, {
    userId: '101',
    chatId: '-1001',
    name: 'Aarav',
    note: 'Loves cricket',
  });
  mem = mergeUserMemory(mem, {
    userId: '101',
    chatId: '-1001',
    name: 'Aarav',
    note: 'loves cricket',
  });
  mem = mergeUserMemory(mem, {
    userId: '101',
    chatId: '-1001',
    name: 'Aarav',
    note: 'Teases Kritika often',
  });

  assert.equal(mem.interactions, 3);
  assert.deepEqual(mem.notes, ['Loves cricket', 'Teases Kritika often']);
  assert.match(formatMemoryContext([mem]), /Aarav \(3 msgs\): Loves cricket; Teases Kritika often/);
});

test('validatePollPayload validates Telegram poll constraints and detectUserWantsPoll works', () => {
  assert.equal(detectUserWantsPoll('Kritika ek funny poll banao!'), true);
  assert.equal(detectUserWantsPoll('Chalo Truth or Dare khelte hain'), true);
  assert.equal(detectUserWantsPoll('Kya kha rahi ho?'), false);

  const valid = validatePollPayload({
    question: 'Aaj ka plan kya hai?',
    options: ['Chai & Gossip', 'Late night gaming', 'Chai & Gossip', 'Movie'],
  });
  assert.deepEqual(valid, {
    question: 'Aaj ka plan kya hai?',
    options: ['Chai & Gossip', 'Late night gaming', 'Movie'],
  });

  assert.equal(validatePollPayload({ question: 'Only one?', options: ['Yes'] }), null);
});
