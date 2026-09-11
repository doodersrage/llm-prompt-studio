import { removeBrowserKey, writeBrowserValue } from './browser-storage';
import { saveUiDensity } from './density-settings';
import { saveWorkspaceMode } from './workspace-mode';
import { saveNavFavorites } from './nav-favorites';
import { saveExpandedNavGroups } from './nav-expanded-groups';
import { clearLastToolDraft } from './tool-draft-memory';
import { clearLastToolRoute } from './last-tool-route';

const KEYS_TO_CLEAR = [
  'comfy-nav-favorites-v1',
  'comfy-recent-destinations-v1',
  'comfy-nav-expanded-groups-v1',
  'comfy-collapsible-open-v1',
  'comfy-tool-context-memory-v1',
  'comfy-last-tool-draft-v1',
  'comfy-last-tool-route-v1',
] as const;

/** Clears pins, recent destinations, nav expand state, collapsible memory, and tool context. Density returns to comfortable; workspace to Simple. */
export function resetUiChrome(): void {
  if (typeof window === 'undefined') {
    return;
  }
  for (const key of KEYS_TO_CLEAR) {
    removeBrowserKey(key);
  }
  saveNavFavorites([]);
  saveExpandedNavGroups([]);
  writeBrowserValue('comfy-recent-destinations-v1', []);
  writeBrowserValue('comfy-collapsible-open-v1', {});
  writeBrowserValue('comfy-tool-context-memory-v1', {});
  clearLastToolDraft();
  clearLastToolRoute();
  saveUiDensity('comfortable');
  saveWorkspaceMode('play');
}
