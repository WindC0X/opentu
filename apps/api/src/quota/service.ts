import { AppError } from '../errors';
import type {
  AuthRepository,
  AuthenticatedSession,
  QuotaAccount,
  QuotaLedgerEntry,
} from '../auth/types';
import type {
  ImageTaskOperationType,
  ImageTaskQuote,
  ImageTaskReferenceAssetInput,
} from '../image-tasks/types';
import {
  MOCK_PRICE_PER_IMAGE,
  MOCK_PRICE_POLICY_ID,
  MOCK_PRICE_VERSION,
  requireMockImageModel,
} from '../providers/mock-provider';

export class QuotaService {
  constructor(private readonly repository: AuthRepository) {}

  quote(input: {
    batchSize: 1 | 2 | 4;
    maskAssetId?: string | null;
    modelKey: string;
    operationType: ImageTaskOperationType;
    ratio: string;
    referenceAssets?: ImageTaskReferenceAssetInput[];
    sourceAssetId?: string | null;
  }): ImageTaskQuote {
    const model = requireMockImageModel(input.modelKey);
    if (!model.capabilities.operationTypes.includes(input.operationType)) {
      throw new AppError(
        'MODEL_UNSUPPORTED_OPERATION',
        400,
        '模型不支持当前操作'
      );
    }
    if (!model.capabilities.supportedRatios.includes(input.ratio)) {
      throw new AppError(
        'MODEL_UNSUPPORTED_OPERATION',
        400,
        '模型不支持当前比例'
      );
    }
    if (input.batchSize > model.capabilities.maxBatchSize) {
      throw new AppError(
        'MODEL_UNSUPPORTED_OPERATION',
        400,
        '模型不支持当前批量数量'
      );
    }
    if (input.operationType === 'inpaint' && !model.capabilities.supportsMask) {
      throw new AppError('MODEL_UNSUPPORTED_OPERATION', 400, '模型不支持 mask');
    }
    if (
      input.referenceAssets &&
      input.referenceAssets.length > model.capabilities.maxReferenceImages
    ) {
      throw new AppError(
        'MODEL_UNSUPPORTED_OPERATION',
        400,
        '模型不支持当前参考图数量'
      );
    }

    return {
      amount: MOCK_PRICE_PER_IMAGE * input.batchSize,
      batchSize: input.batchSize,
      maskAssetId: input.maskAssetId ?? null,
      modelKey: input.modelKey,
      operationType: input.operationType,
      pricePolicyId: MOCK_PRICE_POLICY_ID,
      priceVersion: MOCK_PRICE_VERSION,
      ratio: input.ratio,
      referenceAssets: input.referenceAssets ?? [],
      sourceAssetId: input.sourceAssetId ?? null,
      unit: 'points',
    };
  }

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
