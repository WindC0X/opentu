import {
  boolean,
  index,
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
export const projectStatus = pgEnum('mt_project_status', [
  'active',
  'archived',
  'deleted',
]);
export const canvasSyncStatus = pgEnum('mt_canvas_sync_status', [
  'not_required',
  'pending',
  'running',
  'succeeded',
  'failed',
]);
export const assetKind = pgEnum('mt_asset_kind', ['image', 'mask', 'preset']);
export const assetOrigin = pgEnum('mt_asset_origin', [
  'upload',
  'generated',
  'mask',
  'preset',
]);
export const assetVisibilityStatus = pgEnum('mt_asset_visibility_status', [
  'normal',
  'discarded',
  'hidden',
  'deleted',
]);
export const aigcMetadataStatus = pgEnum('mt_aigc_metadata_status', [
  'unknown',
  'present',
  'removed',
  'not_applicable',
]);
export const assetVariantType = pgEnum('mt_asset_variant_type', [
  'original',
  'provider_input',
  'thumb',
  'preview',
]);
export const assetRelationType = pgEnum('mt_asset_relation_type', [
  'source',
  'mask',
  'reference',
  'result',
]);
export const assetReferenceRole = pgEnum('mt_asset_reference_role', [
  'general',
  'subject',
  'style',
  'composition',
  'background',
]);
export const imageTaskOperationType = pgEnum('mt_image_task_operation_type', [
  'text_to_image',
  'image_to_image',
  'inpaint',
  'reference_generate',
  'prompt_optimize',
]);
export const imageTaskStatus = pgEnum('mt_image_task_status', [
  'queued',
  'running',
  'persisting',
  'succeeded',
  'failed',
  'cancelled',
]);
export const providerUsageStatus = pgEnum('mt_provider_usage_status', [
  'succeeded',
  'failed',
  'timeout',
  'partial_succeeded',
]);
export const pricePolicyUnit = pgEnum('mt_price_policy_unit', [
  'per_task',
  'per_image',
  'fixed',
]);
export const pricePolicyStatus = pgEnum('mt_price_policy_status', [
  'draft',
  'active',
  'retired',
]);
export const providerStatus = pgEnum('mt_provider_status', [
  'active',
  'degraded',
  'disabled',
]);
export const modelVisibility = pgEnum('mt_model_visibility', [
  'public',
  'beta',
  'admin_only',
  'disabled',
]);
export const modelHealthStatus = pgEnum('mt_model_health_status', [
  'healthy',
  'degraded',
  'disabled',
]);
export const modelSupportLevel = pgEnum('mt_model_support_level', [
  'native',
  'wrapped',
  'experimental',
  'unsupported',
]);
export const outboxStatus = pgEnum('mt_outbox_status', [
  'pending',
  'processing',
  'published',
  'failed',
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
    pricePolicyId: uuid('price_policy_id'),
    priceVersion: integer('price_version'),
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

export const mtProjects = pgTable(
  'mt_projects',
  {
    createdAt: createdAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    id: uuid('id').primaryKey().defaultRandom(),
    lastOpenedAt: timestamp('last_opened_at', { withTimezone: true }),
    opentuWorkspaceId: varchar('opentu_workspace_id', { length: 160 }),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => mtUsers.id),
    status: projectStatus('status').notNull().default('active'),
    tenantId: tenantId(),
    title: varchar('title', { length: 120 }).notNull(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    ownerStatusIdx: index('mt_projects_owner_status_idx').on(
      table.tenantId,
      table.ownerUserId,
      table.status
    ),
    workspaceTenantIdx: uniqueIndex('mt_projects_workspace_uidx').on(
      table.tenantId,
      table.opentuWorkspaceId
    ),
  })
);

export const mtCanvasSyncRecords = pgTable(
  'mt_canvas_sync_records',
  {
    assetId: uuid('asset_id'),
    createdAt: createdAt(),
    id: uuid('id').primaryKey().defaultRandom(),
    imageTaskId: uuid('image_task_id'),
    lastErrorCode: varchar('last_error_code', { length: 120 }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => mtProjects.id),
    retryCount: integer('retry_count').notNull().default(0),
    status: canvasSyncStatus('status').notNull().default('pending'),
    tenantId: tenantId(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    projectStatusIdx: index('mt_canvas_sync_records_project_status_idx').on(
      table.tenantId,
      table.projectId,
      table.status
    ),
  })
);

export const mtAssets = pgTable(
  'mt_assets',
  {
    aigcMetadataStatus: aigcMetadataStatus('aigc_metadata_status')
      .notNull()
      .default('not_applicable'),
    aiGenerated: boolean('ai_generated').notNull().default(false),
    assetKind: assetKind('asset_kind').notNull().default('image'),
    createdAt: createdAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    favorite: boolean('favorite').notNull().default(false),
    generationTaskId: uuid('generation_task_id'),
    hasProviderWatermark: boolean('has_provider_watermark'),
    height: integer('height').notNull(),
    id: uuid('id').primaryKey().defaultRandom(),
    mimeType: varchar('mime_type', { length: 80 }).notNull(),
    modelKey: varchar('model_key', { length: 120 }),
    modelVersion: varchar('model_version', { length: 120 }),
    origin: assetOrigin('origin').notNull().default('upload'),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => mtUsers.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => mtProjects.id),
    provider: varchar('provider', { length: 120 }),
    selected: boolean('selected').notNull().default(false),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    tenantId: tenantId(),
    updatedAt: updatedAt(),
    visibilityStatus: assetVisibilityStatus('visibility_status')
      .notNull()
      .default('normal'),
    width: integer('width').notNull(),
  },
  (table) => ({
    ownerStatusIdx: index('mt_assets_owner_status_idx').on(
      table.tenantId,
      table.ownerUserId,
      table.visibilityStatus
    ),
    projectCreatedIdx: index('mt_assets_project_created_idx').on(
      table.tenantId,
      table.projectId,
      table.createdAt
    ),
    shaOwnerIdx: index('mt_assets_owner_sha_idx').on(
      table.tenantId,
      table.ownerUserId,
      table.sha256
    ),
  })
);

export const mtAssetVariants = pgTable(
  'mt_asset_variants',
  {
    assetId: uuid('asset_id')
      .notNull()
      .references(() => mtAssets.id),
    createdAt: createdAt(),
    createdByJobId: uuid('created_by_job_id'),
    exifRemoved: boolean('exif_removed').notNull().default(false),
    height: integer('height').notNull(),
    id: uuid('id').primaryKey().defaultRandom(),
    mimeType: varchar('mime_type', { length: 80 }).notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    storageKey: text('storage_key').notNull(),
    tenantId: tenantId(),
    variantType: assetVariantType('variant_type').notNull(),
    width: integer('width').notNull(),
  },
  (table) => ({
    assetVariantIdx: uniqueIndex('mt_asset_variants_asset_type_uidx').on(
      table.assetId,
      table.variantType
    ),
    storageKeyIdx: uniqueIndex('mt_asset_variants_storage_key_uidx').on(
      table.storageKey
    ),
  })
);

export const mtAssetRelations = pgTable(
  'mt_asset_relations',
  {
    candidateIndex: integer('candidate_index'),
    createdAt: createdAt(),
    id: uuid('id').primaryKey().defaultRandom(),
    maskAssetId: uuid('mask_asset_id').references(() => mtAssets.id),
    referenceAssetId: uuid('reference_asset_id').references(() => mtAssets.id),
    referenceRole: assetReferenceRole('reference_role'),
    relationType: assetRelationType('relation_type').notNull(),
    resultAssetId: uuid('result_asset_id')
      .notNull()
      .references(() => mtAssets.id),
    sourceAssetId: uuid('source_asset_id').references(() => mtAssets.id),
    taskId: uuid('task_id'),
    tenantId: tenantId(),
  },
  (table) => ({
    resultIdx: index('mt_asset_relations_result_idx').on(
      table.tenantId,
      table.resultAssetId
    ),
    taskIdx: index('mt_asset_relations_task_idx').on(
      table.tenantId,
      table.taskId
    ),
  })
);

export const mtPricePolicies = pgTable(
  'mt_price_policies',
  {
    amount: integer('amount').notNull(),
    createdAt: createdAt(),
    id: uuid('id').primaryKey().defaultRandom(),
    modelKey: varchar('model_key', { length: 120 }),
    operationType: imageTaskOperationType('operation_type').notNull(),
    policyKey: varchar('policy_key', { length: 120 }).notNull(),
    status: pricePolicyStatus('status').notNull().default('active'),
    tenantId: tenantId(),
    unit: pricePolicyUnit('unit').notNull(),
    updatedAt: updatedAt(),
    version: integer('version').notNull(),
  },
  (table) => ({
    policyVersionIdx: uniqueIndex('mt_price_policies_key_version_uidx').on(
      table.tenantId,
      table.policyKey,
      table.version
    ),
  })
);

export const mtProviderConfigs = pgTable(
  'mt_provider_configs',
  {
    createdAt: createdAt(),
    dataRegion: varchar('data_region', { length: 120 }),
    dataRetentionPolicy: text('data_retention_policy'),
    dataTrainingUsage: text('data_training_usage'),
    displayName: varchar('display_name', { length: 160 }).notNull(),
    id: uuid('id').primaryKey().defaultRandom(),
    isDefault: boolean('is_default').notNull().default(false),
    lastReviewedAt: timestamp('last_reviewed_at', { withTimezone: true }),
    privacyUrl: text('privacy_url'),
    providerKey: varchar('provider_key', { length: 120 }).notNull(),
    reviewNotes: text('review_notes'),
    status: providerStatus('status').notNull().default('active'),
    tenantId: tenantId(),
    termsUrl: text('terms_url'),
    updatedAt: updatedAt(),
  },
  (table) => ({
    providerKeyIdx: uniqueIndex('mt_provider_configs_key_uidx').on(
      table.tenantId,
      table.providerKey
    ),
  })
);

export const mtModelConfigs = pgTable(
  'mt_model_configs',
  {
    createdAt: createdAt(),
    displayName: varchar('display_name', { length: 160 }).notNull(),
    fallbackGroupId: uuid('fallback_group_id'),
    healthStatus: modelHealthStatus('health_status')
      .notNull()
      .default('healthy'),
    id: uuid('id').primaryKey().defaultRandom(),
    modelFamily: varchar('model_family', { length: 120 }).notNull(),
    modelKey: varchar('model_key', { length: 120 }).notNull(),
    modelVersion: varchar('model_version', { length: 120 }).notNull(),
    pricePolicyId: uuid('price_policy_id')
      .notNull()
      .references(() => mtPricePolicies.id),
    providerConfigId: uuid('provider_config_id')
      .notNull()
      .references(() => mtProviderConfigs.id),
    providerModelId: varchar('provider_model_id', { length: 160 }).notNull(),
    tenantId: tenantId(),
    updatedAt: updatedAt(),
    visibility: modelVisibility('visibility').notNull().default('public'),
  },
  (table) => ({
    modelKeyIdx: uniqueIndex('mt_model_configs_key_uidx').on(
      table.tenantId,
      table.modelKey
    ),
  })
);

export const mtModelCapabilities = pgTable(
  'mt_model_capabilities',
  {
    createdAt: createdAt(),
    id: uuid('id').primaryKey().defaultRandom(),
    maxBatchSize: integer('max_batch_size').notNull().default(1),
    maxReferenceImages: integer('max_reference_images').notNull().default(0),
    modelKey: varchar('model_key', { length: 120 }).notNull(),
    operationType: imageTaskOperationType('operation_type').notNull(),
    supportLevel: modelSupportLevel('support_level').notNull().default('native'),
    supported: boolean('supported').notNull().default(true),
    supportedRatios: jsonb('supported_ratios').notNull().default([]),
    supportedSizes: jsonb('supported_sizes').notNull().default([]),
    supportsBatch: boolean('supports_batch').notNull().default(false),
    supportsMask: boolean('supports_mask').notNull().default(false),
    supportsSeed: boolean('supports_seed').notNull().default(false),
    tenantId: tenantId(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    modelOperationIdx: uniqueIndex('mt_model_capabilities_operation_uidx').on(
      table.tenantId,
      table.modelKey,
      table.operationType
    ),
  })
);

export const mtImageTasks = pgTable(
  'mt_image_tasks',
  {
    actualModelKey: varchar('actual_model_key', { length: 120 }),
    actualProvider: varchar('actual_provider', { length: 120 }),
    batchSize: integer('batch_size').notNull(),
    canvasSyncStatus: canvasSyncStatus('canvas_sync_status')
      .notNull()
      .default('pending'),
    createdAt: createdAt(),
    failureCode: varchar('failure_code', { length: 120 }),
    failureCount: integer('failure_count').notNull().default(0),
    failureMessage: text('failure_message'),
    finalPrompt: text('final_prompt').notNull(),
    id: uuid('id').primaryKey().defaultRandom(),
    idempotencyKey: varchar('idempotency_key', { length: 200 }).notNull(),
    internalErrorDetail: text('internal_error_detail'),
    modelFamily: varchar('model_family', { length: 120 }).notNull(),
    modelVersion: varchar('model_version', { length: 120 }).notNull(),
    normalizedParams: jsonb('normalized_params').notNull().default({}),
    operationType: imageTaskOperationType('operation_type').notNull(),
    optimizedPrompt: text('optimized_prompt'),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => mtUsers.id),
    parentTaskId: uuid('parent_task_id'),
    pricePolicyId: uuid('price_policy_id')
      .notNull()
      .references(() => mtPricePolicies.id),
    priceVersion: integer('price_version').notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => mtProjects.id),
    providerUsageId: uuid('provider_usage_id'),
    quotaHoldLedgerId: uuid('quota_hold_ledger_id')
      .notNull()
      .references(() => mtQuotaLedger.id),
    quotedPriceAmount: integer('quoted_price_amount').notNull(),
    quotedPriceUnit: varchar('quoted_price_unit', { length: 40 })
      .notNull()
      .default('points'),
    ratio: varchar('ratio', { length: 20 }).notNull(),
    rawProviderParams: jsonb('raw_provider_params').notNull().default({}),
    requestedModelKey: varchar('requested_model_key', { length: 120 }).notNull(),
    requestedProvider: varchar('requested_provider', { length: 120 }).notNull(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    settledPriceAmount: integer('settled_price_amount'),
    status: imageTaskStatus('status').notNull().default('queued'),
    successCount: integer('success_count').notNull().default(0),
    tenantId: tenantId(),
    updatedAt: updatedAt(),
    userPrompt: text('user_prompt').notNull(),
  },
  (table) => ({
    idempotencyIdx: uniqueIndex('mt_image_tasks_idempotency_uidx').on(
      table.tenantId,
      table.ownerUserId,
      table.idempotencyKey
    ),
    projectStatusIdx: index('mt_image_tasks_project_status_idx').on(
      table.tenantId,
      table.projectId,
      table.status
    ),
  })
);

export const mtProviderUsage = pgTable(
  'mt_provider_usage',
  {
    createdAt: createdAt(),
    id: uuid('id').primaryKey().defaultRandom(),
    imageTaskId: uuid('image_task_id')
      .notNull()
      .references(() => mtImageTasks.id),
    latencyMs: integer('latency_ms'),
    providerConfigId: uuid('provider_config_id')
      .notNull()
      .references(() => mtProviderConfigs.id),
    providerCostAmount: integer('provider_cost_amount'),
    providerCostCurrency: varchar('provider_cost_currency', { length: 16 }),
    providerModelId: varchar('provider_model_id', { length: 160 }),
    rawErrorCode: varchar('raw_error_code', { length: 120 }),
    rawErrorMessage: text('raw_error_message'),
    requestId: varchar('request_id', { length: 160 }),
    requestSnapshot: jsonb('request_snapshot').notNull().default({}),
    responseSnapshot: jsonb('response_snapshot').notNull().default({}),
    status: providerUsageStatus('status').notNull(),
    tenantId: tenantId(),
  },
  (table) => ({
    taskIdx: index('mt_provider_usage_task_idx').on(
      table.tenantId,
      table.imageTaskId
    ),
  })
);

export const mtOutboxEvents = pgTable(
  'mt_outbox_events',
  {
    aggregateId: uuid('aggregate_id').notNull(),
    aggregateType: varchar('aggregate_type', { length: 80 }).notNull(),
    attemptCount: integer('attempt_count').notNull().default(0),
    createdAt: createdAt(),
    eventType: varchar('event_type', { length: 120 }).notNull(),
    id: uuid('id').primaryKey().defaultRandom(),
    idempotencyKey: varchar('idempotency_key', { length: 200 }).notNull(),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    payload: jsonb('payload').notNull().default({}),
    status: outboxStatus('status').notNull().default('pending'),
    tenantId: tenantId(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    idempotencyIdx: uniqueIndex('mt_outbox_events_idempotency_uidx').on(
      table.tenantId,
      table.idempotencyKey
    ),
    statusIdx: index('mt_outbox_events_status_idx').on(
      table.tenantId,
      table.status
    ),
  })
);
