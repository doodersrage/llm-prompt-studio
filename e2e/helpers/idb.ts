import type { Page } from '@playwright/test';

/** Write app KV rows into Dexie so IDB-authoritative keys survive hydrate. */
export async function putAppKv(page: Page, entries: Record<string, unknown>): Promise<void> {
  await page.evaluate(async pairs => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('comfy-prompt-studio-v1');
      request.onerror = () => reject(request.error ?? new Error('idb open failed'));
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('kv')) {
          db.close();
          resolve();
          return;
        }
        const tx = db.transaction('kv', 'readwrite');
        const store = tx.objectStore('kv');
        for (const [key, value] of Object.entries(pairs)) {
          store.put({ key, value });
        }
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error ?? new Error('idb kv put failed'));
      };
    });
  }, entries);
}

/**
 * Seed settings after auth. Tool slices live in the tools sidecar — writing only
 * `comfy-prompt-tool-settings-v1.tools` loses to an empty IDB sidecar on hydrate.
 */
export async function seedSettingsCache(
  page: Page,
  cache: {
    shared?: Record<string, unknown>;
    tools?: Record<string, unknown>;
    characters?: unknown;
  }
): Promise<void> {
  const updatedAt = Date.now();
  const entries: Record<string, unknown> = {
    'comfy-prompt-tool-settings-v1': {
      shared: cache.shared ?? {},
      tools: {},
      updatedAt,
    },
    'comfy-prompt-tool-settings-tools-v1': {
      tools: cache.tools ?? {},
      updatedAt,
    },
  };
  if (cache.characters !== undefined) {
    entries['comfy-prompt-characters-v1'] = cache.characters;
  }
  await putAppKv(page, entries);
}

/** Replace gallery Dexie rows + localStorage mirror. */
export async function replaceGalleryIdb(
  page: Page,
  entries: Record<string, unknown>[]
): Promise<void> {
  await page.evaluate(async items => {
    try {
      localStorage.setItem('comfyui-gallery-v1', JSON.stringify(items));
    } catch {
      // ignore
    }
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('comfy-prompt-studio-v1');
      request.onerror = () => reject(request.error ?? new Error('idb open failed'));
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('galleryEntries')) {
          db.close();
          resolve();
          return;
        }
        const tx = db.transaction('galleryEntries', 'readwrite');
        const store = tx.objectStore('galleryEntries');
        store.clear();
        for (const entry of items) {
          store.put(entry);
        }
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error ?? new Error('idb gallery put failed'));
      };
    });
    window.dispatchEvent(new Event('comfyui-gallery-updated'));
  }, entries);
}
