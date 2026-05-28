import { randomUUID } from 'crypto';

import { AppError } from '../errors';
import { generateOneTimeCode, hashAccessCode } from './code';
import { hashPassword, verifyPassword } from './password';
import { generateSessionToken, hashSessionToken } from './tokens';
import {
  AuthenticatedSession,
  AuthRepository,
  AuditLog,
  DEFAULT_TENANT_ID,
  QuotaAccount,
  QuotaLedgerEntryType,
  QuotaSummary,
  User,
  UserRole,
  UserView,
} from './types';

const DEFAULT_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

interface AuthServiceOptions {
  now?: () => Date;
  sessionTtlMs?: number;
  tenantId?: string;
}

interface SessionTokenResult {
  expiresAt: Date;
  token: string;
}

export interface LoginResult {
  quota: QuotaSummary;
  session: SessionTokenResult;
  user: UserView;
}

export interface InviteAcceptInput {
  code: string;
  email: string;
  username: string;
  password: string;
  termsVersion: string;
  privacyVersion: string;
}

export interface AdminCreateUserInput {
  email: string;
  username: string;
  password: string;
  role?: UserRole;
  initialQuotaAmount?: number;
  termsVersion?: string;
  privacyVersion?: string;
}

export class AuthService {
  private readonly now: () => Date;
  private readonly sessionTtlMs: number;
  private readonly tenantId: string;

  constructor(
    private readonly repository: AuthRepository,
    options: AuthServiceOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    this.tenantId = options.tenantId ?? DEFAULT_TENANT_ID;
  }

  async login(login: string, password: string): Promise<LoginResult> {
    const user = await this.repository.findUserByLogin(this.tenantId, login);
    if (!user) {
      throw new AppError('INVALID_CREDENTIALS', 401, 'Invalid credentials');
    }
    if (user.status === 'disabled') {
      throw new AppError('USER_DISABLED', 403, 'User is disabled');
    }
    if (user.status !== 'active') {
      throw new AppError('INVALID_CREDENTIALS', 401, 'Invalid credentials');
    }
    if (!(await verifyPassword(password, user.passwordHash))) {
      throw new AppError('INVALID_CREDENTIALS', 401, 'Invalid credentials');
    }

    const now = this.now();
    const updatedUser = await this.repository.updateUser(user.id, {
      lastLoginAt: now,
    });
    const session = await this.createSession(updatedUser);
    return {
      quota: await this.quotaSummary(updatedUser.id),
      session,
      user: toUserView(updatedUser),
    };
  }

  async authenticateSession(token?: string): Promise<AuthenticatedSession> {
    if (!token) {
      throw new AppError('UNAUTHENTICATED', 401, 'Not authenticated');
    }

    const session = await this.repository.findActiveSessionByHash(
      this.tenantId,
      hashSessionToken(token),
      this.now()
    );
    if (!session) {
      throw new AppError('UNAUTHENTICATED', 401, 'Not authenticated');
    }

    const user = await this.repository.findUserById(
      this.tenantId,
      session.userId
    );
    if (!user) {
      throw new AppError('UNAUTHENTICATED', 401, 'Not authenticated');
    }
    if (user.status === 'disabled') {
      throw new AppError('USER_DISABLED', 403, 'User is disabled');
    }

    return {
      quota: await this.quotaSummary(user.id),
      session,
      user,
    };
  }

  async logout(auth: AuthenticatedSession): Promise<void> {
    await this.repository.revokeSession(auth.session.id, this.now());
  }

  async getMe(auth: AuthenticatedSession): Promise<{
    quota: QuotaSummary;
    user: UserView;
  }> {
    return {
      quota: await this.quotaSummary(auth.user.id),
      user: toUserView(auth.user),
    };
  }

  async acceptInvitation(input: InviteAcceptInput): Promise<LoginResult> {
    assertRequiredString(input.email, 'email');
    assertRequiredString(input.username, 'username');
    assertRequiredString(input.password, 'password');
    assertRequiredString(input.termsVersion, 'termsVersion');
    assertRequiredString(input.privacyVersion, 'privacyVersion');

    const now = this.now();
    const invite = await this.repository.findInviteCodeByHash(
      this.tenantId,
      hashAccessCode(input.code)
    );
    if (
      !invite ||
      invite.status !== 'active' ||
      invite.usedCount >= invite.maxUses ||
      isExpired(invite.expiresAt, now)
    ) {
      throw new AppError('INVALID_INVITE_CODE', 400, 'Invalid invite code');
    }

    const user = await this.repository.createUser({
      email: input.email.trim().toLowerCase(),
      passwordHash: await hashPassword(input.password),
      privacyVersion: input.privacyVersion,
      role: 'user',
      status: 'active',
      tenantId: this.tenantId,
      termsAcceptedAt: now,
      termsVersion: input.termsVersion,
      username: input.username.trim().toLowerCase(),
    });

    await this.repository.updateInviteCode(invite.id, {
      status: invite.usedCount + 1 >= invite.maxUses ? 'used' : 'active',
      usedAt: now,
      usedByUserId: user.id,
      usedCount: invite.usedCount + 1,
    });

    const account = await this.repository.createQuotaAccount({
      balanceAmount: 0,
      heldAmount: 0,
      ownerId: user.id,
      ownerType: 'user',
      tenantId: this.tenantId,
    });
    if (invite.initialQuotaAmount > 0) {
      await this.applyQuotaEntry({
        account,
        amount: invite.initialQuotaAmount,
        entryType: 'grant',
        idempotencyKey: `invite:${invite.id}:user:${user.id}`,
        operatorAdminId: invite.createdByAdminId,
        reason: 'invite_initial_grant',
        userId: user.id,
      });
    }

    const session = await this.createSession(user);
    return {
      quota: await this.quotaSummary(user.id),
      session,
      user: toUserView(user),
    };
  }

  async acceptTerms(
    auth: AuthenticatedSession,
    termsVersion: string,
    privacyVersion: string
  ): Promise<{ user: UserView }> {
    assertRequiredString(termsVersion, 'termsVersion');
    assertRequiredString(privacyVersion, 'privacyVersion');

    const user = await this.repository.updateUser(auth.user.id, {
      privacyVersion,
      termsAcceptedAt: this.now(),
      termsVersion,
    });
    return { user: toUserView(user) };
  }

  async redeemCode(
    auth: AuthenticatedSession,
    code: string
  ): Promise<{ ledgerEntryId: string; quota: QuotaSummary }> {
    const now = this.now();
    const redemptionCode = await this.repository.findRedemptionCodeByHash(
      this.tenantId,
      hashAccessCode(code)
    );
    if (
      !redemptionCode ||
      redemptionCode.status !== 'active' ||
      redemptionCode.usedCount >= redemptionCode.maxUses ||
      isExpired(redemptionCode.expiresAt, now)
    ) {
      throw new AppError(
        'INVALID_REDEMPTION_CODE',
        400,
        'Invalid redemption code'
      );
    }

    const existing = await this.repository.findRedemptionByCodeAndUser(
      this.tenantId,
      redemptionCode.id,
      auth.user.id
    );
    if (existing) {
      throw new AppError(
        'INVALID_REDEMPTION_CODE',
        400,
        'Invalid redemption code'
      );
    }

    const account = await this.requireQuotaAccount(auth.user.id);
    const redemptionRecordId = randomUUID();
    const ledger = await this.applyQuotaEntry({
      account,
      amount: redemptionCode.quotaAmount,
      entryType: 'redemption',
      idempotencyKey: `redemption:${redemptionCode.id}:user:${auth.user.id}`,
      relatedRedemptionId: redemptionRecordId,
      userId: auth.user.id,
    });

    await this.repository.createRedemptionRecord({
      id: redemptionRecordId,
      quotaLedgerId: ledger.id,
      redeemedAt: now,
      redemptionCodeId: redemptionCode.id,
      tenantId: this.tenantId,
      userId: auth.user.id,
    });
    await this.repository.updateRedemptionCode(redemptionCode.id, {
      status:
        redemptionCode.usedCount + 1 >= redemptionCode.maxUses
          ? 'used'
          : 'active',
      usedCount: redemptionCode.usedCount + 1,
    });

    return {
      ledgerEntryId: ledger.id,
      quota: await this.quotaSummary(auth.user.id),
    };
  }

  async adminCreateUser(
    admin: AuthenticatedSession,
    input: AdminCreateUserInput
  ): Promise<{ quota: QuotaSummary; user: UserView }> {
    this.requireAdmin(admin);
    assertRequiredString(input.email, 'email');
    assertRequiredString(input.username, 'username');
    assertRequiredString(input.password, 'password');

    const user = await this.repository.createUser({
      email: input.email.trim().toLowerCase(),
      passwordHash: await hashPassword(input.password),
      privacyVersion: input.privacyVersion ?? null,
      role: input.role ?? 'user',
      status: 'active',
      tenantId: this.tenantId,
      termsAcceptedAt: input.termsVersion ? this.now() : null,
      termsVersion: input.termsVersion ?? null,
      username: input.username.trim().toLowerCase(),
    });
    const account = await this.repository.createQuotaAccount({
      balanceAmount: 0,
      heldAmount: 0,
      ownerId: user.id,
      ownerType: 'user',
      tenantId: this.tenantId,
    });
    if ((input.initialQuotaAmount ?? 0) > 0) {
      await this.applyQuotaEntry({
        account,
        amount: input.initialQuotaAmount ?? 0,
        entryType: 'grant',
        idempotencyKey: `admin-create:${user.id}`,
        operatorAdminId: admin.user.id,
        reason: 'admin_create_user',
        userId: user.id,
      });
    }
    await this.audit(admin, 'admin_user_create', 'user', user.id);

    return {
      quota: await this.quotaSummary(user.id),
      user: toUserView(user),
    };
  }

  async adminUpdateUser(
    admin: AuthenticatedSession,
    userId: string,
    input: { password?: string; status?: 'active' | 'disabled' }
  ): Promise<{ user: UserView }> {
    this.requireAdmin(admin);

    const patch: Parameters<AuthRepository['updateUser']>[1] = {};
    if (input.status) {
      patch.status = input.status;
    }
    if (input.password) {
      patch.passwordHash = await hashPassword(input.password);
    }
    if (Object.keys(patch).length === 0) {
      throw new AppError('BAD_REQUEST', 400, 'No user update requested');
    }

    const user = await this.repository.updateUser(userId, patch);
    await this.audit(admin, 'admin_user_update', 'user', user.id, {
      status: input.status,
      passwordReset: Boolean(input.password),
    });
    return { user: toUserView(user) };
  }

  async adminCreateInviteCode(
    admin: AuthenticatedSession,
    input: {
      code?: string;
      expiresAt?: Date | null;
      initialQuotaAmount?: number;
      maxUses?: number;
    }
  ): Promise<{ code: string; id: string }> {
    this.requireAdmin(admin);
    const code = input.code ?? generateOneTimeCode('INV');
    const invite = await this.repository.createInviteCode({
      codeHash: hashAccessCode(code),
      createdByAdminId: admin.user.id,
      expiresAt: input.expiresAt ?? null,
      initialQuotaAmount: input.initialQuotaAmount ?? 0,
      maxUses: input.maxUses ?? 1,
      tenantId: this.tenantId,
    });
    await this.audit(
      admin,
      'admin_invite_code_create',
      'invite_code',
      invite.id
    );
    return { code, id: invite.id };
  }

  async adminCreateRedemptionCode(
    admin: AuthenticatedSession,
    input: {
      code?: string;
      expiresAt?: Date | null;
      maxUses?: number;
      quotaAmount: number;
    }
  ): Promise<{ code: string; id: string }> {
    this.requireAdmin(admin);
    assertPositiveInteger(input.quotaAmount, 'quotaAmount');

    const code = input.code ?? generateOneTimeCode('RED');
    const redemption = await this.repository.createRedemptionCode({
      codeHash: hashAccessCode(code),
      createdByAdminId: admin.user.id,
      expiresAt: input.expiresAt ?? null,
      maxUses: input.maxUses ?? 1,
      quotaAmount: input.quotaAmount,
      tenantId: this.tenantId,
    });
    await this.audit(
      admin,
      'admin_redemption_code_create',
      'redemption_code',
      redemption.id
    );
    return { code, id: redemption.id };
  }

  async adminAdjustQuota(
    admin: AuthenticatedSession,
    userId: string,
    amount: number,
    reason: string
  ): Promise<{ quota: QuotaSummary }> {
    this.requireAdmin(admin);
    assertPositiveInteger(Math.abs(amount), 'amount');
    assertRequiredString(reason, 'reason');

    const account = await this.requireQuotaAccount(userId);
    await this.applyQuotaEntry({
      account,
      amount,
      entryType: 'adjustment',
      idempotencyKey: `admin-adjust:${randomUUID()}`,
      operatorAdminId: admin.user.id,
      reason,
      userId,
    });
    await this.audit(admin, 'admin_quota_adjust', 'user', userId, { amount });
    return { quota: await this.quotaSummary(userId) };
  }

  async listUsers(admin: AuthenticatedSession): Promise<{ users: UserView[] }> {
    this.requireAdmin(admin);
    const users = await this.repository.listUsers(this.tenantId);
    return { users: users.map(toUserView) };
  }

  async listAuditLogs(
    admin: AuthenticatedSession,
    input: {
      action?: string;
      actorUserId?: string;
      limit?: number;
      targetId?: string;
      targetType?: string;
    } = {}
  ): Promise<{ auditLogs: AuditLog[] }> {
    this.requireAdmin(admin);
    return {
      auditLogs: await this.repository.listAuditLogs({
        action: cleanOptionalString(input.action),
        actorUserId: cleanOptionalString(input.actorUserId),
        limit: normalizeLimit(input.limit),
        targetId: cleanOptionalString(input.targetId),
        targetType: cleanOptionalString(input.targetType),
        tenantId: this.tenantId,
      }),
    };
  }

  private async createSession(user: User): Promise<SessionTokenResult> {
    const token = generateSessionToken();
    const expiresAt = new Date(this.now().getTime() + this.sessionTtlMs);
    await this.repository.createSession({
      expiresAt,
      sessionHash: hashSessionToken(token),
      tenantId: this.tenantId,
      userId: user.id,
    });
    return { expiresAt, token };
  }

  private async quotaSummary(userId: string): Promise<QuotaSummary> {
    const account = await this.requireQuotaAccount(userId);
    return {
      accountId: account.id,
      balanceAmount: account.balanceAmount,
      heldAmount: account.heldAmount,
    };
  }

  private async requireQuotaAccount(userId: string): Promise<QuotaAccount> {
    const account = await this.repository.findQuotaAccountByUserId(
      this.tenantId,
      userId
    );
    if (!account) {
      throw new AppError('ACCOUNT_NOT_FOUND', 500, 'Quota account not found');
    }
    return account;
  }

  private async applyQuotaEntry(input: {
    account: QuotaAccount;
    amount: number;
    entryType: QuotaLedgerEntryType;
    idempotencyKey: string;
    operatorAdminId?: string | null;
    reason?: string | null;
    relatedRedemptionId?: string | null;
    userId: string;
  }) {
    if (input.amount === 0) {
      throw new AppError('BAD_REQUEST', 400, 'Quota amount must not be zero');
    }

    const balanceAfter = input.account.balanceAmount + input.amount;
    const heldAfter = input.account.heldAmount;
    const account = await this.repository.updateQuotaAccount(input.account.id, {
      balanceAmount: balanceAfter,
      heldAmount: heldAfter,
    });

    return this.repository.createQuotaLedgerEntry({
      accountId: account.id,
      amount: Math.abs(input.amount),
      balanceAfter: account.balanceAmount,
      entryType: input.entryType,
      heldAfter: account.heldAmount,
      idempotencyKey: input.idempotencyKey,
      operatorAdminId: input.operatorAdminId ?? null,
      reason: input.reason ?? null,
      relatedRedemptionId: input.relatedRedemptionId ?? null,
      relatedTaskId: null,
      tenantId: this.tenantId,
      userId: input.userId,
    });
  }

  private requireAdmin(auth: AuthenticatedSession): void {
    if (auth.user.role !== 'admin') {
      throw new AppError('FORBIDDEN', 403, 'Forbidden');
    }
  }

  private async audit(
    admin: AuthenticatedSession,
    action: string,
    targetType: string,
    targetId: string,
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    await this.repository.createAuditLog({
      action,
      actorUserId: admin.user.id,
      metadata,
      targetId,
      targetType,
      tenantId: this.tenantId,
    });
  }
}

export function toUserView(user: User): UserView {
  return {
    email: user.email,
    id: user.id,
    lastLoginAt: user.lastLoginAt,
    privacyVersion: user.privacyVersion,
    role: user.role,
    status: user.status,
    termsAcceptedAt: user.termsAcceptedAt,
    termsVersion: user.termsVersion,
    username: user.username,
  };
}

function isExpired(expiresAt: Date | null, now: Date): boolean {
  return Boolean(expiresAt && expiresAt.getTime() <= now.getTime());
}

function assertRequiredString(value: string, field: string): void {
  if (!value || !value.trim()) {
    throw new AppError('BAD_REQUEST', 400, `${field} is required`);
  }
}

function cleanOptionalString(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) {
    return 100;
  }
  if (!Number.isInteger(value) || value <= 0 || value > 500) {
    throw new AppError('BAD_REQUEST', 400, 'limit must be 1..500');
  }
  return value;
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new AppError(
      'BAD_REQUEST',
      400,
      `${field} must be a positive integer`
    );
  }
}
