#!/usr/bin/env node
/**
 * Smoke-check docker-compose.yml exposed profile without requiring the Compose plugin.
 * Fails if auth secrets are not required or ports are loopback-bound under exposed.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(resolve(root, 'docker-compose.yml'), 'utf8');

function fail(message) {
  console.error(`validate-compose-exposed: ${message}`);
  process.exit(1);
}

if (!/profiles:\s*\[\s*['"]exposed['"]\s*\]/.test(raw)) {
  fail('prompt-tools-exposed must declare profiles: [exposed]');
}

if (!/PROMPT_AUTH_ENABLED:\s*['"]true['"]/.test(raw)) {
  fail('exposed service must set PROMPT_AUTH_ENABLED: true');
}

if (!/PROMPT_EXPOSED:\s*['"]true['"]/.test(raw)) {
  fail('exposed service must set PROMPT_EXPOSED: true (fail-closed auth gate)');
}

for (const key of [
  'PROMPT_SESSION_SECRET',
  'PROMPT_ADMIN_PASSWORD',
  'PROMPT_API_TOKEN',
  'PROMPT_API_URL',
]) {
  const required = new RegExp(`${key}:\\s*\\$\\{${key}:\\?`);
  if (!required.test(raw)) {
    fail(`exposed service must require ${key} via \${${key}:?…}`);
  }
}

if (!/COMFYUI_ALLOW_CLIENT_URL:\s*['"]false['"]/.test(raw)) {
  fail('exposed service must set COMFYUI_ALLOW_CLIENT_URL: false');
}

// Exposed publish must not be loopback-only (127.0.0.1:…).
const exposedBlock = raw.split('prompt-tools-exposed:')[1]?.split(/\n  [a-z]/)[0] ?? '';
if (!exposedBlock.includes("'47832:47832'") && !exposedBlock.includes('"47832:47832"')) {
  fail('exposed service must publish 47832:47832 (not loopback-only)');
}
if (/127\.0\.0\.1:47832:47832/.test(exposedBlock)) {
  fail('exposed service must not bind 127.0.0.1 for published ports');
}

console.log('validate-compose-exposed: ok');
