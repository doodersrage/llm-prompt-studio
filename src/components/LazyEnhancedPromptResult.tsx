'use client';

import dynamic from 'next/dynamic';
import { HistoryCardSkeleton } from '@/components/ui/ViewState';

const LazyEnhancedPromptResult = dynamic(() => import('@/components/EnhancedPromptResult'), {
  loading: () => (
    <div className="ui-block-group" role="status" aria-busy="true" aria-label="Loading result">
      <HistoryCardSkeleton />
    </div>
  ),
});

export default LazyEnhancedPromptResult;
