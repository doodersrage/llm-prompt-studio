import type { AppFeatureId } from './features';

export type AuthRole = 'admin' | 'user' | 'viewer';

export type UserScheduledCampaign = {
  enabled: boolean;
  target: 'random-scene' | 'topics';
  count: number;
  intervalMin: number;
  autoQueueComfyUi: boolean;
  lastRunAt?: number;
  /** Text-rank over-generated prompts and keep top N when set. */
  bestOfN?: number;
  /** Vision-rank queued outputs and keep top N (requires LLM_VISION_MODEL). */
  bestOfNVision?: boolean;
};

export type AuthUser = {
  id: string;
  username: string;
  passwordHash: string;
  role: AuthRole;
  groupIds: string[];
  blockedFeatures: AppFeatureId[];
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  comfyUiUrl?: string;
  quotaMaxPerMinute?: number;
  scheduledCampaign?: UserScheduledCampaign;
  exportEnabled?: boolean;
  totpSecret?: string;
  totpEnabled?: boolean;
  /** Optional address for batch and security notifications. */
  email?: string;
  emailNotifyBatch?: boolean;
  emailNotifySecurity?: boolean;
};

export type AuthGroup = {
  id: string;
  name: string;
  description?: string;
  blockedFeatures: AppFeatureId[];
  quotaMaxPerMinute?: number;
  createdAt: number;
  updatedAt: number;
};

/** Safe for session/profile/admin list payloads — never includes password or TOTP secrets. */
export type AuthUserPublic = Omit<AuthUser, 'passwordHash' | 'totpSecret'>;

export type AuthSession = {
  userId: string;
  username: string;
  role: AuthRole;
  exp: number;
  impersonatorId?: string;
  sessionId?: string;
};

export type AuthSessionResponse = {
  authEnabled: boolean;
  user: AuthUserPublic | null;
  allowedFeatures: AppFeatureId[] | 'all';
  impersonating?: boolean;
  impersonatorUsername?: string;
};

export type UsersDocument = {
  version: 1;
  users: AuthUser[];
};

export type GroupsDocument = {
  version: 1;
  groups: AuthGroup[];
};

export const VIEWER_ALLOWED_FEATURES = [
  'dashboard',
  'gallery',
  'studio',
] as const satisfies readonly AppFeatureId[];
