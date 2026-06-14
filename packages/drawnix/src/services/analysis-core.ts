/**
 * 分析服务共享工具函数
 *
 * 供 music-analysis-service 和 video-analysis-service 复用。
 */

import {
  resolveInvocationRoute,
  settingsManager,
  type ModelRef,
} from '../utils/settings-manager';
import { validateAndEnsureConfig } from '../utils/gemini-api/auth';
import type { GeminiConfig } from '../utils/gemini-api/types';
import { collectJsonSources } from '../utils/llm-json-extractor';
import { resolveInvocationPlanFromRoute } from './provider-routing';
import { resolveCreativeEmbeddedModelForGeneration } from './creative-embedded-model-guard';

/**
 * 构建 google.generateContent 协议的配置
 */
export async function buildGenerateContentConfig(
  model?: string,
  modelRef?: ModelRef | null
): Promise<GeminiConfig> {
  await settingsManager.waitForInitialization();

  const embeddedModel = resolveCreativeEmbeddedModelForGeneration(
    'text',
    model || null,
    modelRef || null
  );
  const effectiveModel = embeddedModel?.modelId || model;
  const effectiveModelRef = embeddedModel?.modelRef || modelRef || null;
  const routeModel = effectiveModelRef || effectiveModel || null;
  const route = resolveInvocationRoute('text', routeModel);
  const plan = resolveInvocationPlanFromRoute('text', routeModel);

  const config: GeminiConfig = {
    apiKey: route.apiKey,
    baseUrl: route.baseUrl,
    modelName: effectiveModel || route.modelId || 'gemini-2.5-pro',
    authType: plan?.provider.authType || 'bearer',
    providerType: plan?.provider.providerType || 'custom',
    extraHeaders: plan?.provider.extraHeaders,
    protocol: 'google.generateContent',
    binding: {
      ...(plan?.binding || {}),
      protocol: 'google.generateContent',
      baseUrlStrategy: 'trim-v1',
      submitPath: undefined,
    } as any,
    provider: plan?.provider || null,
  };

  return validateAndEnsureConfig(config);
}

/**
 * 从文本中提取顶层 JSON 对象
 */
export function extractJsonObjects(text: string): string[] {
  try {
    return collectJsonSources(text, { kinds: ['object'] });
  } catch {
    return [];
  }
}
