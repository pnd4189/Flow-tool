// Source scans for mistakes the type checker cannot see. Run through check-snapshot.sh.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const sourceDir = join(process.env.TOOL_DIR ?? '', 'source');
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}
const files = walk(sourceDir).map(path => ({ name: relative(sourceDir, path), text: readFileSync(path, 'utf8') }));

const failures: string[] = [];
function scan(title: string, pattern: RegExp, only?: (name: string) => boolean) {
  const hits: string[] = [];
  for (const file of files) {
    if (only && !only(file.name)) continue;
    file.text.split('\n').forEach((line, index) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      if (pattern.test(line)) hits.push(`${file.name}:${index + 1}`);
    });
  }
  if (hits.length) failures.push(`${title}: ${hits.join(', ')}`);
}

// Sandbox rules of Flow tools: no durable storage, no modal dialogs, no download links, no ZIP.
// The i18n dictionary only holds display strings ("Xem prompt (Ctrl+Enter)"), so it is skipped.
scan('forbidden browser API', /\b(localStorage|sessionStorage|indexedDB)\b|\b(window\.)?(confirm|alert|prompt)\s*\(|\bJSZip\b|download\s*=\s*['"{]/, name => name !== 'services/i18n.ts');

// React applies a state updater later, so assigning an outer variable inside it leaves that variable
// empty when it is read right away (this made "Khoá khuôn mặt" always fail). Read state through a ref.
for (const file of files) {
  const updater = /set[A-Z]\w*\(\s*\(?\s*(\w+)\s*\)?\s*=>\s*\{[^}]*?\b\w+\s*=\s*(\[\s*\.\.\.\1\s*\]|\1)\s*;[^}]*?return\s+\1\s*;?\s*\}\s*\)/g;
  if (updater.test(file.text)) failures.push(`state read through a setState updater in ${file.name}`);
}

// The language is chosen through t() keys, never inline.
scan('inline language ternary', /lang\s*===\s*['"](vi|en)['"]\s*\?/, name => name.startsWith('components/'));

if (failures.length) {
  console.error(`${failures.length} failing check(s):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
process.exit(0);
