import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import {
  availableFavorites,
  createBrowserStore,
  isAssignmentProgress,
  isFavoriteIds,
  progressForSteps,
  readLocal,
  removeLocal,
  storageKey,
  writeLocal,
} from '../lib/studyhub/browser-storage.ts';

const typescriptImports = registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (
        error.code !== 'ERR_MODULE_NOT_FOUND' ||
        !specifier.startsWith('.') ||
        !context.parentURL?.endsWith('.ts') ||
        /\.[a-z]+$/i.test(specifier)
      )
        throw error;
      return nextResolve(`${specifier}.ts`, context);
    }
  },
});
let useBrowserStorage;
try {
  ({ useBrowserStorage } = await import('../components/studyhub/use-browser-storage.ts'));
} finally {
  typescriptImports.deregister();
}

function browser(t, existing = []) {
  const values = new Map(existing);
  let writes = 0;
  let fail = false;
  const window = {
    localStorage: {
      getItem(key) {
        if (fail) throw new Error('Access denied');
        return values.get(key) ?? null;
      },
      setItem(key, value) {
        if (fail) throw new Error('Quota exceeded');
        writes++;
        values.set(key, value);
      },
      removeItem(key) {
        if (fail) throw new Error('Access denied');
        values.delete(key);
      },
    },
  };
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  });
  return {
    values,
    writes: () => writes,
    deny: () => (fail = true),
    allow: () => (fail = false),
  };
}

const text = (value) => typeof value === 'string';
const envelope = (value) => JSON.stringify({ version: 1, value });

test('server reads and construction never need window; keys encode each part', () => {
  const key = storageKey('one:two', 'filters', 'schedule');
  assert.equal(key, 'studyhub:v1:user:one%3Atwo:filters:schedule');
  assert.notEqual(storageKey('one', 'two:filters', 'schedule'), key);
  assert.throws(() => storageKey('', 'reviews'));
  assert.deepEqual(readLocal(key, text, ''), { value: '', status: 'unavailable' });
  assert.equal(writeLocal(key, 'draft'), false);
  assert.equal(removeLocal(key), false);
  const store = createBrowserStore(key, text, '');
  assert.deepEqual(store.getServerSnapshot(), { value: '', status: 'loading', ready: false });
  assert.equal(store.getSnapshot(), store.getServerSnapshot());
});

test('the actual React hook renders the same initial HTML without reading browser storage', (t) => {
  function Consumer() {
    const storage = useBrowserStorage({
      userId: 'one',
      area: 'reviews',
      fallback: '',
      validate: text,
    });
    return createElement('output', null, `${storage.status}:${storage.value}`);
  }
  const serverMarkup = renderToString(createElement(Consumer));
  const env = browser(t, [[storageKey('one', 'reviews'), envelope('a saved draft')]]);
  Object.defineProperty(globalThis.window, 'localStorage', {
    get() {
      throw new Error('Browser storage must not be read during rendering');
    },
  });
  assert.equal(renderToString(createElement(Consumer)), serverMarkup);
  assert.equal(serverMarkup, '<output>loading:</output>');
  assert.equal(env.writes(), 0);
});

test('read distinguishes empty, invalid JSON, invalid shape/version and unavailable storage', (t) => {
  const env = browser(t);
  assert.equal(readLocal('a', text, '').status, 'empty');
  for (const bad of ['{', 'null', '12', envelope(12), JSON.stringify({ version: 2, value: 'x' })]) {
    env.values.set('a', bad);
    assert.deepEqual(readLocal('a', text, ''), { value: '', status: 'invalid' });
  }
  env.values.set('a', envelope('restored'));
  assert.deepEqual(readLocal('a', text, ''), { value: 'restored', status: 'loaded' });
  env.deny();
  assert.equal(readLocal('a', text, '').status, 'unavailable');
});

test('hydration restores before edits and never overwrites storage with the fallback', (t) => {
  const key = storageKey('teacher-one', 'reviews');
  const env = browser(t, [[key, envelope('important unfinished comment')]]);
  const store = createBrowserStore(key, text, '');
  const changes = [];
  const unsubscribe = store.subscribe(() => changes.push(store.getSnapshot()));
  store.setValue('early event');
  assert.equal(env.writes(), 0);
  store.start();
  assert.equal(store.getSnapshot().value, 'important unfinished comment');
  assert.equal(store.getSnapshot().status, 'loaded');
  assert.equal(env.writes(), 0);
  assert.equal(changes.length, 1);
  // React's hydration snapshot remains identical to the server markup.
  assert.equal(store.getServerSnapshot().value, '');
  store.setValue((previous) => `${previous}!`);
  assert.equal(store.getSnapshot().status, 'saved');
  assert.equal(readLocal(key, text, '').value, 'important unfinished comment!');
  unsubscribe();
  store.stop();
});

test('closing a dialog and a fresh browser lifecycle restore unfinished input', (t) => {
  browser(t);
  const key = storageKey('one', 'reviews');
  const first = createBrowserStore(key, text, '');
  first.start();
  first.setValue('Unfinished');
  first.stop();
  const reopened = createBrowserStore(key, text, '');
  reopened.start();
  assert.deepEqual(reopened.getSnapshot(), { value: 'Unfinished', status: 'loaded', ready: true });
});

test('switching accounts hides the old snapshot and stale callbacks cannot write', (t) => {
  const env = browser(t);
  const a = storageKey('a', 'reviews');
  const b = storageKey('b', 'reviews');
  const first = createBrowserStore(a, text, '');
  first.start();
  first.setValue('A private draft');
  const staleCallback = first.setValue;
  first.stop();
  const second = createBrowserStore(b, text, '');
  assert.equal(second.getSnapshot().value, '');
  second.start();
  staleCallback('late response from user A');
  second.setValue('B private draft');
  assert.equal(readLocal(a, text, '').value, 'A private draft');
  assert.equal(readLocal(b, text, '').value, 'B private draft');
  assert.equal(env.writes(), 2);
});

test('access and quota failures retain in-memory edits and never report saved', (t) => {
  const env = browser(t);
  env.deny();
  const store = createBrowserStore(storageKey('a', 'reviews'), text, '');
  store.start();
  assert.equal(store.getSnapshot().status, 'unavailable');
  assert.equal(store.getSnapshot().ready, true);
  store.setValue('Copy this if storage stays unavailable');
  assert.equal(store.getSnapshot().status, 'error');
  assert.equal(store.getSnapshot().value, 'Copy this if storage stays unavailable');
  store.clear();
  assert.equal(store.getSnapshot().value, 'Copy this if storage stays unavailable');
  env.allow();
  store.setValue((value) => value);
  assert.equal(store.getSnapshot().status, 'saved');
});

test('clearing removes only the chosen key and does not recreate an empty saved draft', (t) => {
  const env = browser(t, [['unrelated', 'keep me']]);
  const key = storageKey('a', 'reviews');
  const store = createBrowserStore(key, text, '');
  store.start();
  store.setValue('draft');
  store.clear();
  assert.equal(env.values.get('unrelated'), 'keep me');
  assert.equal(env.values.has(key), false);
  assert.deepEqual(store.getSnapshot(), { value: '', ready: true, status: 'empty' });
  store.stop();
  assert.equal(env.values.has(key), false);
});

test('filters can reset in memory when storage removal fails, with an explicit error', (t) => {
  const key = storageKey('a', 'filters', 'schedule');
  const env = browser(t, [
    [key, envelope('filter')],
    ['other-user', 'untouched'],
  ]);
  const store = createBrowserStore(key, text, '');
  store.start();
  env.deny();
  store.reset();
  assert.deepEqual(store.getSnapshot(), { value: '', status: 'error', ready: true });
  assert.equal(env.values.get(key), envelope('filter'));
  assert.equal(env.values.get('other-user'), 'untouched');
  env.allow();
  store.reset();
  assert.equal(store.getSnapshot().status, 'empty');
  assert.equal(env.values.has(key), false);
});

test('progress validates indices and resets ticks after steps change while retaining the note', () => {
  const steps = ['Read', 'Solve'];
  const value = { note: 'My approach', completed: [0, 1], stepsSignature: JSON.stringify(steps) };
  assert.equal(isAssignmentProgress(value), true);
  for (const completed of [[0, 0], [-1], [2], [0.5], ['0']]) {
    assert.equal(isAssignmentProgress({ ...value, completed }), false);
  }
  assert.equal(isAssignmentProgress({ ...value, stepsSignature: 'bad json' }), false);
  assert.equal(progressForSteps(value, steps), value);
  assert.deepEqual(progressForSteps(value, ['New instructions']), {
    note: 'My approach',
    completed: [],
    stepsSignature: '["New instructions"]',
  });
});

test('favorites require unique string IDs and display only currently accessible materials', () => {
  assert.equal(isFavoriteIds(['one', 'two']), true);
  for (const value of [['one', 'one'], [''], [1], {}, null]) {
    assert.equal(isFavoriteIds(value), false);
  }
  assert.deepEqual(
    availableFavorites(['one', 'gone', 'secret', 'one'], [{ id: 'one' }, { id: 'two' }]),
    ['one'],
  );
});
