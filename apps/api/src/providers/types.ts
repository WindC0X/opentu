import type {
  ModelCapabilityRecord,
  PricePolicyUnit,
  ProviderCredentialMetadata,
} from '../admin/types';
import type { AssetReferenceRole } from '../assets/types';
import type {
  CreateImageTaskInput,
  ImageModelView,
  ImageTask,
  ImageTaskOperationType,
  ImageTaskQuote,
  ImageTaskSelectedParams,
} from '../image-tasks/types';

export interface ResolvedImageModel {
  capabilities: ModelCapabilityRecord[];
  credential: ProviderCredentialMetadata | null;
  displayName: string;
  modelFamily: string;
  modelKey: string;
  modelVersion: string;
  price: {
    amount: number;
    policyId: string;
    unit: PricePolicyUnit;
    version: number;
  };
  providerConfigId: string;
  providerKey: string;
  providerModelId: string;
}

export interface ImageModelCatalog {
  listModels(): Promise<ImageModelView[]>;
  quote(input: {
    batchSize: 1 | 2 | 4;
    maskAssetId?: string | null;
    modelKey: string;
    operationType: ImageTaskOperationType;
    params?: ImageTaskSelectedParams;
    ratio: string;
    referenceAssets?: Array<{
      assetId: string;
      order: number;
      role: AssetReferenceRole;
    }>;
    sourceAssetId?: string | null;
  }): Promise<{ model: ResolvedImageModel; quote: ImageTaskQuote }>;
}

export interface ProviderCredentialResolver {
  resolve(input: {
    credential: ProviderCredentialMetadata | null;
    model: ResolvedImageModel;
  }): Promise<string | null>;
}

export interface ProviderInputImage {
  assetId: string;
  body: Buffer;
  mimeType: string;
  order: number;
  role: AssetReferenceRole | 'mask' | 'source';
}

export interface ImageProviderExecutionInput {
  credentialSecret: string | null;
  input: CreateImageTaskInput;
  maskImage: ProviderInputImage | null;
  model: ResolvedImageModel;
  referenceImages: ProviderInputImage[];
  sourceImage: ProviderInputImage | null;
  task: ImageTask;
}

export interface ImageProviderLateResultInput extends ImageProviderExecutionInput {
  providerRequestId: string;
}

export interface ImageProviderResult {
  failureCount: number;
  images: Array<{
    body: Buffer;
    candidateIndex: number;
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  }>;
  latencyMs: number | null;
  providerCostAmount: number | null;
  providerCostCurrency: string | null;
  providerRequestId: string | null;
  rawErrorCode: string | null;
  rawErrorMessage: string | null;
  responseSnapshot: Record<string, unknown>;
  status: 'succeeded' | 'failed' | 'timeout' | 'partial_succeeded';
  successCount: number;
}

export interface ImageProviderAdapter {
  providerKey: string;
  requiresCredential?: boolean;
  execute(input: ImageProviderExecutionInput): Promise<ImageProviderResult>;
  recoverLateResult?(
    input: ImageProviderLateResultInput
  ): Promise<ImageProviderResult>;
}
