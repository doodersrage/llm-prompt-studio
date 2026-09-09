import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  COMPOSE_TRANSFER_RECIPE_IDS,
  COMPOSE_TRANSFER_RECIPE_OPTIONS,
  composeTransferRoleForIndex,
  composeTransferVisionHintForRole,
  fallbackComposeTransferInstruction,
  normalizeComposeTransferRecipe,
  parseComposeTransferInstruction,
} from './compose-transfer-scan-shared';

describe('compose-transfer-scan helpers', () => {
  it('lists every recipe in the UI catalog', () => {
    assert.equal(COMPOSE_TRANSFER_RECIPE_OPTIONS.length, COMPOSE_TRANSFER_RECIPE_IDS.length);
    for (const id of COMPOSE_TRANSFER_RECIPE_IDS) {
      assert.ok(COMPOSE_TRANSFER_RECIPE_OPTIONS.some(option => option.id === id));
      assert.equal(normalizeComposeTransferRecipe(id), id);
    }
  });

  it('normalizes recipes and roles', () => {
    assert.equal(normalizeComposeTransferRecipe('people-from-1-pose-from-2'), 'people-from-1-pose-from-2');
    assert.equal(normalizeComposeTransferRecipe('outfit-from-2'), 'outfit-from-2');
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
    assert.deepEqual(composeTransferRoleForIndex(2, 'outfit-from-2'), {
      role: 'wardrobe',
      focus: 'subject',
    });
    assert.deepEqual(composeTransferRoleForIndex(2, 'background-from-2'), {
      role: 'environment',
      focus: 'full',
    });
    assert.deepEqual(composeTransferRoleForIndex(2, 'style-from-2'), {
      role: 'look',
      focus: 'full',
    });
    assert.match(composeTransferVisionHintForRole('wardrobe'), /clothing/i);
  });

  it('parses JSON instruction payloads', () => {
    assert.equal(
      parseComposeTransferInstruction('{"prompt":"Use pose from Image 1. People from Image 2."}'),
      'Use pose from Image 1. People from Image 2.'
    );
    assert.equal(parseComposeTransferInstruction('plain transfer text'), 'plain transfer text');
  });

  it('builds deterministic fallback transfer instructions', () => {
    const parts = [
      { index: 1, role: 'structure', prompt: 'a runner mid-stride facing left' },
      { index: 2, role: 'primary', prompt: 'a woman with red hair in a green jacket' },
      { index: 3, role: 'primary', prompt: 'a man with glasses' },
    ];
    const posePeople = fallbackComposeTransferInstruction(parts, 'pose-from-1-people-from-rest');
    assert.match(posePeople, /pose.*Image 1/i);
    assert.match(posePeople, /Image 2 and Image 3/i);

    const outfit = fallbackComposeTransferInstruction(parts, 'outfit-from-2');
    assert.match(outfit, /outfit|clothing/i);
    assert.match(outfit, /Image 2/i);

    const background = fallbackComposeTransferInstruction(parts, 'background-from-2');
    assert.match(background, /background|environment/i);

    const style = fallbackComposeTransferInstruction(parts, 'style-from-2');
    assert.match(style, /lighting|look|grade/i);

    const hair = fallbackComposeTransferInstruction(parts, 'hair-from-2');
    assert.match(hair, /hair/i);

    const expression = fallbackComposeTransferInstruction(parts, 'expression-from-2');
    assert.match(expression, /expression|gaze/i);
  });
});
