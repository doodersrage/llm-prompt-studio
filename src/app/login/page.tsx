import { Suspense } from 'react';
import BrandMark from '@/components/BrandMark';
import PageCanvas from '@/components/ui/PageCanvas';
import LoginForm from '@/components/auth/LoginForm';

export default function LoginPage() {
  return (
    <PageCanvas accent="brand">
      <div className="relative mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-6xl flex-col justify-center gap-10 px-4 py-12 sm:px-6 lg:min-h-[calc(100vh-4rem)] lg:flex-row lg:items-center lg:gap-16 lg:py-16">
        <section className="page-enter max-w-xl space-y-5 lg:flex-1">
          <BrandMark
            size={56}
            withWordmark
            wordmarkClassName="type-brand type-display tracking-tight text-[var(--text-primary)]"
          />
          <p className="type-body-lg max-w-md text-[var(--text-secondary)]">
            Prompt, queue, and review ComfyUI work in one studio — image, video, audio, and 3D
            workflows with a gallery that keeps lineage close.
          </p>
        </section>

        <section className="page-enter page-enter-delayed w-full max-w-md lg:flex-none">
          <Suspense
            fallback={
              <div
                className="ui-card space-y-4 p-8"
                role="status"
                aria-busy="true"
                aria-label="Loading sign in"
              >
                <div className="h-8 w-40 rounded-[var(--radius-md)] bg-[var(--bg-active)]" />
                <div className="h-10 w-full rounded-[var(--radius-md)] bg-[var(--bg-subtle)]" />
                <div className="h-10 w-full rounded-[var(--radius-md)] bg-[var(--bg-subtle)]" />
                <div className="h-11 w-full rounded-[var(--radius-md)] bg-[var(--bg-active)]" />
              </div>
            }
          >
            <LoginForm />
          </Suspense>
        </section>
      </div>
    </PageCanvas>
  );
}
