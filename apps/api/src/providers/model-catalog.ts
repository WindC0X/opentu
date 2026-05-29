import type {
  AdminImageTaskOperationType,
  AdminRepository,
  ModelCapabilityRecord,
  ModelConfigRecord,
  PricePolicyRecord,
  ProviderConfigRecord,
} from '../admin/types';
import { DEFAULT_TENANT_ID } from '../auth/types';
import { AppError } from '../errors';
import type {
  ImageModelCatalog,
  ResolvedImageModel,
} from './types';
import {
  MOCK_MODEL_KEY,
  MOCK_PRICE_POLICY_ID,
  MOCK_PRICE_VERSION,
  MOCK_PROVIDER_CONFIG_ID,
  MOCK_PROVIDER_KEY,
  listMockImageModels,
  requireMockImageModel,
} from './mock-provider';
import type {
  ImageModelView,
  ImageTaskOperationType,
  ImageTaskQuote,
  ImageTaskReferenceAssetInput,
} from '../image-tasks/types';

interface AdminImageModelCatalogOptions {
  tenantId?: string;
}

export class MockImageModelCatalog implements ImageModelCatalog {
  async listModels(): Promise<ImageModelView[]> {
    return listMockImageModels();
  }

  async quote(input: {
    batchSize: 1 | 2 | 4;
    maskAssetId?: string | null;
    modelKey: string;
    operationType: ImageTaskOperationType;
    ratio: string;
    referenceAssets?: ImageTaskReferenceAssetInput[];
    sourceAssetId?: string | null;
  }): Promise<{ model: ResolvedImageModel; quote: ImageTaskQuote }> {
    const modelView = requireMockImageModel(input.modelKey);
    validateModelCapability(modelView.capabilities, input);
    const model: ResolvedImageModel = {
      capabilities: modelView.capabilities.operationTypes.map((operationType) => ({
        maxBatchSize: modelView.capabilities.maxBatchSize,
        maxReferenceImages: modelView.capabilities.maxReferenceImages,
        operationType,
        supported: true,
        supportedRatios: modelView.capabilities.supportedRatios,
        supportedSizes: [],
        supportLevel: 'native',
        supportsBatch: modelView.capabilities.supportsBatch,
        supportsMask: modelView.capabilities.supportsMask,
        supportsSeed: false,
      })),
      credential: null,
      displayName: modelView.displayName,
      modelFamily: 'mock-image',
      modelKey: modelView.modelKey,
      modelVersion: '2026-05-27',
      price: {
        amount: modelView.price.amount,
        policyId: MOCK_PRICE_POLICY_ID,
        unit: 'per_image',
        version: MOCK_PRICE_VERSION,
      },
      providerConfigId: MOCK_PROVIDER_CONFIG_ID,
      providerKey: MOCK_PROVIDER_KEY,
      providerModelId: MOCK_MODEL_KEY,
    };
    return { model, quote: buildQuote(input, model) };
  }
}

export class AdminImageModelCatalog implements ImageModelCatalog {
  private readonly fallback = new MockImageModelCatalog();
  private readonly tenantId: string;

  constructor(
    private readonly repository: AdminRepository,
    options: AdminImageModelCatalogOptions = {}
  ) {
    this.tenantId = options.tenantId ?? DEFAULT_TENANT_ID;
  }

  async listModels(): Promise<ImageModelView[]> {
    const records = await this.loadRecords();
    const views = records.models
      .map((model) => this.toModelView(model, records))
      .filter((model): model is ImageModelView => Boolean(model));
    return views.length > 0 ? views : this.fallback.listModels();
  }

  async quote(input: {
    batchSize: 1 | 2 | 4;
    maskAssetId?: string | null;
    modelKey: string;
    operationType: ImageTaskOperationType;
    ratio: string;
    referenceAssets?: ImageTaskReferenceAssetInput[];
    sourceAssetId?: string | null;
  }): Promise<{ model: ResolvedImageModel; quote: ImageTaskQuote }> {
    const records = await this.loadRecords();
    const model = records.models.find(
      (candidate) => candidate.modelKey === input.modelKey
    );
    if (!model && input.modelKey === MOCK_MODEL_KEY) {
      return this.fallback.quote(input);
    }
    if (!model) {
      throw new AppError(
        'MODEL_UNSUPPORTED_OPERATION',
        400,
        `Unsupported model: ${input.modelKey}`
      );
    }

    const resolved = this.resolveModel(model, records);
    validateResolvedCapability(resolved, input);
    return { model: resolved, quote: buildQuote(input, resolved) };
  }

  private async loadRecords(): Promise<{
    models: ModelConfigRecord[];
    pricePolicies: PricePolicyRecord[];
    providers: ProviderConfigRecord[];
  }> {
    const [models, pricePolicies, providers] = await Promise.all([
      this.repository.listModelConfigs(this.tenantId),
      this.repository.listPricePolicies(this.tenantId),
      this.repository.listProviderConfigs(this.tenantId),
    ]);
    return { models, pricePolicies, providers };
  }

  private resolveModel(
    model: ModelConfigRecord,
    records: {
      pricePolicies: PricePolicyRecord[];
      providers: ProviderConfigRecord[];
    }
  ): ResolvedImageModel {
    const provider = records.providers.find(
      (candidate) => candidate.id === model.providerConfigId
    );
    const price = records.pricePolicies.find(
      (candidate) => candidate.id === model.pricePolicyId
    );
    if (!provider || provider.status === 'disabled') {
      throw new AppError('PROVIDER_DISABLED', 400, '供应商不可用');
    }
    if (!price || price.status !== 'active') {
      throw new AppError('MODEL_UNSUPPORTED_OPERATION', 400, '模型价格不可用');
    }
    if (model.healthStatus === 'disabled' || model.visibility === 'disabled') {
      throw new AppError('MODEL_UNSUPPORTED_OPERATION', 400, '模型不可用');
    }
    return {
      capabilities: model.capabilities.filter(isImageCapability),
      credential: provider.credential,
      displayName: model.displayName,
      modelFamily: model.modelFamily,
      modelKey: model.modelKey,
      modelVersion: model.modelVersion,
      price: {
        amount: price.amount,
        policyId: price.id,
        unit: price.unit,
        version: price.version,
      },
      providerConfigId: model.providerConfigId,
      providerKey: provider.providerKey,
      providerModelId: model.providerModelId,
    };
  }

  private toModelView(
    model: ModelConfigRecord,
    records: {
      pricePolicies: PricePolicyRecord[];
      providers: ProviderConfigRecord[];
    }
  ): ImageModelView | null {
    if (model.healthStatus === 'disabled' || model.visibility === 'disabled') {
      return null;
    }
    const provider = records.providers.find(
      (candidate) => candidate.id === model.providerConfigId
    );
    const price = records.pricePolicies.find(
      (candidate) => candidate.id === model.pricePolicyId
    );
    const capabilities = model.capabilities.filter(isImageCapability);
    if (!provider || provider.status === 'disabled' || !price || capabilities.length === 0) {
      return null;
    }
    const primary = capabilities[0]!;
    return {
      capabilities: {
        maxBatchSize: normalizeBatchSize(primary.maxBatchSize),
        maxReferenceImages: Math.max(
          0,
          ...capabilities.map((capability) => capability.maxReferenceImages)
        ),
        operationType: primary.operationType as ImageTaskOperationType,
        operationTypes: capabilities.map(
          (capability) => capability.operationType as ImageTaskOperationType
        ),
        supportedRatios: primary.supportedRatios,
        supportsBatch: capabilities.some((capability) => capability.supportsBatch),
        supportsMask: capabilities.some((capability) => capability.supportsMask),
      },
      displayName: model.displayName,
      modelKey: model.modelKey,
      price: {
        amount: price.amount,
        unit: 'per_image',
        version: price.version,
      },
      providerKey: provider.providerKey,
    };
  }
}

function buildQuote(
  input: {
    batchSize: 1 | 2 | 4;
    maskAssetId?: string | null;
    modelKey: string;
    operationType: ImageTaskOperationType;
    ratio: string;
    referenceAssets?: ImageTaskReferenceAssetInput[];
    sourceAssetId?: string | null;
  },
  model: ResolvedImageModel
): ImageTaskQuote {
  return {
    amount:
      model.price.unit === 'per_image'
        ? model.price.amount * input.batchSize
        : model.price.amount,
    batchSize: input.batchSize,
    maskAssetId: input.maskAssetId ?? null,
    modelKey: input.modelKey,
    operationType: input.operationType,
    pricePolicyId: model.price.policyId,
    priceVersion: model.price.version,
    ratio: input.ratio,
    referenceAssets: input.referenceAssets ?? [],
    sourceAssetId: input.sourceAssetId ?? null,
    unit: 'points',
  };
}

function validateResolvedCapability(
  model: ResolvedImageModel,
  input: {
    batchSize: 1 | 2 | 4;
    operationType: ImageTaskOperationType;
    ratio: string;
    referenceAssets?: ImageTaskReferenceAssetInput[];
  }
): void {
  const capability = model.capabilities.find(
    (candidate) =>
      candidate.supported && candidate.operationType === input.operationType
  );
  if (!capability) {
    throw new AppError('MODEL_UNSUPPORTED_OPERATION', 400, '模型不支持当前操作');
  }
  validateModelCapability(
    {
      maxBatchSize: normalizeBatchSize(capability.maxBatchSize),
      maxReferenceImages: capability.maxReferenceImages,
      operationType: capability.operationType as ImageTaskOperationType,
      operationTypes: [capability.operationType as ImageTaskOperationType],
      supportedRatios: capability.supportedRatios,
      supportsBatch: capability.supportsBatch,
      supportsMask: capability.supportsMask,
    },
    input
  );
}

function validateModelCapability(
  capability: ImageModelView['capabilities'],
  input: {
    batchSize: 1 | 2 | 4;
    operationType: ImageTaskOperationType;
    ratio: string;
    referenceAssets?: ImageTaskReferenceAssetInput[];
  }
): void {
  if (!capability.operationTypes.includes(input.operationType)) {
    throw new AppError('MODEL_UNSUPPORTED_OPERATION', 400, '模型不支持当前操作');
  }
  if (!capability.supportedRatios.includes(input.ratio)) {
    throw new AppError('MODEL_UNSUPPORTED_OPERATION', 400, '模型不支持当前比例');
  }
  if (input.batchSize > capability.maxBatchSize) {
    throw new AppError('MODEL_UNSUPPORTED_OPERATION', 400, '模型不支持当前批量数量');
  }
  if (input.operationType === 'inpaint' && !capability.supportsMask) {
    throw new AppError('MODEL_UNSUPPORTED_OPERATION', 400, '模型不支持 mask');
  }
  if (
    input.referenceAssets &&
    input.referenceAssets.length > capability.maxReferenceImages
  ) {
    throw new AppError('MODEL_UNSUPPORTED_OPERATION', 400, '模型不支持当前参考图数量');
  }
}

function normalizeBatchSize(value: number): 1 | 2 | 4 {
  if (value >= 4) {
    return 4;
  }
  if (value >= 2) {
    return 2;
  }
  return 1;
}

function isImageCapability(
  capability: ModelCapabilityRecord
): capability is ModelCapabilityRecord & {
  operationType: ImageTaskOperationType;
} {
  return (
    capability.operationType === 'text_to_image' ||
    capability.operationType === 'image_to_image' ||
    capability.operationType === 'inpaint' ||
    capability.operationType === 'reference_generate'
  );
}
