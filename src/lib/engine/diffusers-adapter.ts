'use client';

import { loadEngineSettings } from '@/lib/engine-settings';
import { createComfyUiClientId } from '@/lib/comfyui-websocket';
import { parseEngineId } from './capabilities';
import { buildDiffusersViewPath } from './view-paths';
import type {
  EngineAdapter,
  EngineJobStatus,
  EngineOutputImage,
  EngineProgressSubscription,
  EngineQueueResult,
  EngineStatusResult,
  EngineSubscribeProgressInput,
  EngineUploadInput,
  EngineViewPathOptions,
} from './types';

function normalizeJobStatus(status: string | undefined): EngineJobStatus {
  if (
    status === 'pending' ||
    status === 'running' ||
    status === 'completed' ||
    status === 'error'
  ) {
    return status;
  }
  return 'unknown';
}

function createNoopSubscription(clientId: string): EngineProgressSubscription {
  return {
    close: () => undefined,
    ready: Promise.resolve(),
    setPromptId: () => undefined,
    clientId,
  };
}

async function fetchDiffusersStatusViaProxy(
  promptId: string,
  engineUrl?: string
): Promise<EngineStatusResult | null> {
  const params = new URLSearchParams({ promptId });
  if (engineUrl?.trim()) {
    params.set('engineUrl', engineUrl.trim());
  }
  const response = await fetch(`/api/diffusers/status?${params.toString()}`);
  const raw = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const resolvedUrl =
    (typeof raw.engineUrl === 'string' && raw.engineUrl.trim()) ||
    (typeof raw.comfyUrl === 'string' && raw.comfyUrl.trim()) ||
    engineUrl?.trim() ||
    '';
  // Legacy 404 responses + explicit error payloads both mean "stop polling".
  if (response.status === 404) {
    return {
      promptId,
      status: 'error',
      statusMessage:
        typeof raw.error === 'string' && raw.error.trim()
          ? raw.error.trim()
          : typeof raw.statusMessage === 'string' && raw.statusMessage.trim()
            ? raw.statusMessage.trim()
            : 'Diffusers job not found (engine restarted or id lost).',
      engineUrl: resolvedUrl,
    };
  }
  if (!response.ok) {
    return null;
  }
  const images = Array.isArray(raw.images) ? (raw.images as EngineOutputImage[]) : undefined;
  const normalized = normalizeJobStatus(typeof raw.status === 'string' ? raw.status : undefined);
  const statusMessage = typeof raw.statusMessage === 'string' ? raw.statusMessage : undefined;
  return {
    promptId,
    status: normalized,
    statusMessage,
    engineUrl: resolvedUrl,
    images,
    queuePosition:
      typeof raw.queuePosition === 'number' || raw.queuePosition === null
        ? (raw.queuePosition as number | null)
        : undefined,
    progressValue: typeof raw.progressValue === 'number' ? raw.progressValue : undefined,
    progressMax: typeof raw.progressMax === 'number' ? raw.progressMax : undefined,
  };
}

/** Diffusers-first adapter: workflows via classify+/v1/workflow, else txt2img. */
export const diffusersEngineAdapter: EngineAdapter = {
  id: 'diffusers',

  async postPrompt(body: Record<string, unknown>): Promise<EngineQueueResult> {
    const settings = loadEngineSettings();
    const clientId =
      (typeof body.clientId === 'string' && body.clientId.trim()) || createComfyUiClientId();
    const engineUrlHint =
      (typeof body.engineUrl === 'string' && body.engineUrl.trim()) ||
      settings.diffusersApiUrl ||
      undefined;

    const comfy =
      body.comfy && typeof body.comfy === 'object' && !Array.isArray(body.comfy)
        ? (body.comfy as Record<string, unknown>)
        : null;
    const hasWorkflow =
      typeof comfy?.workflowJson === 'string' && Boolean(comfy.workflowJson.trim());

    // Workflow path: inject + Diffusers /v1/workflow, Comfy fallback for unsupported.
    if (hasWorkflow) {
      try {
        const response = await fetch('/api/comfyui', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...body,
            clientId,
            preferDiffusers: true,
            allowComfyFallback: body.allowComfyFallback !== false,
            engineUrl: engineUrlHint,
          }),
        });
        const raw = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        const promptId = typeof raw.promptId === 'string' ? raw.promptId.trim() : undefined;
        const engineUrl =
          (typeof raw.engineUrl === 'string' && raw.engineUrl.trim()) ||
          (typeof raw.comfyUrl === 'string' && raw.comfyUrl.trim()) ||
          engineUrlHint;
        const engineId = parseEngineId(raw.engineId) ?? 'diffusers';

        if (!response.ok || !promptId) {
          return {
            ok: false,
            status: response.status,
            error: typeof raw.error === 'string' ? raw.error : 'Diffusers workflow queue failed.',
            href: typeof raw.href === 'string' ? raw.href : undefined,
            engineUrl,
            engineId,
            raw,
            releaseLiveSocket: () => undefined,
          };
        }

        return {
          ok: true,
          status: response.status,
          promptId,
          clientId: (typeof raw.clientId === 'string' && raw.clientId.trim()) || clientId,
          engineUrl,
          engineId,
          family: typeof raw.family === 'string' ? raw.family : undefined,
          workflowSource:
            typeof raw.workflowSource === 'string' ? raw.workflowSource : 'diffusers-workflow',
          diffusersFallbackReason:
            typeof raw.diffusersFallbackReason === 'string'
              ? raw.diffusersFallbackReason
              : undefined,
          raw,
          releaseLiveSocket: () => undefined,
        };
      } catch (error) {
        return {
          ok: false,
          status: 0,
          error: error instanceof Error ? error.message : 'Diffusers workflow queue failed.',
          engineId: 'diffusers',
          raw: {},
          releaseLiveSocket: () => undefined,
        };
      }
    }

    const engineSettings = loadEngineSettings();
    const payload = {
      prompt: body.prompt,
      negativePrompt: body.negativePrompt,
      model: body.model,
      params: body.params,
      workshopCrop: body.workshopCrop,
      modelCheckpointMap: body.modelCheckpointMap,
      qualityProfile: body.qualityProfile,
      hasInputImage: body.hasInputImage === true,
      clientId,
      engineUrl: engineUrlHint,
      autoStart: engineSettings.diffusersAutoStart,
    };

    try {
      const response = await fetch('/api/diffusers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const raw = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const promptId = typeof raw.promptId === 'string' ? raw.promptId.trim() : undefined;
      const engineUrl =
        (typeof raw.engineUrl === 'string' && raw.engineUrl.trim()) ||
        (typeof raw.comfyUrl === 'string' && raw.comfyUrl.trim()) ||
        engineUrlHint;

      if (!response.ok || !promptId) {
        return {
          ok: false,
          status: response.status,
          error: typeof raw.error === 'string' ? raw.error : 'Diffusers queue failed.',
          engineUrl,
          engineId: 'diffusers',
          raw,
          releaseLiveSocket: () => undefined,
        };
      }

      return {
        ok: true,
        status: response.status,
        promptId,
        clientId: (typeof raw.clientId === 'string' && raw.clientId.trim()) || clientId,
        engineUrl,
        engineId: 'diffusers',
        workflowSource: typeof raw.workflowSource === 'string' ? raw.workflowSource : 'diffusers',
        raw,
        releaseLiveSocket: () => undefined,
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        error: error instanceof Error ? error.message : 'Diffusers queue failed.',
        engineId: 'diffusers',
        raw: {},
        releaseLiveSocket: () => undefined,
      };
    }
  },

  async fetchJobStatus(promptId: string, engineUrl?: string): Promise<EngineStatusResult | null> {
    const hint = engineUrl?.trim() || loadEngineSettings().diffusersApiUrl;
    return fetchDiffusersStatusViaProxy(promptId, hint);
  },

  buildViewPath(
    engineUrl: string,
    image: EngineOutputImage,
    options?: EngineViewPathOptions
  ): string {
    return buildDiffusersViewPath(engineUrl, image, options);
  },

  async uploadInputImage(input: EngineUploadInput) {
    const { compressImageForEngineUpload } = await import('@/lib/browser-compress-image');
    const { fileToDataUrl } = await import('@/lib/browser-file-data-url');
    const engineUrl = input.engineUrl?.trim() || loadEngineSettings().diffusersApiUrl;

    const prepared = await compressImageForEngineUpload(input.file, {
      maxEdge: 2048,
      maxBytes: 3_500_000,
      quality: 0.9,
    });

    const tryMultipart = async () => {
      const formData = new FormData();
      formData.append('image', prepared, prepared.name);
      if (engineUrl) {
        formData.append('engineUrl', engineUrl);
      }
      const response = await fetch('/api/diffusers/upload', {
        method: 'POST',
        body: formData,
      });
      const data = (await response.json()) as {
        name?: string;
        subfolder?: string;
        type?: string;
        error?: string;
      };
      if (!response.ok || !data.name?.trim()) {
        throw new Error(data.error ?? 'Diffusers image upload failed.');
      }
      return {
        name: data.name.trim(),
        subfolder: data.subfolder?.trim() || undefined,
        type: data.type?.trim() || undefined,
      };
    };

    const tryJson = async () => {
      const image = await fileToDataUrl(prepared);
      if (image.length > 9_000_000) {
        throw new Error(
          'Image is still too large after compression. Try a smaller figure (under ~6MB).'
        );
      }
      const response = await fetch('/api/diffusers/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image,
          mimeType: prepared.type || 'image/png',
          filename: prepared.name || 'prompt-studio-upload.png',
          ...(engineUrl ? { engineUrl } : {}),
        }),
      });
      const data = (await response.json()) as {
        name?: string;
        subfolder?: string;
        type?: string;
        error?: string;
      };
      if (!response.ok || !data.name?.trim()) {
        throw new Error(data.error ?? 'Diffusers image upload failed.');
      }
      return {
        name: data.name.trim(),
        subfolder: data.subfolder?.trim() || undefined,
        type: data.type?.trim() || undefined,
      };
    };

    try {
      return await tryMultipart();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/FormData|parse body|multipart/i.test(message)) {
        throw error;
      }
      return tryJson();
    }
  },

  subscribeProgress(input: EngineSubscribeProgressInput): EngineProgressSubscription {
    const clientId = input.clientId?.trim() || createComfyUiClientId();
    let promptId = input.promptId?.trim() || '';
    let closed = false;

    const poll = async () => {
      if (closed || !promptId) {
        return;
      }
      try {
        const status = await fetchDiffusersStatusViaProxy(promptId, input.engineUrl);
        if (!status || closed) {
          return;
        }
        if (status.status === 'running' || status.status === 'pending') {
          input.onProgress({
            promptId,
            status: 'progress',
            message: status.statusMessage,
            value: status.progressValue,
            max: status.progressMax,
          });
          return;
        }
        if (status.status === 'completed') {
          input.onProgress({
            promptId,
            status: 'finished',
            message: status.statusMessage ?? 'Completed',
          });
          closed = true;
          clearInterval(timer);
          return;
        }
        if (status.status === 'error') {
          input.onProgress({
            promptId,
            status: 'error',
            message: status.statusMessage ?? 'Diffusers job failed.',
          });
          input.onError?.(status.statusMessage ?? 'Diffusers job failed.');
          closed = true;
          clearInterval(timer);
        }
      } catch (error) {
        input.onError?.(error instanceof Error ? error.message : 'Diffusers progress poll failed.');
      }
    };

    const timer = setInterval(() => {
      void poll();
    }, 750);
    void poll();

    return {
      close: () => {
        closed = true;
        clearInterval(timer);
      },
      ready: Promise.resolve(),
      setPromptId: next => {
        promptId = next.trim();
      },
      clientId,
    };
  },

  async openProgressBeforeQueue(input) {
    return createNoopSubscription(input.clientId);
  },
};
