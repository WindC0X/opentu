import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const userRole = pgEnum('mt_user_role', ['user', 'admin']);
export const userStatus = pgEnum('mt_user_status', [
  'invited',
  'active',
  'disabled',
]);
export const codeStatus = pgEnum('mt_code_status', [
  'active',
  'used',
  'expired',
  'disabled',
]);
export const quotaOwnerType = pgEnum('mt_quota_owner_type', ['user', 'team']);
export const quotaLedgerEntryType = pgEnum('mt_quota_ledger_entry_type', [
  'grant',
  'redemption',
  'hold',
  'consume',
  'release',
  'refund',
  'adjustment',
]);

const tenantId = () => uuid('tenant_id').notNull();
const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const mtTenants = pgTable('mt_tenants', {
  createdAt: createdAt(),
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 200 }).notNull(),
  status: varchar('status', { length: 32 }).notNull().default('active'),
  updatedAt: updatedAt(),
});

export const mtUsers = pgTable(
  'mt_users',
  {
    createdAt: createdAt(),
    email: varchar('email', { length: 320 }).notNull(),
    id: uuid('id').primaryKey().defaultRandom(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    passwordHash: text('password_hash').notNull(),
    privacyVersion: varchar('privacy_version', { length: 64 }),
    role: userRole('role').notNull().default('user'),
    status: userStatus('status').notNull().default('active'),
    tenantId: tenantId(),
    termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }),
    termsVersion: varchar('terms_version', { length: 64 }),
    updatedAt: updatedAt(),
    username: varchar('username', { length: 120 }).notNull(),
  },
  (table) => ({
    emailTenantIdx: uniqueIndex('mt_users_tenant_email_uidx').on(
      table.tenantId,
      table.email
    ),
    usernameTenantIdx: uniqueIndex('mt_users_tenant_username_uidx').on(
      table.tenantId,
      table.username
    ),
  })
);

export const mtUserSessions = pgTable(
  'mt_user_sessions',
  {
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    id: uuid('id').primaryKey().defaultRandom(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    sessionHash: varchar('session_hash', { length: 128 }).notNull(),
    tenantId: tenantId(),
    updatedAt: updatedAt(),
    userId: uuid('user_id')
      .notNull()
      .references(() => mtUsers.id),
  },
  (table) => ({
    sessionHashTenantIdx: uniqueIndex('mt_user_sessions_hash_uidx').on(
      table.tenantId,
      table.sessionHash
    ),
  })
);

export const mtInviteCodes = pgTable(
  'mt_invite_codes',
  {
    codeHash: varchar('code_hash', { length: 128 }).notNull(),
    createdAt: createdAt(),
    createdByAdminId: uuid('created_by_admin_id')
      .notNull()
      .references(() => mtUsers.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    id: uuid('id').primaryKey().defaultRandom(),
    initialQuotaAmount: integer('initial_quota_amount').notNull().default(0),
    maxUses: integer('max_uses').notNull().default(1),
    status: codeStatus('status').notNull().default('active'),
    tenantId: tenantId(),
    updatedAt: updatedAt(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    usedByUserId: uuid('used_by_user_id').references(() => mtUsers.id),
    usedCount: integer('used_count').notNull().default(0),
  },
  (table) => ({
    codeHashTenantIdx: uniqueIndex('mt_invite_codes_hash_uidx').on(
      table.tenantId,
      table.codeHash
    ),
  })
);

export const mtRedemptionCodes = pgTable(
  'mt_redemption_codes',
  {
    codeHash: varchar('code_hash', { length: 128 }).notNull(),
    createdAt: createdAt(),
    createdByAdminId: uuid('created_by_admin_id')
      .notNull()
      .references(() => mtUsers.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    id: uuid('id').primaryKey().defaultRandom(),
    maxUses: integer('max_uses').notNull(),
    quotaAmount: integer('quota_amount').notNull(),
    status: codeStatus('status').notNull().default('active'),
    tenantId: tenantId(),
    updatedAt: updatedAt(),
    usedCount: integer('used_count').notNull().default(0),
  },
  (table) => ({
    codeHashTenantIdx: uniqueIndex('mt_redemption_codes_hash_uidx').on(
      table.tenantId,
      table.codeHash
    ),
  })
);

export const mtQuotaAccounts = pgTable(
  'mt_quota_accounts',
  {
    allowOverdraft: boolean('allow_overdraft').notNull().default(false),
    balanceAmount: integer('balance_amount').notNull().default(0),
    createdAt: createdAt(),
    heldAmount: integer('held_amount').notNull().default(0),
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').notNull(),
    ownerType: quotaOwnerType('owner_type').notNull().default('user'),
    tenantId: tenantId(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    ownerTenantIdx: uniqueIndex('mt_quota_accounts_owner_uidx').on(
      table.tenantId,
      table.ownerType,
      table.ownerId
    ),
  })
);

export const mtQuotaLedger = pgTable(
  'mt_quota_ledger',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => mtQuotaAccounts.id),
    amount: integer('amount').notNull(),
    balanceAfter: integer('balance_after').notNull(),
    createdAt: createdAt(),
    entryType: quotaLedgerEntryType('entry_type').notNull(),
    heldAfter: integer('held_after').notNull(),
    id: uuid('id').primaryKey().defaultRandom(),
    idempotencyKey: varchar('idempotency_key', { length: 200 }).notNull(),
    operatorAdminId: uuid('operator_admin_id').references(() => mtUsers.id),
    reason: text('reason'),
    relatedRedemptionId: uuid('related_redemption_id'),
    relatedTaskId: uuid('related_task_id'),
    tenantId: tenantId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => mtUsers.id),
  },
  (table) => ({
    idempotencyTenantIdx: uniqueIndex('mt_quota_ledger_idempotency_uidx').on(
      table.tenantId,
      table.idempotencyKey
    ),
  })
);

export const mtRedemptionCodeRedemptions = pgTable(
  'mt_redemption_code_redemptions',
  {
    createdAt: createdAt(),
    id: uuid('id').primaryKey().defaultRandom(),
    quotaLedgerId: uuid('quota_ledger_id')
      .notNull()
      .references(() => mtQuotaLedger.id),
    redeemedAt: timestamp('redeemed_at', { withTimezone: true }).notNull(),
    redemptionCodeId: uuid('redemption_code_id')
      .notNull()
      .references(() => mtRedemptionCodes.id),
    tenantId: tenantId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => mtUsers.id),
  },
  (table) => ({
    userCodeTenantIdx: uniqueIndex(
      'mt_redemption_code_redemptions_user_code_uidx'
    ).on(table.tenantId, table.redemptionCodeId, table.userId),
  })
);

export const mtAuditLogs = pgTable('mt_audit_logs', {
  action: varchar('action', { length: 120 }).notNull(),
  actorUserId: uuid('actor_user_id')
    .notNull()
    .references(() => mtUsers.id),
  createdAt: createdAt(),
  id: uuid('id').primaryKey().defaultRandom(),
  metadata: jsonb('metadata').notNull().default({}),
  targetId: varchar('target_id', { length: 120 }).notNull(),
  targetType: varchar('target_type', { length: 80 }).notNull(),
  tenantId: tenantId(),
});
