export const APP_FEATURES = [
  { id: 'dashboard', label: 'Dashboard', description: 'Home dashboard and queue overview' },
  { id: 'queue', label: 'Queue', description: 'Central ComfyUI job queue' },
  { id: 'generate', label: 'Generate', description: 'Keyword and random scene generators' },
  { id: 'format', label: 'Format', description: 'Prompt formatting tool' },
  { id: 'prompt', label: 'Prompt Editor', description: 'Manual prompt edit and optimization' },
  { id: 'lint', label: 'Lint', description: 'Prompt lint and diagnostics' },
  { id: 'topics', label: 'Topics', description: 'Topic list generator' },
  { id: 'character', label: 'Character', description: 'Character, duo, and compose tools' },
  { id: 'background', label: 'Background', description: 'Background-only scenes' },
  { id: 'pet', label: 'Pet', description: 'Pet scene generator' },
  { id: 'fantasy', label: 'Fantasy', description: 'Fantasy scene generator' },
  {
    id: 'roleplay',
    label: 'Roleplay',
    description: 'Cast a character, pick story beats, queue stills or clips',
  },
  {
    id: 'nsfw-generator',
    label: 'Adult generator',
    description: 'Env-gated NSFW scene generator plugin',
  },
  { id: 'image-prompt', label: 'Image → Prompt', description: 'Vision upload to prompt' },
  { id: 'refine', label: 'Refine', description: 'Image refinement pipeline' },
  { id: 'controlnet', label: 'ControlNet', description: 'ControlNet prompt builder' },
  { id: 'video', label: 'Video', description: 'Video motion prompts — T2V, I2V, extend' },
  { id: 'audio', label: 'Audio', description: 'Audio / music prompts' },
  { id: 'mesh', label: '3D Mesh', description: 'Mesh / 3D prompts' },
  { id: 'logo', label: 'Logo', description: 'Brand marks — SVG export and raster prompts' },
  { id: 'outpaint', label: 'Outpaint', description: 'Canvas expansion' },
  { id: 'workflow-editor', label: 'Workflow editor', description: 'Node graph editor' },
  { id: 'negative', label: 'Negative', description: 'Negative prompt builder' },
  { id: 'studio', label: 'Studio', description: 'History, analytics, and experiments' },
  { id: 'gallery', label: 'Gallery', description: 'ComfyUI output gallery' },
  { id: 'variations', label: 'Variations', description: 'Variation grid and matrix queue' },
  { id: 'plugins', label: 'Plugins', description: 'Custom tool registry' },
  { id: 'settings', label: 'Settings', description: 'App and ComfyUI settings' },
  { id: 'profile', label: 'Profile', description: 'Account, password, and preferences' },
  { id: 'comfyui-api', label: 'ComfyUI API', description: 'Queue and poll ComfyUI jobs' },
  { id: 'llm-api', label: 'LLM API', description: 'Generation and refinement API routes' },
] as const;

export type AppFeatureId = (typeof APP_FEATURES)[number]['id'];

export const ALL_FEATURE_IDS = APP_FEATURES.map(feature => feature.id) as AppFeatureId[];

const PAGE_FEATURE_MAP: Array<{ prefix: string; feature: AppFeatureId }> = [
  { prefix: '/m/play', feature: 'roleplay' },
  { prefix: '/m/moodboard', feature: 'roleplay' },
  { prefix: '/m/fitting', feature: 'roleplay' },
  { prefix: '/m/day', feature: 'roleplay' },
  { prefix: '/m/queue', feature: 'queue' },
  { prefix: '/m/gallery', feature: 'gallery' },
  { prefix: '/m', feature: 'gallery' },
  { prefix: '/dashboard', feature: 'dashboard' },
  { prefix: '/queue', feature: 'queue' },
  { prefix: '/format', feature: 'format' },
  { prefix: '/prompt', feature: 'prompt' },
  { prefix: '/lint', feature: 'lint' },
  { prefix: '/topics', feature: 'topics' },
  { prefix: '/characters', feature: 'character' },
  { prefix: '/character', feature: 'character' },
  { prefix: '/background', feature: 'background' },
  { prefix: '/pet', feature: 'pet' },
  { prefix: '/fantasy', feature: 'fantasy' },
  { prefix: '/play', feature: 'roleplay' },
  { prefix: '/roleplay', feature: 'roleplay' },
  { prefix: '/fitting', feature: 'roleplay' },
  { prefix: '/day', feature: 'roleplay' },
  { prefix: '/moodboard', feature: 'roleplay' },
  { prefix: '/plugins/nsfw-generator', feature: 'nsfw-generator' },
  { prefix: '/image-prompt', feature: 'image-prompt' },
  { prefix: '/refine', feature: 'refine' },
  { prefix: '/inpaint', feature: 'refine' },
  { prefix: '/outpaint', feature: 'outpaint' },
  { prefix: '/compose', feature: 'refine' },
  { prefix: '/workflow-editor', feature: 'workflow-editor' },
  { prefix: '/controlnet', feature: 'controlnet' },
  { prefix: '/video', feature: 'video' },
  { prefix: '/audio', feature: 'audio' },
  { prefix: '/mesh', feature: 'mesh' },
  { prefix: '/logo', feature: 'logo' },
  { prefix: '/negative', feature: 'negative' },
  { prefix: '/studio', feature: 'studio' },
  { prefix: '/gallery', feature: 'gallery' },
  { prefix: '/variations', feature: 'variations' },
  { prefix: '/plugins', feature: 'plugins' },
  { prefix: '/settings', feature: 'settings' },
  { prefix: '/profile', feature: 'profile' },
];

const API_FEATURE_MAP: Array<{ prefix: string; feature: AppFeatureId }> = [
  { prefix: '/api/plugin-hooks', feature: 'plugins' },
  { prefix: '/api/comfyui', feature: 'comfyui-api' },
  { prefix: '/api/diffusers', feature: 'comfyui-api' },
  { prefix: '/api/fal', feature: 'comfyui-api' },
  { prefix: '/api/replicate', feature: 'comfyui-api' },
  { prefix: '/api/openai', feature: 'comfyui-api' },
  { prefix: '/api/gemini', feature: 'comfyui-api' },
  { prefix: '/api/grok', feature: 'comfyui-api' },

  { prefix: '/api/generate', feature: 'llm-api' },
  { prefix: '/api/random-scene', feature: 'llm-api' },
  { prefix: '/api/character', feature: 'llm-api' },
  { prefix: '/api/background', feature: 'llm-api' },
  { prefix: '/api/pet', feature: 'llm-api' },
  { prefix: '/api/fantasy', feature: 'llm-api' },
  { prefix: '/api/roleplay', feature: 'llm-api' },
  { prefix: '/api/nsfw-generate', feature: 'nsfw-generator' },
  { prefix: '/api/refine', feature: 'llm-api' },
  { prefix: '/api/vision-scan', feature: 'llm-api' },
  { prefix: '/api/format', feature: 'llm-api' },
  { prefix: '/api/lint', feature: 'llm-api' },
  { prefix: '/api/topics', feature: 'llm-api' },
  { prefix: '/api/negative', feature: 'llm-api' },
  { prefix: '/api/controlnet', feature: 'llm-api' },
  { prefix: '/api/video-prompt', feature: 'llm-api' },
  { prefix: '/api/image-prompt', feature: 'llm-api' },
  { prefix: '/api/logo', feature: 'llm-api' },
  { prefix: '/api/batch', feature: 'llm-api' },
  { prefix: '/api/duo', feature: 'llm-api' },
  { prefix: '/api/compose', feature: 'llm-api' },
  { prefix: '/api/fix', feature: 'llm-api' },
  { prefix: '/api/compact', feature: 'llm-api' },

  // Spawns a local trainer process/command from request input — must never be reachable by an
  // unmapped (always-allowed) route. See requireAdmin() in the route itself for the second gate.
  { prefix: '/api/lora-train', feature: 'settings' },
  { prefix: '/api/film', feature: 'gallery' },
  { prefix: '/api/runway', feature: 'comfyui-api' },
  { prefix: '/api/plugins/server', feature: 'plugins' },
  // Previously unmapped ⇒ any signed-in user. Gate to settings/studio so viewers stay read-only.
  { prefix: '/api/webhooks', feature: 'settings' },
  { prefix: '/api/storage', feature: 'settings' },
  { prefix: '/api/scheduled-batch', feature: 'settings' },
  { prefix: '/api/maintenance', feature: 'settings' },
  { prefix: '/api/collab', feature: 'studio' },
];

export function featureForPath(pathname: string): AppFeatureId | null {
  const path = pathname.split('?')[0] ?? pathname;

  if (path === '/') {
    return 'generate';
  }

  for (const entry of PAGE_FEATURE_MAP) {
    if (path === entry.prefix || path.startsWith(`${entry.prefix}/`)) {
      return entry.feature;
    }
  }

  for (const entry of API_FEATURE_MAP) {
    if (path === entry.prefix || path.startsWith(`${entry.prefix}/`)) {
      return entry.feature;
    }
  }

  return null;
}

export function featureLabel(id: AppFeatureId): string {
  return APP_FEATURES.find(feature => feature.id === id)?.label ?? id;
}
