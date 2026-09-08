import { DEFAULT_QWEN_MODEL, type ComfyImageModel } from './comfy-models/client';
import {
  DEFAULT_MODEL_SAMPLER_PRESET_TIER,
  normalizeModelSamplerPresetTier,
} from './model-sampler-defaults';
import type { ModelSamplerPresetTier, ModelSamplerOverrideFields } from './model-sampler-defaults';
import type { KleinEnhancerIdentityPreset } from './klein-enhancer-workflow-patch';
import {
  DEFAULT_RESOLUTION_ORIENTATION,
  DEFAULT_RESOLUTION_SIZE_TIER,
  normalizeResolutionOrientation,
  normalizeResolutionSizeTier,
} from './model-resolution-defaults';
import type { ResolutionOrientation, ResolutionSizeTier } from './model-resolution-defaults';
import { DEFAULT_ANATOMY_GUARD_MODE, normalizeAnatomyGuardMode } from './anatomy-guard';
import type { AnatomyGuardMode } from './anatomy-guard';
import { DEFAULT_RENDER_REALISM_MODE, normalizeRenderRealismMode } from './render-realism';
import type { RenderRealismMode } from './render-realism';
import { DEFAULT_VARIATION_SETTINGS } from './variation-settings';
import type { DetailLevel } from './detail-level';
import {
  isBrowserStorageReady,
  readBrowserValue,
  readBrowserString,
  whenBrowserStorageReady,
  writeBrowserValue,
  writeBrowserString,
  flushBrowserStorageNow,
} from './browser-storage';
import type { ModelCheckpointMap, ModelRefinerMap, ModelVaeMap } from './model-checkpoint-map';
import type { ModelLoraMap, SessionActiveLoraIdsByModel } from './model-lora-map';
import {
  normalizeSessionLoraStrengthOverrides,
  type SessionLoraStrengthOverrides,
} from './lora-stack';
import type { ModelUpscaleMap } from './model-upscale-map';
import {
  normalizeGalleryWorkflowMaxBytes,
  normalizeGalleryWorkflowRetentionDays,
} from './gallery-workflow-hygiene';
import {
  DEFAULT_QUEUE_QUALITY_PROFILE,
  normalizeQueueQualityProfile,
  type QueueQualityProfile,
} from './queue-quality-profile';
import {
  normalizeToolQueueQualityProfiles,
  SUGGESTED_TOOL_QUEUE_QUALITY_PROFILES,
} from './tool-quality-profiles';
import { mergeToolQualityRecipes } from './tool-quality-recipes';
import {
  SUGGESTED_MODEL_CHECKPOINT_MAP,
  SUGGESTED_MODEL_REFINER_MAP,
  SUGGESTED_MODEL_VAE_MAP,
} from './model-checkpoint-map';
import { mergeSuggestedUpscaleMap } from './model-upscale-map';
import { mergeSessionLoraIdsByModel, SUGGESTED_MODEL_LORA_MAP } from './model-lora-map';
import {
  normalizeLoraDatasetExportPrefs,
  normalizeLoraTrainTrainerPrefs,
  normalizeTrainJobs,
} from './lora-train-job';
import { loadOnboardingState } from './onboarding-store';
import { scheduleAfterCommit } from './schedule-after-commit';

export const SETTINGS_CACHE_KEY = 'comfy-prompt-tool-settings-v1';
export const SETTINGS_CACHE_UPDATED_EVENT = 'settings-cache-updated';
/** Sidecar — small, always fits in localStorage even when the main settings blob is huge. */
export const SYSTEM_WORKFLOWS_PREF_KEY = 'comfy-use-system-workflows-v1';
export const SESSION_LORA_PREFS_KEY = 'comfy-session-lora-prefs-v1';
/** Peels heavy tool/plugin/map payloads out of the main settings blob. */
export const SETTINGS_TOOLS_SIDECAR_KEY = 'comfy-prompt-tool-settings-tools-v1';
export const SETTINGS_PLUGINS_SIDECAR_KEY = 'comfy-prompt-tool-settings-plugins-v1';
export const SETTINGS_MAPS_SIDECAR_KEY = 'comfy-prompt-tool-settings-maps-v1';

type SettingsMapsSidecar = {
  modelCheckpointMap?: SharedToolSettings['modelCheckpointMap'];
  modelVaeMap?: SharedToolSettings['modelVaeMap'];
  modelRefinerMap?: SharedToolSettings['modelRefinerMap'];
  modelUpscaleMap?: SharedToolSettings['modelUpscaleMap'];
  modelLoraMap?: SharedToolSettings['modelLoraMap'];
  modelControlNetMap?: SharedToolSettings['modelControlNetMap'];
  modelWorkflowMap?: SharedToolSettings['modelWorkflowMap'];
  modelSamplerMemory?: SharedToolSettings['modelSamplerMemory'];
  updatedAt?: number;
};

function peelSettingsMaps(shared: SharedToolSettings): SettingsMapsSidecar {
  return {
    modelCheckpointMap: shared.modelCheckpointMap,
    modelVaeMap: shared.modelVaeMap,
    modelRefinerMap: shared.modelRefinerMap,
    modelUpscaleMap: shared.modelUpscaleMap,
    modelLoraMap: shared.modelLoraMap,
    modelControlNetMap: shared.modelControlNetMap,
    modelWorkflowMap: shared.modelWorkflowMap,
    modelSamplerMemory: shared.modelSamplerMemory,
  };
}

function applySettingsMapsSidecar(
  shared: SharedToolSettings,
  maps: SettingsMapsSidecar | null
): void {
  if (!maps) {
    return;
  }
  if (maps.modelCheckpointMap) {
    shared.modelCheckpointMap = { ...shared.modelCheckpointMap, ...maps.modelCheckpointMap };
  }
  if (maps.modelVaeMap) {
    shared.modelVaeMap = { ...shared.modelVaeMap, ...maps.modelVaeMap };
  }
  if (maps.modelRefinerMap) {
    shared.modelRefinerMap = { ...shared.modelRefinerMap, ...maps.modelRefinerMap };
  }
  if (maps.modelUpscaleMap) {
    shared.modelUpscaleMap = { ...shared.modelUpscaleMap, ...maps.modelUpscaleMap };
  }
  if (maps.modelLoraMap) {
    shared.modelLoraMap = { ...shared.modelLoraMap, ...maps.modelLoraMap };
  }
  if (maps.modelControlNetMap) {
    shared.modelControlNetMap = { ...shared.modelControlNetMap, ...maps.modelControlNetMap };
  }
  if (maps.modelWorkflowMap) {
    shared.modelWorkflowMap = { ...shared.modelWorkflowMap, ...maps.modelWorkflowMap };
  }
  if (maps.modelSamplerMemory) {
    shared.modelSamplerMemory = { ...shared.modelSamplerMemory, ...maps.modelSamplerMemory };
  }
}

function persistSettingsBlobSidecars(cache: SettingsCache): void {
  const updatedAt = typeof cache.updatedAt === 'number' ? cache.updatedAt : Date.now();
  writeBrowserValue(SETTINGS_TOOLS_SIDECAR_KEY, {
    tools: cache.tools ?? {},
    updatedAt,
  });
  writeBrowserValue(SETTINGS_PLUGINS_SIDECAR_KEY, {
    installedPlugins: cache.installedPlugins ?? [],
    updatedAt,
  });
  writeBrowserValue(SETTINGS_MAPS_SIDECAR_KEY, {
    ...peelSettingsMaps(cache.shared),
    updatedAt,
  });
}

/** Main blob without heavy tools/plugins/maps — those live in sidecars. */
function slimSettingsForMainBlob(cache: SettingsCache): SettingsCache {
  const shared: SharedToolSettings = { ...cache.shared };
  shared.modelCheckpointMap = {};
  shared.modelVaeMap = {};
  shared.modelRefinerMap = {};
  shared.modelUpscaleMap = {};
  shared.modelLoraMap = {};
  shared.modelControlNetMap = {};
  shared.modelWorkflowMap = {};
  shared.modelSamplerMemory = {};
  return {
    shared,
    tools: {},
    installedPlugins: [],
    ...(typeof cache.updatedAt === 'number' ? { updatedAt: cache.updatedAt } : {}),
  };
}

function loadSettingsBlobSidecars(): {
  tools?: ToolSettingsCache;
  installedPlugins?: SettingsCache['installedPlugins'];
  maps?: SettingsMapsSidecar | null;
} {
  const toolsRaw = readBrowserValue<{ tools?: unknown; updatedAt?: number }>(
    SETTINGS_TOOLS_SIDECAR_KEY
  );
  const pluginsRaw = readBrowserValue<{
    installedPlugins?: SettingsCache['installedPlugins'];
    updatedAt?: number;
  }>(SETTINGS_PLUGINS_SIDECAR_KEY);
  const mapsRaw = readBrowserValue<SettingsMapsSidecar>(SETTINGS_MAPS_SIDECAR_KEY);
  const tools =
    toolsRaw?.tools && typeof toolsRaw.tools === 'object'
      ? (toolsRaw.tools as ToolSettingsCache)
      : undefined;
  return {
    tools,
    installedPlugins: pluginsRaw?.installedPlugins,
    maps: mapsRaw ?? null,
  };
}

type SessionLoraPrefs = {
  sessionActiveLoraIdsByModel?: SessionActiveLoraIdsByModel;
  sessionLoraStrengthOverridesByModel?: Record<string, SessionLoraStrengthOverrides>;
};

function buildSessionLoraPrefsSidecar(
  shared: SharedToolSettings,
  existing?: SessionLoraPrefs | null
): SessionLoraPrefs | null {
  const byModel = shared.sessionActiveLoraIdsByModel;
  const strengthByModel = shared.sessionLoraStrengthOverridesByModel;
  const hasLoras = byModel && Object.keys(byModel).length > 0;
  const hasStrength = strengthByModel && Object.keys(strengthByModel).length > 0;
  if (!hasLoras && !hasStrength) {
    return null;
  }
  const prefs: SessionLoraPrefs = {};
  if (hasLoras) {
    prefs.sessionActiveLoraIdsByModel = mergeSessionLoraIdsByModel(
      existing?.sessionActiveLoraIdsByModel,
      byModel
    );
  } else if (existing?.sessionActiveLoraIdsByModel) {
    prefs.sessionActiveLoraIdsByModel = existing.sessionActiveLoraIdsByModel;
  }
  if (hasStrength) {
    prefs.sessionLoraStrengthOverridesByModel = {
      ...(existing?.sessionLoraStrengthOverridesByModel ?? {}),
      ...(strengthByModel as Record<string, SessionLoraStrengthOverrides>),
    };
  } else if (existing?.sessionLoraStrengthOverridesByModel) {
    prefs.sessionLoraStrengthOverridesByModel = existing.sessionLoraStrengthOverridesByModel;
  }
  return prefs;
}

function persistCriticalSharedPrefs(shared: SharedToolSettings): void {
  if (typeof window === 'undefined') {
    return;
  }
  writeBrowserString(SYSTEM_WORKFLOWS_PREF_KEY, shared.useSystemWorkflows === true ? '1' : '0');
  const existing = readBrowserValue<SessionLoraPrefs>(SESSION_LORA_PREFS_KEY);
  const nextPrefs = buildSessionLoraPrefsSidecar(shared, existing);
  if (!nextPrefs) {
    return;
  }
  writeBrowserValue(SESSION_LORA_PREFS_KEY, nextPrefs);
}

function applySystemWorkflowsSidecar(shared: SharedToolSettings): void {
  const wfRaw = readBrowserString(SYSTEM_WORKFLOWS_PREF_KEY);
  if (wfRaw === '1') {
    shared.useSystemWorkflows = true;
  } else if (wfRaw === '0') {
    shared.useSystemWorkflows = false;
  }
}

function applyCriticalSharedPrefs(shared: SharedToolSettings): void {
  applySystemWorkflowsSidecar(shared);

  const loraPrefs = readBrowserValue<SessionLoraPrefs>(SESSION_LORA_PREFS_KEY);
  if (loraPrefs?.sessionActiveLoraIdsByModel) {
    shared.sessionActiveLoraIdsByModel = mergeSessionLoraIdsByModel(
      shared.sessionActiveLoraIdsByModel,
      loraPrefs.sessionActiveLoraIdsByModel
    );
  }
  if (loraPrefs?.sessionLoraStrengthOverridesByModel) {
    shared.sessionLoraStrengthOverridesByModel = {
      ...(shared.sessionLoraStrengthOverridesByModel ?? {}),
      ...loraPrefs.sessionLoraStrengthOverridesByModel,
    };
  }
}

/** Memoized result for loadSettingsCache to avoid re-normalizing on hot-path reads. */
let cachedLoadResult: SettingsCache | null = null;
let cachedBrowserVersion: unknown | null = null;
/** Patches queued before IndexedDB KV hydrate — merged and flushed on ready. */
let pendingSettingsCache: SettingsCache | null = null;
let pendingFlushScheduled = false;

function mergePendingSettingsCache(base: SettingsCache | null, next: SettingsCache): SettingsCache {
  if (!base) {
    return next;
  }
  const mergedTools = { ...base.tools } as ToolSettingsCache;
  for (const [toolKey, toolPatch] of Object.entries(next.tools ?? {})) {
    const key = toolKey as keyof ToolSettingsCache;
    (mergedTools as Record<string, unknown>)[key] = {
      ...((mergedTools as Record<string, unknown>)[key] as object | undefined),
      ...(toolPatch as object),
    };
  }
  return {
    shared: { ...base.shared, ...next.shared },
    tools: mergedTools,
    installedPlugins: next.installedPlugins ?? base.installedPlugins,
  };
}

function schedulePendingSettingsFlush(): void {
  if (pendingFlushScheduled) {
    return;
  }
  pendingFlushScheduled = true;
  void whenBrowserStorageReady().then(() => {
    pendingFlushScheduled = false;
    flushPendingSettingsCache();
  });
}

function withPendingSettingsOverlay(result: SettingsCache): SettingsCache {
  if (!pendingSettingsCache) {
    return result;
  }
  return mergePendingSettingsCache(result, pendingSettingsCache);
}

export function notifySettingsCacheUpdated(): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
    return;
  }
  scheduleAfterCommit(() => {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
      return;
    }
    window.dispatchEvent(new Event(SETTINGS_CACHE_UPDATED_EVENT));
  });
}

export type SaveSettingsOptions = {
  /**
   * When false, skip the same-tab `settings-cache-updated` broadcast.
   * Use for routine typing/persist so listeners do not clobber controlled inputs.
   * Cross-tab sync still runs after IndexedDB flush.
   */
  notify?: boolean;
};
function repairSystemWorkflowsFromOnboarding(shared: SharedToolSettings): {
  shared: SharedToolSettings;
  repaired: boolean;
} {
  if (shared.useSystemWorkflows === true) {
    return { shared, repaired: false };
  }
  try {
    const onboardingDone = loadOnboardingState().some(
      step => step.id === 'system-workflows' && step.done
    );
    if (onboardingDone) {
      return { shared: { ...shared, useSystemWorkflows: true }, repaired: true };
    }
  } catch {
    // ignore onboarding read failures
  }
  return { shared, repaired: false };
}

function flushPendingSettingsCache(): void {
  if (!pendingSettingsCache || !isBrowserStorageReady()) {
    return;
  }
  const pending = pendingSettingsCache;
  pendingSettingsCache = null;
  invalidateSettingsCache();
  const fromStore = loadSettingsCache();
  saveSettingsCache(mergePendingSettingsCache(fromStore, pending));
}

export type SharedToolSettings = {
  model: ComfyImageModel;
  detail: DetailLevel;
  /** Shared across people-focused tools; rolls catalog wardrobe when enabled. */
  alwaysIncludeClothing?: boolean;
  /**
   * When true (default), LLM calls get rolled location / wardrobe / environment
   * ingredient seeds. When false, only the user's keywords/hints are sent —
   * better for completionist local models that overfit injected seeds.
   */
  seedLlmWithIngredients?: boolean;
  /** Pin catalog wardrobe across Character/Duo/Batch generations. */
  lockedWardrobeId?: string;
  /** Pin scene location across people-focused generators. */
  lockedLocation?: string;
  /** Pin variation/environment seed for reproducible rolls. */
  lockedVariationSeed?: string;
  /** Auto-apply rule fixes when lint reports errors after generation. */
  autoFixRules?: boolean;
  /** Saved workflow assignment used when queueing from generators. */
  selectedWorkflowFileId?: string;
  /** Auto-select workflow file when target model changes. */
  modelWorkflowMap?: Record<string, string>;
  /** When true (default), pick the mapped workflow when the target model changes. */
  autoSelectWorkflowForModel?: boolean;
  /**
   * When true (default), apply the model LoRA map to the session picker when the
   * target model changes and the user is still following defaults (session unset).
   */
  autoSelectLorasForModel?: boolean;
  /** When true (default), limit the model picker to models with available workflows. */
  limitModelsToAvailableWorkflows?: boolean;
  /**
   * When true, queue uses built-in scaffolds for the target model instead of
   * library / mapped / picker workflow JSON. Checkpoint/VAE/LoRA maps and
   * queue optimize still apply.
   */
  useSystemWorkflows?: boolean;
  /**
   * When system workflows are on, limit the model picker to FLUX/Qwen/video
   * (default true). Set false for hybrid mode: unsupported families keep
   * mapped/manual workflows instead of snapping away.
   */
  systemWorkflowsLimitPicker?: boolean;
  /** Temporary override to show every model in the picker. */
  showAllModelsOverride?: boolean;
  /** Active inference engine (`comfyui` default | `diffusers` optional | cloud APIs). */
  inferenceEngine?: import('./engine/types').EngineId;
  /** Browser Diffusers engine URL (proxied via `/api/diffusers`). */
  diffusersApiUrl?: string;
  /**
   * When Diffusers is unreachable on localhost, Studio spawns
   * `services/diffusers-engine` (server kill-switch: DIFFUSERS_AUTOSTART=0).
   */
  diffusersAutoStart?: boolean;
  /** Fal txt2img model id (e.g. fal-ai/flux/schnell). */
  falModel?: string;
  /** Fal image-to-image model when a reference photo is queued. */
  falImg2ImgModel?: string;
  /** Fal image-to-video model when Roleplay/Video queues a clip on the Fal engine. */
  falI2vModel?: string;
  /** Fal text-to-video model when Video queues a clip without a first frame. */
  falT2vModel?: string;
  /** Fal extend-video model when Roleplay continues an https Fal clip. */
  falExtendModel?: string;
  /** Session Fal API key. Stored in this browser only; server `FAL_KEY` is the fallback. */
  sessionFalApiKey?: string;
  /** Replicate txt2img model id (e.g. black-forest-labs/flux-schnell). */
  replicateModel?: string;
  /** Replicate image-to-image model when a reference photo is queued. */
  replicateImg2ImgModel?: string;
  /** Replicate image-to-video model when Roleplay/Video queues a clip on Replicate. */
  replicateI2vModel?: string;
  /** Replicate text-to-video model when Video queues a clip without a first frame. */
  replicateT2vModel?: string;
  /** Session Replicate token. Stored in this browser only; server `REPLICATE_API_TOKEN` is the fallback. */
  sessionReplicateApiToken?: string;
  openaiModel?: string;
  openaiImg2ImgModel?: string;
  sessionOpenaiApiKey?: string;
  geminiModel?: string;
  geminiImg2ImgModel?: string;
  sessionGeminiApiKey?: string;
  grokModel?: string;
  grokImg2ImgModel?: string;
  sessionGrokApiKey?: string;
  /** Runway Gen-4 stills model id (e.g. gen4_image). */
  runwayModel?: string;
  /** Runway image-to-image model when a reference photo is queued. */
  runwayImg2ImgModel?: string;
  /** Runway image-to-video model (Gen-4.5 / Gen-4 Turbo). */
  runwayI2vModel?: string;
  /** Runway text-to-video model. */
  runwayT2vModel?: string;
  /** Runway video-to-video / extend model (Aleph). */
  runwayExtendModel?: string;
  /** Session Runway API key. Stored in this browser only; server `RUNWAY_API_KEY` is the fallback. */
  sessionRunwayApiKey?: string;
  /**
   * Diffusers workshop crop: auto-detect craft roles, always hide hands,
   * or never force the head-and-shoulders crop.
   */
  diffusersWorkshopCrop?: 'auto' | 'always' | 'never';
  /** Session LLM temperature override (0–2) sent with generation requests. */
  sessionLlmTemperature?: number;
  /** Session override for template fallback when LLM fails. */
  sessionAllowTemplateFallback?: boolean;
  /** Session override for the text LLM model (undefined = server LLM_MODEL default). */
  sessionLlmModel?: string;
  /** Session override for the vision LLM model (undefined = server LLM_VISION_MODEL default). */
  sessionLlmVisionModel?: string;
  /** Session override for the embedding model (undefined = server LLM_EMBED_MODEL). */
  sessionLlmEmbedModel?: string;
  /** Extra ComfyUI pool URLs merged with COMFYUI_POOL at queue time. */
  comfyPoolUrls?: string[];
  /** Session LLM enabled override (undefined = server default; false = template-only for this browser). */
  sessionLlmEnabled?: boolean;
  /** Public LLM provider for this browser (`server` = env LLM_API_BASE_URL). */
  sessionLlmProvider?: import('./llm-providers').SessionLlmProvider;
  /** Session API key for OpenRouter / Groq. Stored in this browser only. */
  sessionLlmApiKey?: string;
  /** Pinned character appearance block injected into Character/Duo generations. */
  activeCharacterDescriptor?: string;
  /** Active Character OS record id (`comfy-prompt-characters-v1`). */
  activeCharacterId?: string;
  /** Active look on that character (haircut / wardrobe era). */
  activeLookId?: string;
  /** KSampler preset tier applied when queueing (base, optimized, max compatible, or max quality). */
  modelSamplerPreset?: ModelSamplerPresetTier;
  /** Optional sidebar overrides for KSampler fields; blank = use preset defaults. */
  modelSamplerOverrides?: ModelSamplerOverrideFields;
  /** When true (default), wire Flux2Klein Enhancer on Klein compose/reference queues when installed. */
  kleinEnhancerEnabled?: boolean;
  kleinEnhancerIdentityPreset?: KleinEnhancerIdentityPreset;
  /** When true (default), wire Flux2KleinTextEnhancer on Klein T2I + compose positive conditioning. */
  kleinEnhancerTextEnabled?: boolean;
  /** When true (default), wire Color Anchor on Klein compose model path. */
  kleinEnhancerColorAnchorEnabled?: boolean;
  kleinEnhancerColorAnchorStrength?: number;
  /** Latent orientation preset applied when queueing. */
  modelResolutionOrientation?: ResolutionOrientation;
  /** Latent size tier applied when queueing (small / medium / max). */
  modelResolutionSizeTier?: ResolutionSizeTier;
  /** Auto-adjust positive/negative prompts for realistic renders on queue. */
  renderRealismMode?: RenderRealismMode;
  /** Auto-adjust prompts to reduce mutations and extra limbs on queue. */
  anatomyGuardMode?: AnatomyGuardMode;
  /** When true (default), patch EmptyLatentImage and loader nodes directly at queue time. */
  directWorkflowPatching?: boolean;
  /** When true, overwrite hardcoded checkpoint/UNET/VAE/CLIP filenames with the target model at queue time. */
  syncWorkflowLoadersToModel?: boolean;
  /** When true (default), auto-bind placeholders and audit workflow structure at queue time. */
  workflowQueueOptimize?: boolean;
  /** When true (default), insert model-sampling nodes into imported FLUX/SD3 workflows at queue time. */
  workflowGraphEnrich?: boolean;
  /** When true (default), insert SDXL refiner pass on Final/Max when refiner map is set. */
  workflowSdxlRefinerEnrich?: boolean;
  /** When true (default), chain Lanczos polish after neural UpscaleModel on Max. */
  workflowNeuralUpscalePolish?: boolean;
  /** When true, add subtle ImageSharpen after upscale on Max (off by default — sharpen can look waxy on skin). */
  workflowSharpenAfterUpscale?: boolean;
  /**
   * When true (default), Draft queues save via WebP when a compatible ComfyUI
   * save node is installed; Final/Max keep PNG.
   */
  compactDraftSaves?: boolean;
  /** Overrides sidebar sampler/resolution when queueing (draft / final / max). */
  queueQualityProfile?: QueueQualityProfile;
  /**
   * Session intent shortcuts: Iterate → Draft, Keeper → Final.
   * Cleared when the user picks Max / Follow settings manually.
   */
  sessionQueueMode?: 'iterate' | 'keeper' | 'off';
  /** When true, Max gallery Upscale/Moiré jobs wait until ComfyUI queue is idle. */
  holdMaxUntilIdle?: boolean;
  /** When true (default), Max→Final if free VRAM is below the threshold. */
  vramGuardEnabled?: boolean;
  /** Free VRAM (GB) below which Max enrich downgrades to Final. */
  vramGuardMinFreeGb?: number;
  /** When true, call ComfyUI's `/free` (unload + free VRAM) after a Max-quality gallery job completes. */
  freeVramAfterMax?: boolean;
  /** Per-model sampler params learned from 4–5★ gallery ratings. */
  modelSamplerMemory?: import('./sampler-memory').ModelSamplerMemoryMap;
  /** Per-tool queue quality overrides (tool id → profile). */
  toolQueueQualityProfiles?: import('./tool-quality-profiles').ToolQueueQualityProfiles;
  /** Named quality recipes (model + profile + optional LoRA session). */
  toolQualityRecipes?: import('./tool-quality-recipes').ToolQualityRecipe[];
  /** Per-model checkpoint filename overrides for loader patching (modelId=filename). */
  modelCheckpointMap?: ModelCheckpointMap;
  /** Per-model VAE filename overrides for VAELoader patching (modelId=filename). */
  modelVaeMap?: ModelVaeMap;
  /** Per-model SDXL refiner checkpoint overrides (modelId=filename). */
  modelRefinerMap?: ModelRefinerMap;
  /** Per-model UpscaleModel loader filenames (modelId or default=filename). */
  modelUpscaleMap?: ModelUpscaleMap;
  /**
   * Per-model default LoRA library ids (modelId=id1,id2). Empty value = no LoRAs.
   * Used when this model has no entry in sessionActiveLoraIdsByModel.
   */
  modelLoraMap?: ModelLoraMap;
  /** Per-model ControlNet filenames (modelId or default=filename). */
  modelControlNetMap?: import('./model-controlnet-map').ModelControlNetMap;
  /**
   * Session IP-Adapter identity/style reference(s).
   * At queue time, patches existing {{IPADAPTER_*}} tokens/nodes or auto-inserts
   * a minimal IPAdapter chain when none exist (requires ComfyUI-IPAdapter-Plus
   * class nodes). Extra filenames stack additional Apply nodes. When IP-Adapter
   * Plus is missing, InstantID/PuLID auto-insert is attempted as a fallback.
   */
  ipAdapterImageFilename?: string;
  /** Extra IP-Adapter refs (index 0 mirrors ipAdapterImageFilename). */
  ipAdapterImageFilenames?: string[];
  /** Convenience source URL for the IP-Adapter reference — uploaded to ComfyUI on queue. */
  ipAdapterImageUrl?: string;
  /** IP-Adapter weight (0–1) patched onto IPAdapter-family nodes at queue time. */
  ipAdapterStrength?: number;
  /** Optional ipadapter_file filename override for {{IPADAPTER_MODEL}}. */
  ipAdapterModelFilename?: string;
  /** Preferred identity insert: IP-Adapter, InstantID, PuLID, or auto fallback. */
  identityKind?: import('./compose-identity-lock').ComposeIdentityKind;
  /** Comfy host that holds ipAdapterImageFilename (pin queue when identity is on). */
  ipAdapterComfyUrl?: string;
  /**
   * Current-model LoRA picks mirrored for queue/recipes. Prefer
   * sessionActiveLoraIdsByModel for per-model persistence.
   */
  sessionActiveLoraIds?: string[];
  /**
   * Textual-inversion embedding stems (SD/SDXL). Appended as embedding:name at queue time.
   */
  sessionEmbeddingTokens?: string[];
  /**
   * Per-model session LoRA picks. Key present (even with []) = explicit override
   * for that model; missing key = follow model LoRA map / library enabled.
   */
  sessionActiveLoraIdsByModel?: SessionActiveLoraIdsByModel;
  /** Session-only LoRA strength tweaks (merged at queue time; does not change library defaults). */
  sessionLoraStrengthOverrides?: SessionLoraStrengthOverrides;
  /** Per-model session LoRA strength tweaks (preferred over global legacy field). */
  sessionLoraStrengthOverridesByModel?: import('./model-lora-map').SessionLoraStrengthOverridesByModel;
  /** Tiled neural upscale tile size (0 disables tiling). Overrides Max default when set. */
  neuralUpscaleTileSize?: number;
  /** Prefer mapped library workflow with upscale nodes for gallery upscale actions. */
  useLibraryUpscaleWorkflow?: boolean;
  /** img2img / edit denoise strength (0.05–1) applied when queueing with an input image. */
  editDenoiseStrength?: number;
  /**
   * Gentle / Balanced / Strong for Z-Image Turbo img2img, Boogu Edit Turbo,
   * and Klein Distilled. Z-Image maps to denoise; Boogu / Klein wrap the
   * instruction (denoise stays 1).
   */
  turboEditStrength?: import('./turbo-edit-strength').TurboEditStrength;
  /**
   * Default denoise for the gallery "Face detail" requeue action — feeds
   * {{FACE_DETAIL_DENOISE}} (and {{DENOISE}}) on the resolved workflow.
   */
  faceDetailerDenoise?: number;
  /**
   * Drop stored exact-replay workflow graphs older than N days (0 = keep forever).
   * Default 30. List UI already strips graphs; this prunes IndexedDB bodies.
   */
  galleryWorkflowRetentionDays?: number;
  /** Max total bytes of stored exact-replay graphs (0 = unlimited). */
  galleryWorkflowMaxBytes?: number;
  /**
   * When true (default), stamp promptVersion / promptContentHash / versionRootId
   * on history saves and show vN labels in Studio.
   */
  promptVersioningEnabled?: boolean;
  /** @deprecated Use selectedWorkflowFileId */
  selectedWorkflowPresetId?: string;
  /** When true (default), expand `__name__` / `{a|b|c}` wildcard tokens before queueing. */
  expandWildcards?: boolean;
  /** Optional seed for reproducible wildcard expands (blank = fresh random roll each queue). */
  wildcardSeed?: string;
  /** User-defined `__name__` list overrides/additions layered on top of the built-in defaults. */
  wildcardLists?: import('./wildcard-expand').WildcardMap;
  /** When true (default), auto-retry once on OOM/CUDA/execution_error gallery job failures. */
  autoRetryOnOom?: boolean;
  /** When true (default), downgrade Max→Final / Final→Draft on OOM auto-retry. */
  oomRetryDowngrade?: boolean;
  /**
   * Preferred ComfyUI pool host URL. When set and the host is in COMFYUI_POOL
   * and healthy-ish, queue routing prefers it over VRAM-aware / round-robin picks.
   */
  preferredComfyHost?: string;
  /** When true (default), rotate away from pool hosts whose queue exceeds the busy threshold. */
  comfyPoolLoadBalance?: boolean;
  /** Pending + running jobs above which a pool host is skipped (default 4). */
  comfyPoolBusyThreshold?: number;
  /** Last-used gallery LoRA dataset export prefs (trigger + caption mode). */
  loraDatasetExportPrefs?: import('./lora-train-job').LoraDatasetExportPrefs;
  /** External LoRA trainer URL / command / output prefs (app owns the loop). */
  loraTrainTrainerPrefs?: import('./lora-train-job').LoraTrainTrainerPrefs;
  /** Recent LoRA train jobs (localStorage / Dexie settings slice). */
  loraTrainJobs?: import('./lora-train-job').TrainJob[];
};

export type GenerateSource = 'keywords' | 'random';

export type GenerateToolCache = {
  mode?: 'positive' | 'negative';
  generateSource?: GenerateSource;
  hintSource?: import('./scene-hint-source').SceneHintSource;
  historySeedScope?: import('./scene-hint-source').HistorySeedScope;
  lastHistorySeedEntryId?: string;
  /** Persisted keyword / scene draft for Generate. */
  hints?: string;
  variationEnabled?: boolean;
  variationStrength?: number;
  distinctPeople?: boolean;
  sportPresetId?: string;
  sceneStarterCategory?: import('./scene-starter-presets').SceneStarterCategory | 'all';
  sceneStarterPresetId?: string;
  sceneStarterQuery?: string;
  sceneStarterFraming?: import('./scene-starter-presets').SceneStarterFramingFilter;
  sceneStarterTags?: string[];
  /** Optional theme steer for random surprise mode. */
  genre?: string;
  includePeople?: boolean;
  wildness?: number;
};

export type FormatToolCache = {
  mode?: 'positive' | 'negative';
  smartFormat?: boolean;
  /** Persisted Format draft input. */
  draft?: string;
};

export type PromptEditorToolCache = {
  hints?: string;
  positive?: string;
  negative?: string;
};

export type RefineToolCache = {
  intentHints?: string;
  currentPrompt?: string;
  regionalSlots?: import('./regional-prompt-slots').RegionalPromptSlot[];
  hintSource?: import('./scene-hint-source').SceneHintSource;
  historySeedScope?: import('./scene-hint-source').HistorySeedScope;
  lastHistorySeedEntryId?: string;
  randomTheme?: string;
};

export type InpaintToolCache = {
  maskDescription?: string;
  changeDescription?: string;
  directPrompt?: string;
  regionalSlots?: import('./regional-prompt-slots').RegionalPromptSlot[];
  hintSource?: import('./scene-hint-source').SceneHintSource;
  historySeedScope?: import('./scene-hint-source').HistorySeedScope;
  lastHistorySeedEntryId?: string;
  randomTheme?: string;
};

/** Outpaint / expand — pad canvas + border mask. */
export type OutpaintToolCache = {
  intent?: string;
  padTop?: number;
  padRight?: number;
  padBottom?: number;
  padLeft?: number;
  hintSource?: import('./scene-hint-source').SceneHintSource;
  historySeedScope?: import('./scene-hint-source').HistorySeedScope;
  lastHistorySeedEntryId?: string;
  randomTheme?: string;
};

/** Compose / Transfer tool — key is `imageCompose` (legacy `compose` was CharacterTool). */
export type ImageComposeToolCache = {
  instruction?: string;
  mode?: 'transfer' | 'modify';
  /** Last figure-slot count hint (1–4). */
  figureCountHint?: number;
  /**
   * Multi-image vision transfer scan recipe.
   * Default: pose from Image 1, people from Image 2+.
   */
  transferScanRecipe?: 'pose-from-1-people-from-rest' | 'people-from-1-pose-from-2';
  /**
   * Cut Image 1 onto a white plate before queueing so edit models cannot lock
   * onto the original background. Default on; Images 2–4 are left intact.
   */
  isolateSubject?: boolean;
  /** Pull identity from Figure 1 via IP-Adapter at queue time. */
  identityLock?: boolean;
  /** IP-Adapter weight when identityLock is on (default 0.5). */
  identityLockStrength?: number;
  /** Identity backend when lock is on (default ipadapter). */
  identityKind?: import('./compose-identity-lock').ComposeIdentityKind;
  regionalSlots?: import('./regional-prompt-slots').RegionalPromptSlot[];
  hintSource?: import('./scene-hint-source').SceneHintSource;
  historySeedScope?: import('./scene-hint-source').HistorySeedScope;
  lastHistorySeedEntryId?: string;
  randomTheme?: string;
};

export type ControlNetSlotPreset = {
  id: string;
  name: string;
  mode?: import('./controlnet-prompt').ControlNetMode;
  subject?: string;
  scene?: string;
  detailNotes?: string;
  slotStrengths?: number[];
  slotModes?: import('./controlnet-prompt').ControlNetMode[];
  updatedAt?: number;
};

export type ControlNetToolCache = {
  mode?: import('./controlnet-prompt').ControlNetMode;
  subject?: string;
  scene?: string;
  /** Extra constraints — not DetailLevel. */
  detailNotes?: string;
  /** Per-slot ControlNetApply strengths (up to 4). */
  slotStrengths?: number[];
  /** Per-slot conditioning modes (up to 4). */
  slotModes?: import('./controlnet-prompt').ControlNetMode[];
  /** Named slot/mode presets (images stay ephemeral). */
  presets?: ControlNetSlotPreset[];
  hintSource?: import('./scene-hint-source').SceneHintSource;
  historySeedScope?: import('./scene-hint-source').HistorySeedScope;
  lastHistorySeedEntryId?: string;
  randomTheme?: string;
};

export type VideoToolCache = {
  subject?: string;
  motion?: string;
  camera?: string;
  style?: string;
  durationSec?: number;
  /** Last video-category model chosen on `/video` (survives other tools changing shared.model). */
  model?: import('./comfy-models/client').ComfyImageModel;
  /** Optional I2V reference frame — a ComfyUI-uploaded filename or a fetchable URL. */
  initImageUrl?: string;
  /** Explicit T2V vs I2V vs extend. Gallery stills force i2v; empty frame is t2v. */
  clipMode?: import('./video-clip-mode').VideoClipMode;
  /** Parent clip URL for Fal extend-video (public Fal URL or local view URL). */
  parentVideoUrl?: string;
  /** Frame count / length fed to {{VIDEO_FRAMES}} at queue time. */
  frames?: number;
  /** Output frame rate fed to {{VIDEO_FPS}} at queue time. */
  fps?: number;
  hintSource?: import('./scene-hint-source').SceneHintSource;
  historySeedScope?: import('./scene-hint-source').HistorySeedScope;
  lastHistorySeedEntryId?: string;
  randomTheme?: string;
};

export type AudioToolCache = {
  subject?: string;
  mood?: string;
  instruments?: string;
  durationSec?: number;
};

export type MeshToolCache = {
  subject?: string;
  materials?: string;
  style?: string;
  resolution?: number;
};

export type LogoToolCache = {
  brandName?: string;
  tagline?: string;
  industry?: string;
  stylePreset?: import('./logo-presets').LogoStylePresetId;
  motif?: import('./logo-presets').LogoMotifId;
  colorPrimary?: string;
  colorSecondary?: string;
  colorAccent?: string;
  includeWordmark?: boolean;
  extraNotes?: string;
};

export type LintToolCache = {
  hints?: string;
  prompt?: string;
};

import type { CharacterPresetOptions } from './character-options';

export type CharacterSceneMode = 'solo' | 'duo' | 'compose';

export type CharacterToolCache = {
  hints?: string;
  hintSource?: import('./scene-hint-source').SceneHintSource;
  historySeedScope?: import('./scene-hint-source').HistorySeedScope;
  randomTheme?: string;
  lastHistorySeedEntryId?: string;
  sceneMode?: CharacterSceneMode;
  portraitStyle?: 'portrait' | 'full-body' | 'action';
  variationStrength?: number;
  sportPresetId?: string;
  sceneStarterCategory?: import('./scene-starter-presets').SceneStarterCategory | 'all';
  sceneStarterPresetId?: string;
  sceneStarterQuery?: string;
  sceneStarterFraming?: import('./scene-starter-presets').SceneStarterFramingFilter;
  sceneStarterTags?: string[];
  teamKit?: boolean;
  batchCount?: number;
  composeSubjectMode?: 'character' | 'duo';
  composeStyle?: 'layered' | 'inline';
  settingType?: string;
  timeOfDay?: string;
  mood?: string;
  /** Regional prompt segments for {{REGION_*}} queue injection. */
  regionalSegments?: import('./regional-prompt-builder').RegionalPromptSegment[];
} & Partial<CharacterPresetOptions> &
  Partial<Omit<BackgroundPresetOptions, 'surfaceMaterials'>> & {
    surfaceMaterials?: string;
  };

import type { BackgroundPresetOptions } from './background-options';

export type BackgroundToolCache = {
  settingType?: string;
  timeOfDay?: string;
  mood?: string;
  hintSource?: import('./scene-hint-source').SceneHintSource;
  historySeedScope?: import('./scene-hint-source').HistorySeedScope;
  randomTheme?: string;
  lastHistorySeedEntryId?: string;
  surfaceMaterials?: string;
} & Partial<Omit<BackgroundPresetOptions, 'surfaceMaterials'>>;

import type { FantasyPresetOptions, FantasyShotFraming } from './fantasy-options';
import type { PetPresetOptions } from './pet-options';

export type PetToolCache = {
  hints?: string;
  hintSource?: import('./scene-hint-source').SceneHintSource;
  historySeedScope?: import('./scene-hint-source').HistorySeedScope;
  randomTheme?: string;
  lastHistorySeedEntryId?: string;
  portraitStyle?: 'portrait' | 'full-body' | 'action';
  variationStrength?: number;
  petPresetId?: string;
  presetCategory?: 'all' | 'dog' | 'cat' | 'bird' | 'rabbit' | 'small';
} & Partial<PetPresetOptions>;

export type FantasyToolCache = {
  hints?: string;
  hintSource?: import('./scene-hint-source').SceneHintSource;
  historySeedScope?: import('./scene-hint-source').HistorySeedScope;
  randomTheme?: string;
  lastHistorySeedEntryId?: string;
  portraitStyle?: FantasyShotFraming;
  wildness?: number;
  variationStrength?: number;
  fantasyPresetId?: string;
  presetCategory?:
    'all' | 'character' | 'creature' | 'environment' | 'epic' | 'dark' | 'fairy' | 'celestial';
} & Partial<FantasyPresetOptions>;

export type NsfwGeneratorToolCache = {
  hints?: string;
  hintSource?: import('./scene-hint-source').SceneHintSource;
  wildness?: number;
  nsfwPresetId?: string;
  presetCategory?: 'all' | import('./nsfw-generator-presets').NsfwPresetCategory;
  duoOnly?: boolean;
};

export type MobileStudioToolCache = {
  plates?: import('./mobile-studio').CharacterPlate[];
  activePlateId?: string;
};

export type RoleplayToolCache = {
  personaId?: string;
  customPersona?: string;
  characterName?: string;
  extraHints?: string;
  setting?: string;
  tone?: import('./roleplay').RoleplayTone;
  content?: import('./roleplay').RoleplayContentId;
  playAs?: import('./roleplay').RoleplayPlayAs;
  referenceImageUrl?: string;
  referenceImageFilename?: string;
  referenceOriginalUrl?: string;
  referenceOriginalFilename?: string;
  isolateSubject?: boolean;
  referenceIsolated?: boolean;
  bio?: import('./roleplay').RoleplayBio;
  story?: import('./roleplay').RoleplayStoryBeat[];
  /** Unpicked beat cards remembered across rolls for continuity. */
  rejectedScenes?: import('./roleplay').RoleplayScene[];
  autoQueue?: boolean;
  /** Still frames only, or still-then-clip / clip-to-clip film loop. Default clip. */
  beatOutput?: 'still' | 'clip';
  allowGore?: boolean;
  activeSessionId?: string;
};

/** Fitting Room — outfit try-on from a Cast plate + locked wardrobe kit. */
export type FittingToolCache = {
  isolateSubject?: boolean;
  referenceIsolated?: boolean;
  referenceImageUrl?: string;
  referenceImageFilename?: string;
  referenceOriginalUrl?: string;
  referenceOriginalFilename?: string;
  /** Optional freeform notes layered onto the outfit edit instruction. */
  notes?: string;
  /** Filter full-catalog wardrobe kits by clothing type. */
  wardrobeCategoryFilter?: import('./wardrobe-catalog-ui').WardrobeCategoryFilter;
  /** Lazy draft try-on thumbs keyed by wardrobeId::lookId. */
  kitPreviews?: Record<string, import('./fitting-kit-previews').FittingKitPreview>;
  /** Auto-queue draft previews for the swipe deck when a plate is ready. */
  autoKitPreviews?: boolean;
  /** White cut-out plate used only for draft kit previews (sidecar; main ref unchanged). */
  previewPlateFilename?: string;
  previewPlateUrl?: string;
  previewPlateSourceKey?: string;
};

/** Day Planner — time-of-day slots with wardrobe + scene beats for one character. */
export type DayToolCache = {
  slots?: import('./day-planner').DaySlot[];
  /** Completed / in-flight stills for the day reel and Cut film. */
  stills?: import('./day-planner').DaySlotStill[];
  notes?: string;
  /** Filter slot wardrobe kits by clothing type. */
  wardrobeCategoryFilter?: import('./wardrobe-catalog-ui').WardrobeCategoryFilter;
};

/** Moodboard → Scene — reference tiles merged into one scene prompt. */
export type MoodboardToolCache = {
  tiles?: import('./moodboard-scene').MoodboardTile[];
  templateId?: import('./moodboard-scene').MoodboardTemplateId;
  instruction?: string;
};

export type ImagePromptToolCache = {
  focus?: 'full' | 'subject' | 'background' | 'style';
  descriptionPreset?: import('./image-prompt-presets').ImagePromptDescriptionPreset;
  extraHints?: string;
  hintSource?: import('./scene-hint-source').SceneHintSource;
  historySeedScope?: import('./scene-hint-source').HistorySeedScope;
  lastHistorySeedEntryId?: string;
  randomTheme?: string;
};

export type TopicToolCache = {
  seedTopic?: string;
  hintSource?: import('./scene-hint-source').SceneHintSource;
  historySeedScope?: import('./scene-hint-source').HistorySeedScope;
  randomTheme?: string;
  lastHistorySeedEntryId?: string;
  count?: number;
  variety?: number;
  batchTarget?: 'generate' | 'duo' | 'character' | 'pet' | 'fantasy' | 'background';
};

export type NegativeToolCache = {
  sport?: string;
  preserveSubject?: boolean;
  extra?: string;
};

export type StudioToolCache = {
  compareModelB?: string;
  compareVisualSeed?: string;
  templateId?: string;
  templateSlots?: Record<string, string>;
  catalogTab?: 'clothing' | 'locations';
  locationBlocklist?: string[];
  savedIdentityBundles?: import('./character-identity-bundle').CharacterIdentityBundle[];
};

export type VariationsToolCache = {
  hints?: string;
  hintSource?: import('./scene-hint-source').SceneHintSource;
  historySeedScope?: import('./scene-hint-source').HistorySeedScope;
  randomTheme?: string;
  lastHistorySeedEntryId?: string;
  count?: number;
  variationStrength?: number;
  target?: 'generate' | 'character' | 'duo' | 'pet' | 'fantasy' | 'background';
  gridMode?: 'roll' | 'matrix' | 'imported';
  matrixAxisRow?: 'variation' | 'sportPreset' | 'location';
  matrixAxisCol?: 'variation' | 'sportPreset' | 'location';
  matrixRowCount?: number;
  matrixColCount?: number;
  portraitStyle?: 'portrait' | 'full-body' | 'action';
  sportPresetId?: string;
  importedBatchPrompts?: string[];
  importedBatchTopics?: string[];
};

export type ToolSettingsCache = {
  generate?: GenerateToolCache;
  format?: FormatToolCache;
  promptEditor?: PromptEditorToolCache;
  refine?: RefineToolCache;
  inpaint?: InpaintToolCache;
  outpaint?: OutpaintToolCache;
  /** Compose / Transfer multi-image edit (not CharacterTool legacy `compose`). */
  imageCompose?: ImageComposeToolCache;
  controlnet?: ControlNetToolCache;
  video?: VideoToolCache;
  audio?: AudioToolCache;
  mesh?: MeshToolCache;
  logo?: LogoToolCache;
  lint?: LintToolCache;
  background?: BackgroundToolCache;
  pet?: PetToolCache;
  fantasy?: FantasyToolCache;
  nsfwGenerator?: NsfwGeneratorToolCache;
  roleplay?: RoleplayToolCache;
  fitting?: FittingToolCache;
  day?: DayToolCache;
  moodboard?: MoodboardToolCache;
  mobileStudio?: MobileStudioToolCache;
  character?: CharacterToolCache;
  imagePrompt?: ImagePromptToolCache;
  topics?: TopicToolCache;
  negative?: NegativeToolCache;
  studio?: StudioToolCache;
  variations?: VariationsToolCache;
};

/** @internal Legacy keys merged into character/generate on load. */
type LegacyToolSettingsCache = ToolSettingsCache & {
  randomScene?: Pick<GenerateToolCache, 'genre' | 'includePeople' | 'wildness'>;
  duo?: Pick<
    CharacterToolCache,
    'hints' | 'portraitStyle' | 'variationStrength' | 'sportPresetId' | 'teamKit' | 'batchCount'
  >;
  compose?: Pick<
    CharacterToolCache,
    | 'hints'
    | 'portraitStyle'
    | 'variationStrength'
    | 'teamKit'
    | 'composeStyle'
    | 'settingType'
    | 'timeOfDay'
    | 'mood'
    | 'surfaceMaterials'
  > &
    Partial<CharacterPresetOptions> &
    Partial<Omit<BackgroundPresetOptions, 'surfaceMaterials'>> & {
      subjectMode?: 'character' | 'duo';
    };
};

export type SettingsCache = {
  shared: SharedToolSettings;
  tools: ToolSettingsCache;
  /** Installed plugin runtime manifests (Sprint 8). */
  installedPlugins?: import('./plugin-manifest').PluginManifest[];
  /** Monotonic save timestamp for merge / sync conflict resolution. */
  updatedAt?: number;
};

export const DEFAULT_SHARED_SETTINGS: SharedToolSettings = {
  // ComfyUI owns generate (Lightning bf16 + enrich); Diffusers is optional.
  inferenceEngine: 'comfyui',
  diffusersAutoStart: true,
  model: DEFAULT_QWEN_MODEL,
  detail: 'balanced',
  alwaysIncludeClothing: true,
  seedLlmWithIngredients: true,
  autoFixRules: true,
  modelSamplerPreset: 'base',
  modelSamplerOverrides: {},
  kleinEnhancerEnabled: true,
  kleinEnhancerTextEnabled: true,
  kleinEnhancerColorAnchorEnabled: true,
  kleinEnhancerColorAnchorStrength: 0.45,
  modelResolutionOrientation: DEFAULT_RESOLUTION_ORIENTATION,
  modelResolutionSizeTier: DEFAULT_RESOLUTION_SIZE_TIER,
  renderRealismMode: DEFAULT_RENDER_REALISM_MODE,
  anatomyGuardMode: DEFAULT_ANATOMY_GUARD_MODE,
  directWorkflowPatching: true,
  syncWorkflowLoadersToModel: false,
  workflowQueueOptimize: true,
  workflowGraphEnrich: true,
  workflowSdxlRefinerEnrich: true,
  workflowNeuralUpscalePolish: true,
  workflowSharpenAfterUpscale: true,
  compactDraftSaves: true,
  neuralUpscaleTileSize: 512,
  useLibraryUpscaleWorkflow: false,
  queueQualityProfile: 'followSettings',
  sessionQueueMode: 'off',
  holdMaxUntilIdle: false,
  vramGuardEnabled: true,
  vramGuardMinFreeGb: 6,
  freeVramAfterMax: false,
  modelSamplerMemory: {},
  toolQueueQualityProfiles: SUGGESTED_TOOL_QUEUE_QUALITY_PROFILES,
  toolQualityRecipes: mergeToolQualityRecipes(undefined),
  modelCheckpointMap: {},
  modelVaeMap: {},
  modelRefinerMap: {},
  modelUpscaleMap: {},
  modelLoraMap: {},
  sessionActiveLoraIdsByModel: {},
  sessionEmbeddingTokens: [],
  sessionLoraStrengthOverrides: {},
  sessionLoraStrengthOverridesByModel: {},
  autoSelectWorkflowForModel: true,
  autoSelectLorasForModel: true,
  limitModelsToAvailableWorkflows: true,
  useSystemWorkflows: false,
  systemWorkflowsLimitPicker: true,
  showAllModelsOverride: false,
  ipAdapterStrength: 0.6,
  identityKind: 'ipadapter',
  expandWildcards: true,
  autoRetryOnOom: true,
  oomRetryDowngrade: true,
  // Keep in sync with DEFAULT_FACE_DETAIL_DENOISE in gallery-output-face-detail.ts
  // (not imported here to avoid a module cycle through comfyui-config.ts).
  faceDetailerDenoise: 0.35,
  turboEditStrength: 'balanced',
  galleryWorkflowRetentionDays: 30,
  galleryWorkflowMaxBytes: 8 * 1024 * 1024,
  promptVersioningEnabled: true,
  preferredComfyHost: undefined,
  comfyPoolUrls: [],
  comfyPoolLoadBalance: true,
  comfyPoolBusyThreshold: 4,
};

export const DEFAULT_GENERATE_TOOL_CACHE: GenerateToolCache = {
  mode: 'positive',
  generateSource: 'keywords',
  hintSource: 'manual',
  historySeedScope: 'related',
  hints: '',
  variationEnabled: DEFAULT_VARIATION_SETTINGS.enabled,
  variationStrength: DEFAULT_VARIATION_SETTINGS.strength,
  distinctPeople: true,
  genre: '',
  includePeople: true,
  wildness: 65,
};

export const DEFAULT_FORMAT_TOOL_CACHE: FormatToolCache = {
  mode: 'positive',
  smartFormat: true,
  draft: '',
};

export const DEFAULT_PROMPT_EDITOR_TOOL_CACHE: PromptEditorToolCache = {
  hints: '',
  positive: '',
  negative: '',
};

export const DEFAULT_REFINE_TOOL_CACHE: RefineToolCache = {
  intentHints: '',
  currentPrompt: '',
  hintSource: 'manual',
  historySeedScope: 'related',
};

export const DEFAULT_INPAINT_TOOL_CACHE: InpaintToolCache = {
  maskDescription: '',
  changeDescription: '',
  directPrompt: '',
  hintSource: 'manual',
  historySeedScope: 'related',
};

export const DEFAULT_OUTPAINT_TOOL_CACHE: OutpaintToolCache = {
  intent: 'continue the scene naturally with matching lighting',
  padTop: 128,
  padRight: 128,
  padBottom: 128,
  padLeft: 128,
  hintSource: 'manual',
  historySeedScope: 'related',
};

export const DEFAULT_IMAGE_COMPOSE_TOOL_CACHE: ImageComposeToolCache = {
  instruction: '',
  mode: 'transfer',
  figureCountHint: 2,
  transferScanRecipe: 'pose-from-1-people-from-rest',
  isolateSubject: true,
  identityLock: false,
  identityLockStrength: 0.5,
  identityKind: 'ipadapter',
  hintSource: 'manual',
  historySeedScope: 'related',
};

export const DEFAULT_CONTROLNET_TOOL_CACHE: ControlNetToolCache = {
  mode: 'depth',
  subject: '',
  scene: '',
  detailNotes: '',
  slotStrengths: [1, 1, 1, 1],
  slotModes: ['depth', 'depth', 'depth', 'depth'],
  presets: [],
  hintSource: 'manual',
  historySeedScope: 'related',
};

export const DEFAULT_VIDEO_TOOL_CACHE: VideoToolCache = {
  subject: '',
  motion: '',
  camera: '',
  style: '',
  durationSec: 4,
  clipMode: 't2v',
  hintSource: 'manual',
  historySeedScope: 'related',
};

export const DEFAULT_AUDIO_TOOL_CACHE: AudioToolCache = {
  subject: '',
  mood: '',
  instruments: '',
  durationSec: 10,
};

export const DEFAULT_MESH_TOOL_CACHE: MeshToolCache = {
  subject: '',
  materials: '',
  style: '',
  resolution: 512,
};

export const DEFAULT_LOGO_TOOL_CACHE: LogoToolCache = {
  brandName: '',
  tagline: '',
  industry: '',
  stylePreset: 'app-icon',
  motif: 'studio-bars',
  colorPrimary: '#5eead4',
  colorSecondary: '#38bdf8',
  colorAccent: '#f0ab7c',
  includeWordmark: true,
  extraNotes: '',
};

export const DEFAULT_LINT_TOOL_CACHE: LintToolCache = {
  hints: '',
  prompt: '',
};

export const DEFAULT_CHARACTER_TOOL_CACHE: CharacterToolCache = {
  hints: '',
  hintSource: 'manual',
  historySeedScope: 'related',
  randomTheme: '',
  sceneMode: 'solo',
  portraitStyle: 'portrait',
  variationStrength: 50,
  sportPresetId: '',
  teamKit: false,
  batchCount: 3,
  composeSubjectMode: 'duo',
  composeStyle: 'layered',
  settingType: '',
  timeOfDay: '',
  mood: '',
};

export const DEFAULT_BACKGROUND_TOOL_CACHE: BackgroundToolCache = {
  hintSource: 'manual',
  historySeedScope: 'related',
  randomTheme: '',
  settingType: '',
  timeOfDay: '',
  mood: '',
};

export const DEFAULT_PET_TOOL_CACHE: PetToolCache = {
  hints: '',
  hintSource: 'manual',
  historySeedScope: 'related',
  randomTheme: '',
  portraitStyle: 'portrait',
  variationStrength: 50,
};

export const DEFAULT_FANTASY_TOOL_CACHE: FantasyToolCache = {
  hints: '',
  hintSource: 'manual',
  historySeedScope: 'related',
  randomTheme: '',
  portraitStyle: 'portrait',
  wildness: 65,
  variationStrength: 50,
};

export const DEFAULT_NSFW_GENERATOR_TOOL_CACHE: NsfwGeneratorToolCache = {
  hints: '',
  hintSource: 'manual',
  wildness: 60,
  presetCategory: 'all',
};

export const DEFAULT_ROLEPLAY_TOOL_CACHE: RoleplayToolCache = {
  personaId: 'raccoon-pirate',
  customPersona: '',
  characterName: '',
  extraHints: '',
  setting: '',
  tone: 'silly',
  content: 'pg13',
  playAs: 'text',
  isolateSubject: true,
  autoQueue: true,
  beatOutput: 'clip',
};

export const DEFAULT_FITTING_TOOL_CACHE: FittingToolCache = {
  isolateSubject: true,
  notes: '',
  autoKitPreviews: false,
  kitPreviews: {},
};

export const DEFAULT_DAY_TOOL_CACHE: DayToolCache = {
  slots: undefined,
  notes: '',
};

export const DEFAULT_MOODBOARD_TOOL_CACHE: MoodboardToolCache = {
  tiles: [],
  templateId: 'scene-blend',
  instruction: '',
};

export const DEFAULT_MOBILE_STUDIO_TOOL_CACHE: MobileStudioToolCache = {
  plates: [],
  activePlateId: '',
};

export const DEFAULT_IMAGE_PROMPT_TOOL_CACHE: ImagePromptToolCache = {
  focus: 'full',
  descriptionPreset: 'standard',
  extraHints: '',
  hintSource: 'manual',
  historySeedScope: 'related',
};

export const DEFAULT_TOPIC_TOOL_CACHE: TopicToolCache = {
  seedTopic: '',
  hintSource: 'manual',
  historySeedScope: 'related',
  randomTheme: '',
  count: 10,
  variety: 50,
  batchTarget: 'generate',
};

export const DEFAULT_NEGATIVE_TOOL_CACHE: NegativeToolCache = {
  sport: '',
  preserveSubject: false,
  extra: '',
};

export const DEFAULT_STUDIO_TOOL_CACHE: StudioToolCache = {
  compareModelB: 'flux-2-klein',
  templateId: 'duo-sport-race',
  templateSlots: {},
  catalogTab: 'clothing',
  locationBlocklist: [],
};

export const DEFAULT_VARIATIONS_TOOL_CACHE: VariationsToolCache = {
  hints: '',
  hintSource: 'manual',
  historySeedScope: 'related',
  randomTheme: '',
  count: 4,
  variationStrength: 65,
  target: 'generate',
  portraitStyle: 'action',
  sportPresetId: '',
};

function isDetailLevel(value: unknown): value is DetailLevel {
  return value === 'concise' || value === 'balanced' || value === 'rich';
}

export function migrateLegacyToolSettings(tools: ToolSettingsCache): {
  tools: ToolSettingsCache;
  changed: boolean;
} {
  const legacy = tools as LegacyToolSettingsCache;
  const { randomScene, duo, compose, ...rest } = legacy;

  if (!randomScene && !duo && !compose) {
    return { tools, changed: false };
  }

  let changed = false;
  let character = { ...(rest.character ?? {}) } as CharacterToolCache;
  let generate = { ...(rest.generate ?? {}) } as GenerateToolCache;

  if (duo) {
    changed = true;
    character = {
      ...character,
      ...duo,
      sceneMode: 'duo',
    };
  }

  if (compose) {
    changed = true;
    const { subjectMode, ...composeRest } = compose;
    character = {
      ...character,
      ...composeRest,
      composeSubjectMode: subjectMode ?? character.composeSubjectMode,
      sceneMode: 'compose',
    };
  }

  if (randomScene) {
    changed = true;
    generate = {
      ...generate,
      ...randomScene,
      generateSource: 'random',
    };
  }

  return {
    tools: {
      ...rest,
      character,
      generate,
    },
    changed,
  };
}

export function loadSettingsCache(): SettingsCache {
  if (typeof window === 'undefined') {
    return { shared: DEFAULT_SHARED_SETTINGS, tools: {}, installedPlugins: [] };
  }

  // IndexedDB-only keys return null until hydrate — never memoize empty defaults while
  // storage is still loading.
  if (!isBrowserStorageReady()) {
    return withPendingSettingsOverlay({
      shared: { ...DEFAULT_SHARED_SETTINGS },
      tools: {},
      installedPlugins: [],
    });
  }

  // Fast path: return the memoized result unless browser storage changed.
  if (
    cachedLoadResult != null &&
    readBrowserValue<unknown>(SETTINGS_CACHE_KEY) === cachedBrowserVersion
  ) {
    return cachedLoadResult;
  }

  try {
    const parsed = readBrowserValue<Partial<SettingsCache>>(SETTINGS_CACHE_KEY);
    if (!parsed) {
      const defaults = withPendingSettingsOverlay({
        shared: { ...DEFAULT_SHARED_SETTINGS },
        tools: {},
        installedPlugins: [],
      });
      applyCriticalSharedPrefs(defaults.shared);
      // Avoid memoizing pre-hydrate defaults — IDB/localStorage may still be loading.
      if (isBrowserStorageReady()) {
        cachedLoadResult = defaults;
        cachedBrowserVersion = null;
      }
      return defaults;
    }
    const shared = {
      ...DEFAULT_SHARED_SETTINGS,
      ...parsed.shared,
    };
    applyCriticalSharedPrefs(shared);

    if (!isDetailLevel(shared.detail)) {
      shared.detail = DEFAULT_SHARED_SETTINGS.detail;
    }

    shared.modelSamplerPreset = normalizeModelSamplerPresetTier(
      shared.modelSamplerPreset ?? DEFAULT_MODEL_SAMPLER_PRESET_TIER
    );
    shared.modelResolutionOrientation = normalizeResolutionOrientation(
      shared.modelResolutionOrientation ?? DEFAULT_RESOLUTION_ORIENTATION
    );
    shared.modelResolutionSizeTier = normalizeResolutionSizeTier(
      shared.modelResolutionSizeTier ?? DEFAULT_RESOLUTION_SIZE_TIER
    );
    shared.renderRealismMode = normalizeRenderRealismMode(
      shared.renderRealismMode ?? DEFAULT_SHARED_SETTINGS.renderRealismMode
    );
    shared.anatomyGuardMode = normalizeAnatomyGuardMode(
      shared.anatomyGuardMode ?? DEFAULT_ANATOMY_GUARD_MODE
    );
    shared.queueQualityProfile = normalizeQueueQualityProfile(
      shared.queueQualityProfile ?? DEFAULT_QUEUE_QUALITY_PROFILE
    );
    shared.galleryWorkflowRetentionDays = normalizeGalleryWorkflowRetentionDays(
      shared.galleryWorkflowRetentionDays
    );
    shared.galleryWorkflowMaxBytes = normalizeGalleryWorkflowMaxBytes(
      shared.galleryWorkflowMaxBytes
    );
    shared.expandWildcards = shared.expandWildcards !== false;
    shared.autoRetryOnOom = shared.autoRetryOnOom !== false;
    shared.oomRetryDowngrade = shared.oomRetryDowngrade !== false;
    shared.vramGuardEnabled = shared.vramGuardEnabled !== false;
    shared.promptVersioningEnabled = shared.promptVersioningEnabled !== false;
    const freeGb = shared.vramGuardMinFreeGb;
    shared.vramGuardMinFreeGb =
      typeof freeGb === 'number' && Number.isFinite(freeGb)
        ? Math.min(48, Math.max(1, Math.round(freeGb * 10) / 10))
        : DEFAULT_SHARED_SETTINGS.vramGuardMinFreeGb;
    shared.toolQueueQualityProfiles = {
      ...SUGGESTED_TOOL_QUEUE_QUALITY_PROFILES,
      ...normalizeToolQueueQualityProfiles(shared.toolQueueQualityProfiles),
    };
    shared.toolQualityRecipes = mergeToolQualityRecipes(shared.toolQualityRecipes);
    const preferredHost =
      typeof shared.preferredComfyHost === 'string' ? shared.preferredComfyHost.trim() : '';
    shared.preferredComfyHost = preferredHost || undefined;
    shared.comfyPoolUrls = Array.isArray(shared.comfyPoolUrls)
      ? shared.comfyPoolUrls.map(url => String(url).trim()).filter(Boolean)
      : [];
    shared.loraDatasetExportPrefs = normalizeLoraDatasetExportPrefs(shared.loraDatasetExportPrefs);
    shared.loraTrainTrainerPrefs = normalizeLoraTrainTrainerPrefs(shared.loraTrainTrainerPrefs);
    shared.loraTrainJobs = normalizeTrainJobs(shared.loraTrainJobs);
    shared.modelCheckpointMap = {
      ...SUGGESTED_MODEL_CHECKPOINT_MAP,
      ...shared.modelCheckpointMap,
    };
    shared.modelVaeMap = {
      ...SUGGESTED_MODEL_VAE_MAP,
      ...shared.modelVaeMap,
    };
    shared.modelRefinerMap = {
      ...SUGGESTED_MODEL_REFINER_MAP,
      ...shared.modelRefinerMap,
    };
    shared.modelUpscaleMap = mergeSuggestedUpscaleMap(shared.modelUpscaleMap);
    shared.modelLoraMap = {
      ...SUGGESTED_MODEL_LORA_MAP,
      ...shared.modelLoraMap,
    };

    // Migrate sticky global LoRA session → per-model for the current model only.
    // Other models keep the system default (map or empty) until the user picks.
    const byModel = shared.sessionActiveLoraIdsByModel ?? {};
    const byModelEmpty = Object.keys(byModel).length === 0;
    if (byModelEmpty && Array.isArray(shared.sessionActiveLoraIds) && shared.model?.trim()) {
      shared.sessionActiveLoraIdsByModel = {
        [shared.model.trim()]: shared.sessionActiveLoraIds,
      };
    } else if (!shared.sessionActiveLoraIdsByModel) {
      shared.sessionActiveLoraIdsByModel = {};
    }

    const strengthByModel = shared.sessionLoraStrengthOverridesByModel ?? {};
    const strengthByModelEmpty = Object.keys(strengthByModel).length === 0;
    const legacyStrength = normalizeSessionLoraStrengthOverrides(
      shared.sessionLoraStrengthOverrides
    );
    if (strengthByModelEmpty && Object.keys(legacyStrength).length > 0 && shared.model?.trim()) {
      shared.sessionLoraStrengthOverridesByModel = {
        [shared.model.trim()]: legacyStrength,
      };
    } else if (!shared.sessionLoraStrengthOverridesByModel) {
      shared.sessionLoraStrengthOverridesByModel = {};
    }

    const sidecars = loadSettingsBlobSidecars();
    applySettingsMapsSidecar(shared, sidecars.maps ?? null);

    const rawTools = sidecars.tools ?? parsed.tools ?? {};
    const migrated = migrateLegacyToolSettings(rawTools);
    const installedPlugins = Array.isArray(sidecars.installedPlugins)
      ? sidecars.installedPlugins
      : Array.isArray(parsed.installedPlugins)
        ? (parsed.installedPlugins as SettingsCache['installedPlugins'])
        : [];

    const repair = repairSystemWorkflowsFromOnboarding(shared);
    if (repair.repaired) {
      Object.assign(shared, repair.shared);
    }

    if (migrated.changed && typeof window !== 'undefined') {
      scheduleAfterCommit(() => {
        saveSettingsCache({ shared, tools: migrated.tools, installedPlugins });
      });
    } else if (repair.repaired && typeof window !== 'undefined') {
      scheduleAfterCommit(() => {
        saveSettingsCache({
          shared,
          tools: migrated.tools,
          installedPlugins,
        });
        void flushBrowserStorageNowWithTimeout();
      });
    } else if (
      typeof window !== 'undefined' &&
      isBrowserStorageReady() &&
      (!sidecars.tools || !sidecars.maps || sidecars.installedPlugins === undefined)
    ) {
      // One-time peel: write tools/plugins/maps sidecars without a full notify cycle.
      persistSettingsBlobSidecars({
        shared,
        tools: migrated.tools,
        installedPlugins,
        ...(typeof parsed.updatedAt === 'number' ? { updatedAt: parsed.updatedAt } : {}),
      });
    }

    const result = withPendingSettingsOverlay({
      shared,
      tools: migrated.tools,
      installedPlugins,
      ...(typeof parsed.updatedAt === 'number' ? { updatedAt: parsed.updatedAt } : {}),
    });

    // Cache the normalized result so subsequent reads bypass migration/normalization.
    cachedLoadResult = result;
    cachedBrowserVersion = readBrowserValue<unknown>(SETTINGS_CACHE_KEY);
    return result;
  } catch {
    const fallback = withPendingSettingsOverlay({
      shared: DEFAULT_SHARED_SETTINGS,
      tools: {},
      installedPlugins: [],
    });
    cachedLoadResult = fallback;
    cachedBrowserVersion = null;
    return fallback;
  }
}

/** Invalidate the memoized cache after a write so the next read re-normalizes fresh data. */
export function invalidateSettingsCache(): void {
  cachedLoadResult = null;
  cachedBrowserVersion = null;
}

if (typeof window !== 'undefined') {
  void whenBrowserStorageReady().then(() => {
    invalidateSettingsCache();
    notifySettingsCacheUpdated();
  });
}

export function saveSettingsCache(cache: SettingsCache, options?: SaveSettingsOptions): void {
  if (typeof window === 'undefined') {
    return;
  }
  const shouldNotify = options?.notify !== false;
  const stamped: SettingsCache = { ...cache, updatedAt: Date.now() };
  applySystemWorkflowsSidecar(stamped.shared);
  if (!isBrowserStorageReady()) {
    pendingSettingsCache = mergePendingSettingsCache(pendingSettingsCache, stamped);
    schedulePendingSettingsFlush();
    invalidateSettingsCache();
    cachedLoadResult = pendingSettingsCache;
    cachedBrowserVersion = pendingSettingsCache;
    persistCriticalSharedPrefs(stamped.shared);
    persistSettingsBlobSidecars(stamped);
    if (shouldNotify) {
      notifySettingsCacheUpdated();
    }
    return;
  }

  persistSettingsBlobSidecars(stamped);
  writeBrowserValue(SETTINGS_CACHE_KEY, slimSettingsForMainBlob(stamped));
  const storedVersion = readBrowserValue<unknown>(SETTINGS_CACHE_KEY);
  cachedLoadResult = stamped;
  cachedBrowserVersion = storedVersion;
  persistCriticalSharedPrefs(stamped.shared);
  void flushBrowserStorageNow().then(() => {
    void import('./tab-sync').then(({ broadcastTabSync }) =>
      broadcastTabSync({ type: 'settings-updated' })
    );
    void import('./auto-storage-sync').then(({ scheduleAutoPushStorage }) =>
      scheduleAutoPushStorage()
    );
  });
  if (shouldNotify) {
    notifySettingsCacheUpdated();
  }
}

export function saveSharedSettings(
  shared: SharedToolSettings,
  options?: SaveSettingsOptions
): void {
  if (typeof window === 'undefined') {
    return;
  }
  invalidateSettingsCache();
  const cache = isBrowserStorageReady()
    ? loadSettingsCache()
    : (pendingSettingsCache ?? {
        shared: DEFAULT_SHARED_SETTINGS,
        tools: {},
        installedPlugins: [],
      });
  const merged: SharedToolSettings = { ...shared };
  applySystemWorkflowsSidecar(merged);
  saveSettingsCache({ ...cache, shared: merged }, options);
}

/** Persist LoRA stack picks and await storage flush — survives immediate page reload. */
export async function saveSessionLoraSelectionNow(
  shared: SharedToolSettings,
  options?: SaveSettingsOptions
): Promise<void> {
  saveSharedSettings(shared, { notify: options?.notify ?? false });
  await flushBrowserStorageNowWithTimeout();
}

/** Persist shared settings and await IndexedDB flush — use for critical toggles before navigation. */
export async function saveSharedSettingsNow(
  shared: SharedToolSettings,
  options?: SaveSettingsOptions
): Promise<void> {
  saveSharedSettings(shared, options);
  await flushBrowserStorageNowWithTimeout();
}

const STORAGE_FLUSH_TIMEOUT_MS = 4000;

async function flushBrowserStorageNowWithTimeout(): Promise<void> {
  await Promise.race([
    flushBrowserStorageNow(),
    new Promise<void>(resolve => {
      setTimeout(resolve, STORAGE_FLUSH_TIMEOUT_MS);
    }),
  ]);
}

/**
 * Reliable toggle for Use system workflows — writes the tiny sidecar to localStorage
 * synchronously first so refresh survives IndexedDB debounce/hang.
 */
export async function setUseSystemWorkflowsPref(
  enabled: boolean,
  extras?: Partial<Pick<SharedToolSettings, 'queueQualityProfile'>>
): Promise<void> {
  if (typeof window === 'undefined') {
    return;
  }

  const sidecar = enabled ? '1' : '0';
  try {
    window.localStorage.setItem(SYSTEM_WORKFLOWS_PREF_KEY, sidecar);
  } catch {
    throw new Error('Browser storage is blocked or full.');
  }

  writeBrowserString(SYSTEM_WORKFLOWS_PREF_KEY, sidecar);

  invalidateSettingsCache();
  const shared: SharedToolSettings = {
    ...loadSettingsCache().shared,
    useSystemWorkflows: enabled,
    ...(extras ?? {}),
  };
  saveSharedSettings(shared, { notify: true });
  await flushBrowserStorageNowWithTimeout();
  invalidateSettingsCache();
}

export function saveToolSettings<K extends keyof ToolSettingsCache>(
  tool: K,
  settings: ToolSettingsCache[K],
  options?: SaveSettingsOptions
): void {
  if (typeof window === 'undefined') {
    return;
  }
  invalidateSettingsCache();
  const cache = isBrowserStorageReady()
    ? loadSettingsCache()
    : (pendingSettingsCache ?? {
        shared: DEFAULT_SHARED_SETTINGS,
        tools: {},
        installedPlugins: [],
      });
  saveSettingsCache(
    {
      ...cache,
      tools: {
        ...cache.tools,
        [tool]: {
          ...cache.tools[tool],
          ...settings,
        },
      },
    },
    options
  );
}

export function loadToolSettings<K extends keyof ToolSettingsCache>(
  tool: K,
  defaults: NonNullable<ToolSettingsCache[K]>
): NonNullable<ToolSettingsCache[K]> {
  const cache = loadSettingsCache();
  return {
    ...defaults,
    ...(cache.tools[tool] ?? {}),
  } as NonNullable<ToolSettingsCache[K]>;
}

/**
 * Pure list helpers for `StudioToolCache.savedIdentityBundles` — a saved library of
 * portable character sheets (descriptor + LoRA triggers + IP-Adapter ref settings)
 * on top of the single-bundle export/import already in character-identity-bundle.ts.
 * Callers persist the result via saveToolSettings("studio", { savedIdentityBundles }).
 */
export function upsertSavedIdentityBundle(
  list: import('./character-identity-bundle').CharacterIdentityBundle[] | undefined,
  bundle: import('./character-identity-bundle').CharacterIdentityBundle
): import('./character-identity-bundle').CharacterIdentityBundle[] {
  const key = bundle.name.trim().toLowerCase();
  const next = (list ?? []).filter(entry => entry.name.trim().toLowerCase() !== key);
  next.push(bundle);
  return next;
}

export function removeSavedIdentityBundle(
  list: import('./character-identity-bundle').CharacterIdentityBundle[] | undefined,
  name: string
): import('./character-identity-bundle').CharacterIdentityBundle[] {
  const key = name.trim().toLowerCase();
  return (list ?? []).filter(entry => entry.name.trim().toLowerCase() !== key);
}

export function listSavedIdentityBundles(): import('./character-identity-bundle').CharacterIdentityBundle[] {
  return loadToolSettings('studio', DEFAULT_STUDIO_TOOL_CACHE).savedIdentityBundles ?? [];
}
