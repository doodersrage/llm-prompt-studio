#!/usr/bin/env node
/**
 * Fail if 'use client' modules import Node/server-only libraries.
 * Prevents webpack UnhandledSchemeError (node:crypto / node:fs) regressions.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');

const FORBIDDEN = [
  /from\s+['"]node:sqlite['"]/,
  /from\s+['"]node:fs['"]/,
  /from\s+['"]node:path['"]/,
  /from\s+['"]server-only['"]/,
  /from\s+['"]@\/lib\/fal-client['"]/,
  /from\s+['"]\.\.?\/.*fal-client['"]/,
  /from\s+['"]@\/lib\/replicate-client['"]/,
  /from\s+['"]\.\.?\/.*replicate-client['"]/,
  /from\s+['"]@\/lib\/llm-image-client['"]/,
  /from\s+['"]\.\.?\/.*llm-image-client['"]/,
  /from\s+['"]@\/lib\/llm-image-cache['"]/,
  /from\s+['"]\.\.?\/.*llm-image-cache['"]/,
  /from\s+['"]@\/lib\/llm-image-routes['"]/,
  /from\s+['"]\.\.?\/.*llm-image-routes['"]/,
  /from\s+['"]@\/lib\/comfyui-server-workflows['"]/,
  /from\s+['"]\.\.?\/.*comfyui-server-workflows['"]/,
  /from\s+['"]@\/lib\/export-encryption['"]/,
  /from\s+['"]@\/lib\/auth\/password['"]/,
  /from\s+['"]@\/lib\/auth\/session['"]/,
  /from\s+['"]@\/lib\/auth\/store['"]/,
  /from\s+['"](?:@\/lib\/|\.\.?\/)compose-transfer-scan['"]/,
];

/** Value imports of history-workflow (type-only is OK). */
const HISTORY_VALUE_IMPORT =
  /import\s+(?!type\s)\{[^}]*\}\s+from\s+['"][^'"]*comfyui-history-workflow['"]|import\s+(?!type\s)[A-Za-z_$][\w$]*\s+from\s+['"][^'"]*comfyui-history-workflow['"]/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(full);
  }
  return out;
}

function isClientFile(source) {
  return /^\s*['"]use client['"]\s*;?/m.test(source);
}

const files = walk(SRC);
const violations = [];

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  if (!isClientFile(source)) continue;
  const rel = relative(ROOT, file);
  for (const pattern of FORBIDDEN) {
    if (pattern.test(source)) {
      violations.push(`${rel}: matches ${pattern}`);
    }
  }
  if (HISTORY_VALUE_IMPORT.test(source)) {
    violations.push(`${rel}: value-import of comfyui-history-workflow (use /api/… instead)`);
  }
}

if (violations.length) {
  console.error('Client/server import boundary violations:\n');
  for (const line of violations) console.error(`  - ${line}`);
  console.error('\nMove Node/server work behind an API route or a non-client module.');
  process.exit(1);
}

console.log(
  `check-client-server-imports: ok (${files.filter(f => isClientFile(readFileSync(f, 'utf8'))).length} client files scanned)`
);
