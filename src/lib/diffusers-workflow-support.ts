import type { DiffusersClassifyResult } from './diffusers-client';

export type DiffusersSupportHint = {
  mode: 'native' | 'fallback' | 'unknown';
  label: string;
  detail: string;
};

export function formatDiffusersClassifyHint(
  result: DiffusersClassifyResult | null | undefined
): DiffusersSupportHint {
  if (!result) {
    return {
      mode: 'unknown',
      label: 'Diffusers classify unavailable',
      detail: 'Start the Diffusers engine or check DIFFUSERS_API_URL.',
    };
  }
  if (result.supported) {
    const img2img =
      typeof result.assets.init_image === 'string' && result.assets.init_image ? ' · img2img' : '';
    return {
      mode: 'native',
      label: `Native Diffusers · ${result.family}${img2img}`,
      detail: result.reason || 'Graph compiles for native execution.',
    };
  }
  const nodes =
    result.unsupportedNodes.length > 0
      ? ` Unsupported: ${result.unsupportedNodes.slice(0, 3).join(', ')}${result.unsupportedNodes.length > 3 ? '…' : ''}.`
      : '';
  return {
    mode: 'fallback',
    label: 'Comfy fallback likely',
    detail: `${result.reason || 'Workflow not natively supported.'}${nodes} Queue will use ComfyUI when fallback is enabled.`,
  };
}

/** Queue toast / status when Diffusers-first may have fallen through to Comfy. */
export function formatDiffusersQueueRouting(input: {
  preferredEngineId?: string | null;
  actualEngineId?: string | null;
  workflowSource?: string | null;
  family?: string | null;
  diffusersFallbackReason?: string | null;
}): { engineLabel: string; statusNote: string | null } {
  const preferred = (input.preferredEngineId || '').trim();
  const actual = (input.actualEngineId || preferred || '').trim();
  const fallback =
    actual === 'comfyui' &&
    (preferred === 'diffusers' ||
      input.workflowSource === 'comfy-fallback' ||
      Boolean(input.diffusersFallbackReason?.trim()));

  if (!fallback) {
    const family = input.family?.trim();
    return {
      engineLabel: actual || preferred || 'engine',
      statusNote:
        actual === 'diffusers' && family
          ? `native Diffusers · ${family}`
          : actual === 'diffusers'
            ? 'native Diffusers'
            : null,
    };
  }

  const reason = (input.diffusersFallbackReason || '').trim();
  const short = reason.length > 120 ? `${reason.slice(0, 117).trimEnd()}…` : reason;
  return {
    engineLabel: 'comfyui',
    statusNote: short ? `Diffusers → Comfy fallback · ${short}` : 'Diffusers → Comfy fallback',
  };
}
