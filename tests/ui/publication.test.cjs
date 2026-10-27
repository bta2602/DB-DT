/* eslint-disable @typescript-eslint/no-require-imports -- This .cjs test uses Node's CommonJS module format. */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const publicDir = path.resolve(__dirname, '../../public/studyhub');
const tokensPath = path.join(publicDir, 'tokens.css');

function publicSources() {
  assert.ok(fs.existsSync(publicDir), 'Frontend public/ directory must exist');
  function walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : /\.(?:js|mjs|html|css)$/i.test(entry.name) ? [full] : [];
    });
  }
  return walk(publicDir).map(file => ({ file, text: fs.readFileSync(file, 'utf8') }));
}

test('publication has an entry page and the expected ES module files', () => {
  for (const name of ['index.html', 'app.js', 'api.js', 'logic.js']) {
    const file = path.join(publicDir, name);
    assert.ok(fs.existsSync(file), `${name} is missing`);
    assert.ok(fs.statSync(file).size > 0, `${name} is empty`);
  }
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  assert.match(html, /<script\b[^>]*\btype\s*=\s*["']module["']/i, 'App must load as an ES module');
  assert.match(html, /<html\b[^>]*\blang\s*=\s*["']ru["']/i, 'Page language should be explicit');
  assert.match(html, /name\s*=\s*["']viewport["']/i, 'Mobile viewport is required');
});

test('every publication JavaScript file passes node syntax checking', () => {
  const files = publicSources().filter(entry => /\.(?:js|mjs)$/i.test(entry.file));
  assert.ok(files.length >= 3, 'Expected frontend app, API adapter and logic modules');
  for (const { file } of files) {
    const result = spawnSync(process.execPath, ['--check', file], {
      encoding: 'utf8', windowsHide: true, timeout: 10000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${path.basename(file)}: ${result.stderr || result.stdout}`);
  }
});

test('publication does not include the old role switch or fixture generators', () => {
  for (const { file, text } of publicSources()) {
    const label = path.relative(publicDir, file);
    assert.doesNotMatch(text, /\brole-select\b/, `${label}: old role switch remains`);
    assert.doesNotMatch(text, /\bstudyhub-ui-prototype-v1\b/, `${label}: old local storage namespace remains`);
    assert.doesNotMatch(text, /\b(?:initialAccounts|initialTasks|seedStudents|seedGrades|seedAttendance|seedSubmissions)\b/, `${label}: old synthetic data loader remains`);
    assert.doesNotMatch(text, /studyhub\.demo|А\. К\. Нурланова|ИС-23-1|ИС-24-1|2026-10-(?:2[2-9]|30)/, `${label}: old synthetic school records remain`);
  }
});

test('publication does not write credentials or old school-state objects to browser storage', () => {
  for (const { file, text } of publicSources().filter(entry => /\.(?:js|mjs)$/i.test(entry.file))) {
    const label = path.relative(publicDir, file);
    assert.doesNotMatch(text, /(?:localStorage|sessionStorage)\s*\.\s*setItem\s*\(\s*["'`](?:password|accessToken|refreshToken|authToken|gradeBook|submissions|attendance)["'`]/i, `${label}: sensitive state is persisted in browser storage`);
    assert.doesNotMatch(text, /localStorage\s*\.\s*setItem\s*\(\s*STORE\s*,\s*JSON\.stringify\s*\(\s*\{\s*tasks\b/, `${label}: whole old school state is still persisted locally`);
  }
});

function luminance(hex) {
  const rgb = hex.replace('#', '').match(/../g).map(pair => parseInt(pair, 16) / 255);
  const linear = rgb.map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('palette text and focus tokens meet the intended contrast ratios', () => {
  const css = fs.readFileSync(tokensPath, 'utf8');
  const colors = Object.fromEntries([...css.matchAll(/--([a-z-]+):\s*(#[\da-f]{6})\s*;/gi)].map(match => [match[1], match[2]]));
  for (const [foreground, background] of [
    ['ink', 'white'], ['ink', 'bg'], ['muted', 'white'], ['muted', 'bg'],
    ['white', 'green'], ['green', 'soft'], ['amber', 'amber-bg'],
    ['blue', 'blue-bg'], ['red', 'red-bg'],
  ]) {
    assert.ok(colors[foreground] && colors[background], 'Color token missing');
    const ratio = contrast(colors[foreground], colors[background]);
    assert.ok(ratio >= 4.5, `${foreground}/${background}: ${ratio.toFixed(2)} must be at least 4.5`);
  }
  assert.ok(contrast(colors.focus, colors.white) >= 3, 'Focus must be distinguishable on white');
  assert.ok(contrast(colors['control-border'], colors.white) >= 3, 'Control boundary must be distinguishable');
});
