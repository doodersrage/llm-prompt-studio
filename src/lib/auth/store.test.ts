import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AppFeatureId } from './features';
import { ALL_FEATURE_IDS } from './features';
import type { AuthGroup, AuthUser } from './types';

// --- config ---
let authExplicitlyEnabled = false;
let defaultAdminUsername = 'admin';
let defaultAdminPassword = 'admin';
const isAuthExplicitlyEnabled = mock.fn(() => authExplicitlyEnabled);
const getDefaultAdminUsername = mock.fn(() => defaultAdminUsername);
const getDefaultAdminPassword = mock.fn(() => defaultAdminPassword);
mock.module('./config', {
  namedExports: { isAuthExplicitlyEnabled, getDefaultAdminUsername, getDefaultAdminPassword },
});

// --- password (mocked for speed/determinism; real hashing is covered by password.test.ts) ---
const hashPassword = mock.fn((password: string) => `hashed:${password}`);
const verifyPassword = mock.fn((password: string, encoded: string) => encoded === `hashed:${password}`);
mock.module('./password', { namedExports: { hashPassword, verifyPassword } });

// --- sqlite/studio-db ---
let dbPath = '/tmp/auth-store-test/studio.sqlite';
let dbFileExists = false;
const getStudioDb = mock.fn(() => ({}) as unknown);
const studioDbFileExists = mock.fn(() => dbFileExists);
const studioDbPath = mock.fn(() => dbPath);
mock.module('@/lib/sqlite/studio-db', {
  namedExports: { getStudioDb, studioDbFileExists, studioDbPath },
});

// --- sqlite/tables ---
let usersTable: AuthUser[] = [];
let groupsTable: AuthGroup[] = [];
const countUsers = mock.fn(() => usersTable.length);
const loadUsers = mock.fn(() => usersTable);
const loadGroups = mock.fn(() => groupsTable);
const saveUsers = mock.fn((users: AuthUser[]) => {
  usersTable = users;
});
const saveGroups = mock.fn((groups: AuthGroup[]) => {
  groupsTable = groups;
});
mock.module('@/lib/sqlite/tables', {
  namedExports: { countUsers, loadUsers, loadGroups, saveUsers, saveGroups },
});

// --- sqlite/json-import ---
// Point at real, non-existent-by-default paths on disk so isAuthEnabled's fs.existsSync
// checks exercise real filesystem behavior (see task notes: cheap, side-effect-free reads).
const legacyDir = path.join(os.tmpdir(), `auth-store-test-legacy-${process.pid}`);
let legacyUsersPathOverride: string | null = null;
let legacyImportedPathOverride: string | null = null;
const legacyAuthUsersPath = mock.fn(
  () => legacyUsersPathOverride ?? path.join(legacyDir, 'does-not-exist-users.json')
);
const legacyAuthUsersImportedPath = mock.fn(
  () => legacyImportedPathOverride ?? path.join(legacyDir, 'does-not-exist-users.json.imported')
);
mock.module('@/lib/sqlite/json-import', {
  namedExports: { legacyAuthUsersPath, legacyAuthUsersImportedPath },
});

function makeUser(overrides: Partial<AuthUser> = {}): AuthUser {
  const now = Date.now();
  return {
    id: overrides.id ?? 'user-1',
    username: overrides.username ?? 'alice',
    passwordHash: overrides.passwordHash ?? 'hashed:alicepw',
    role: overrides.role ?? 'user',
    groupIds: overrides.groupIds ?? [],
    blockedFeatures: overrides.blockedFeatures ?? [],
    enabled: overrides.enabled ?? true,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    comfyUiUrl: overrides.comfyUiUrl,
    quotaMaxPerMinute: overrides.quotaMaxPerMinute,
    scheduledCampaign: overrides.scheduledCampaign,
    exportEnabled: overrides.exportEnabled,
    totpSecret: overrides.totpSecret,
    totpEnabled: overrides.totpEnabled,
    email: overrides.email,
    emailNotifyBatch: overrides.emailNotifyBatch,
    emailNotifySecurity: overrides.emailNotifySecurity,
  };
}

function makeGroup(overrides: Partial<AuthGroup> = {}): AuthGroup {
  const now = Date.now();
  return {
    id: overrides.id ?? 'group-1',
    name: overrides.name ?? 'Group One',
    description: overrides.description,
    blockedFeatures: overrides.blockedFeatures ?? [],
    quotaMaxPerMinute: overrides.quotaMaxPerMinute,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

afterEach(async () => {
  const { invalidateAuthStoreCache } = await import('./store');
  invalidateAuthStoreCache();

  usersTable = [];
  groupsTable = [];
  authExplicitlyEnabled = false;
  defaultAdminUsername = 'admin';
  defaultAdminPassword = 'admin';
  dbPath = '/tmp/auth-store-test/studio.sqlite';
  dbFileExists = false;
  legacyUsersPathOverride = null;
  legacyImportedPathOverride = null;
  try {
    fs.rmSync(legacyDir, { recursive: true, force: true });
  } catch {
    // ignore
  }

  isAuthExplicitlyEnabled.mock.resetCalls();
  getDefaultAdminUsername.mock.resetCalls();
  getDefaultAdminPassword.mock.resetCalls();
  hashPassword.mock.resetCalls();
  verifyPassword.mock.resetCalls();
  getStudioDb.mock.resetCalls();
  studioDbFileExists.mock.resetCalls();
  studioDbPath.mock.resetCalls();
  countUsers.mock.resetCalls();
  loadUsers.mock.resetCalls();
  loadGroups.mock.resetCalls();
  saveUsers.mock.resetCalls();
  saveGroups.mock.resetCalls();
  legacyAuthUsersPath.mock.resetCalls();
  legacyAuthUsersImportedPath.mock.resetCalls();
});

describe('auth/store', async () => {
  const {
    invalidateAuthStoreCache,
    ensureAuthStore,
    isAuthEnabled,
    toPublicUser,
    listUsers,
    listGroups,
    findUserById,
    findUserByUsername,
    verifyUserCredentials,
    saveUsers: saveUsersFn,
    saveGroups: saveGroupsFn,
    upsertUser,
    deleteUser,
    upsertGroup,
    deleteGroup,
    resolveBlockedFeatures,
    listAllowedFeatures,
    updateUserProfile,
    listUsersWithCampaigns,
    userCanAccessFeature,
    getAuthBootstrapInfo,
  } = await import('./store');

  describe('ensureAuthStore bootstrap and caching', () => {
    it('bootstraps a default admin user when no users exist yet', () => {
      usersTable = [];
      const { users } = ensureAuthStore();
      assert.equal(users.users.length, 1);
      assert.equal(users.users[0]!.id, 'user-admin-default');
      assert.equal(users.users[0]!.username, 'admin');
      assert.equal(users.users[0]!.passwordHash, 'hashed:admin');
      // The bootstrap doc gets persisted since countUsers() was 0.
      assert.equal(saveUsers.mock.calls.length, 1);
    });

    it('does not persist bootstrap users again once users already exist', () => {
      usersTable = [makeUser()];
      ensureAuthStore();
      assert.equal(saveUsers.mock.calls.length, 0);
    });

    it('returns default empty groups document when no groups exist', () => {
      usersTable = [makeUser()];
      groupsTable = [];
      const { groups } = ensureAuthStore();
      assert.deepEqual(groups, { version: 1, groups: [] });
    });

    it('wraps existing groups from the table', () => {
      usersTable = [makeUser()];
      groupsTable = [makeGroup()];
      const { groups } = ensureAuthStore();
      assert.equal(groups.groups.length, 1);
      assert.equal(groups.groups[0]!.id, 'group-1');
    });

    it('caches the result and does not re-read within the cache window', () => {
      usersTable = [makeUser({ username: 'first' })];
      const first = ensureAuthStore();
      assert.equal(loadUsers.mock.calls.length, 1);

      // Mutate the underlying table directly; a cached call should not see it.
      usersTable = [makeUser({ username: 'second' })];
      const second = ensureAuthStore();
      assert.equal(loadUsers.mock.calls.length, 1);
      assert.equal(second.users.users[0]!.username, first.users.users[0]!.username);
    });

    it('re-reads after invalidateAuthStoreCache is called', () => {
      usersTable = [makeUser({ username: 'first' })];
      ensureAuthStore();
      assert.equal(loadUsers.mock.calls.length, 1);

      invalidateAuthStoreCache();
      usersTable = [makeUser({ username: 'second' })];
      const result = ensureAuthStore();
      assert.equal(loadUsers.mock.calls.length, 2);
      assert.equal(result.users.users[0]!.username, 'second');
    });

    it('invalidates the cache automatically when the db path changes', () => {
      dbPath = '/tmp/auth-store-test/a.sqlite';
      usersTable = [makeUser({ username: 'first' })];
      ensureAuthStore();
      assert.equal(loadUsers.mock.calls.length, 1);

      dbPath = '/tmp/auth-store-test/b.sqlite';
      usersTable = [makeUser({ username: 'second' })];
      const result = ensureAuthStore();
      assert.equal(loadUsers.mock.calls.length, 2);
      assert.equal(result.users.users[0]!.username, 'second');
    });

    it('re-syncs the default admin from env on every cached read when auth is explicitly enabled', () => {
      authExplicitlyEnabled = true;
      usersTable = [
        makeUser({ id: 'user-admin-default', username: 'admin', role: 'admin', passwordHash: 'hashed:admin' }),
      ];
      ensureAuthStore();
      const before = isAuthExplicitlyEnabled.mock.calls.length;
      ensureAuthStore();
      assert.ok(isAuthExplicitlyEnabled.mock.calls.length > before);
    });
  });

  describe('syncDefaultAdminFromEnv (via ensureAuthStore)', () => {
    it('does nothing when auth is not explicitly enabled', () => {
      authExplicitlyEnabled = false;
      usersTable = [makeUser({ id: 'user-admin-default', username: 'admin', role: 'admin' })];
      ensureAuthStore();
      assert.equal(saveUsers.mock.calls.length, 0);
    });

    it('creates a new default admin entry when none is found by id or username/role', () => {
      authExplicitlyEnabled = true;
      usersTable = [makeUser({ id: 'other-id', username: 'someone-else', role: 'user' })];
      const { users } = ensureAuthStore();
      assert.equal(users.users[0]!.id, 'user-admin-default');
      assert.equal(users.users[0]!.username, 'admin');
      assert.equal(users.users.length, 2);
      assert.ok(saveUsers.mock.calls.length >= 1);
    });

    it('updates the password hash in place when the existing default admin password does not verify', () => {
      authExplicitlyEnabled = true;
      defaultAdminPassword = 'newpass';
      usersTable = [
        makeUser({
          id: 'user-admin-default',
          username: 'admin',
          role: 'admin',
          passwordHash: 'hashed:oldpass',
        }),
      ];
      const { users } = ensureAuthStore();
      assert.equal(users.users.length, 1);
      assert.equal(users.users[0]!.passwordHash, 'hashed:newpass');
      assert.ok(saveUsers.mock.calls.length >= 1);
    });

    it('canonicalizes the username casing in place when found by role+username match', () => {
      // The role+username lookup matches case-insensitively, so a casing-only mismatch
      // is found by that branch and then rewritten to the config's exact casing.
      authExplicitlyEnabled = true;
      defaultAdminUsername = 'newname';
      usersTable = [
        makeUser({
          id: 'custom-id',
          username: 'NewName',
          role: 'admin',
          passwordHash: 'hashed:admin',
        }),
      ];
      const { users } = ensureAuthStore();
      assert.equal(users.users.length, 1);
      assert.equal(users.users[0]!.id, 'custom-id');
      assert.equal(users.users[0]!.username, 'newname');
      assert.ok(saveUsers.mock.calls.length >= 1);
    });

    it('makes no changes and does not save when username and password already match', () => {
      authExplicitlyEnabled = true;
      usersTable = [
        makeUser({
          id: 'user-admin-default',
          username: 'admin',
          role: 'admin',
          passwordHash: 'hashed:admin',
        }),
      ];
      ensureAuthStore();
      assert.equal(saveUsers.mock.calls.length, 0);
    });
  });

  describe('isAuthEnabled', () => {
    it('returns true and ensures the store when auth is explicitly enabled', () => {
      authExplicitlyEnabled = true;
      usersTable = [makeUser({ id: 'user-admin-default', role: 'admin' })];
      assert.equal(isAuthEnabled(), true);
    });

    it('returns true when a legacy users.json file exists on disk', () => {
      fs.mkdirSync(legacyDir, { recursive: true });
      const legacyPath = path.join(legacyDir, 'users.json');
      fs.writeFileSync(legacyPath, '{}');
      legacyUsersPathOverride = legacyPath;
      assert.equal(isAuthEnabled(), true);
      assert.equal(studioDbFileExists.mock.calls.length, 0);
    });

    it('returns true when a legacy imported marker file exists on disk', () => {
      fs.mkdirSync(legacyDir, { recursive: true });
      const importedPath = path.join(legacyDir, 'users.json.imported');
      fs.writeFileSync(importedPath, '{}');
      legacyImportedPathOverride = importedPath;
      assert.equal(isAuthEnabled(), true);
    });

    it('returns false when no legacy file exists and the studio db file does not exist', () => {
      dbFileExists = false;
      assert.equal(isAuthEnabled(), false);
      assert.equal(getStudioDb.mock.calls.length, 0);
    });

    it('returns true when the studio db exists and has users', () => {
      dbFileExists = true;
      usersTable = [makeUser()];
      assert.equal(isAuthEnabled(), true);
      assert.equal(getStudioDb.mock.calls.length, 1);
    });

    it('returns false when the studio db exists but has no users', () => {
      dbFileExists = true;
      usersTable = [];
      assert.equal(isAuthEnabled(), false);
    });
  });

  describe('toPublicUser', () => {
    it('strips passwordHash and totpSecret and keeps every other field', () => {
      const user = makeUser({
        email: 'a@example.com',
        totpSecret: 'JBSWY3DPEHPK3PXP',
        totpEnabled: true,
      });
      const publicUser = toPublicUser(user);
      assert.equal((publicUser as unknown as { passwordHash?: string }).passwordHash, undefined);
      assert.equal((publicUser as unknown as { totpSecret?: string }).totpSecret, undefined);
      assert.equal(publicUser.id, user.id);
      assert.equal(publicUser.email, 'a@example.com');
      assert.equal(publicUser.totpEnabled, true);
    });
  });

  describe('listUsers / listGroups', () => {
    it('lists users as public users', () => {
      usersTable = [makeUser({ id: 'u1' }), makeUser({ id: 'u2' })];
      const result = listUsers();
      assert.deepEqual(
        result.map(u => u.id),
        ['u1', 'u2']
      );
      assert.ok(!('passwordHash' in result[0]!));
    });

    it('lists groups as-is', () => {
      groupsTable = [makeGroup({ id: 'g1' })];
      usersTable = [makeUser()];
      assert.deepEqual(
        listGroups().map(g => g.id),
        ['g1']
      );
    });
  });

  describe('findUserById / findUserByUsername', () => {
    it('finds a user by id', () => {
      usersTable = [makeUser({ id: 'u1' }), makeUser({ id: 'u2' })];
      assert.equal(findUserById('u2')!.id, 'u2');
    });

    it('returns null when the id is not found', () => {
      usersTable = [makeUser({ id: 'u1' })];
      assert.equal(findUserById('missing'), null);
    });

    it('finds a user by trimmed, case-insensitive username', () => {
      usersTable = [makeUser({ username: 'Alice' })];
      assert.equal(findUserByUsername('  alice  ')!.username, 'Alice');
    });

    it('returns null when the username is not found', () => {
      usersTable = [makeUser({ username: 'Alice' })];
      assert.equal(findUserByUsername('bob'), null);
    });
  });

  describe('verifyUserCredentials', () => {
    it('returns null when the user does not exist', () => {
      usersTable = [];
      assert.equal(verifyUserCredentials('nobody', 'pw'), null);
    });

    it('returns null when the user is disabled', () => {
      usersTable = [makeUser({ username: 'alice', enabled: false, passwordHash: 'hashed:pw' })];
      assert.equal(verifyUserCredentials('alice', 'pw'), null);
    });

    it('returns null when the password is wrong', () => {
      usersTable = [makeUser({ username: 'alice', enabled: true, passwordHash: 'hashed:pw' })];
      assert.equal(verifyUserCredentials('alice', 'wrong'), null);
    });

    it('returns the user when credentials are correct', () => {
      usersTable = [makeUser({ username: 'alice', enabled: true, passwordHash: 'hashed:pw' })];
      assert.equal(verifyUserCredentials('alice', 'pw')!.username, 'alice');
    });
  });

  describe('saveUsers / saveGroups', () => {
    it('invalidates the cache and persists users', () => {
      usersTable = [makeUser({ username: 'first' })];
      ensureAuthStore();
      assert.equal(loadUsers.mock.calls.length, 1);

      saveUsersFn([makeUser({ username: 'second' })]);
      ensureAuthStore();
      assert.equal(loadUsers.mock.calls.length, 2);
    });

    it('invalidates the cache and persists groups', () => {
      // loadGroupsDocument() calls loadGroups() once, and ensureAuthStore's dead-code
      // resync check (`loadGroups().length === 0 && groups.groups.length > 0`, which can
      // never actually be true — see the note on loadGroupsDocument) calls it again, so a
      // single uncached ensureAuthStore() call reads loadGroups() twice.
      usersTable = [makeUser()];
      groupsTable = [];
      ensureAuthStore();
      assert.equal(loadGroups.mock.calls.length, 2);

      saveGroupsFn([makeGroup()]);
      ensureAuthStore();
      assert.equal(loadGroups.mock.calls.length, 4);
    });
  });

  describe('upsertUser', () => {
    it('throws when creating a user without a password and without inviteWithoutPassword', () => {
      usersTable = [];
      assert.throws(
        () =>
          upsertUser({
            username: 'newuser',
            role: 'user',
            groupIds: [],
            blockedFeatures: [],
            enabled: true,
          }),
        /Password is required for new users\./
      );
    });

    it('creates a new user with a hashed password, unshifted to the front', () => {
      usersTable = [makeUser({ id: 'existing' })];
      const created = upsertUser({
        username: 'newuser',
        password: 'secret',
        role: 'user',
        groupIds: [],
        blockedFeatures: [],
        enabled: true,
      });
      assert.equal(created.username, 'newuser');
      assert.equal(usersTable[0]!.id, created.id);
      assert.equal(usersTable[0]!.passwordHash, 'hashed:secret');
      assert.equal(usersTable.length, 2);
    });

    it('allows creating a passwordless invited user', () => {
      const created = upsertUser({
        username: 'invitee',
        role: 'user',
        groupIds: [],
        blockedFeatures: [],
        enabled: false,
        inviteWithoutPassword: true,
      });
      assert.equal(created.username, 'invitee');
      assert.equal(created.enabled, false);
    });

    it('updates an existing user by id, preserving passwordHash when no new password given', () => {
      usersTable = [makeUser({ id: 'u1', username: 'alice', passwordHash: 'hashed:orig' })];
      const updated = upsertUser({
        id: 'u1',
        username: 'alice2',
        role: 'user',
        groupIds: [],
        blockedFeatures: [],
        enabled: true,
      });
      assert.equal(updated.username, 'alice2');
      assert.equal(usersTable[0]!.passwordHash, 'hashed:orig');
    });

    it('matches an existing user by case-insensitive trimmed username when no id is given, replacing it in place', () => {
      usersTable = [makeUser({ id: 'u1', username: 'Alice' })];
      const updated = upsertUser({
        username: '  alice  ',
        role: 'admin',
        groupIds: [],
        blockedFeatures: [],
        enabled: true,
        password: 'x',
      });
      // Real behavior: a username-only match still generates a NEW id (only an explicit
      // `id` input is reused), but the match is replaced in place rather than appended.
      assert.notEqual(updated.id, 'u1');
      assert.equal(usersTable.length, 1);
      assert.equal(usersTable[0]!.id, updated.id);
    });

    it('overwrites passwordHash when a new password is given for an existing user', () => {
      usersTable = [makeUser({ id: 'u1', passwordHash: 'hashed:orig' })];
      upsertUser({
        id: 'u1',
        username: 'alice',
        role: 'user',
        groupIds: [],
        blockedFeatures: [],
        enabled: true,
        password: 'newpw',
      });
      assert.equal(usersTable[0]!.passwordHash, 'hashed:newpw');
    });

    it('throws when demoting the last enabled admin', () => {
      usersTable = [makeUser({ id: 'u1', role: 'admin', enabled: true })];
      assert.throws(
        () =>
          upsertUser({
            id: 'u1',
            username: 'alice',
            role: 'user',
            groupIds: [],
            blockedFeatures: [],
            enabled: true,
          }),
        /Cannot demote the last enabled admin\./
      );
    });

    it('allows demoting an admin when another enabled admin remains', () => {
      usersTable = [
        makeUser({ id: 'u1', role: 'admin', enabled: true }),
        makeUser({ id: 'u2', username: 'other-admin', role: 'admin', enabled: true }),
      ];
      const updated = upsertUser({
        id: 'u1',
        username: 'alice',
        role: 'user',
        groupIds: [],
        blockedFeatures: [],
        enabled: true,
      });
      assert.equal(updated.role, 'user');
    });

    it('normalizes comfyUiUrl, quotaMaxPerMinute, and preserves existing optional fields when not provided', () => {
      usersTable = [
        makeUser({
          id: 'u1',
          scheduledCampaign: { enabled: true, target: 'topics', count: 1, intervalMin: 5, autoQueueComfyUi: false },
          exportEnabled: true,
          email: 'old@example.com',
        }),
      ];
      const updated = upsertUser({
        id: 'u1',
        username: 'alice',
        role: 'user',
        groupIds: [],
        blockedFeatures: [],
        enabled: true,
        comfyUiUrl: '   ',
        quotaMaxPerMinute: 4.9,
      });
      assert.equal(updated.comfyUiUrl, undefined);
      assert.equal(usersTable[0]!.exportEnabled, true);
      assert.equal(usersTable[0]!.email, 'old@example.com');
      assert.equal(usersTable[0]!.scheduledCampaign?.target, 'topics');
    });

    it('floors a positive quotaMaxPerMinute and trims comfyUiUrl', () => {
      usersTable = [makeUser({ id: 'u1' })];
      upsertUser({
        id: 'u1',
        username: 'alice',
        role: 'user',
        groupIds: [],
        blockedFeatures: [],
        enabled: true,
        comfyUiUrl: '  http://host  ',
        quotaMaxPerMinute: 7.8,
      });
      assert.equal(usersTable[0]!.comfyUiUrl, 'http://host');
      assert.equal(usersTable[0]!.quotaMaxPerMinute, 7);
    });

    it('ignores a zero or negative quotaMaxPerMinute', () => {
      usersTable = [makeUser({ id: 'u1' })];
      upsertUser({
        id: 'u1',
        username: 'alice',
        role: 'user',
        groupIds: [],
        blockedFeatures: [],
        enabled: true,
        quotaMaxPerMinute: 0,
      });
      assert.equal(usersTable[0]!.quotaMaxPerMinute, undefined);
    });
  });

  describe('deleteUser', () => {
    it('throws when the user does not exist', () => {
      usersTable = [];
      assert.throws(() => deleteUser('missing'), /User not found\./);
    });

    it('throws when deleting the last enabled admin', () => {
      usersTable = [makeUser({ id: 'u1', role: 'admin', enabled: true })];
      assert.throws(() => deleteUser('u1'), /Cannot delete the last enabled admin\./);
    });

    it('allows deleting a disabled admin even if no other admins exist', () => {
      usersTable = [makeUser({ id: 'u1', role: 'admin', enabled: false })];
      deleteUser('u1');
      assert.equal(usersTable.length, 0);
    });

    it('allows deleting an admin when another enabled admin remains', () => {
      usersTable = [
        makeUser({ id: 'u1', role: 'admin', enabled: true }),
        makeUser({ id: 'u2', username: 'other', role: 'admin', enabled: true }),
      ];
      deleteUser('u1');
      assert.deepEqual(
        usersTable.map(u => u.id),
        ['u2']
      );
    });

    it('deletes a regular user', () => {
      usersTable = [makeUser({ id: 'u1', role: 'user' })];
      deleteUser('u1');
      assert.equal(usersTable.length, 0);
    });
  });

  describe('upsertGroup', () => {
    it('creates a new group unshifted to the front', () => {
      groupsTable = [makeGroup({ id: 'g1' })];
      usersTable = [makeUser()];
      const created = upsertGroup({ name: 'New Group', blockedFeatures: [] });
      assert.equal(groupsTable[0]!.id, created.id);
      assert.equal(groupsTable.length, 2);
    });

    it('updates an existing group by id, preserving createdAt', () => {
      groupsTable = [makeGroup({ id: 'g1', createdAt: 100 })];
      usersTable = [makeUser()];
      const updated = upsertGroup({ id: 'g1', name: 'Renamed', blockedFeatures: [] });
      assert.equal(updated.createdAt, 100);
      assert.equal(groupsTable[0]!.name, 'Renamed');
    });

    it('matches an existing group by case-insensitive trimmed name when no id is given', () => {
      groupsTable = [makeGroup({ id: 'g1', name: 'Editors', createdAt: 50 })];
      usersTable = [makeUser()];
      const updated = upsertGroup({ name: '  editors  ', blockedFeatures: [] });
      assert.equal(updated.createdAt, 50);
      assert.equal(groupsTable.length, 1);
    });

    it('drops a blank description and floors a positive quota', () => {
      usersTable = [makeUser()];
      const created = upsertGroup({
        name: 'Group',
        description: '   ',
        blockedFeatures: [],
        quotaMaxPerMinute: 3.2,
      });
      assert.equal(created.description, undefined);
      assert.equal(created.quotaMaxPerMinute, 3);
    });
  });

  describe('deleteGroup', () => {
    it('removes the group and strips the group id from every user', () => {
      groupsTable = [makeGroup({ id: 'g1' }), makeGroup({ id: 'g2' })];
      usersTable = [
        makeUser({ id: 'u1', groupIds: ['g1', 'g2'] }),
        makeUser({ id: 'u2', groupIds: ['g2'] }),
      ];
      deleteGroup('g1');
      assert.deepEqual(
        groupsTable.map(g => g.id),
        ['g2']
      );
      assert.deepEqual(
        usersTable.map(u => u.groupIds),
        [['g2'], ['g2']]
      );
    });
  });

  describe('resolveBlockedFeatures', () => {
    it('returns an empty set for admins', () => {
      const result = resolveBlockedFeatures(makeUser({ role: 'admin' }));
      assert.equal(result.size, 0);
    });

    it('returns everything except the viewer allowlist for viewers', () => {
      const result = resolveBlockedFeatures(makeUser({ role: 'viewer' }));
      assert.ok(result.has('settings'));
      assert.ok(!result.has('dashboard'));
      assert.ok(!result.has('gallery'));
      assert.ok(!result.has('studio'));
    });

    it('merges the user own blockedFeatures with their groups blockedFeatures', () => {
      groupsTable = [
        makeGroup({ id: 'g1', blockedFeatures: ['video' as AppFeatureId] }),
        makeGroup({ id: 'g2', blockedFeatures: ['audio' as AppFeatureId] }),
      ];
      usersTable = [makeUser()];
      const user = makeUser({
        role: 'user',
        blockedFeatures: ['logo' as AppFeatureId],
        groupIds: ['g1', 'unknown-group'],
      });
      const result = resolveBlockedFeatures(user);
      assert.ok(result.has('logo'));
      assert.ok(result.has('video'));
      assert.ok(!result.has('audio'));
    });
  });

  describe('listAllowedFeatures', () => {
    it('returns an empty array for a null user', () => {
      assert.deepEqual(listAllowedFeatures(null), []);
    });

    it("returns 'all' for admins", () => {
      assert.equal(listAllowedFeatures(makeUser({ role: 'admin' })), 'all');
    });

    it('returns the viewer allowlist for viewers', () => {
      const result = listAllowedFeatures(makeUser({ role: 'viewer' }));
      assert.deepEqual(result, ['dashboard', 'gallery', 'studio']);
    });

    it('returns all features minus blocked ones for a regular user', () => {
      usersTable = [makeUser()];
      const user = makeUser({ role: 'user', blockedFeatures: ['video' as AppFeatureId] });
      const result = listAllowedFeatures(user) as AppFeatureId[];
      assert.ok(!result.includes('video'));
      assert.equal(result.length, ALL_FEATURE_IDS.length - 1);
    });
  });

  describe('updateUserProfile', () => {
    it('throws when the user does not exist', () => {
      usersTable = [];
      assert.throws(() => updateUserProfile('missing', {}), /User not found\./);
    });

    it('updates the password when currentPassword is correct', () => {
      usersTable = [makeUser({ id: 'u1', passwordHash: 'hashed:oldpw' })];
      updateUserProfile('u1', { password: 'newpw', currentPassword: 'oldpw' });
      assert.equal(usersTable[0]!.passwordHash, 'hashed:newpw');
    });

    it('throws when currentPassword is provided but incorrect', () => {
      usersTable = [makeUser({ id: 'u1', passwordHash: 'hashed:oldpw' })];
      assert.throws(
        () => updateUserProfile('u1', { password: 'newpw', currentPassword: 'wrong' }),
        /Current password is incorrect\./
      );
    });

    it('updates the password without verification when currentPassword is omitted', () => {
      usersTable = [makeUser({ id: 'u1', passwordHash: 'hashed:oldpw' })];
      updateUserProfile('u1', { password: 'newpw' });
      assert.equal(usersTable[0]!.passwordHash, 'hashed:newpw');
    });

    it('updates comfyUiUrl, blanking it to undefined when given whitespace', () => {
      usersTable = [makeUser({ id: 'u1', comfyUiUrl: 'http://old' })];
      updateUserProfile('u1', { comfyUiUrl: '   ' });
      assert.equal(usersTable[0]!.comfyUiUrl, undefined);
    });

    it('leaves fields untouched when not present in the input', () => {
      usersTable = [makeUser({ id: 'u1', comfyUiUrl: 'http://old', exportEnabled: true })];
      updateUserProfile('u1', {});
      assert.equal(usersTable[0]!.comfyUiUrl, 'http://old');
      assert.equal(usersTable[0]!.exportEnabled, true);
    });

    it('updates totp, email, and notification fields when provided', () => {
      usersTable = [makeUser({ id: 'u1' })];
      const updated = updateUserProfile('u1', {
        totpSecret: 'SECRET',
        totpEnabled: true,
        email: '  new@example.com  ',
        emailNotifyBatch: true,
        emailNotifySecurity: false,
      });
      assert.equal((updated as unknown as { totpSecret?: string }).totpSecret, undefined);
      assert.equal(updated.totpEnabled, true);
      assert.equal(updated.email, 'new@example.com');
      assert.equal(updated.emailNotifyBatch, true);
      assert.equal(updated.emailNotifySecurity, false);
      assert.equal(findUserById('u1')?.totpSecret, 'SECRET');
    });

    it('clears totpSecret to undefined when given an empty string', () => {
      usersTable = [makeUser({ id: 'u1', totpSecret: 'OLD' })];
      updateUserProfile('u1', { totpSecret: '' });
      assert.equal(findUserById('u1')?.totpSecret, undefined);
    });
  });

  describe('listUsersWithCampaigns', () => {
    it('returns only enabled users with an enabled scheduled campaign', () => {
      usersTable = [
        makeUser({
          id: 'u1',
          enabled: true,
          scheduledCampaign: { enabled: true, target: 'topics', count: 1, intervalMin: 5, autoQueueComfyUi: false },
        }),
        makeUser({
          id: 'u2',
          enabled: false,
          scheduledCampaign: { enabled: true, target: 'topics', count: 1, intervalMin: 5, autoQueueComfyUi: false },
        }),
        makeUser({
          id: 'u3',
          enabled: true,
          scheduledCampaign: { enabled: false, target: 'topics', count: 1, intervalMin: 5, autoQueueComfyUi: false },
        }),
        makeUser({ id: 'u4', enabled: true }),
      ];
      const result = listUsersWithCampaigns();
      assert.deepEqual(
        result.map(u => u.id),
        ['u1']
      );
    });
  });

  describe('userCanAccessFeature', () => {
    it('returns true when feature is null', () => {
      assert.equal(userCanAccessFeature(makeUser(), null), true);
    });

    it('returns false when user is null', () => {
      assert.equal(userCanAccessFeature(null, 'video' as AppFeatureId), false);
    });

    it('returns false when user is disabled', () => {
      assert.equal(userCanAccessFeature(makeUser({ enabled: false }), 'video' as AppFeatureId), false);
    });

    it("returns true for the 'profile' feature regardless of role", () => {
      assert.equal(
        userCanAccessFeature(makeUser({ role: 'viewer' }), 'profile' as AppFeatureId),
        true
      );
    });

    it('returns true for admins', () => {
      assert.equal(userCanAccessFeature(makeUser({ role: 'admin' }), 'settings' as AppFeatureId), true);
    });

    it('returns false when the feature is blocked for a regular user', () => {
      usersTable = [makeUser()];
      const user = makeUser({ role: 'user', blockedFeatures: ['video' as AppFeatureId] });
      assert.equal(userCanAccessFeature(user, 'video' as AppFeatureId), false);
    });

    it('returns true when the feature is not blocked for a regular user', () => {
      usersTable = [makeUser()];
      const user = makeUser({ role: 'user', blockedFeatures: [] });
      assert.equal(userCanAccessFeature(user, 'video' as AppFeatureId), true);
    });
  });

  describe('getAuthBootstrapInfo', () => {
    it('reports enabled status and the default admin username', () => {
      authExplicitlyEnabled = true;
      usersTable = [makeUser({ id: 'user-admin-default', role: 'admin' })];
      defaultAdminUsername = 'root';
      const info = getAuthBootstrapInfo();
      assert.equal(info.enabled, true);
      assert.equal(info.defaultAdminUsername, 'root');
    });

    it('reports disabled when no auth signal is present', () => {
      authExplicitlyEnabled = false;
      dbFileExists = false;
      const info = getAuthBootstrapInfo();
      assert.equal(info.enabled, false);
    });
  });
});
