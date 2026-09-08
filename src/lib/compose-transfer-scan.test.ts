import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  composeTransferRoleForIndex,
  fallbackComposeTransferInstruction,
  normalizeComposeTransferRecipe,
  parseComposeTransferInstruction,
} from './compose-transfer-scan';

describe('compose-transfer-scan helpers', () => {
  it('normalizes recipes and roles', () => {
    assert.equal(normalizeComposeTransferRecipe('people-from-1-pose-from-2'), 'people-from-1-pose-from-2');
    assert.equal(normalizeComposeTransferRecipe('nope'), 'pose-from-1-people-from-rest');
    assert.deepEqual(composeTransferRoleForIndex(1, 'pose-from-1-people-from-rest'), {
      role: 'structure',
      focus: 'subject',
    });
    assert.deepEqual(composeTransferRoleForIndex(2, 'pose-from-1-people-from-rest'), {
      role: 'primary',
      focus: 'subject',
    });
    assert.deepEqual(composeTransferRoleForIndex(1, 'people-from-1-pose-from-2'), {
      role: 'primary',
      focus: 'subject',
    });
  });

  it('parses JSON instruction payloads', () => {
    assert.equal(
      parseComposeTransferInstruction('{"prompt":"Use pose from Image 1. People from Image 2."}'),
      'Use pose from Image 1. People from Image 2.'
    );
    assert.equal(
      parseComposeTransferInstruction('plain transfer text'),
      'plain transfer text'
    );
  });

  it('builds a deterministic fallback transfer instruction', () => {
    const prompt = fallbackComposeTransferInstruction(
      [
        { index: 1, role: 'structure', prompt: 'a runner mid-stride facing left' },
        { index: 2, role: 'primary', prompt: 'a woman with red hair in a green jacket' },
        { index: 3, role: 'primary', prompt: 'a man with glasses' },
      ],
      'pose-from-1-people-from-rest'
    );
    assert.match(prompt, /pose.*Image 1/i);
    assert.match(prompt, /Image 2 and Image 3/i);
  });
});
