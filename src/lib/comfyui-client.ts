import fs from 'node:fs';
import path from 'node:path';
import {
  type ComfyUiRuntimeConfig,
  type ResolvedComfyUiConfig,
  injectPromptsWithFallbacks,
  parseWorkflowJson,
  resolvePlaceholderTokens,
  resolveQueueInjectionContext,
  resolveWorkflowGraphEnrichOptions,
  findUnresolvedLoaderPlaceholders,
  normalizeComfyApiWorkflow,
  type WorkflowParamValues,
} from './comfyui-config';
import { writeQueueArtifact } from './queue-artifacts';
import { loadServerWorkflowJson } from './comfyui-server-workflows';
import { applyUserComfyUiOverride } from './user-comfy-url';
import {
  ensureComfyUiPoolStatsForQueue,
  getComfyUiPoolStatsCache,
  getDefaultPoolBusyThreshold,
  markComfyUiPoolEndpointUnhealthy,
  parseComfyUiPool,
  resolveComfyUiUrlWithPoolDetailed,
  type ComfyUiPoolRoutingMeta,
} from './comfyui-pool';
import { isDeadHostErrorMessage, isDeadHostHttpStatus, pickAlternateComfyUrl } from './oom-retry';
import {
  getComfyUiAllowedHosts,
  isComfyClientUrlAllowed,
  normalizeSafeHttpUrl,
} from './url-safety';
import { optimizeWorkflowForQueue } from './workflow-queue-optimizer';
import { runWorkflowPreflightSync } from './workflow-preflight-sync';
import { fetchComfyObjectInfoPayload } from './comfyui-object-info';
import { formatComfyUiQueueValidationError } from './comfyui-queue-validation-error';
import { workflowContentHash } from './workflow-content-hash';

export type ComfyQueueRequest = {
  prompt: string;
  negativePrompt?: string;
  params?: WorkflowParamValues;
  /** Target model for server-side loader resolution when runtime is trimmed. */
  model?: string;
  workflowId?: string;
  nodeTitle?: string;
  /**
   * ComfyUI WebSocket client id — must match `?clientId=` on the browser WS
   * so latent preview frames are associated with this session.
   */
  clientId?: string;
  /** Jump ahead of pending jobs (ComfyUI `front: true`). Interactive singles only. */
  front?: boolean;
};

export type ComfyQueueResult = {
  ok: boolean;
  promptId?: string;
  error?: string;
  comfyUrl: string;
  clientId?: string;
  workflowSource?: 'client' | 'env' | 'minimal' | 'diffusers-workflow' | 'comfy-fallback';
  /** Which backend actually accepted the job (Diffusers-first may fall back). */
  engineId?: import('./engine/types').EngineId;
  family?: string;
  /** Why Diffusers classify/queue declined before Comfy accepted the job. */
  diffusersFallbackReason?: string;
  replacements?: { positive: number; negative: number };
  /** How a multi-host pool pick routed this queue (when COMFYUI_POOL is set). */
  poolRouting?: ComfyUiPoolRoutingMeta;
};

function mergeHookParamsIntoWorkflowParams(
  base: WorkflowParamValues | undefined,
  hookParams: Record<string, string | number | boolean | null> | undefined,
  denoise: string | number | undefined,
  cfg: string | number | undefined
): WorkflowParamValues | undefined {
  const next: WorkflowParamValues = { ...(base ?? {}) };
  let changed = Boolean(base);
  if (hookParams) {
    if (hookParams.denoise !== undefined && hookParams.denoise !== null) {
      next.denoise = hookParams.denoise as string | number;
      changed = true;
    }
    if (hookParams.cfg !== undefined && hookParams.cfg !== null) {
      next.cfg = hookParams.cfg as string | number;
      changed = true;
    }
    if (hookParams.steps !== undefined && hookParams.steps !== null) {
      next.steps = hookParams.steps as string | number;
      changed = true;
    }
    if (hookParams.seed !== undefined && hookParams.seed !== null) {
      next.seed = hookParams.seed as string | number;
      changed = true;
    }
    if (typeof hookParams.width === 'number' || typeof hookParams.width === 'string') {
      next.width = hookParams.width;
      changed = true;
    }
    if (typeof hookParams.height === 'number' || typeof hookParams.height === 'string') {
      next.height = hookParams.height;
      changed = true;
    }
  }
  if (denoise !== undefined && denoise !== null && String(denoise).trim() !== '') {
    next.denoise = denoise;
    changed = true;
  }
  if (cfg !== undefined && cfg !== null && String(cfg).trim() !== '') {
    next.cfg = cfg;
    changed = true;
  }
  return changed ? next : base;
}

/**
 * Privileged server plugin hooks (PROMPT_DATA_DIR/plugins) — rewrite allowlisted
 * fields before Comfy /prompt. Returns a blocked error string when a hook stops the queue.
 */
async function applyServerPluginQueueHooks(input: {
  request: ComfyQueueRequest;
  workflow: Record<string, unknown> | null;
  runtime?: ComfyUiRuntimeConfig;
}): Promise<
  | { ok: true; request: ComfyQueueRequest; workflow: Record<string, unknown> | null }
  | { ok: false; error: string }
> {
  try {
    const { runServerQueuePreflight } = await import('./server-plugin-hooks');
    const { isServerPluginRegistryEnabled } = await import('./server-plugin-registry');
    if (!isServerPluginRegistryEnabled()) {
      return { ok: true, request: input.request, workflow: input.workflow };
    }

    const preflight = await runServerQueuePreflight({
      event: 'queue-preflight',
      prompt: input.request.prompt,
      negativePrompt: input.request.negativePrompt,
      model: input.request.model ?? input.runtime?.queueTargetModel,
      denoise: input.request.params?.denoise as string | number | undefined,
      cfg: input.request.params?.cfg as string | number | undefined,
      params: input.request.params as Record<string, string | number | boolean | null> | undefined,
      workflow: input.workflow ?? undefined,
    });
    if (preflight.blocked) {
      return {
        ok: false,
        error:
          preflight.reason ||
          preflight.messages.join(' · ') ||
          'Server plugin hook blocked the queue.',
      };
    }

    const mutated = preflight.payload;
    const nextRequest: ComfyQueueRequest = {
      ...input.request,
      prompt: mutated.prompt || input.request.prompt,
      negativePrompt: mutated.negativePrompt ?? input.request.negativePrompt,
      params: mergeHookParamsIntoWorkflowParams(
        input.request.params,
        mutated.params,
        mutated.denoise,
        mutated.cfg
      ),
    };
    const nextWorkflow =
      mutated.workflow && typeof mutated.workflow === 'object' ? mutated.workflow : input.workflow;
    return { ok: true, request: nextRequest, workflow: nextWorkflow };
  } catch {
    return { ok: true, request: input.request, workflow: input.workflow };
  }
}

async function dispatchServerQueuePost(input: {
  request: ComfyQueueRequest;
  result: ComfyQueueResult;
  workflow?: Record<string, unknown>;
}): Promise<void> {
  try {
    const { runServerQueuePost } = await import('./server-plugin-hooks');
    const { isServerPluginRegistryEnabled } = await import('./server-plugin-registry');
    if (!isServerPluginRegistryEnabled()) {
      return;
    }
    await runServerQueuePost({
      event: 'queue-post',
      prompt: input.request.prompt,
      negativePrompt: input.request.negativePrompt,
      model: input.request.model,
      denoise: input.request.params?.denoise as string | number | undefined,
      cfg: input.request.params?.cfg as string | number | undefined,
      params: input.request.params as Record<string, string | number | boolean | null> | undefined,
      workflow: input.workflow,
      promptId: input.result.promptId,
      comfyUrl: input.result.comfyUrl,
      ok: input.result.ok,
      error: input.result.error,
    });
  } catch {
    // Best-effort.
  }
}

/** Max prompts accepted by /api/comfyui in one request. */
export const COMFYUI_MAX_BATCH_PROMPTS = 12;

export type ComfyPromptPostBody = {
  prompt: Record<string, unknown>;
  client_id: string;
  extra_data: {
    preview_method: 'auto';
    extra_pnginfo: {
      workflow: Record<string, unknown>;
    };
  };
  front?: boolean;
};

/** Body for ComfyUI `POST /prompt`, including PNG replay metadata. */
export function buildComfyPromptPostBody(input: {
  prompt: Record<string, unknown>;
  clientId: string;
  front?: boolean;
}): ComfyPromptPostBody {
  return {
    prompt: input.prompt,
    client_id: input.clientId,
    extra_data: {
      preview_method: 'auto',
      extra_pnginfo: {
        workflow: input.prompt,
      },
    },
    ...(input.front ? { front: true } : {}),
  };
}

function envComfyUiBaseUrl(): string {
  return (
    process.env.COMFYUI_API_URL?.trim() ||
    process.env.COMFY_PROMPT_API_URL?.trim()?.replace(/:\d+$/, ':8188') ||
    'http://127.0.0.1:8188'
  );
}

export function getComfyUiBaseUrlWithRouting(
  runtime?: ComfyUiRuntimeConfig,
  routingSeed?: string
): { url: string; routing?: ComfyUiPoolRoutingMeta } {
  const runtimeWithUser = applyUserComfyUiOverride(runtime ?? {});
  const allowedHosts = getComfyUiAllowedHosts();
  const clientUrl = runtimeWithUser.apiUrl?.trim();

  if (clientUrl && isComfyClientUrlAllowed()) {
    return {
      url: normalizeSafeHttpUrl(clientUrl, {
        allowPrivate: true,
        allowedHosts,
      }),
      routing: { strategy: 'client' },
    };
  }

  const resolved = resolveComfyUiUrlWithPoolDetailed({
    userUrl: runtimeWithUser.apiUrl,
    envUrl: envComfyUiBaseUrl(),
    routingSeed,
    poolStats: getComfyUiPoolStatsCache(),
    preferredComfyHost: runtime?.preferredComfyHost,
    loadBalance: runtime?.comfyPoolLoadBalance,
    busyThreshold: runtime?.comfyPoolBusyThreshold ?? getDefaultPoolBusyThreshold(),
    poolUrls: runtime?.comfyPoolUrls,
  });

  return {
    url: normalizeSafeHttpUrl(resolved.url, {
      allowPrivate: true,
      allowedHosts,
    }),
    routing: resolved.routing,
  };
}

export function getComfyUiBaseUrl(runtime?: ComfyUiRuntimeConfig, routingSeed?: string): string {
  return getComfyUiBaseUrlWithRouting(runtime, routingSeed).url;
}

function loadWorkflowFromEnv(): Record<string, unknown> | null {
  const inline = process.env.COMFYUI_WORKFLOW_JSON?.trim();
  if (inline) {
    return parseWorkflowJson(inline);
  }

  const filePath = process.env.COMFYUI_WORKFLOW_PATH?.trim();
  if (!filePath) {
    return null;
  }

  try {
    const resolved = path.isAbsolute(filePath)
      ? filePath
      : path.join(/* turbopackIgnore: true */ process.cwd(), filePath);
    return parseWorkflowJson(fs.readFileSync(resolved, 'utf8'));
  } catch {
    return null;
  }
}

export function resolveComfyUiConfig(
  runtime?: ComfyUiRuntimeConfig
): ResolvedComfyUiConfig & { poolRouting?: ComfyUiPoolRoutingMeta } {
  const clientWorkflow = parseWorkflowJson(runtime?.workflowJson);
  const selectedServerWorkflow = runtime?.workflowFileId
    ? loadServerWorkflowJson(runtime.workflowFileId)
    : null;
  const envWorkflow = selectedServerWorkflow ?? loadWorkflowFromEnv();
  const workflowRaw = clientWorkflow ?? envWorkflow;
  const workflow = workflowRaw ? normalizeComfyApiWorkflow(workflowRaw) : null;

  const { url, routing } = getComfyUiBaseUrlWithRouting(runtime);

  return {
    apiUrl: url,
    workflow,
    placeholderTokens: resolvePlaceholderTokens(runtime),
    legacyPositiveNodeId:
      process.env.COMFYUI_POSITIVE_NODE_ID?.trim() ||
      process.env.COMFYUI_PROMPT_NODE_ID?.trim() ||
      undefined,
    legacyNegativeNodeId: process.env.COMFYUI_NEGATIVE_NODE_ID?.trim() || undefined,
    workflowSource: clientWorkflow ? 'client' : envWorkflow ? 'env' : 'none',
    poolRouting: routing,
  };
}

async function resolveComfyUiConfigForQueue(
  runtime?: ComfyUiRuntimeConfig
): Promise<ResolvedComfyUiConfig & { poolRouting?: ComfyUiPoolRoutingMeta }> {
  await ensureComfyUiPoolStatsForQueue({
    loadBalance: runtime?.comfyPoolLoadBalance,
    poolUrls: runtime?.comfyPoolUrls,
  });
  return resolveComfyUiConfig(runtime);
}

/** Cache optimized graphs across batch queue requests that share the same workflow object. */
const optimizedWorkflowCache = new WeakMap<
  object,
  { key: string; workflow: Record<string, unknown> }
>();

/**
 * Content-hash cache for rebuilt workflow objects (WeakMap misses when identity changes).
 * Insertion-order eviction keeps recent batch profiles warm.
 */
const optimizedWorkflowByHash = new Map<
  string,
  { optimizeKey: string; workflow: Record<string, unknown> }
>();
const OPTIMIZED_WORKFLOW_HASH_CACHE_MAX = 48;

function rememberOptimizedWorkflowByHash(
  sourceHash: string,
  optimizeKey: string,
  /** Already-cloned snapshot — shared with WeakMap; do not mutate. */
  workflow: Record<string, unknown>
) {
  const cacheKey = `${sourceHash}|${optimizeKey}`;
  if (optimizedWorkflowByHash.has(cacheKey)) {
    optimizedWorkflowByHash.delete(cacheKey);
  }
  optimizedWorkflowByHash.set(cacheKey, {
    optimizeKey,
    workflow,
  });
  while (optimizedWorkflowByHash.size > OPTIMIZED_WORKFLOW_HASH_CACHE_MAX) {
    const oldest = optimizedWorkflowByHash.keys().next().value;
    if (oldest == null) {
      break;
    }
    optimizedWorkflowByHash.delete(oldest);
  }
}

function injectPromptsIntoWorkflow(
  workflow: Record<string, unknown>,
  request: ComfyQueueRequest,
  config: ResolvedComfyUiConfig,
  runtime?: ComfyUiRuntimeConfig,
  enrichInventory?: {
    availableUpscaleModels?: string[] | null;
    availableCheckpoints?: string[] | null;
    availableUnets?: string[] | null;
    availableVaes?: string[] | null;
    availableClips?: string[] | null;
    availableLoras?: string[] | null;
    supportsNeuralUpscaleTileSize?: boolean;
    availableNodeTypes?: Iterable<string> | null;
    webpSaveAdapters?: import('./workflow-save-format').WebpSaveAdapter[] | null;
  }
) {
  const { params, loaders, customTokens } = resolveQueueInjectionContext({
    runtime,
    override: request.params,
    model: runtime?.queueTargetModel ?? request.model,
    workflow,
    availableCheckpoints: enrichInventory?.availableCheckpoints,
    availableUnets: enrichInventory?.availableUnets,
    availableVaes: enrichInventory?.availableVaes,
    availableUpscaleModels: enrichInventory?.availableUpscaleModels,
  });
  const model = runtime?.queueTargetModel ?? request.model;
  const inventoryFingerprint = [
    enrichInventory?.availableUpscaleModels?.slice().sort().join(',') ?? '',
    String(enrichInventory?.availableCheckpoints?.length ?? 0),
    String(enrichInventory?.availableLoras?.length ?? 0),
    enrichInventory?.supportsNeuralUpscaleTileSize ? '1' : '0',
    enrichInventory?.availableNodeTypes
      ? [...enrichInventory.availableNodeTypes]
          .filter(name => /saveimage|image save/i.test(name))
          .sort()
          .join(',')
      : '',
  ].join(';');
  const hasInputImage = Boolean(
    params.inputImageFilename?.toString().trim() ||
    (Array.isArray(params.inputImageFilenames) &&
      params.inputImageFilenames.some(name => String(name ?? '').trim()))
  );
  const optimizeKey = [
    runtime?.queueQualityProfile ?? 'draft',
    model ?? '',
    params.upscaleModelFilename ?? '',
    params.refinerCheckpointFilename ?? '',
    runtime?.workflowGraphEnrich === false ? '0' : '1',
    runtime?.compactDraftSaves === false ? '0' : '1',
    hasInputImage ? 'i1' : 'i0',
    inventoryFingerprint,
  ].join('|');

  let optimizedWorkflow = workflow;
  if (runtime?.workflowQueueOptimize !== false) {
    const cached = optimizedWorkflowCache.get(workflow);
    if (cached && cached.key === optimizeKey) {
      optimizedWorkflow = structuredClone(cached.workflow);
    } else {
      // Use runtime-provided hash to skip redundant stringify when the caller already computed it.
      const preHash =
        typeof runtime?.workflowOptimizedHash === 'string' && runtime.workflowOptimizedHash.trim()
          ? runtime.workflowOptimizedHash
          : workflowContentHash(JSON.stringify(workflow));
      const byHash = optimizedWorkflowByHash.get(`${preHash}|${optimizeKey}`);
      if (byHash) {
        optimizedWorkflow = structuredClone(byHash.workflow);
        optimizedWorkflowCache.set(workflow, {
          key: optimizeKey,
          workflow: byHash.workflow,
        });
      } else {
        const optimized = optimizeWorkflowForQueue({
          workflow,
          tokens: config.placeholderTokens,
          model,
          qualityProfile: runtime?.queueQualityProfile,
          upscaleModelFilename: params.upscaleModelFilename,
          refinerCheckpointFilename: params.refinerCheckpointFilename,
          skipIfUnchanged: true,
          contentHash: runtime?.workflowOptimizedHash,
          optimizedModel: runtime?.workflowOptimizedModel,
          optimizedProfile: runtime?.workflowOptimizedProfile,
          availableUpscaleModels: enrichInventory?.availableUpscaleModels,
          availableCheckpoints: enrichInventory?.availableCheckpoints,
          supportsNeuralUpscaleTileSize: enrichInventory?.supportsNeuralUpscaleTileSize,
          availableNodeTypes: enrichInventory?.availableNodeTypes,
          webpSaveAdapters: enrichInventory?.webpSaveAdapters,
          compactDraftSaves: runtime?.compactDraftSaves,
          hasInputImage,
          ...resolveWorkflowGraphEnrichOptions(runtime),
        });
        // One snapshot shared by WeakMap + hash cache; inject clones before mutating.
        const cloned = structuredClone(optimized.workflow);
        optimizedWorkflow = cloned;
        optimizedWorkflowCache.set(workflow, {
          key: optimizeKey,
          workflow: cloned,
        });
        rememberOptimizedWorkflowByHash(preHash, optimizeKey, cloned);
      }
    }
  }

  return injectPromptsWithFallbacks(
    optimizedWorkflow,
    {
      positive: request.prompt,
      negative: request.negativePrompt,
      params,
      customTokens,
    },
    config.placeholderTokens,
    {
      legacyPositiveNodeId: config.legacyPositiveNodeId,
      legacyNegativeNodeId: config.legacyNegativeNodeId,
      directWorkflowPatching: runtime?.directWorkflowPatching,
      syncWorkflowLoadersToModel: runtime?.syncWorkflowLoadersToModel,
      loaders,
      model: runtime?.queueTargetModel ?? request.model,
      availableCheckpoints: enrichInventory?.availableCheckpoints,
      availableUnets: enrichInventory?.availableUnets,
      availableVaes: enrichInventory?.availableVaes,
      availableClips: enrichInventory?.availableClips,
      availableLoras: enrichInventory?.availableLoras,
      qualityProfile: runtime?.queueQualityProfile,
      loraLibrary: runtime?.loraLibrary,
      availableNodeTypes: enrichInventory?.availableNodeTypes,
      regionalSlots: runtime?.regionalSlots,
      kleinEnhancerEnabled: runtime?.kleinEnhancerEnabled,
      kleinEnhancerIdentityPreset: runtime?.kleinEnhancerIdentityPreset,
      kleinEnhancerTextEnabled: runtime?.kleinEnhancerTextEnabled,
      kleinEnhancerColorAnchorEnabled: runtime?.kleinEnhancerColorAnchorEnabled,
      kleinEnhancerColorAnchorStrength: runtime?.kleinEnhancerColorAnchorStrength,
      samplerOverrides: runtime?.modelSamplerOverrides,
    }
  );
}

async function fetchComfyObjectInfoForPreflight(runtime?: ComfyUiRuntimeConfig) {
  try {
    return await fetchComfyObjectInfoPayload(runtime);
  } catch {
    return null;
  }
}

function buildPreflightFailure(
  preflight: ReturnType<typeof runWorkflowPreflightSync>,
  comfyUrl: string
): ComfyQueueResult {
  return {
    ok: false,
    error: preflight.issues
      .filter(issue => issue.severity === 'error')
      .map(issue => issue.message)
      .join(' · '),
    comfyUrl,
  };
}

function resolveDeadHostFailoverUrl(
  currentUrl: string,
  runtime: ComfyUiRuntimeConfig | undefined,
  error: unknown,
  httpStatus?: number
): string | undefined {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const dead =
    (typeof httpStatus === 'number' && isDeadHostHttpStatus(httpStatus)) ||
    isDeadHostErrorMessage(message) ||
    (typeof httpStatus !== 'number' && isDeadHostErrorMessage(String(error ?? '')));
  if (!dead) {
    return undefined;
  }
  markComfyUiPoolEndpointUnhealthy(currentUrl);
  return pickAlternateComfyUrl(parseComfyUiPool(runtime?.comfyPoolUrls), currentUrl);
}

export async function queuePromptToComfyUi(
  request: ComfyQueueRequest,
  runtime?: ComfyUiRuntimeConfig,
  options?: {
    preflight?: boolean;
    objectInfo?: Awaited<ReturnType<typeof fetchComfyObjectInfoForPreflight>>;
    /** Try Diffusers /v1/workflow before Comfy /prompt. */
    preferDiffusers?: boolean;
    diffusersUrl?: string;
    /** When Diffusers rejects the graph, fall back to Comfy (default true). */
    allowComfyFallback?: boolean;
  }
): Promise<ComfyQueueResult> {
  const config = await resolveComfyUiConfigForQueue(runtime);
  let poolRouting = config.poolRouting;
  let routedUrl = config.apiUrl;
  const runPreflight = options?.preflight !== false;
  const preferDiffusers = options?.preferDiffusers === true;
  const allowComfyFallback = options?.allowComfyFallback !== false;

  try {
    const objectInfo =
      config.workflow && runPreflight
        ? (options?.objectInfo ?? (await fetchComfyObjectInfoForPreflight(runtime)))
        : null;

    const promptBody = config.workflow
      ? (() => {
          const injected = injectPromptsIntoWorkflow(config.workflow, request, config, runtime, {
            availableUpscaleModels: objectInfo?.models.upscaleModels,
            availableCheckpoints: objectInfo?.models.checkpoints,
            availableUnets: objectInfo?.models.unets,
            availableVaes: objectInfo?.models.vaes,
            availableClips: objectInfo?.models.clips,
            availableLoras: objectInfo?.models.loras,
            supportsNeuralUpscaleTileSize: objectInfo?.supportsNeuralUpscaleTileSize,
            availableNodeTypes: objectInfo?.nodeTypes,
            webpSaveAdapters: objectInfo?.webpSaveAdapters,
          });
          const unresolved = findUnresolvedLoaderPlaceholders(injected.workflow);
          if (unresolved.length > 0) {
            const modelHint = request.model ?? runtime?.queueTargetModel ?? 'unknown';
            const loaderHint = [
              request.params?.unetFilename ? `unet=${request.params.unetFilename}` : null,
              request.params?.vaeFilename ? `vae=${request.params.vaeFilename}` : null,
            ]
              .filter(Boolean)
              .join(', ');
            throw new Error(
              `Workflow still has unresolved loader placeholders (${unresolved.join(', ')}) for model "${modelHint}"${loaderHint ? ` (${loaderHint})` : ''}. Set Settings → checkpoint/VAE maps for your model, then retry.`
            );
          }

          if (runPreflight) {
            const preflight = runWorkflowPreflightSync({
              workflow: injected.workflow,
              model: request.model ?? runtime?.queueTargetModel ?? 'qwen-image-2512',
              syncWorkflowLoadersToModel: runtime?.syncWorkflowLoadersToModel,
              knownNodeTypes: objectInfo?.nodeTypes,
              models: objectInfo?.models,
              objectInfoUnavailable: !objectInfo,
              customTokens: runtime?.customTokens,
              lightningAlreadyPrepared: true,
            });
            if (!preflight.ok) {
              return {
                kind: 'preflight_failed' as const,
                preflight,
              };
            }
          }

          return {
            kind: 'ready' as const,
            injected,
          };
        })()
      : {
          kind: 'minimal' as const,
        };

    if (promptBody.kind === 'preflight_failed') {
      return buildPreflightFailure(promptBody.preflight, config.apiUrl);
    }

    const resolvedPromptBody =
      promptBody.kind === 'ready'
        ? {
            prompt: promptBody.injected.workflow,
            workflowSource:
              config.workflowSource === 'env' ? ('env' as const) : ('client' as const),
            replacements: {
              positive: promptBody.injected.positiveReplacements,
              negative: promptBody.injected.negativeReplacements,
            },
          }
        : {
            prompt: buildMinimalWorkflow(request.prompt, request.nodeTitle),
            workflowSource: 'minimal' as const,
            replacements: { positive: 1, negative: 0 },
          };

    const initialWorkflow =
      typeof resolvedPromptBody.prompt === 'object' && resolvedPromptBody.prompt
        ? (resolvedPromptBody.prompt as Record<string, unknown>)
        : null;
    const hooked = await applyServerPluginQueueHooks({
      request,
      workflow: initialWorkflow,
      runtime,
    });
    if (!hooked.ok) {
      return {
        ok: false,
        error: hooked.error,
        comfyUrl: config.apiUrl,
        engineId: 'comfyui',
        poolRouting,
      };
    }

    const activeRequest = hooked.request;
    type ActivePromptBody = {
      prompt: Record<string, unknown>;
      workflowSource: 'client' | 'env' | 'minimal';
      replacements: { positive: number; negative: number };
    };
    let activePromptBody: ActivePromptBody = {
      prompt:
        typeof resolvedPromptBody.prompt === 'object' && resolvedPromptBody.prompt
          ? (resolvedPromptBody.prompt as Record<string, unknown>)
          : {},
      workflowSource: resolvedPromptBody.workflowSource,
      replacements: resolvedPromptBody.replacements,
    };

    const promptRewritten =
      activeRequest.prompt !== request.prompt ||
      (activeRequest.negativePrompt ?? '') !== (request.negativePrompt ?? '') ||
      activeRequest.params !== request.params;
    const workflowRewritten = hooked.workflow && hooked.workflow !== initialWorkflow;

    if (workflowRewritten && hooked.workflow) {
      activePromptBody = {
        ...activePromptBody,
        prompt: hooked.workflow,
      };
    } else if (promptRewritten && config.workflow && promptBody.kind === 'ready') {
      const reinjected = injectPromptsIntoWorkflow(
        config.workflow,
        activeRequest,
        config,
        runtime,
        {
          availableUpscaleModels: objectInfo?.models.upscaleModels,
          availableCheckpoints: objectInfo?.models.checkpoints,
          availableUnets: objectInfo?.models.unets,
          availableVaes: objectInfo?.models.vaes,
          availableClips: objectInfo?.models.clips,
          availableLoras: objectInfo?.models.loras,
          supportsNeuralUpscaleTileSize: objectInfo?.supportsNeuralUpscaleTileSize,
          availableNodeTypes: objectInfo?.nodeTypes,
          webpSaveAdapters: objectInfo?.webpSaveAdapters,
        }
      );
      activePromptBody = {
        prompt: reinjected.workflow as Record<string, unknown>,
        workflowSource: resolvedPromptBody.workflowSource,
        replacements: {
          positive: reinjected.positiveReplacements,
          negative: reinjected.negativeReplacements,
        },
      };
    } else if (promptRewritten && promptBody.kind === 'minimal') {
      activePromptBody = {
        prompt: buildMinimalWorkflow(activeRequest.prompt, activeRequest.nodeTitle) as Record<
          string,
          unknown
        >,
        workflowSource: 'minimal',
        replacements: { positive: 1, negative: 0 },
      };
    }

    const clientId =
      activeRequest.clientId?.trim() ||
      `srv${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;

    if (preferDiffusers && activePromptBody.prompt && typeof activePromptBody.prompt === 'object') {
      const { classifyDiffusersWorkflow, queueDiffusersWorkflow } =
        await import('./diffusers-client');
      const graph = activePromptBody.prompt as Record<string, unknown>;
      const classified = await classifyDiffusersWorkflow(graph, options?.diffusersUrl);
      let diffusersFallbackReason: string | undefined;
      if (classified?.supported) {
        const { freeComfyUiMemoryServer } = await import('./comfyui-free-server');
        await freeComfyUiMemoryServer();
        const queued = await queueDiffusersWorkflow(
          {
            prompt: graph,
            client_id: clientId,
          },
          options?.diffusersUrl
        );
        if (queued.ok && queued.promptId) {
          writeQueueArtifact({
            prompt: activeRequest.prompt,
            negativePrompt: activeRequest.negativePrompt,
            promptId: queued.promptId,
            comfyUrl: queued.engineUrl ?? options?.diffusersUrl ?? '',
            workflow: graph,
          });
          const success: ComfyQueueResult = {
            ok: true,
            promptId: queued.promptId,
            comfyUrl: queued.engineUrl ?? options?.diffusersUrl ?? config.apiUrl,
            clientId,
            workflowSource: 'diffusers-workflow',
            engineId: 'diffusers',
            family: classified.family,
            replacements: activePromptBody.replacements,
          };
          void dispatchServerQueuePost({
            request: activeRequest,
            result: success,
            workflow: graph,
          });
          return success;
        }
        if (!allowComfyFallback) {
          const failure: ComfyQueueResult = {
            ok: false,
            error: queued.error ?? 'Diffusers workflow queue failed.',
            comfyUrl: queued.engineUrl ?? options?.diffusersUrl ?? config.apiUrl,
            clientId,
            workflowSource: 'diffusers-workflow',
            engineId: 'diffusers',
            family: classified.family,
            replacements: activePromptBody.replacements,
          };
          void dispatchServerQueuePost({
            request: activeRequest,
            result: failure,
            workflow: graph,
          });
          return failure;
        }
        diffusersFallbackReason =
          queued.error?.trim() || 'Diffusers queue failed after classify supported the graph.';
      } else if (!allowComfyFallback) {
        const failure: ComfyQueueResult = {
          ok: false,
          error:
            classified?.reason || 'Workflow not supported by Diffusers; Comfy fallback disabled.',
          comfyUrl: options?.diffusersUrl ?? config.apiUrl,
          clientId,
          workflowSource: 'diffusers-workflow',
          engineId: 'diffusers',
          family: classified?.family,
          replacements: activePromptBody.replacements,
        };
        void dispatchServerQueuePost({
          request: activeRequest,
          result: failure,
          workflow: graph,
        });
        return failure;
      } else {
        const nodes =
          classified?.unsupportedNodes && classified.unsupportedNodes.length > 0
            ? ` Unsupported: ${classified.unsupportedNodes.slice(0, 4).join(', ')}${
                classified.unsupportedNodes.length > 4 ? '…' : ''
              }.`
            : '';
        diffusersFallbackReason = `${
          classified?.reason || 'Workflow not natively supported by Diffusers.'
        }${nodes}`;
      }

      // Fall through to Comfy with an explicit fallback tag for UI honesty.
      const comfyFallbackMeta = {
        workflowSource: 'comfy-fallback' as const,
        diffusersFallbackReason,
        family: classified?.family,
      };

      const postPrompt = (apiUrl: string) =>
        fetch(`${apiUrl}/prompt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            buildComfyPromptPostBody({
              prompt: activePromptBody.prompt as Record<string, unknown>,
              clientId,
              front: activeRequest.front === true,
            })
          ),
        });

      let workflowResponse: Response;
      try {
        workflowResponse = await postPrompt(routedUrl);
      } catch (error) {
        const alt = resolveDeadHostFailoverUrl(routedUrl, runtime, error);
        if (!alt) {
          throw error;
        }
        routedUrl = alt;
        poolRouting = { strategy: 'failover' };
        workflowResponse = await postPrompt(routedUrl);
      }

      if (!workflowResponse.ok && isDeadHostHttpStatus(workflowResponse.status)) {
        const alt = resolveDeadHostFailoverUrl(
          routedUrl,
          runtime,
          workflowResponse.statusText,
          workflowResponse.status
        );
        if (alt) {
          routedUrl = alt;
          poolRouting = { strategy: 'failover' };
          workflowResponse = await postPrompt(routedUrl);
        }
      }

      if (!workflowResponse.ok) {
        const text = await workflowResponse.text();
        const failure: ComfyQueueResult = {
          ok: false,
          error: formatComfyUiQueueValidationError(
            text || `ComfyUI returned ${workflowResponse.status}`
          ),
          comfyUrl: routedUrl,
          clientId,
          ...comfyFallbackMeta,
          engineId: 'comfyui',
          replacements: activePromptBody.replacements,
          poolRouting,
        };
        void dispatchServerQueuePost({
          request: activeRequest,
          result: failure,
          workflow: graph,
        });
        return failure;
      }

      const data = (await workflowResponse.json()) as { prompt_id?: string };

      writeQueueArtifact({
        prompt: activeRequest.prompt,
        negativePrompt: activeRequest.negativePrompt,
        promptId: data.prompt_id,
        comfyUrl: routedUrl,
        workflow: graph,
      });

      const success: ComfyQueueResult = {
        ok: true,
        promptId: data.prompt_id,
        comfyUrl: routedUrl,
        clientId,
        ...comfyFallbackMeta,
        engineId: 'comfyui',
        replacements: activePromptBody.replacements,
        poolRouting,
      };
      void dispatchServerQueuePost({
        request: activeRequest,
        result: success,
        workflow: graph,
      });
      return success;
    }

    const postPrompt = (apiUrl: string) =>
      fetch(`${apiUrl}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          buildComfyPromptPostBody({
            prompt: activePromptBody.prompt as Record<string, unknown>,
            clientId,
            front: activeRequest.front === true,
          })
        ),
      });

    let workflowResponse: Response;
    try {
      workflowResponse = await postPrompt(routedUrl);
    } catch (error) {
      const alt = resolveDeadHostFailoverUrl(routedUrl, runtime, error);
      if (!alt) {
        throw error;
      }
      routedUrl = alt;
      poolRouting = { strategy: 'failover' };
      workflowResponse = await postPrompt(routedUrl);
    }

    if (!workflowResponse.ok && isDeadHostHttpStatus(workflowResponse.status)) {
      const alt = resolveDeadHostFailoverUrl(
        routedUrl,
        runtime,
        workflowResponse.statusText,
        workflowResponse.status
      );
      if (alt) {
        routedUrl = alt;
        poolRouting = { strategy: 'failover' };
        workflowResponse = await postPrompt(routedUrl);
      }
    }

    if (!workflowResponse.ok) {
      const text = await workflowResponse.text();
      const failure: ComfyQueueResult = {
        ok: false,
        error: formatComfyUiQueueValidationError(
          text || `ComfyUI returned ${workflowResponse.status}`
        ),
        comfyUrl: routedUrl,
        clientId,
        workflowSource: activePromptBody.workflowSource,
        engineId: 'comfyui',
        replacements: activePromptBody.replacements,
        poolRouting,
      };
      void dispatchServerQueuePost({
        request: activeRequest,
        result: failure,
        workflow:
          typeof activePromptBody.prompt === 'object'
            ? (activePromptBody.prompt as Record<string, unknown>)
            : undefined,
      });
      return failure;
    }

    const data = (await workflowResponse.json()) as { prompt_id?: string };

    writeQueueArtifact({
      prompt: activeRequest.prompt,
      negativePrompt: activeRequest.negativePrompt,
      promptId: data.prompt_id,
      comfyUrl: routedUrl,
      workflow:
        typeof activePromptBody.prompt === 'object'
          ? (activePromptBody.prompt as Record<string, unknown>)
          : undefined,
    });

    const success: ComfyQueueResult = {
      ok: true,
      promptId: data.prompt_id,
      comfyUrl: routedUrl,
      clientId,
      workflowSource: activePromptBody.workflowSource,
      engineId: 'comfyui',
      replacements: activePromptBody.replacements,
      poolRouting,
    };
    void dispatchServerQueuePost({
      request: activeRequest,
      result: success,
      workflow:
        typeof activePromptBody.prompt === 'object'
          ? (activePromptBody.prompt as Record<string, unknown>)
          : undefined,
    });
    return success;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'ComfyUI unreachable',
      comfyUrl: routedUrl,
      engineId: preferDiffusers ? 'diffusers' : 'comfyui',
    };
  }
}

export type ComfyBatchQueueResult = {
  ok: boolean;
  queued: number;
  failed: number;
  results: ComfyQueueResult[];
  comfyUrl: string;
};

export async function queueBatchToComfyUi(
  requests: ComfyQueueRequest[],
  runtime?: ComfyUiRuntimeConfig,
  options?: {
    preflight?: boolean;
    preferDiffusers?: boolean;
    allowComfyFallback?: boolean;
    diffusersUrl?: string;
  }
): Promise<ComfyBatchQueueResult> {
  const config = await resolveComfyUiConfigForQueue(runtime);
  const results: ComfyQueueResult[] = [];
  const runPreflight = options?.preflight !== false;
  const objectInfo =
    runPreflight && config.workflow ? await fetchComfyObjectInfoForPreflight(runtime) : null;

  for (const request of requests) {
    if (!request.prompt.trim()) {
      continue;
    }

    results.push(
      await queuePromptToComfyUi(request, runtime, {
        preflight: runPreflight,
        objectInfo: objectInfo ?? undefined,
        preferDiffusers: options?.preferDiffusers === true,
        allowComfyFallback: options?.allowComfyFallback !== false,
        diffusersUrl: options?.diffusersUrl,
      })
    );
  }

  const queued = results.filter(entry => entry.ok).length;
  return {
    ok: queued > 0,
    queued,
    failed: results.length - queued,
    results,
    comfyUrl: config.apiUrl,
  };
}

function buildMinimalWorkflow(prompt: string, nodeTitle = 'CLIP Text Encode') {
  return {
    '1': {
      class_type: 'CLIPTextEncode',
      inputs: { text: prompt, clip: ['2', 0] },
      _meta: { title: nodeTitle },
    },
    '2': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: 'model.safetensors' },
    },
  };
}
