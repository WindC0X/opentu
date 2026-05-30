import { AppError } from '../errors';
import type {
  AuthRepository,
  AuthenticatedSession,
  QuotaAccount,
  QuotaLedgerEntry,
} from '../auth/types';
import type { ImageTaskQuote } from '../image-tasks/types';

export class QuotaService {
  constructor(private readonly repository: AuthRepository) {}

  async hold(
    auth: AuthenticatedSession,
    quote: ImageTaskQuote,
    input: { idempotencyKey: string; taskId: string }
  ): Promise<QuotaLedgerEntry> {
    const account = await this.requireQuotaAccount(auth);
    if (!account.allowOverdraft && account.balanceAmount < quote.amount) {
      throw new AppError('INSUFFICIENT_QUOTA', 402, '点数不足，无法提交任务');
    }
    const balanceAfter = account.balanceAmount - quote.amount;
    const heldAfter = account.heldAmount + quote.amount;
    return this.applyEntry(account, {
      amount: quote.amount,
      balanceAfter,
      entryType: 'hold',
      heldAfter,
      idempotencyKey: `quota_hold:${input.idempotencyKey}`,
      pricePolicyId: quote.pricePolicyId,
      priceVersion: quote.priceVersion,
      relatedTaskId: input.taskId,
      userId: auth.user.id,
    });
  }

  async consume(
    auth: AuthenticatedSession,
    quote: ImageTaskQuote,
    input: {
      amount: number;
      idempotencyKey: string;
      taskId: string;
    }
  ): Promise<QuotaLedgerEntry | null> {
    if (input.amount <= 0) {
      return null;
    }
    const account = await this.requireQuotaAccount(auth);
    if (account.heldAmount < input.amount) {
      throw new AppError('INSUFFICIENT_QUOTA', 409, '冻结点数不足');
    }
    return this.applyEntry(account, {
      amount: input.amount,
      balanceAfter: account.balanceAmount,
      entryType: 'consume',
      heldAfter: account.heldAmount - input.amount,
      idempotencyKey: `quota_consume:${input.idempotencyKey}`,
      pricePolicyId: quote.pricePolicyId,
      priceVersion: quote.priceVersion,
      relatedTaskId: input.taskId,
      userId: auth.user.id,
    });
  }

  async release(
    auth: AuthenticatedSession,
    quote: ImageTaskQuote,
    input: {
      amount: number;
      idempotencyKey: string;
      taskId: string;
    }
  ): Promise<QuotaLedgerEntry | null> {
    if (input.amount <= 0) {
      return null;
    }
    const account = await this.requireQuotaAccount(auth);
    if (account.heldAmount < input.amount) {
      throw new AppError('INSUFFICIENT_QUOTA', 409, '冻结点数不足');
    }
    return this.applyEntry(account, {
      amount: input.amount,
      balanceAfter: account.balanceAmount + input.amount,
      entryType: 'release',
      heldAfter: account.heldAmount - input.amount,
      idempotencyKey: `quota_release:${input.idempotencyKey}`,
      pricePolicyId: quote.pricePolicyId,
      priceVersion: quote.priceVersion,
      relatedTaskId: input.taskId,
      userId: auth.user.id,
    });
  }

  async canConsumeHeldAmount(
    auth: AuthenticatedSession,
    amount: number
  ): Promise<boolean> {
    if (amount <= 0) {
      return true;
    }
    const account = await this.requireQuotaAccount(auth);
    return account.heldAmount >= amount;
  }

  private async applyEntry(
    account: QuotaAccount,
    input: {
      amount: number;
      balanceAfter: number;
      entryType: 'hold' | 'consume' | 'release';
      heldAfter: number;
      idempotencyKey: string;
      pricePolicyId: string;
      priceVersion: number;
      relatedTaskId: string;
      userId: string;
    }
  ): Promise<QuotaLedgerEntry> {
    const updated = await this.repository.updateQuotaAccount(account.id, {
      balanceAmount: input.balanceAfter,
      heldAmount: input.heldAfter,
    });
    return this.repository.createQuotaLedgerEntry({
      accountId: updated.id,
      amount: input.amount,
      balanceAfter: updated.balanceAmount,
      entryType: input.entryType,
      heldAfter: updated.heldAmount,
      idempotencyKey: input.idempotencyKey,
      pricePolicyId: input.pricePolicyId,
      priceVersion: input.priceVersion,
      relatedTaskId: input.relatedTaskId,
      tenantId: account.tenantId,
      userId: input.userId,
    });
  }

  private async requireQuotaAccount(
    auth: AuthenticatedSession
  ): Promise<QuotaAccount> {
    const account = await this.repository.findQuotaAccountByUserId(
      auth.user.tenantId,
      auth.user.id
    );
    if (!account) {
      throw new AppError('ACCOUNT_NOT_FOUND', 500, 'Quota account not found');
    }
    return account;
  }
}
