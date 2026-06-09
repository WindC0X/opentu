import type {
  Task,
  TaskInvocationBindingSnapshot,
  TaskInvocationOperation,
  TaskInvocationRouteSnapshot,
} from '../types/task.types';
import {
  createModelRef,
  providerProfilesSettings,
  resolveInvocationRoute,
  type ModelRef,
} from '../utils/settings-manager';
import {
  resolveInvocationPlanFromRoute,
  type ProviderModelBinding,
} from './provider-routing';

const DEFAULT_BASE_URL = 'https://api.tu-zi.com/v1';

function normalizeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function toRouteModel(
  modelRef?: ModelRef | null,
  modelId?: string | null
): ModelRef | string | null {
  if (modelRef?.profileId || modelRef?.modelId) {
    return modelRef;
  }
  return normalizeString(modelId);
}

function cloneMetadata(
  metadata: ProviderModelBinding['metadata']
): Record<string, unknown> | undefined {
  if (!metadata) {
    return undefined;
  }

  try {
    return JSON.parse(JSON.stringify(metadata)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function snapshotBinding(
  binding?: ProviderModelBinding | null
): TaskInvocationBindingSnapshot | null {
  if (!binding) {
    return null;
  }

  return {
    id: binding.id,
    protocol: binding.protocol,
    requestSchema: binding.requestSchema,
    responseSchema: binding.responseSchema,
    submitPath: binding.submitPath,
    pollPathTemplate: binding.pollPathTemplate,
    baseUrlStrategy: binding.baseUrlStrategy,
    metadata: cloneMetadata(binding.metadata),
  };
}

export function createTaskInvocationRouteSnapshot(
  operation: TaskInvocationOperation,
  routeModel?: ModelRef | string | null,
  options: { bindingId?: string | null } = {}
): TaskInvocationRouteSnapshot {
  const plan = resolveInvocationPlanFromRoute(operation, routeModel, {
    bindingId: options.bindingId,
  });

  if (plan) {
    return {
      operation,
      modelRef: createModelRef(plan.modelRef.profileId, plan.modelRef.modelId),
      providerProfileId: plan.provider.profileId,
      providerType: plan.provider.providerType,
      modelId: plan.modelRef.modelId,
      binding: snapshotBinding(plan.binding),
    };
  }

  const route = resolveInvocationRoute(operation, routeModel);
  return {
    operation,
    modelRef: createModelRef(route.profileId, route.modelId),
    providerProfileId: route.profileId,
    providerType: route.providerType,
    modelId: route.modelId,
    binding: null,
  };
}

export function createTaskInvocationRouteSnapshotFromTask(
  task: Pick<Task, 'type' | 'params'>,
  operation?: TaskInvocationOperation
): TaskInvocationRouteSnapshot | undefined {
  const routeOperation =
    operation ||
    (task.type === 'video'
      ? 'video'
      : task.type === 'audio'
      ? 'audio'
      : task.type === 'chat'
      ? 'text'
      : task.type === 'image'
      ? 'image'
      : undefined);

  if (!routeOperation) {
    return undefined;
  }

  return createTaskInvocationRouteSnapshot(
    routeOperation,
    task.params.modelRef || task.params.model || null
  );
}

export function resolveTaskInvocationRouteModel(
  task: Pick<Task, 'params' | 'invocationRoute'>
): ModelRef | string | null {
  const route = task.invocationRoute;
  if (route) {
    const profileId =
      normalizeString(route.modelRef?.profileId) ||
      normalizeString(route.providerProfileId);
    const modelId =
      normalizeString(route.modelRef?.modelId) ||
      normalizeString(route.modelId);
    const ref = createModelRef(profileId, modelId);
    if (ref) {
      return ref;
    }
  }

  return task.params.modelRef || task.params.model || null;
}

export function resolveLegacyTaskInvocationRouteModel(
  operation: TaskInvocationOperation,
  task: Pick<Task, 'params' | 'invocationRoute'>
): ModelRef | string | null {
  const routeModel = resolveTaskInvocationRouteModel(task);
  if (typeof routeModel !== 'string') {
    return routeModel;
  }

  const modelId = normalizeString(routeModel);
  if (!modelId) {
    return routeModel;
  }

  const directRoute = resolveInvocationRoute(operation, modelId);
  if (directRoute.profileId) {
    return createModelRef(directRoute.profileId, directRoute.modelId);
  }

  const matchingProfiles = providerProfilesSettings
    .get()
    .filter((profile) => profile.enabled && profile.baseUrl && profile.apiKey);

  for (const profile of matchingProfiles) {
    const candidate = createModelRef(profile.id, modelId);
    if (resolveInvocationPlanFromRoute(operation, candidate)) {
      return candidate;
    }
  }

  return routeModel;
}

export function shouldUseStrictTaskInvocationRoute(
  task: Pick<Task, 'invocationRoute'>
): boolean {
  return Boolean(task.invocationRoute?.providerProfileId);
}

export function assertTaskInvocationRouteAvailable(
  operation: TaskInvocationOperation,
  task: Pick<Task, 'invocationRoute'>
): void {
  const route = task.invocationRoute;
  if (!route?.providerProfileId) {
    return;
  }

  const profile = providerProfilesSettings
    .get()
    .find((item) => item.id === route.providerProfileId);

  if (!profile) {
    throw new Error('原供应商配置已删除，无法继续查询异步任务状态');
  }

  if (!profile.enabled) {
    throw new Error('原供应商配置已停用，无法继续查询异步任务状态');
  }

  const usesSessionBroker = profile.authType === 'session-broker';

  if (!usesSessionBroker && !profile.apiKey?.trim()) {
    throw new Error('原供应商 API Key 未配置，无法继续查询异步任务状态');
  }

  if (!profile.baseUrl?.trim()) {
    throw new Error('原供应商 Base URL 未配置，无法继续查询异步任务状态');
  }

  const routeModel = toRouteModel(route.modelRef, route.modelId);
  const plan = resolveInvocationPlanFromRoute(operation, routeModel, {
    bindingId: route.binding?.id,
  });

  if (!plan) {
    throw new Error('原供应商模型绑定已不可用，无法继续查询异步任务状态');
  }
}

export function mergeTaskInvocationRoute(
  existing: TaskInvocationRouteSnapshot | undefined,
  next: TaskInvocationRouteSnapshot | undefined
): TaskInvocationRouteSnapshot | undefined {
  return next || existing;
}

export function isLegacyDefaultVideoBaseUrl(baseUrl?: string | null): boolean {
  const normalized = normalizeString(baseUrl);
  return !normalized || normalized === DEFAULT_BASE_URL;
}
