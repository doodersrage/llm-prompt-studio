'use client';

import { Fragment, useState } from 'react';
import type { SharedToolSettings } from '@/lib/settings-cache';
import {
  CLOUD_ENGINE_OPTIONS,
  DEFAULT_FAL_EXTEND_MODEL,
  DEFAULT_FAL_I2V_MODEL,
  DEFAULT_FAL_T2V_MODEL,
  DEFAULT_REPLICATE_I2V_MODEL,
  DEFAULT_REPLICATE_T2V_MODEL,
  DEFAULT_RUNWAY_EXTEND_MODEL,
  DEFAULT_RUNWAY_I2V_MODEL,
  DEFAULT_RUNWAY_T2V_MODEL,
  FAL_EXTEND_MODEL_PRESETS,
  FAL_I2V_MODEL_PRESETS,
  FAL_T2V_MODEL_PRESETS,
  REPLICATE_I2V_MODEL_PRESETS,
  REPLICATE_T2V_MODEL_PRESETS,
  RUNWAY_EXTEND_MODEL_PRESETS,
  RUNWAY_I2V_MODEL_PRESETS,
  RUNWAY_T2V_MODEL_PRESETS,
  normalizeEngineId,
  parseEngineId,
} from '@/lib/engine/capabilities';
import { ToolSection } from '@/components/ui/ToolPageShell';

export type SettingsInferenceEnginePanelProps = {
  sharedSettings: SharedToolSettings;
  updateSharedSettings: (patch: Partial<SharedToolSettings>) => void;
};

export default function SettingsInferenceEnginePanel({
  sharedSettings,
  updateSharedSettings,
}: SettingsInferenceEnginePanelProps) {
  const [diffusersEnsureStatus, setDiffusersEnsureStatus] = useState<string | null>(null);

  return (
    <ToolSection
      id="settings-comfyui-inference-engine"
      title="Inference engine"
      description="ComfyUI is the default generate path (Qwen Lightning bf16, Final/Max enrich, specialty graphs, Play film). Diffusers is optional local stills (txt2img/img2img, native inpaint, Canny ControlNet for SDXL/Flux/Qwen). Fal, Replicate, and Runway queue stills and clips. Grok and Gemini queue stills plus native video. ChatGPT stays stills. Cloud engines have no workflows, LoRAs, or live latents."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="inference-engine" className="text-xs text-[var(--text-secondary)]">
            Active engine
          </label>
          <select
            id="inference-engine"
            value={parseEngineId(sharedSettings.inferenceEngine) ?? 'comfyui'}
            onChange={event => {
              const next = normalizeEngineId(event.target.value);
              updateSharedSettings({
                inferenceEngine: next,
              });
              if (next === 'diffusers') {
                setDiffusersEnsureStatus('Ensuring Diffusers engine…');
                void fetch('/api/diffusers/ensure', {
                  method: 'POST',
                  credentials: 'include',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    engineUrl: sharedSettings.diffusersApiUrl?.trim() || undefined,
                    autoStart: sharedSettings.diffusersAutoStart !== false,
                  }),
                })
                  .then(async response => {
                    const data = (await response.json().catch(() => null)) as {
                      ok?: boolean;
                      started?: boolean;
                      alreadyRunning?: boolean;
                      error?: string;
                    } | null;
                    if (!response.ok) {
                      setDiffusersEnsureStatus(
                        data?.error || `Diffusers ensure failed (HTTP ${response.status}).`
                      );
                      return;
                    }
                    if (data?.alreadyRunning) {
                      setDiffusersEnsureStatus('Diffusers already running.');
                    } else if (data?.started) {
                      setDiffusersEnsureStatus('Diffusers started.');
                    } else {
                      setDiffusersEnsureStatus('Diffusers ready.');
                    }
                  })
                  .catch(error => {
                    setDiffusersEnsureStatus(
                      error instanceof Error ? error.message : 'Diffusers ensure failed.'
                    );
                  });
              } else {
                setDiffusersEnsureStatus(null);
              }
            }}
            className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-muted)] px-3 py-2 text-sm text-[var(--text-primary)] shadow-inner transition focus-visible:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
          >
            <option value="comfyui">ComfyUI (primary generate)</option>
            <option value="diffusers">Diffusers (stills only)</option>
            {CLOUD_ENGINE_OPTIONS.map(option => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          {diffusersEnsureStatus ? (
            <p className="text-xs text-[var(--text-muted)]">{diffusersEnsureStatus}</p>
          ) : null}
        </div>
        <div className="space-y-1">
          <label htmlFor="diffusers-url" className="text-xs text-[var(--text-secondary)]">
            Diffusers API URL
          </label>
          <input
            id="diffusers-url"
            value={sharedSettings.diffusersApiUrl ?? ''}
            onChange={event => updateSharedSettings({ diffusersApiUrl: event.target.value })}
            placeholder="http://127.0.0.1:8190"
            disabled={sharedSettings.inferenceEngine !== 'diffusers'}
            className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-muted)] px-3 py-2 text-sm text-[var(--text-primary)] shadow-inner transition focus-visible:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
        <label
          className={`flex cursor-pointer items-start gap-3 sm:col-span-2 ${
            sharedSettings.inferenceEngine !== 'diffusers' ? 'cursor-not-allowed opacity-50' : ''
          }`}
        >
          <input
            type="checkbox"
            checked={sharedSettings.diffusersAutoStart !== false}
            onChange={event =>
              updateSharedSettings({
                diffusersAutoStart: event.target.checked,
              })
            }
            disabled={sharedSettings.inferenceEngine !== 'diffusers'}
            className="mt-0.5 rounded border-[var(--border-default)] bg-[var(--bg-muted)] text-[var(--text-primary)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:cursor-not-allowed"
          />
          <span className="space-y-0.5">
            <span className="block text-sm text-[var(--text-primary)]">
              Auto-start Diffusers when offline
            </span>
            <span className="block text-xs text-[var(--text-muted)]">
              Spawns{' '}
              <code className="rounded bg-[var(--bg-elevated)] px-1 text-[var(--text-secondary)]">
                services/diffusers-engine
              </code>{' '}
              for localhost URLs when Diffusers is the active engine. Server kill-switch:{' '}
              <code className="rounded bg-[var(--bg-elevated)] px-1 text-[var(--text-secondary)]">
                DIFFUSERS_AUTOSTART=0
              </code>
              .
            </span>
          </span>
        </label>
        <div className="space-y-1 sm:col-span-2">
          <label htmlFor="diffusers-workshop-crop" className="text-xs text-[var(--text-secondary)]">
            Workshop crop (hide hands)
          </label>
          <select
            id="diffusers-workshop-crop"
            value={sharedSettings.diffusersWorkshopCrop ?? 'auto'}
            onChange={event => {
              const value = event.target.value;
              updateSharedSettings({
                diffusersWorkshopCrop: value === 'always' || value === 'never' ? value : 'auto',
              });
            }}
            disabled={sharedSettings.inferenceEngine !== 'diffusers'}
            className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-muted)] px-3 py-2 text-sm text-[var(--text-primary)] shadow-inner transition focus-visible:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="auto">Auto (glassblower / blacksmith / …)</option>
            <option value="always">Always crop hands</option>
            <option value="never">Allow hands in frame</option>
          </select>
        </div>
        {CLOUD_ENGINE_OPTIONS.map(option => {
          const active = sharedSettings.inferenceEngine === option.id;
          const tokenValue = sharedSettings[option.sessionTokenField] ?? '';
          const modelValue = sharedSettings[option.modelField] ?? '';
          const img2imgValue = sharedSettings[option.img2imgField] ?? '';
          const listId = `${option.id}-model-presets`;
          return (
            <Fragment key={option.id}>
              <div className="space-y-1 sm:col-span-2">
                <label
                  htmlFor={`${option.id}-api-token`}
                  className="text-xs text-[var(--text-secondary)]"
                >
                  {option.tokenLabel}
                </label>
                <input
                  id={`${option.id}-api-token`}
                  type="password"
                  autoComplete="off"
                  value={tokenValue}
                  onChange={event =>
                    updateSharedSettings({
                      [option.sessionTokenField]: event.target.value.trim() || undefined,
                    })
                  }
                  placeholder={option.tokenPlaceholder}
                  disabled={!active}
                  className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-muted)] px-3 py-2 text-sm text-[var(--text-primary)] shadow-inner transition focus-visible:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
              <div className="space-y-1">
                <label
                  htmlFor={`${option.id}-model`}
                  className="text-xs text-[var(--text-secondary)]"
                >
                  {option.shortLabel} txt2img model
                </label>
                <input
                  id={`${option.id}-model`}
                  list={listId}
                  value={modelValue}
                  onChange={event =>
                    updateSharedSettings({
                      [option.modelField]: event.target.value,
                    })
                  }
                  placeholder={option.defaultTxt2Img}
                  disabled={!active}
                  className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-muted)] px-3 py-2 text-sm text-[var(--text-primary)] shadow-inner transition focus-visible:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:cursor-not-allowed disabled:opacity-50"
                />
                <datalist id={listId}>
                  {option.presets.map(preset => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </datalist>
              </div>
              <div className="space-y-1">
                <label
                  htmlFor={`${option.id}-img2img-model`}
                  className="text-xs text-[var(--text-secondary)]"
                >
                  {option.shortLabel} image-to-image model
                </label>
                <input
                  id={`${option.id}-img2img-model`}
                  list={listId}
                  value={img2imgValue}
                  onChange={event =>
                    updateSharedSettings({
                      [option.img2imgField]: event.target.value,
                    })
                  }
                  placeholder={option.defaultImg2Img}
                  disabled={!active}
                  className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-muted)] px-3 py-2 text-sm text-[var(--text-primary)] shadow-inner transition focus-visible:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
              {option.id === 'fal' ? (
                <div className="space-y-1 sm:col-span-2">
                  <label htmlFor="fal-i2v-model" className="text-xs text-[var(--text-secondary)]">
                    Fal image-to-video model
                  </label>
                  <input
                    id="fal-i2v-model"
                    list="fal-i2v-model-presets"
                    value={sharedSettings.falI2vModel ?? ''}
                    onChange={event =>
                      updateSharedSettings({
                        falI2vModel: event.target.value,
                      })
                    }
                    placeholder={DEFAULT_FAL_I2V_MODEL}
                    disabled={!active}
                    className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-muted)] px-3 py-2 text-sm text-[var(--text-primary)] shadow-inner transition focus-visible:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <datalist id="fal-i2v-model-presets">
                    {FAL_I2V_MODEL_PRESETS.map(preset => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </datalist>
                </div>
              ) : null}
              {option.id === 'fal' ? (
                <div className="space-y-1 sm:col-span-2">
                  <label htmlFor="fal-t2v-model" className="text-xs text-[var(--text-secondary)]">
                    Fal text-to-video model
                  </label>
                  <input
                    id="fal-t2v-model"
                    list="fal-t2v-model-presets"
                    value={sharedSettings.falT2vModel ?? ''}
                    onChange={event =>
                      updateSharedSettings({
                        falT2vModel: event.target.value,
                      })
                    }
                    placeholder={DEFAULT_FAL_T2V_MODEL}
                    disabled={!active}
                    className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-muted)] px-3 py-2 text-sm text-[var(--text-primary)] shadow-inner transition focus-visible:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <datalist id="fal-t2v-model-presets">
                    {FAL_T2V_MODEL_PRESETS.map(preset => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </datalist>
                </div>
              ) : null}
              {option.id === 'fal' ? (
                <div className="space-y-1 sm:col-span-2">
                  <label
                    htmlFor="fal-extend-model"
                    className="text-xs text-[var(--text-secondary)]"
                  >
                    Fal extend-video model
                  </label>
                  <input
                    id="fal-extend-model"
                    list="fal-extend-model-presets"
                    value={sharedSettings.falExtendModel ?? ''}
                    onChange={event =>
                      updateSharedSettings({
                        falExtendModel: event.target.value,
                      })
                    }
                    placeholder={DEFAULT_FAL_EXTEND_MODEL}
                    disabled={!active}
                    className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-muted)] px-3 py-2 text-sm text-[var(--text-primary)] shadow-inner transition focus-visible:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <datalist id="fal-extend-model-presets">
                    {FAL_EXTEND_MODEL_PRESETS.map(preset => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </datalist>
                </div>
              ) : null}
              {option.id === 'replicate' ? (
                <div className="space-y-1 sm:col-span-2">
                  <label
                    htmlFor="replicate-i2v-model"
                    className="text-xs text-[var(--text-secondary)]"
                  >
                    Replicate image-to-video model
                  </label>
                  <input
                    id="replicate-i2v-model"
                    list="replicate-i2v-model-presets"
                    value={sharedSettings.replicateI2vModel ?? ''}
                    onChange={event =>
                      updateSharedSettings({
                        replicateI2vModel: event.target.value,
                      })
                    }
                    placeholder={DEFAULT_REPLICATE_I2V_MODEL}
                    disabled={!active}
                    className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-muted)] px-3 py-2 text-sm text-[var(--text-primary)] shadow-inner transition focus-visible:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <datalist id="replicate-i2v-model-presets">
                    {REPLICATE_I2V_MODEL_PRESETS.map(preset => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </datalist>
                </div>
              ) : null}
              {option.id === 'replicate' ? (
                <div className="space-y-1 sm:col-span-2">
                  <label
                    htmlFor="replicate-t2v-model"
                    className="text-xs text-[var(--text-secondary)]"
                  >
                    Replicate text-to-video model
                  </label>
                  <input
                    id="replicate-t2v-model"
                    list="replicate-t2v-model-presets"
                    value={sharedSettings.replicateT2vModel ?? ''}
                    onChange={event =>
                      updateSharedSettings({
                        replicateT2vModel: event.target.value,
                      })
                    }
                    placeholder={DEFAULT_REPLICATE_T2V_MODEL}
                    disabled={!active}
                    className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-muted)] px-3 py-2 text-sm text-[var(--text-primary)] shadow-inner transition focus-visible:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <datalist id="replicate-t2v-model-presets">
                    {REPLICATE_T2V_MODEL_PRESETS.map(preset => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </datalist>
                </div>
              ) : null}
              {option.id === 'runway' ? (
                <div className="space-y-1 sm:col-span-2">
                  <label
                    htmlFor="runway-i2v-model"
                    className="text-xs text-[var(--text-secondary)]"
                  >
                    Runway image-to-video model
                  </label>
                  <input
                    id="runway-i2v-model"
                    list="runway-i2v-model-presets"
                    value={sharedSettings.runwayI2vModel ?? ''}
                    onChange={event =>
                      updateSharedSettings({
                        runwayI2vModel: event.target.value,
                      })
                    }
                    placeholder={DEFAULT_RUNWAY_I2V_MODEL}
                    disabled={!active}
                    className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-muted)] px-3 py-2 text-sm text-[var(--text-primary)] shadow-inner transition focus-visible:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <datalist id="runway-i2v-model-presets">
                    {RUNWAY_I2V_MODEL_PRESETS.map(preset => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </datalist>
                </div>
              ) : null}
              {option.id === 'runway' ? (
                <div className="space-y-1 sm:col-span-2">
                  <label
                    htmlFor="runway-t2v-model"
                    className="text-xs text-[var(--text-secondary)]"
                  >
                    Runway text-to-video model
                  </label>
                  <input
                    id="runway-t2v-model"
                    list="runway-t2v-model-presets"
                    value={sharedSettings.runwayT2vModel ?? ''}
                    onChange={event =>
                      updateSharedSettings({
                        runwayT2vModel: event.target.value,
                      })
                    }
                    placeholder={DEFAULT_RUNWAY_T2V_MODEL}
                    disabled={!active}
                    className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-muted)] px-3 py-2 text-sm text-[var(--text-primary)] shadow-inner transition focus-visible:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <datalist id="runway-t2v-model-presets">
                    {RUNWAY_T2V_MODEL_PRESETS.map(preset => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </datalist>
                </div>
              ) : null}
              {option.id === 'runway' ? (
                <div className="space-y-1 sm:col-span-2">
                  <label
                    htmlFor="runway-extend-model"
                    className="text-xs text-[var(--text-secondary)]"
                  >
                    Runway video-to-video / extend model
                  </label>
                  <input
                    id="runway-extend-model"
                    list="runway-extend-model-presets"
                    value={sharedSettings.runwayExtendModel ?? ''}
                    onChange={event =>
                      updateSharedSettings({
                        runwayExtendModel: event.target.value,
                      })
                    }
                    placeholder={DEFAULT_RUNWAY_EXTEND_MODEL}
                    disabled={!active}
                    className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-muted)] px-3 py-2 text-sm text-[var(--text-primary)] shadow-inner transition focus-visible:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <datalist id="runway-extend-model-presets">
                    {RUNWAY_EXTEND_MODEL_PRESETS.map(preset => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </datalist>
                </div>
              ) : null}
            </Fragment>
          );
        })}
      </div>
      <p className="text-xs text-[var(--text-muted)]">
        Default Generate uses ComfyUI (Dynamic VRAM / bf16 Lightning, Play film). Diffusers remains
        available for stills only — run{' '}
        <code className="rounded bg-[var(--bg-elevated)] px-1 text-[var(--text-secondary)]">
          cd services/diffusers-engine && ./run.sh
        </code>{' '}
        or enable auto-start when that engine is selected. Cloud stills queue{' '}
        <code className="rounded bg-[var(--bg-elevated)] px-1 text-[var(--text-secondary)]">
          prompt + optional Image 1
        </code>
        . Clips queue on Fal (Kling including O3, WAN, LTX 2.3, Grok Imagine, Veo), Replicate
        (Kling, WAN, LTX 2.3), Runway (Gen-4.5 / Aleph), Grok native video, Gemini Veo, or local
        WAN/LTX. Continue paths: Fal LTX extend-video (or CDN upload → extend; soft-fail →
        last-frame I2V), Grok `/v1/videos/extensions`, Runway `/v1/video_to_video`, Replicate
        last-frame I2V, Gemini last-frame I2V + server stitch. Roleplay and Video label which path
        ran. ChatGPT stays stills (Sora is deprecated). Stills go through{' '}
        <code className="rounded bg-[var(--bg-elevated)] px-1 text-[var(--text-secondary)]">
          /api/fal
        </code>
        ,{' '}
        <code className="rounded bg-[var(--bg-elevated)] px-1 text-[var(--text-secondary)]">
          /api/replicate
        </code>
        ,{' '}
        <code className="rounded bg-[var(--bg-elevated)] px-1 text-[var(--text-secondary)]">
          /api/openai
        </code>
        ,{' '}
        <code className="rounded bg-[var(--bg-elevated)] px-1 text-[var(--text-secondary)]">
          /api/gemini
        </code>
        ,{' '}
        <code className="rounded bg-[var(--bg-elevated)] px-1 text-[var(--text-secondary)]">
          /api/grok
        </code>
        , and{' '}
        <code className="rounded bg-[var(--bg-elevated)] px-1 text-[var(--text-secondary)]">
          /api/runway
        </code>
        ; keys from Settings or{' '}
        <code className="rounded bg-[var(--bg-elevated)] px-1 text-[var(--text-secondary)]">
          FAL_KEY
        </code>
        {' / '}
        <code className="rounded bg-[var(--bg-elevated)] px-1 text-[var(--text-secondary)]">
          REPLICATE_API_TOKEN
        </code>
        {' / '}
        <code className="rounded bg-[var(--bg-elevated)] px-1 text-[var(--text-secondary)]">
          OPENAI_API_KEY
        </code>
        {' / '}
        <code className="rounded bg-[var(--bg-elevated)] px-1 text-[var(--text-secondary)]">
          GEMINI_API_KEY
        </code>
        {' / '}
        <code className="rounded bg-[var(--bg-elevated)] px-1 text-[var(--text-secondary)]">
          XAI_API_KEY
        </code>
        {' / '}
        <code className="rounded bg-[var(--bg-elevated)] px-1 text-[var(--text-secondary)]">
          RUNWAY_API_KEY
        </code>
        . Server proxy uses{' '}
        <code className="rounded bg-[var(--bg-elevated)] px-1 text-[var(--text-secondary)]">
          DIFFUSERS_API_URL
        </code>
        ; default engine via{' '}
        <code className="rounded bg-[var(--bg-elevated)] px-1 text-[var(--text-secondary)]">
          PROMPT_ENGINE
        </code>
        .
      </p>
    </ToolSection>
  );
}
