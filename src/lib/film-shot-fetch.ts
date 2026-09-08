/**
 * Resolve film/stitch shot bytes on the server without cookie self-fetch.
 * Gallery durable originals and Comfy/cloud view proxies are read in-process.
 */

import 'server-only';

import {
  normalizeComfyViewType,
  sanitizeComfyViewFilename,
  sanitizeComfyViewSubfolder,
  assertSafeHttpUrl,
} from './url-safety';
import { getComfyUiBaseUrl } from './comfyui-client';
import { stripEmptyComfyUiRuntime } from './comfyui-config';
import { readGalleryOriginalFile } from './gallery-media-store';
import { isServerStorageEnabled } from './server-storage';

export type FilmShotFetchResult = {
  buffer: Buffer;
  contentType?: string;
  filenameHint?: string;
};

function parseGalleryMediaPath(
  pathname: string,
  searchParams: URLSearchParams
): {
  entryId: string;
  index?: number;
  variant: string;
} | null {
  const match = pathname.match(/^\/api\/gallery\/media\/([^/]+)\/?$/);
  if (!match?.[1]) {
    return null;
  }
  const entryId = decodeURIComponent(match[1]);
  const rawIndex = Number(searchParams.get('index'));
  const index = Number.isInteger(rawIndex) && rawIndex >= 0 ? rawIndex : undefined;
  const variant = searchParams.get('variant')?.trim() || 'thumb';
  return { entryId, index, variant };
}

async function fetchComfyViewBytes(searchParams: URLSearchParams): Promise<FilmShotFetchResult> {
  const filename = sanitizeComfyViewFilename(searchParams.get('filename') ?? '');
  const subfolder = sanitizeComfyViewSubfolder(searchParams.get('subfolder') ?? '');
  const type = normalizeComfyViewType(searchParams.get('type')?.trim() || 'output');
  const runtime = stripEmptyComfyUiRuntime({
    apiUrl: searchParams.get('comfyUrl') ?? undefined,
  });
  const comfyUrl = getComfyUiBaseUrl(runtime);
  const viewUrl = new URL(`${comfyUrl.replace(/\/+$/, '')}/view`);
  viewUrl.searchParams.set('filename', filename);
  viewUrl.searchParams.set('subfolder', subfolder);
  viewUrl.searchParams.set('type', type);
  const response = await fetch(viewUrl.toString(), {
    signal: AbortSignal.timeout(60_000),
    redirect: 'manual',
  });
  if (!response.ok) {
    throw new Error(`ComfyUI view returned HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength === 0) {
    throw new Error('ComfyUI view returned an empty file.');
  }
  return {
    buffer,
    contentType: response.headers.get('content-type') ?? undefined,
    filenameHint: filename,
  };
}

async function fetchNamedEngineViewBytes(
  engine: string,
  searchParams: URLSearchParams
): Promise<FilmShotFetchResult> {
  const filename = sanitizeComfyViewFilename(searchParams.get('filename') ?? '');
  const subfolder = sanitizeComfyViewSubfolder(searchParams.get('subfolder') ?? '');

  if (engine === 'fal') {
    const file = await (
      await import('./fal-client')
    ).ensureFalOutput({
      promptId: searchParams.get('promptId') ?? undefined,
      filename,
      subfolder,
    });
    if (!file) {
      throw new Error('Fal output not found for stitch.');
    }
    return { buffer: file.bytes, contentType: file.mimeType, filenameHint: filename };
  }
  if (engine === 'replicate') {
    const file = await (
      await import('./replicate-client')
    ).ensureReplicateOutput({
      promptId: searchParams.get('promptId') ?? undefined,
      filename,
      subfolder,
    });
    if (!file) {
      throw new Error('Replicate output not found for stitch.');
    }
    return { buffer: file.bytes, contentType: file.mimeType, filenameHint: filename };
  }
  if (engine === 'runway') {
    const file = await (
      await import('./runway-client')
    ).ensureRunwayOutput({
      promptId: searchParams.get('promptId') ?? undefined,
      filename,
      subfolder,
    });
    if (!file) {
      throw new Error('Runway output not found for stitch.');
    }
    return { buffer: file.bytes, contentType: file.mimeType, filenameHint: filename };
  }

  throw new Error(`Direct ${engine} view resolve is not wired; use a durable gallery original.`);
}

/**
 * Load shot bytes for film assemble. Prefer in-process gallery/Comfy reads so
 * auth cookies are never required on a loopback self-fetch.
 */
export async function fetchFilmShotBytes(input: {
  url: string;
  entryId?: string;
  userId?: string | null;
  requestOrigin?: string;
}): Promise<FilmShotFetchResult> {
  const trimmed = input.url.trim();
  if (!trimmed) {
    throw new Error('Shot URL is required.');
  }

  if (trimmed.startsWith('data:')) {
    const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(trimmed);
    if (!match) {
      throw new Error('Invalid data URL.');
    }
    const payload = match[3] ?? '';
    const buffer = match[2]
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload), 'utf8');
    return { buffer, contentType: match[1] || undefined };
  }

  if (input.entryId?.trim() && isServerStorageEnabled()) {
    const entryId = input.entryId.trim();
    for (const owner of [input.userId, null] as const) {
      try {
        const original = readGalleryOriginalFile({ userId: owner, entryId });
        if (original?.buffer?.byteLength) {
          return {
            buffer: original.buffer,
            contentType: original.contentType,
            filenameHint: original.filename,
          };
        }
      } catch {
        // try next owner
      }
    }
  }

  let absolute = trimmed;
  if (trimmed.startsWith('/') && input.requestOrigin) {
    absolute = new URL(trimmed, input.requestOrigin).toString();
  } else if (trimmed.startsWith('/') && !input.requestOrigin) {
    absolute = `http://127.0.0.1${trimmed}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(absolute);
  } catch {
    throw new Error('Invalid shot URL.');
  }

  const gallery = parseGalleryMediaPath(parsed.pathname, parsed.searchParams);
  if (gallery && gallery.variant === 'original' && isServerStorageEnabled()) {
    for (const owner of [input.userId, null] as const) {
      try {
        const original = readGalleryOriginalFile({
          userId: owner,
          entryId: gallery.entryId,
          index: gallery.index,
        });
        if (original?.buffer?.byteLength) {
          return {
            buffer: original.buffer,
            contentType: original.contentType,
            filenameHint: original.filename,
          };
        }
      } catch {
        // try next
      }
    }
  }

  if (parsed.pathname === '/api/comfyui/view' || parsed.pathname.startsWith('/api/comfyui/view')) {
    return fetchComfyViewBytes(parsed.searchParams);
  }

  const engineView = parsed.pathname.match(
    /^\/api\/(fal|replicate|runway|diffusers|grok|gemini|openai)\/view\/?$/
  );
  if (engineView?.[1]) {
    try {
      return await fetchNamedEngineViewBytes(engineView[1], parsed.searchParams);
    } catch {
      // Fall through to HTTP for engines without a direct resolver.
    }
  }

  const safe = assertSafeHttpUrl(parsed.toString(), { allowPrivate: true });
  const response = await fetch(safe.toString(), {
    redirect: 'manual',
    headers: { Accept: 'image/*,video/*,*/*' },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(`Could not fetch shot (${response.status}).`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength === 0) {
    throw new Error('Shot download was empty.');
  }
  if (buffer.byteLength > 250 * 1024 * 1024) {
    throw new Error('Shot is too large to assemble on the server.');
  }
  return {
    buffer,
    contentType: response.headers.get('content-type') ?? undefined,
  };
}
