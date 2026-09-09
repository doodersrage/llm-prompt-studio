'use client';

import { useState } from 'react';
import { useNsfwGeneratorToolOrchestration } from '@/hooks/useNsfwGeneratorToolOrchestration';
import { useToolPageDescription } from '@/hooks/useToolPageDescription';
import NsfwGeneratorToolSections from '@/components/nsfw-generator/NsfwGeneratorToolSections';
import NsfwConsentGate from '@/components/NsfwConsentGate';

export default function NsfwGeneratorTool() {
  const description = useToolPageDescription(
    'Adult scene prompts with presets. Requires env flag on server and client.',
    'Explicit adult scenes — pick a preset, add hints, generate, and queue.'
  );
  const vm = useNsfwGeneratorToolOrchestration();
  const [acknowledged, setAcknowledged] = useState(false);

  if (!vm.mounted) {
    return null;
  }

  if (!acknowledged) {
    return <NsfwConsentGate onAcknowledged={() => setAcknowledged(true)} />;
  }

  return <NsfwGeneratorToolSections description={description} {...vm} />;
}
