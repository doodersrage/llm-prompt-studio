function resolveInstrumentationBaseUrl(): string {
  const configured = process.env.PROMPT_API_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, '');
  }
  const port = process.env.PORT?.trim() || '47832';
  return `http://127.0.0.1:${port}`;
}

async function postInstrumentationRoute(path: string, body?: unknown): Promise<void> {
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const token = process.env.PROMPT_API_TOKEN?.trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${resolveInstrumentationBaseUrl()}${path}`, {
    method: 'POST',
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(`${path} failed (${response.status}): ${message}`);
  }
}

/**
 * Tick cadence for the scheduler wake-up. Actual run spacing is gated inside
 * `/api/scheduled-batch/run` via `shouldRunServerScheduledBatch` / lastRunAt.
 *
 * Important: keep this file free of direct imports of nodemailer / server-storage
 * graphs — Next's instrumentation compile can otherwise try to resolve Node builtins
 * (`stream`, `fs`, …) in a browser-like context.
 */
const SERVER_SCHEDULED_BATCH_TICK_MS = 60_000;

function startServerScheduledBatchLoop(): void {
  let running = false;

  const timer = setInterval(() => {
    if (running) {
      return;
    }
    running = true;
    void postInstrumentationRoute('/api/scheduled-batch/run', { gated: true })
      .catch(error => {
        console.error('[server-scheduled-batch]', error);
      })
      .finally(() => {
        running = false;
      });
  }, SERVER_SCHEDULED_BATCH_TICK_MS);
  timer.unref?.();
}

export async function register() {
  if (process.env.NEXT_RUNTIME === 'edge') {
    return;
  }

  const { isUsingInsecureSessionSecret, INSECURE_SESSION_SECRET_WARNING } =
    await import('./lib/session-secret-check');
  if (isUsingInsecureSessionSecret()) {
    console.warn(`[security] ${INSECURE_SESSION_SECRET_WARNING}`);
  }

  const { isUsingDefaultAdminCredentials, getDefaultAdminCredentialsWarning } =
    await import('./lib/default-admin-check');
  if (isUsingDefaultAdminCredentials()) {
    console.warn(`[security] ${getDefaultAdminCredentialsWarning()}`);
  }

  startServerScheduledBatchLoop();

  if (process.env.SERVER_USER_MAINTENANCE === 'true') {
    const maintenanceIntervalMin = Number(process.env.SERVER_USER_MAINTENANCE_INTERVAL_MIN ?? '15');
    const maintenanceMs = Math.max(5, maintenanceIntervalMin) * 60_000;

    const timer = setInterval(() => {
      void postInstrumentationRoute('/api/maintenance/run').catch(error => {
        console.error('[server-user-maintenance]', error);
      });
    }, maintenanceMs);
    timer.unref?.();
  }
}
