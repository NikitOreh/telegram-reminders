import test from 'node:test';
import assert from 'node:assert/strict';
import { createUserState, parseOwnerIds } from './user-sessions.js';

test('OWNER_ID принимает несколько числовых ID через запятую', () => {
  assert.deepEqual(parseOwnerIds('111000111, 222000222,111000111'), [111000111, 222000222]);
  assert.throws(() => parseOwnerIds('111000111,пользователь'));
  assert.throws(() => parseOwnerIds(''));
});

test('черновики и режимы пользователей изолированы, старый черновик владельца сохранён', async () => {
  const data = { campaigns: [], draft: { sourceText: 'Старый пост' }, mode: 'button' };
  const { state, rawState, runForUser } = createUserState(data, 11);
  await Promise.all([
    runForUser(11, async () => {
      assert.equal(state.draft.sourceText, 'Старый пост');
      state.draft = { sourceText: 'Пост первого' };
      state.planNetwork = '1';
      state.planDay = '2026-10-02';
      state.planPage = 3;
      state.draftInfoMessageIds = [101, 102];
      state.draftPreviewMessageIds = [103, 104];
      state.copyPreviewMessageIds = [105];
      state.promptMessageId = 101;
      await Promise.resolve();
      assert.equal(state.mode, 'button');
    }),
    runForUser(22, async () => {
      assert.equal(state.draft, undefined);
      state.draft = { sourceText: 'Пост второго' };
      state.mode = 'photo';
      state.planNetwork = '2';
      state.planDay = '2026-10-03';
      state.planPage = 1;
      state.draftInfoMessageIds = [201];
      state.draftPreviewMessageIds = [203];
      state.copyPreviewMessageIds = [204, 205];
      state.promptMessageId = 202;
      await Promise.resolve();
      assert.equal(state.mode, 'photo');
    })
  ]);
  assert.equal(rawState.userSessions['11'].draft.sourceText, 'Пост первого');
  assert.equal(rawState.userSessions['22'].draft.sourceText, 'Пост второго');
  assert.equal(rawState.userSessions['11'].planNetwork, '1');
  assert.equal(rawState.userSessions['22'].planNetwork, '2');
  assert.equal(rawState.userSessions['11'].planPage, 3);
  assert.equal(rawState.userSessions['22'].planDay, '2026-10-03');
  assert.deepEqual(rawState.userSessions['11'].draftInfoMessageIds, [101, 102]);
  assert.deepEqual(rawState.userSessions['22'].draftInfoMessageIds, [201]);
  assert.deepEqual(rawState.userSessions['11'].draftPreviewMessageIds, [103, 104]);
  assert.deepEqual(rawState.userSessions['22'].draftPreviewMessageIds, [203]);
  assert.deepEqual(rawState.userSessions['11'].copyPreviewMessageIds, [105]);
  assert.deepEqual(rawState.userSessions['22'].copyPreviewMessageIds, [204, 205]);
  assert.equal(rawState.userSessions['11'].promptMessageId, 101);
  assert.equal(rawState.userSessions['22'].promptMessageId, 202);
  assert.equal(rawState.draft, undefined);
});
