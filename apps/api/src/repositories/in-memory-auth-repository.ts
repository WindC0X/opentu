import { randomUUID } from 'crypto';

import { AppError } from '../errors';
import {
  AuditLog,
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

export class InMemoryAuthRepository implements AuthRepository {
  readonly auditLogs = new Map<string, AuditLog>();
  readonly inviteCodes = new Map<string, InviteCode>();
  readonly quotaAccounts = new Map<string, QuotaAccount>();
  readonly quotaLedger = new Map<string, QuotaLedgerEntry>();
  readonly redemptionCodes = new Map<string, RedemptionCode>();
  readonly redemptionRecords = new Map<string, RedemptionCodeRedemption>();
  readonly sessions = new Map<string, UserSession>();
  readonly users = new Map<string, User>();

  async createAuditLog(input: CreateAuditLogInput): Promise<AuditLog> {
    const auditLog: AuditLog = {
      action: input.action,
      actorUserId: input.actorUserId,
      createdAt: new Date(),
      id: randomUUID(),
      metadata: input.metadata ?? {},
      targetId: input.targetId,
      targetType: input.targetType,
      tenantId: input.tenantId,
    };
    this.auditLogs.set(auditLog.id, auditLog);
    return auditLog;
  }

  async createInviteCode(input: CreateInviteCodeInput): Promise<InviteCode> {
    this.assertUniqueCodeHash(this.inviteCodes, input.tenantId, input.codeHash);
    const now = new Date();
    const inviteCode: InviteCode = {
      codeHash: input.codeHash,
      createdAt: now,
      createdByAdminId: input.createdByAdminId,
      expiresAt: input.expiresAt,
      id: randomUUID(),
      initialQuotaAmount: input.initialQuotaAmount,
      maxUses: input.maxUses,
      status: 'active',
      tenantId: input.tenantId,
      updatedAt: now,
      usedAt: null,
      usedByUserId: null,
      usedCount: 0,
    };
    this.inviteCodes.set(inviteCode.id, inviteCode);
    return inviteCode;
  }

  async createQuotaAccount(
    input: CreateQuotaAccountInput
  ): Promise<QuotaAccount> {
    const existing = await this.findQuotaAccountByUserId(
      input.tenantId,
      input.ownerId
    );
    if (existing) {
      throw new AppError('CONFLICT', 409, 'Quota account already exists');
    }

    const now = new Date();
    const quotaAccount: QuotaAccount = {
      allowOverdraft: input.allowOverdraft ?? false,
      balanceAmount: input.balanceAmount ?? 0,
      createdAt: now,
      heldAmount: input.heldAmount ?? 0,
      id: randomUUID(),
      ownerId: input.ownerId,
      ownerType: input.ownerType,
      tenantId: input.tenantId,
      updatedAt: now,
    };
    this.quotaAccounts.set(quotaAccount.id, quotaAccount);
    return quotaAccount;
  }

  async createQuotaLedgerEntry(
    input: CreateQuotaLedgerEntryInput
  ): Promise<QuotaLedgerEntry> {
    const existing = [...this.quotaLedger.values()].find(
      (entry) =>
        entry.tenantId === input.tenantId &&
        entry.idempotencyKey === input.idempotencyKey
    );
    if (existing) {
      return existing;
    }

    const quotaLedgerEntry: QuotaLedgerEntry = {
      accountId: input.accountId,
      amount: input.amount,
      balanceAfter: input.balanceAfter,
      createdAt: new Date(),
      entryType: input.entryType,
      heldAfter: input.heldAfter,
      id: randomUUID(),
      idempotencyKey: input.idempotencyKey,
      operatorAdminId: input.operatorAdminId ?? null,
      reason: input.reason ?? null,
      relatedRedemptionId: input.relatedRedemptionId ?? null,
      relatedTaskId: input.relatedTaskId ?? null,
      tenantId: input.tenantId,
      userId: input.userId,
    };
    this.quotaLedger.set(quotaLedgerEntry.id, quotaLedgerEntry);
    return quotaLedgerEntry;
  }

  async createRedemptionCode(
    input: CreateRedemptionCodeInput
  ): Promise<RedemptionCode> {
    this.assertUniqueCodeHash(
      this.redemptionCodes,
      input.tenantId,
      input.codeHash
    );
    const now = new Date();
    const redemptionCode: RedemptionCode = {
      codeHash: input.codeHash,
      createdAt: now,
      createdByAdminId: input.createdByAdminId,
      expiresAt: input.expiresAt,
      id: randomUUID(),
      maxUses: input.maxUses,
      quotaAmount: input.quotaAmount,
      status: 'active',
      tenantId: input.tenantId,
      updatedAt: now,
      usedCount: 0,
    };
    this.redemptionCodes.set(redemptionCode.id, redemptionCode);
    return redemptionCode;
  }

  async createRedemptionRecord(
    input: CreateRedemptionRecordInput
  ): Promise<RedemptionCodeRedemption> {
    const existing = await this.findRedemptionByCodeAndUser(
      input.tenantId,
      input.redemptionCodeId,
      input.userId
    );
    if (existing) {
      throw new AppError('CONFLICT', 409, 'Redemption already exists');
    }

    const record: RedemptionCodeRedemption = {
      createdAt: new Date(),
      id: input.id,
      quotaLedgerId: input.quotaLedgerId,
      redeemedAt: input.redeemedAt,
      redemptionCodeId: input.redemptionCodeId,
      tenantId: input.tenantId,
      userId: input.userId,
    };
    this.redemptionRecords.set(record.id, record);
    return record;
  }

  async createSession(input: CreateSessionInput): Promise<UserSession> {
    const now = new Date();
    const session: UserSession = {
      createdAt: now,
      expiresAt: input.expiresAt,
      id: randomUUID(),
      revokedAt: null,
      sessionHash: input.sessionHash,
      tenantId: input.tenantId,
      updatedAt: now,
      userId: input.userId,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async createUser(input: CreateUserInput): Promise<User> {
    this.assertUniqueUserLogin(input.tenantId, input.email, input.username);
    const now = new Date();
    const user: User = {
      createdAt: now,
      email: input.email,
      id: randomUUID(),
      lastLoginAt: null,
      passwordHash: input.passwordHash,
      privacyVersion: input.privacyVersion,
      role: input.role,
      status: input.status,
      tenantId: input.tenantId,
      termsAcceptedAt: input.termsAcceptedAt,
      termsVersion: input.termsVersion,
      updatedAt: now,
      username: input.username,
    };
    this.users.set(user.id, user);
    return user;
  }

  async findActiveSessionByHash(
    tenantId: string,
    sessionHash: string,
    now: Date
  ): Promise<UserSession | null> {
    return (
      [...this.sessions.values()].find(
        (session) =>
          session.tenantId === tenantId &&
          session.sessionHash === sessionHash &&
          !session.revokedAt &&
          session.expiresAt.getTime() > now.getTime()
      ) ?? null
    );
  }

  async findInviteCodeByHash(
    tenantId: string,
    codeHash: string
  ): Promise<InviteCode | null> {
    return (
      [...this.inviteCodes.values()].find(
        (invite) => invite.tenantId === tenantId && invite.codeHash === codeHash
      ) ?? null
    );
  }

  async findQuotaAccountByUserId(
    tenantId: string,
    userId: string
  ): Promise<QuotaAccount | null> {
    return (
      [...this.quotaAccounts.values()].find(
        (account) =>
          account.tenantId === tenantId &&
          account.ownerType === 'user' &&
          account.ownerId === userId
      ) ?? null
    );
  }

  async findRedemptionByCodeAndUser(
    tenantId: string,
    redemptionCodeId: string,
    userId: string
  ): Promise<RedemptionCodeRedemption | null> {
    return (
      [...this.redemptionRecords.values()].find(
        (record) =>
          record.tenantId === tenantId &&
          record.redemptionCodeId === redemptionCodeId &&
          record.userId === userId
      ) ?? null
    );
  }

  async findRedemptionCodeByHash(
    tenantId: string,
    codeHash: string
  ): Promise<RedemptionCode | null> {
    return (
      [...this.redemptionCodes.values()].find(
        (redemption) =>
          redemption.tenantId === tenantId && redemption.codeHash === codeHash
      ) ?? null
    );
  }

  async findUserById(tenantId: string, userId: string): Promise<User | null> {
    const user = this.users.get(userId);
    return user?.tenantId === tenantId ? user : null;
  }

  async findUserByLogin(tenantId: string, login: string): Promise<User | null> {
    const normalizedLogin = login.trim().toLowerCase();
    return (
      [...this.users.values()].find(
        (user) =>
          user.tenantId === tenantId &&
          (user.email.toLowerCase() === normalizedLogin ||
            user.username.toLowerCase() === normalizedLogin)
      ) ?? null
    );
  }

  async listUsers(tenantId: string): Promise<User[]> {
    return [...this.users.values()].filter(
      (user) => user.tenantId === tenantId
    );
  }

  async revokeSession(sessionId: string, revokedAt: Date): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    this.sessions.set(sessionId, {
      ...session,
      revokedAt,
      updatedAt: revokedAt,
    });
  }

  async updateInviteCode(
    id: string,
    patch: Partial<
      Pick<InviteCode, 'status' | 'usedAt' | 'usedByUserId' | 'usedCount'>
    >
  ): Promise<InviteCode> {
    const invite = this.require(this.inviteCodes, id, 'Invite code not found');
    const updated = {
      ...invite,
      ...patch,
      updatedAt: new Date(),
    };
    this.inviteCodes.set(id, updated);
    return updated;
  }

  async updateQuotaAccount(
    id: string,
    patch: Pick<QuotaAccount, 'balanceAmount' | 'heldAmount'>
  ): Promise<QuotaAccount> {
    const account = this.require(
      this.quotaAccounts,
      id,
      'Quota account not found'
    );
    const updated = {
      ...account,
      ...patch,
      updatedAt: new Date(),
    };
    this.quotaAccounts.set(id, updated);
    return updated;
  }

  async updateRedemptionCode(
    id: string,
    patch: Partial<Pick<RedemptionCode, 'status' | 'usedCount'>>
  ): Promise<RedemptionCode> {
    const redemption = this.require(
      this.redemptionCodes,
      id,
      'Redemption code not found'
    );
    const updated = {
      ...redemption,
      ...patch,
      updatedAt: new Date(),
    };
    this.redemptionCodes.set(id, updated);
    return updated;
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
    const user = this.require(this.users, id, 'User not found');
    const updated = {
      ...user,
      ...patch,
      updatedAt: new Date(),
    };
    this.users.set(id, updated);
    return updated;
  }

  private assertUniqueCodeHash<
    T extends { codeHash: string; tenantId: string }
  >(map: Map<string, T>, tenantId: string, codeHash: string): void {
    const existing = [...map.values()].find(
      (record) => record.tenantId === tenantId && record.codeHash === codeHash
    );
    if (existing) {
      throw new AppError('CONFLICT', 409, 'Code already exists');
    }
  }

  private assertUniqueUserLogin(
    tenantId: string,
    email: string,
    username: string
  ): void {
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedUsername = username.trim().toLowerCase();
    const existing = [...this.users.values()].find(
      (user) =>
        user.tenantId === tenantId &&
        (user.email.toLowerCase() === normalizedEmail ||
          user.username.toLowerCase() === normalizedUsername)
    );
    if (existing) {
      throw new AppError('CONFLICT', 409, 'User already exists');
    }
  }

  private require<T>(map: Map<string, T>, id: string, message: string): T {
    const record = map.get(id);
    if (!record) {
      throw new AppError('NOT_FOUND', 404, message);
    }
    return record;
  }
}
