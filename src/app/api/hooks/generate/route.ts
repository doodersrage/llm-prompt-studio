import { timingSafeEqual } from 'node:crypto';
import { apiError, apiJson, apiMethodNotAllowed } from '@/lib/api/response';
import { resolveUserIdFromApiKey } from '@/lib/auth/api-keys';
import { findUserById } from '@/lib/auth/store';
import { generatePrompt } from '@/lib/prompt-generator';
import { normalizeGenerationSettings } from '@/lib/generation-settings';
import { readSessionFromRequest } from '@/lib/auth/session';

export const runtime = 'nodejs';

function timingSafeEqualString(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

function extractToken(request: Request): string | undefined {
  const authorization = request.headers.get('authorization');
  if (authorization?.toLowerCase().startsWith('bearer ')) {
    return authorization.slice(7).trim() || undefined;
  }
  return request.headers.get('x-prompt-api-token')?.trim() || undefined;
}

function resolveHookUser(request: Request) {
  const session = readSessionFromRequest(request);
  if (session) {
    return findUserById(session.userId);
  }
  const token = extractToken(request);
  const userId = token ? resolveUserIdFromApiKey(token) : null;
  return userId ? findUserById(userId) : null;
}

export async function POST(request: Request) {
  const secret = process.env.INBOUND_WEBHOOK_SECRET?.trim();
  const providedSecret = request.headers.get('x-prompt-hook-secret')?.trim();
  const user = resolveHookUser(request);

  const authorizedByUser = Boolean(user?.enabled);
  const authorizedBySecret = Boolean(
    secret && providedSecret && timingSafeEqualString(secret, providedSecret)
  );
  if (!authorizedByUser && !authorizedBySecret) {
    return apiError('Provide a user API key or X-Prompt-Hook-Secret.', 401);
  }

  const body = (await request.json()) as {
    input?: string;
    model?: string;
    detail?: string;
    mode?: 'positive' | 'negative';
  };
  if (!body.input?.trim()) {
    return apiError('input is required.', 400);
  }

  const settings = normalizeGenerationSettings({
    model: body.model,
    detail: body.detail,
  });

  const result = await generatePrompt(body.input, body.mode ?? 'positive', settings);

  return apiJson(result);
}

export async function OPTIONS() {
  return apiMethodNotAllowed(['POST'], '/api/hooks/generate');
}
