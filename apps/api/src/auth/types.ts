export const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';

export type UserRole = 'user' | 'admin';
export type UserStatus = 'invited' | 'active' | 'disabled';
export type CodeStatus = 'active' | 'used' | 'expired' | 'disabled';
export type QuotaOwnerType = 'user' | 'team';
export type QuotaLedgerEntryType =
  | 'grant'
  | 'redemption'
  | 'hold'
  | 'consume'
  | 'release'
  | 'refund'
  | 'adjustment';

export interface User {
  id: string;
  tenantId: string;
  email: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  termsAcceptedAt: Date | null;
  termsVersion: string | null;
  privacyVersion: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserSession {
  id: string;
  tenantId: string;
  userId: string;
  sessionHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InviteCode {
  id: string;
  tenantId: string;
  codeHash: string;
  status: CodeStatus;
  initialQuotaAmount: number;
  maxUses: number;
  usedCount: number;
  expiresAt: Date | null;
  createdByAdminId: string;
  usedByUserId: string | null;
  usedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RedemptionCode {
  id: string;
  tenantId: string;
  codeHash: string;
  quotaAmount: number;
  status: CodeStatus;
  maxUses: number;
  usedCount: number;
  expiresAt: Date | null;
  createdByAdminId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface RedemptionCodeRedemption {
  id: string;
  tenantId: string;
  redemptionCodeId: string;
  userId: string;
  quotaLedgerId: string;
  redeemedAt: Date;
  createdAt: Date;
}

export interface QuotaAccount {
  id: string;
  tenantId: string;
  ownerType: QuotaOwnerType;
  ownerId: string;
  balanceAmount: number;
  heldAmount: number;
  allowOverdraft: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuotaLedgerEntry {
  id: string;
  tenantId: string;
  accountId: string;
  userId: string;
  entryType: QuotaLedgerEntryType;
  amount: number;
  balanceAfter: number;
  heldAfter: number;
  relatedTaskId: string | null;
  relatedRedemptionId: string | null;
  reason: string | null;
  operatorAdminId: string | null;
  pricePolicyId: string | null;
  priceVersion: number | null;
  idempotencyKey: string;
  createdAt: Date;
}

export interface AuditLog {
  id: string;
  tenantId: string;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface UserView {
  id: string;
  email: string;
  username: string;
  role: UserRole;
  status: UserStatus;
  termsAcceptedAt: Date | null;
  termsVersion: string | null;
  privacyVersion: string | null;
  lastLoginAt: Date | null;
}

export interface QuotaSummary {
  accountId: string;
  balanceAmount: number;
  heldAmount: number;
}

export interface AuthenticatedSession {
  user: User;
  session: UserSession;
  quota: QuotaSummary;
}

export interface CreateUserInput {
  tenantId: string;
  email: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  termsAcceptedAt: Date | null;
  termsVersion: string | null;
  privacyVersion: string | null;
}

export interface CreateSessionInput {
  tenantId: string;
  userId: string;
  sessionHash: string;
  expiresAt: Date;
}

export interface CreateInviteCodeInput {
  tenantId: string;
  codeHash: string;
  initialQuotaAmount: number;
  maxUses: number;
  expiresAt: Date | null;
  createdByAdminId: string;
}

export interface CreateRedemptionCodeInput {
  tenantId: string;
  codeHash: string;
  quotaAmount: number;
  maxUses: number;
  expiresAt: Date | null;
  createdByAdminId: string;
}

export interface CreateRedemptionRecordInput {
  id: string;
  tenantId: string;
  redemptionCodeId: string;
  userId: string;
  quotaLedgerId: string;
  redeemedAt: Date;
}

export interface CreateQuotaAccountInput {
  tenantId: string;
  ownerType: QuotaOwnerType;
  ownerId: string;
  balanceAmount?: number;
  heldAmount?: number;
  allowOverdraft?: boolean;
}

export interface CreateQuotaLedgerEntryInput {
  tenantId: string;
  accountId: string;
  userId: string;
  entryType: QuotaLedgerEntryType;
  amount: number;
  balanceAfter: number;
  heldAfter: number;
  relatedTaskId?: string | null;
  relatedRedemptionId?: string | null;
  reason?: string | null;
  operatorAdminId?: string | null;
  pricePolicyId?: string | null;
  priceVersion?: number | null;
  idempotencyKey: string;
}

export interface CreateAuditLogInput {
  tenantId: string;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}

export interface AuthRepository {
  createAuditLog(input: CreateAuditLogInput): Promise<AuditLog>;
  createInviteCode(input: CreateInviteCodeInput): Promise<InviteCode>;
  createQuotaAccount(input: CreateQuotaAccountInput): Promise<QuotaAccount>;
  createQuotaLedgerEntry(
    input: CreateQuotaLedgerEntryInput
  ): Promise<QuotaLedgerEntry>;
  createRedemptionCode(
    input: CreateRedemptionCodeInput
  ): Promise<RedemptionCode>;
  createRedemptionRecord(
    input: CreateRedemptionRecordInput
  ): Promise<RedemptionCodeRedemption>;
  createSession(input: CreateSessionInput): Promise<UserSession>;
  createUser(input: CreateUserInput): Promise<User>;
  findActiveSessionByHash(
    tenantId: string,
    sessionHash: string,
    now: Date
  ): Promise<UserSession | null>;
  findInviteCodeByHash(
    tenantId: string,
    codeHash: string
  ): Promise<InviteCode | null>;
  findQuotaAccountByUserId(
    tenantId: string,
    userId: string
  ): Promise<QuotaAccount | null>;
  findRedemptionByCodeAndUser(
    tenantId: string,
    redemptionCodeId: string,
    userId: string
  ): Promise<RedemptionCodeRedemption | null>;
  findRedemptionCodeByHash(
    tenantId: string,
    codeHash: string
  ): Promise<RedemptionCode | null>;
  findUserById(tenantId: string, userId: string): Promise<User | null>;
  findUserByLogin(tenantId: string, login: string): Promise<User | null>;
  listUsers(tenantId: string): Promise<User[]>;
  revokeSession(sessionId: string, revokedAt: Date): Promise<void>;
  updateInviteCode(
    id: string,
    patch: Partial<
      Pick<InviteCode, 'status' | 'usedCount' | 'usedByUserId' | 'usedAt'>
    >
  ): Promise<InviteCode>;
  updateQuotaAccount(
    id: string,
    patch: Pick<QuotaAccount, 'balanceAmount' | 'heldAmount'>
  ): Promise<QuotaAccount>;
  updateRedemptionCode(
    id: string,
    patch: Partial<Pick<RedemptionCode, 'status' | 'usedCount'>>
  ): Promise<RedemptionCode>;
  updateUser(
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
  ): Promise<User>;
}
