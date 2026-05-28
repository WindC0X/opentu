import { and, desc, eq, gt, isNull, or } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import {
  AuditLog,
  AuditLogFilter,
  AuthRepository,
  CreateAuditLogInput,
  CreateInviteCodeInput,
  CreateQuotaAccountInput,
  CreateQuotaLedgerEntryInput,
  CreateRedemptionCodeInput,
  CreateRedemptionRecordInput,
  CreateSessionInput,
  CreateUserInput,
  InviteCode,
  QuotaAccount,
  QuotaLedgerEntry,
  RedemptionCode,
  RedemptionCodeRedemption,
  User,
  UserSession,
} from '../auth/types';
import * as schema from '../db/schema';
import { AppError } from '../errors';

type Db = PostgresJsDatabase<typeof schema>;

export class DrizzleAuthRepository implements AuthRepository {
  constructor(private readonly db: Db) {}

  async createAuditLog(input: CreateAuditLogInput): Promise<AuditLog> {
    const [row] = await this.db
      .insert(schema.mtAuditLogs)
      .values({
        action: input.action,
        actorUserId: input.actorUserId,
        metadata: input.metadata ?? {},
        targetId: input.targetId,
        targetType: input.targetType,
        tenantId: input.tenantId,
      })
      .returning();
    return mapAuditLog(requireRow(row, 'Audit log insert failed'));
  }

  async createInviteCode(input: CreateInviteCodeInput): Promise<InviteCode> {
    const [row] = await this.db
      .insert(schema.mtInviteCodes)
      .values({
        codeHash: input.codeHash,
        createdByAdminId: input.createdByAdminId,
        expiresAt: input.expiresAt,
        initialQuotaAmount: input.initialQuotaAmount,
        maxUses: input.maxUses,
        tenantId: input.tenantId,
      })
      .returning();
    return mapInviteCode(requireRow(row, 'Invite code insert failed'));
  }

  async createQuotaAccount(
    input: CreateQuotaAccountInput
  ): Promise<QuotaAccount> {
    const [row] = await this.db
      .insert(schema.mtQuotaAccounts)
      .values({
        allowOverdraft: input.allowOverdraft ?? false,
        balanceAmount: input.balanceAmount ?? 0,
        heldAmount: input.heldAmount ?? 0,
        ownerId: input.ownerId,
        ownerType: input.ownerType,
        tenantId: input.tenantId,
      })
      .returning();
    return mapQuotaAccount(requireRow(row, 'Quota account insert failed'));
  }

  async createQuotaLedgerEntry(
    input: CreateQuotaLedgerEntryInput
  ): Promise<QuotaLedgerEntry> {
    const existing = await this.findQuotaLedgerByIdempotencyKey(
      input.tenantId,
      input.idempotencyKey
    );
    if (existing) {
      return existing;
    }

    const [row] = await this.db
      .insert(schema.mtQuotaLedger)
      .values({
        accountId: input.accountId,
        amount: input.amount,
        balanceAfter: input.balanceAfter,
        entryType: input.entryType,
        heldAfter: input.heldAfter,
        idempotencyKey: input.idempotencyKey,
        operatorAdminId: input.operatorAdminId ?? null,
        pricePolicyId: input.pricePolicyId ?? null,
        priceVersion: input.priceVersion ?? null,
        reason: input.reason ?? null,
        relatedRedemptionId: input.relatedRedemptionId ?? null,
        relatedTaskId: input.relatedTaskId ?? null,
        tenantId: input.tenantId,
        userId: input.userId,
      })
      .returning();
    return mapQuotaLedgerEntry(requireRow(row, 'Quota ledger insert failed'));
  }

  async createRedemptionCode(
    input: CreateRedemptionCodeInput
  ): Promise<RedemptionCode> {
    const [row] = await this.db
      .insert(schema.mtRedemptionCodes)
      .values({
        codeHash: input.codeHash,
        createdByAdminId: input.createdByAdminId,
        expiresAt: input.expiresAt,
        maxUses: input.maxUses,
        quotaAmount: input.quotaAmount,
        tenantId: input.tenantId,
      })
      .returning();
    return mapRedemptionCode(requireRow(row, 'Redemption code insert failed'));
  }

  async createRedemptionRecord(
    input: CreateRedemptionRecordInput
  ): Promise<RedemptionCodeRedemption> {
    const [row] = await this.db
      .insert(schema.mtRedemptionCodeRedemptions)
      .values({
        id: input.id,
        quotaLedgerId: input.quotaLedgerId,
        redeemedAt: input.redeemedAt,
        redemptionCodeId: input.redemptionCodeId,
        tenantId: input.tenantId,
        userId: input.userId,
      })
      .returning();
    return mapRedemptionRecord(requireRow(row, 'Redemption insert failed'));
  }

  async createSession(input: CreateSessionInput): Promise<UserSession> {
    const [row] = await this.db
      .insert(schema.mtUserSessions)
      .values({
        expiresAt: input.expiresAt,
        sessionHash: input.sessionHash,
        tenantId: input.tenantId,
        userId: input.userId,
      })
      .returning();
    return mapSession(requireRow(row, 'Session insert failed'));
  }

  async createUser(input: CreateUserInput): Promise<User> {
    const [row] = await this.db
      .insert(schema.mtUsers)
      .values({
        email: input.email,
        passwordHash: input.passwordHash,
        privacyVersion: input.privacyVersion,
        role: input.role,
        status: input.status,
        tenantId: input.tenantId,
        termsAcceptedAt: input.termsAcceptedAt,
        termsVersion: input.termsVersion,
        username: input.username,
      })
      .returning();
    return mapUser(requireRow(row, 'User insert failed'));
  }

  async findActiveSessionByHash(
    tenantId: string,
    sessionHash: string,
    now: Date
  ): Promise<UserSession | null> {
    const [row] = await this.db
      .select()
      .from(schema.mtUserSessions)
      .where(
        and(
          eq(schema.mtUserSessions.tenantId, tenantId),
          eq(schema.mtUserSessions.sessionHash, sessionHash),
          isNull(schema.mtUserSessions.revokedAt),
          gt(schema.mtUserSessions.expiresAt, now)
        )
      )
      .limit(1);
    return row ? mapSession(row) : null;
  }

  async findInviteCodeByHash(
    tenantId: string,
    codeHash: string
  ): Promise<InviteCode | null> {
    const [row] = await this.db
      .select()
      .from(schema.mtInviteCodes)
      .where(
        and(
          eq(schema.mtInviteCodes.tenantId, tenantId),
          eq(schema.mtInviteCodes.codeHash, codeHash)
        )
      )
      .limit(1);
    return row ? mapInviteCode(row) : null;
  }

  async findQuotaAccountByUserId(
    tenantId: string,
    userId: string
  ): Promise<QuotaAccount | null> {
    const [row] = await this.db
      .select()
      .from(schema.mtQuotaAccounts)
      .where(
        and(
          eq(schema.mtQuotaAccounts.tenantId, tenantId),
          eq(schema.mtQuotaAccounts.ownerType, 'user'),
          eq(schema.mtQuotaAccounts.ownerId, userId)
        )
      )
      .limit(1);
    return row ? mapQuotaAccount(row) : null;
  }

  async findRedemptionByCodeAndUser(
    tenantId: string,
    redemptionCodeId: string,
    userId: string
  ): Promise<RedemptionCodeRedemption | null> {
    const [row] = await this.db
      .select()
      .from(schema.mtRedemptionCodeRedemptions)
      .where(
        and(
          eq(schema.mtRedemptionCodeRedemptions.tenantId, tenantId),
          eq(
            schema.mtRedemptionCodeRedemptions.redemptionCodeId,
            redemptionCodeId
          ),
          eq(schema.mtRedemptionCodeRedemptions.userId, userId)
        )
      )
      .limit(1);
    return row ? mapRedemptionRecord(row) : null;
  }

  async findRedemptionCodeByHash(
    tenantId: string,
    codeHash: string
  ): Promise<RedemptionCode | null> {
    const [row] = await this.db
      .select()
      .from(schema.mtRedemptionCodes)
      .where(
        and(
          eq(schema.mtRedemptionCodes.tenantId, tenantId),
          eq(schema.mtRedemptionCodes.codeHash, codeHash)
        )
      )
      .limit(1);
    return row ? mapRedemptionCode(row) : null;
  }

  async findUserById(tenantId: string, userId: string): Promise<User | null> {
    const [row] = await this.db
      .select()
      .from(schema.mtUsers)
      .where(
        and(
          eq(schema.mtUsers.tenantId, tenantId),
          eq(schema.mtUsers.id, userId)
        )
      )
      .limit(1);
    return row ? mapUser(row) : null;
  }

  async findUserByLogin(tenantId: string, login: string): Promise<User | null> {
    const normalizedLogin = login.trim().toLowerCase();
    const [row] = await this.db
      .select()
      .from(schema.mtUsers)
      .where(
        and(
          eq(schema.mtUsers.tenantId, tenantId),
          or(
            eq(schema.mtUsers.email, normalizedLogin),
            eq(schema.mtUsers.username, normalizedLogin)
          )
        )
      )
      .limit(1);
    return row ? mapUser(row) : null;
  }

  async listAuditLogs(input: AuditLogFilter): Promise<AuditLog[]> {
    const conditions = [
      eq(schema.mtAuditLogs.tenantId, input.tenantId),
      input.actorUserId
        ? eq(schema.mtAuditLogs.actorUserId, input.actorUserId)
        : undefined,
      input.action ? eq(schema.mtAuditLogs.action, input.action) : undefined,
      input.targetType
        ? eq(schema.mtAuditLogs.targetType, input.targetType)
        : undefined,
      input.targetId ? eq(schema.mtAuditLogs.targetId, input.targetId) : undefined,
    ].filter(Boolean);
    const rows = await this.db
      .select()
      .from(schema.mtAuditLogs)
      .where(and(...conditions))
      .orderBy(desc(schema.mtAuditLogs.createdAt))
      .limit(input.limit ?? 100);
    return rows.map(mapAuditLog);
  }

  async listUsers(tenantId: string): Promise<User[]> {
    const rows = await this.db
      .select()
      .from(schema.mtUsers)
      .where(eq(schema.mtUsers.tenantId, tenantId));
    return rows.map(mapUser);
  }

  async revokeSession(sessionId: string, revokedAt: Date): Promise<void> {
    await this.db
      .update(schema.mtUserSessions)
      .set({
        revokedAt,
        updatedAt: revokedAt,
      })
      .where(eq(schema.mtUserSessions.id, sessionId));
  }

  async updateInviteCode(
    id: string,
    patch: Partial<
      Pick<InviteCode, 'status' | 'usedAt' | 'usedByUserId' | 'usedCount'>
    >
  ): Promise<InviteCode> {
    const [row] = await this.db
      .update(schema.mtInviteCodes)
      .set({
        status: patch.status,
        updatedAt: new Date(),
        usedAt: patch.usedAt,
        usedByUserId: patch.usedByUserId,
        usedCount: patch.usedCount,
      })
      .where(eq(schema.mtInviteCodes.id, id))
      .returning();
    return mapInviteCode(requireRow(row, 'Invite code not found'));
  }

  async updateQuotaAccount(
    id: string,
    patch: Pick<QuotaAccount, 'balanceAmount' | 'heldAmount'>
  ): Promise<QuotaAccount> {
    const [row] = await this.db
      .update(schema.mtQuotaAccounts)
      .set({
        balanceAmount: patch.balanceAmount,
        heldAmount: patch.heldAmount,
        updatedAt: new Date(),
      })
      .where(eq(schema.mtQuotaAccounts.id, id))
      .returning();
    return mapQuotaAccount(requireRow(row, 'Quota account not found'));
  }

  async updateRedemptionCode(
    id: string,
    patch: Partial<Pick<RedemptionCode, 'status' | 'usedCount'>>
  ): Promise<RedemptionCode> {
    const [row] = await this.db
      .update(schema.mtRedemptionCodes)
      .set({
        status: patch.status,
        updatedAt: new Date(),
        usedCount: patch.usedCount,
      })
      .where(eq(schema.mtRedemptionCodes.id, id))
      .returning();
    return mapRedemptionCode(requireRow(row, 'Redemption code not found'));
  }

  async updateUser(
    id: string,
    patch: Partial<
      Pick<
        User,
        | 'lastLoginAt'
        | 'passwordHash'
        | 'privacyVersion'
        | 'status'
        | 'termsAcceptedAt'
        | 'termsVersion'
      >
    >
  ): Promise<User> {
    const [row] = await this.db
      .update(schema.mtUsers)
      .set({
        lastLoginAt: patch.lastLoginAt,
        passwordHash: patch.passwordHash,
        privacyVersion: patch.privacyVersion,
        status: patch.status,
        termsAcceptedAt: patch.termsAcceptedAt,
        termsVersion: patch.termsVersion,
        updatedAt: new Date(),
      })
      .where(eq(schema.mtUsers.id, id))
      .returning();
    return mapUser(requireRow(row, 'User not found'));
  }

  private async findQuotaLedgerByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string
  ): Promise<QuotaLedgerEntry | null> {
    const [row] = await this.db
      .select()
      .from(schema.mtQuotaLedger)
      .where(
        and(
          eq(schema.mtQuotaLedger.tenantId, tenantId),
          eq(schema.mtQuotaLedger.idempotencyKey, idempotencyKey)
        )
      )
      .limit(1);
    return row ? mapQuotaLedgerEntry(row) : null;
  }
}

function mapAuditLog(row: typeof schema.mtAuditLogs.$inferSelect): AuditLog {
  return {
    action: row.action,
    actorUserId: row.actorUserId,
    createdAt: row.createdAt,
    id: row.id,
    metadata: row.metadata as Record<string, unknown>,
    targetId: row.targetId,
    targetType: row.targetType,
    tenantId: row.tenantId,
  };
}

function mapInviteCode(
  row: typeof schema.mtInviteCodes.$inferSelect
): InviteCode {
  return {
    codeHash: row.codeHash,
    createdAt: row.createdAt,
    createdByAdminId: row.createdByAdminId,
    expiresAt: row.expiresAt,
    id: row.id,
    initialQuotaAmount: row.initialQuotaAmount,
    maxUses: row.maxUses,
    status: row.status,
    tenantId: row.tenantId,
    updatedAt: row.updatedAt,
    usedAt: row.usedAt,
    usedByUserId: row.usedByUserId,
    usedCount: row.usedCount,
  };
}

function mapQuotaAccount(
  row: typeof schema.mtQuotaAccounts.$inferSelect
): QuotaAccount {
  return {
    allowOverdraft: row.allowOverdraft,
    balanceAmount: row.balanceAmount,
    createdAt: row.createdAt,
    heldAmount: row.heldAmount,
    id: row.id,
    ownerId: row.ownerId,
    ownerType: row.ownerType,
    tenantId: row.tenantId,
    updatedAt: row.updatedAt,
  };
}

function mapQuotaLedgerEntry(
  row: typeof schema.mtQuotaLedger.$inferSelect
): QuotaLedgerEntry {
  return {
    accountId: row.accountId,
    amount: row.amount,
    balanceAfter: row.balanceAfter,
    createdAt: row.createdAt,
    entryType: row.entryType,
    heldAfter: row.heldAfter,
    id: row.id,
    idempotencyKey: row.idempotencyKey,
    operatorAdminId: row.operatorAdminId,
    pricePolicyId: row.pricePolicyId,
    priceVersion: row.priceVersion,
    reason: row.reason,
    relatedRedemptionId: row.relatedRedemptionId,
    relatedTaskId: row.relatedTaskId,
    tenantId: row.tenantId,
    userId: row.userId,
  };
}

function mapRedemptionCode(
  row: typeof schema.mtRedemptionCodes.$inferSelect
): RedemptionCode {
  return {
    codeHash: row.codeHash,
    createdAt: row.createdAt,
    createdByAdminId: row.createdByAdminId,
    expiresAt: row.expiresAt,
    id: row.id,
    maxUses: row.maxUses,
    quotaAmount: row.quotaAmount,
    status: row.status,
    tenantId: row.tenantId,
    updatedAt: row.updatedAt,
    usedCount: row.usedCount,
  };
}

function mapRedemptionRecord(
  row: typeof schema.mtRedemptionCodeRedemptions.$inferSelect
): RedemptionCodeRedemption {
  return {
    createdAt: row.createdAt,
    id: row.id,
    quotaLedgerId: row.quotaLedgerId,
    redeemedAt: row.redeemedAt,
    redemptionCodeId: row.redemptionCodeId,
    tenantId: row.tenantId,
    userId: row.userId,
  };
}

function mapSession(
  row: typeof schema.mtUserSessions.$inferSelect
): UserSession {
  return {
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    id: row.id,
    revokedAt: row.revokedAt,
    sessionHash: row.sessionHash,
    tenantId: row.tenantId,
    updatedAt: row.updatedAt,
    userId: row.userId,
  };
}

function mapUser(row: typeof schema.mtUsers.$inferSelect): User {
  return {
    createdAt: row.createdAt,
    email: row.email,
    id: row.id,
    lastLoginAt: row.lastLoginAt,
    passwordHash: row.passwordHash,
    privacyVersion: row.privacyVersion,
    role: row.role,
    status: row.status,
    tenantId: row.tenantId,
    termsAcceptedAt: row.termsAcceptedAt,
    termsVersion: row.termsVersion,
    updatedAt: row.updatedAt,
    username: row.username,
  };
}

function requireRow<T>(row: T | undefined, message: string): T {
  if (!row) {
    throw new AppError('NOT_FOUND', 404, message);
  }
  return row;
}
