import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { dictionary, normalizeLocale, normalizeTheme, translate } from '../lib/studyhub/i18n.ts';
import { formatDate } from '../lib/studyhub/client-utils.ts';

test('Kazakh dates use real month names and the college time zone', () => {
  assert.equal(formatDate('2026-10-30', 'kk'), '30 қазан');
  assert.equal(formatDate('2026-11-06', 'kk'), '6 қараша');
  assert.equal(formatDate('2026-10-31T18:59:00Z', 'kk'), '31 қазан');
  assert.equal(formatDate('2026-10-31T19:00:00Z', 'kk'), '1 қараша');
  assert.equal(formatDate('2026-12-31T20:00:00Z', 'kk'), '1 қаңтар');
  assert.equal(formatDate('2024-02-29', 'kk'), '29 ақпан');
  assert.equal(formatDate(null, 'kk'), '—');
  assert.equal(formatDate('2026-11-06', 'en'), '6 November');
  assert.equal(formatDate('2026-11-06', 'ru'), '6 ноября');
});

test('Kazakh dates work when the browser has incomplete Kazakh ICU data', async (context) => {
  const NativeDateTimeFormat = Intl.DateTimeFormat;
  context.mock.method(Intl, 'DateTimeFormat', function (locale, options) {
    if (locale === 'kk-KZ') return { format: () => 'M10 30' };
    return new NativeDateTimeFormat(locale, options);
  });
  const limitedBrowser = await import('../lib/studyhub/client-utils.ts?limited-icu');
  assert.equal(limitedBrowser.formatDate('2026-10-30', 'kk'), '30 қазан');
  assert.equal(limitedBrowser.formatDate('2026-11-06', 'kk'), '6 қараша');
});

test('preferences accept supported values and use safe defaults', () => {
  for (const locale of ['ru', 'kk', 'en']) assert.equal(normalizeLocale(locale), locale);
  for (const value of [undefined, null, '', 'kz', 'fr', '<script>']) {
    assert.equal(normalizeLocale(value), 'ru');
  }
  assert.equal(normalizeTheme('dark'), 'dark');
  assert.equal(normalizeTheme('light'), 'light');
  assert.equal(normalizeTheme('unknown'), 'light');
});

test('translations preserve values, zero, unknown text and unresolved placeholders', () => {
  assert.equal(translate('Сохранить', 'kk'), 'Сақтау');
  assert.equal(translate('Сохранить', 'en'), 'Save');
  assert.equal(translate('Оценка {value0} из 100', 'en', { value0: 0 }), 'Score: 0 out of 100');
  assert.equal(translate('Изменить: {name}', 'en', { name: 'Жанар <A>' }), 'Edit: Жанар <A>');
  assert.equal(translate('Изменить: {name}', 'en'), 'Edit: {name}');
  assert.equal(translate('Моё собственное название 123', 'en'), 'Моё собственное название 123');
  assert.equal(translate('constructor', 'en'), 'constructor');
  assert.equal(
    translate(translate('Неверная почта или пароль.', 'en'), 'kk'),
    'Пошта немесе құпиясөз дұрыс емес.',
  );
});

test('every translation is filled and preserves interpolation parameters', () => {
  const parameters = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const [source, translations] of Object.entries(dictionary)) {
    assert.equal(translations.length, 2, source);
    for (const translated of translations) {
      assert.ok(translated.trim(), source);
      assert.deepEqual(parameters(translated), parameters(source), source);
    }
  }
});

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const lists = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? sourceFiles(path) : /\.[jt]sx?$/.test(entry.name) ? [path] : [];
    }),
  );
  return lists.flat();
}

test('static UI translation calls have dictionary entries and JSX has no untranslated Russian', async () => {
  const files = (await Promise.all(['app', 'components/studyhub'].map(sourceFiles))).flat();
  const missing = new Set();
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const checkArgument = (node) => {
      if (
        ts.isStringLiteralLike(node) &&
        /[А-Яа-яЁё]/.test(node.text) &&
        !Object.hasOwn(dictionary, node.text)
      ) {
        missing.add(`${file}: ${node.text}`);
      }
      ts.forEachChild(node, checkArgument);
    };
    const visit = (node) => {
      if (
        ts.isCallExpression(node) &&
        ['t', 'translate', 'pageMetadata'].includes(node.expression.getText(tree)) &&
        node.arguments[0]
      ) {
        checkArgument(node.arguments[0]);
      }
      if (
        ts.isJsxText(node) &&
        /[А-Яа-яЁё]/.test(node.text) &&
        !['Русский', 'Қазақша'].includes(node.text.trim())
      ) {
        missing.add(`${file}: untranslated JSX: ${node.text.trim()}`);
      }
      if (
        ts.isJsxAttribute(node) &&
        node.initializer &&
        ts.isStringLiteral(node.initializer) &&
        /[А-Яа-яЁё]/.test(node.initializer.text)
      ) {
        missing.add(`${file}: untranslated attribute: ${node.initializer.text}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  assert.deepEqual([...missing], []);
});
