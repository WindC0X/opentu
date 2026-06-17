/**
 * 图片生成 MCP 工具
 *
 * 封装现有的图片生成服务，提供标准化的 MCP 工具接口
 * 支持两种执行模式：
 * - async: 直接调用 API 等待返回（Agent 流程）
 * - queue: 创建任务加入队列（直接生成流程）
 */

import type {
  MCPTool,
  MCPResult,
  MCPExecuteOptions,
  MCPTaskResult,
} from '../types';
import {
  TaskType,
  type GenerationParams,
  type KnowledgeContextRef,
} from '../../types/task.types';
import {
  getDefaultImageModel,
  IMAGE_PARAMS,
  getCompatibleParams,
  hasCreativeUserParams,
  hasRuntimeParameterSchema,
  isCreativeManagedImageTask,
  isCreativeManagedModel,
  sanitizeCreativeUserParamsForModel,
  type CreativeUserParams,
} from '../../constants/model-config';
import { geminiSettings, type ModelRef } from '../../utils/settings-manager';
import { getFallbackDefaultModelId } from '../../utils/runtime-model-discovery';
import { normalizeToClosestImageSize } from '../../services/media-api/utils';
import {
  getAdapterContextFromSettings,
  resolveAdapterForInvocation,
} from '../../services/model-adapters';
import {
  GPT_IMAGE_EDIT_REQUEST_SCHEMAS,
  isGPTImageEditRequestSchema,
} from '../../services/model-adapters';
import { resolveCreativeEmbeddedModelForGeneration } from '../../services/creative-embedded-model-guard';
import { isCreativeEmbeddedMode } from '../../services/creative-mode';
import {
  createQueueTask,
  validatePrompt,
  wrapApiError,
  toUploadedImages,
  type PromptLineageMeta,
} from './shared/queue-utils';

/**
 * 获取当前使用的图片模型名称
 * 优先级：设置中的模型 > 默认模型
 */
export function getCurrentImageModel(): string {
  if (isCreativeEmbeddedMode()) {
    return getFallbackDefaultModelId('image');
  }
  const settings = geminiSettings.get();
  return settings?.imageModelName || getDefaultImageModel();
}

function getImageModelSchemaDefault(): string | undefined {
  return getCurrentImageModel() || undefined;
}

function getImageModelSchemaDescription(): string {
  const defaultModel = getImageModelSchemaDefault();
  return defaultModel
    ? `图片生成模型，默认使用 ${defaultModel}`
    : '图片生成模型，默认使用 New API Creative 推荐图片模型';
}

/**
 * 获取图片尺寸选项
 */
function getImageSizeOptions(): string[] {
  const sizeParam = IMAGE_PARAMS.find((p) => p.id === 'size');
  return sizeParam?.options?.map((o) => o.value) || ['1x1', '16x9', '9x16'];
}

/**
 * 图片生成参数
 */
export interface ImageGenerationParams {
  /** 图片描述提示词 */
  prompt: string;
  /** 图片尺寸，格式如 '1x1', '16x9', '9x16' */
  size?: string;
  /** 分辨率档位（用于 GPT Image / Gemini 等模型） */
  resolution?: '1k' | '2k' | '4k';
  /** 参考图片 URL 列表 */
  referenceImages?: string[];
  /** 图片生成模式：文生图、图生图或编辑 */
  generationMode?: 'text_to_image' | 'image_to_image' | 'image_edit';
  /** 编辑蒙版图片 URL 或 data URL */
  maskImage?: string;
  /** GPT Image 输入保真度 */
  inputFidelity?: 'high' | 'low';
  /** GPT Image 背景模式 */
  background?: 'transparent' | 'opaque' | 'auto';
  /** GPT Image 输出格式 */
  outputFormat?: 'png' | 'jpeg' | 'webp';
  /** GPT Image 输出压缩率 */
  outputCompression?: number;
  /** 官方画质（GPT）或兼容旧值（1k/2k/4k） */
  quality?: 'auto' | 'low' | 'medium' | 'high' | '1k' | '2k' | '4k';
  /** AI 模型 */
  model?: string;
  /** 模型来源引用（用于多供应商路由） */
  modelRef?: ModelRef | null;
  /** 生成数量（仅 queue 模式支持） */
  count?: number;
  /** 批次 ID（批量生成时） */
  batchId?: string;
  /** 批次索引（1-based） */
  batchIndex?: number;
  /** 批次总数 */
  batchTotal?: number;
  /** 全局索引 */
  globalIndex?: number;
  /** 额外参数（如 seedream_quality） */
  params?: Record<string, unknown>;
  /** new-api runtime parameterSchema 对应的类型化用户参数 */
  userParams?: CreativeUserParams;
  /** Local-only marker preserving managed Creative image tasks with empty userParams across retry/resume. */
  creativeManaged?: boolean;
  /** 自动插入的目标 Frame */
  targetFrameId?: string;
  /** 自动插入的目标 Frame 尺寸 */
  targetFrameDimensions?: { width: number; height: number };
  /** 是否作为 PPT 页整图回填 */
  pptSlideImage?: boolean;
  /** PPT 大纲中的单页提示词，不含公共提示词 */
  pptSlidePrompt?: string;
  /** 重新生成时需要替换的旧整页图片元素 ID */
  pptReplaceElementId?: string;
  /** 是否自动插入画布 */
  autoInsertToCanvas?: boolean;
  /** 提示词历史轻量元数据 */
  promptMeta?: PromptLineageMeta;
  /** 素材库轻量元数据 */
  assetMetadata?: GenerationParams['assetMetadata'];
  /** 本次生成使用的知识库笔记轻量引用 */
  knowledgeContextRefs?: KnowledgeContextRef[];
  /** 连环画生成器动作元数据 */
  comicCreatorAction?: 'page-image';
  /** 连环画记录 ID */
  comicCreatorRecordId?: string;
  /** 连环画页面 ID */
  comicCreatorPageId?: string;
}

function shouldUseEditSchema(params: ImageGenerationParams): boolean {
  return (
    !!params.referenceImages?.length ||
    params.generationMode === 'image_edit' ||
    params.generationMode === 'image_to_image' ||
    !!params.maskImage
  );
}

function isSchemaBackedCreativeImageParams(
  params: ImageGenerationParams,
  effectiveModel?: string,
  effectiveModelRef?: ModelRef | null
): boolean {
  return (
    isCreativeManagedImageTask(params) ||
    isCreativeManagedModel(
      effectiveModel || params.model || null,
      effectiveModelRef || params.modelRef || null
    ) ||
    hasCreativeUserParams(params.userParams) ||
    (!!(effectiveModel || params.model) &&
      hasRuntimeParameterSchema(effectiveModel || params.model || ''))
  );
}

function pickManagedCreativeRawParams(
  params: ImageGenerationParams,
  effectiveModel: string
): Record<string, unknown> | undefined {
  const schemaParamIds = new Set(
    getCompatibleParams(effectiveModel)
      .filter((param) => param.runtimeSchema)
      .map((param) => param.id)
  );
  const rawParams =
    params.params && typeof params.params === 'object'
      ? params.params
      : undefined;
  if (!rawParams) {
    return undefined;
  }
  const picked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawParams)) {
    if (schemaParamIds.has(key)) {
      picked[key] = value;
    }
  }
  return picked;
}

function sanitizeManagedCreativeUserParams(
  params: ImageGenerationParams,
  effectiveModel: string
): CreativeUserParams {
  if (params.userParams) {
    return sanitizeCreativeUserParamsForModel(
      effectiveModel,
      params.userParams
    );
  }

  const pickedParams = pickManagedCreativeRawParams(params, effectiveModel);
  if (!pickedParams) {
    return {};
  }

  return sanitizeCreativeUserParamsForModel(effectiveModel, pickedParams);
}

function buildAdapterParams(
  params: ImageGenerationParams
): Record<string, unknown> | undefined {
  const adapterParams: Record<string, unknown> = {
    ...(params.params || {}),
  };

  if (params.resolution !== undefined) {
    adapterParams.resolution = params.resolution;
  }

  if (params.quality !== undefined) {
    adapterParams.quality = params.quality;
  }

  if (typeof params.count === 'number' && Number.isFinite(params.count)) {
    adapterParams.n = params.count;
  }

  return Object.keys(adapterParams).length > 0 ? adapterParams : undefined;
}

function buildQueueAdapterParams(
  params: ImageGenerationParams
): Record<string, unknown> | undefined {
  // Queue mode already expands top-level count into multiple tasks.
  // Do not also send it as adapter n/count, or count=2 becomes 2 tasks * 2 images.
  return buildAdapterParams({ ...params, count: undefined });
}

/**
 * 直接调用 API 生成图片（async 模式）
 */
async function executeAsync(params: ImageGenerationParams): Promise<MCPResult> {
  const { prompt, size, referenceImages, modelRef } = params;

  const promptError = validatePrompt(prompt);
  if (promptError) return promptError;

  try {
    const embeddedModel = resolveCreativeEmbeddedModelForGeneration(
      'image',
      params.model || null,
      modelRef || null
    );
    const requestedModel =
      embeddedModel?.modelId || params.model || getCurrentImageModel();
    const requestedModelRef = embeddedModel?.modelRef || modelRef || null;
    const preferredRequestSchema = shouldUseEditSchema(params)
      ? GPT_IMAGE_EDIT_REQUEST_SCHEMAS
      : undefined;
    const adapter = resolveAdapterForInvocation(
      'image',
      requestedModel,
      requestedModelRef,
      {
        preferredRequestSchema,
      }
    );

    if (!adapter || adapter.kind !== 'image') {
      return {
        success: false,
        error: `未找到可用的图片适配器: ${requestedModel}`,
        type: 'error',
      };
    }

    const schemaBacked = isSchemaBackedCreativeImageParams(
      params,
      requestedModel,
      requestedModelRef
    );
    const userParams = schemaBacked
      ? sanitizeManagedCreativeUserParams(params, requestedModel)
      : undefined;
    if (schemaBacked && !adapter.supportsCreativeUserParams) {
      return {
        success: false,
        error:
          'schema-backed Creative image requests require a managed userParams adapter',
        type: 'error',
      };
    }

    const result = await adapter.generateImage(
      getAdapterContextFromSettings(
        'image',
        requestedModelRef || requestedModel,
        {
          preferredRequestSchema,
        }
      ),
      {
        prompt,
        model: requestedModel,
        modelRef: requestedModelRef,
        size: schemaBacked ? undefined : size || '1x1',
        generationMode:
          params.generationMode ||
          (isGPTImageEditRequestSchema(preferredRequestSchema)
            ? 'image_to_image'
            : 'text_to_image'),
        referenceImages:
          referenceImages && referenceImages.length > 0
            ? referenceImages
            : undefined,
        maskImage: params.maskImage,
        inputFidelity: schemaBacked ? undefined : params.inputFidelity,
        background: schemaBacked ? undefined : params.background,
        outputFormat: schemaBacked ? undefined : params.outputFormat,
        outputCompression: schemaBacked ? undefined : params.outputCompression,
        params: schemaBacked ? undefined : buildAdapterParams(params),
        userParams,
      }
    );

    const { getFileExtension, normalizeImageDataUrl } = await import(
      '@aitu/utils'
    );
    const imageUrl = normalizeImageDataUrl(result.url);
    const format = getFileExtension(imageUrl) || result.format || 'png';

    return {
      success: true,
      data: {
        url: imageUrl,
        urls: result.urls?.map((url) => normalizeImageDataUrl(url)),
        format: format === 'bin' ? result.format || 'png' : format,
        prompt,
        size: size || '1x1',
      },
      type: 'image',
    };
  } catch (error: any) {
    console.error('[ImageGenerationTool] Generation failed:', error);
    return wrapApiError(error, '图片生成失败');
  }
}

/** 图片任务队列配置 */
function getImageQueueConfig(params: ImageGenerationParams) {
  const uploadedImages = toUploadedImages(params.referenceImages);

  return {
    taskType: TaskType.IMAGE,
    resultType: 'image' as const,
    getDefaultModel: getCurrentImageModel,
    logPrefix: 'ImageGenerationTool',
    buildTaskPayload: () => {
      const embeddedModel = resolveCreativeEmbeddedModelForGeneration(
        'image',
        params.model || null,
        params.modelRef || null
      );
      const model =
        embeddedModel?.modelId || params.model || getCurrentImageModel();
      const modelRef = embeddedModel?.modelRef || params.modelRef || null;
      const schemaBacked = isSchemaBackedCreativeImageParams(
        params,
        model,
        modelRef
      );
      const adapterParams = schemaBacked
        ? undefined
        : buildQueueAdapterParams(params);
      const userParams = schemaBacked
        ? sanitizeManagedCreativeUserParams(params, model)
        : undefined;
      return {
        prompt: params.prompt,
        size: schemaBacked ? undefined : params.size || '1x1',
        uploadedImages:
          uploadedImages && uploadedImages.length > 0
            ? uploadedImages
            : undefined,
        referenceImages:
          params.referenceImages && params.referenceImages.length > 0
            ? params.referenceImages
            : undefined,
        generationMode: params.generationMode,
        maskImage: params.maskImage,
        inputFidelity: schemaBacked ? undefined : params.inputFidelity,
        background: schemaBacked ? undefined : params.background,
        outputFormat: schemaBacked ? undefined : params.outputFormat,
        outputCompression: schemaBacked ? undefined : params.outputCompression,
        model,
        modelRef,
        targetFrameId: params.targetFrameId,
        targetFrameDimensions: params.targetFrameDimensions,
        pptSlideImage: params.pptSlideImage,
        pptSlidePrompt: params.pptSlidePrompt,
        pptReplaceElementId: params.pptReplaceElementId,
        promptMeta: params.promptMeta,
        assetMetadata: params.assetMetadata,
        knowledgeContextRefs: params.knowledgeContextRefs,
        comicCreatorAction: params.comicCreatorAction,
        comicCreatorRecordId: params.comicCreatorRecordId,
        comicCreatorPageId: params.comicCreatorPageId,
        ...(adapterParams ? { params: adapterParams } : {}),
        ...(schemaBacked ? { userParams, creativeManaged: true } : {}),
      };
    },
    buildResultData: () => ({
      size: params.size || '1x1',
    }),
  };
}

/**
 * 图片生成 MCP 工具定义
 */
export const imageGenerationTool: MCPTool = {
  name: 'generate_image',
  description: `生成图片工具。根据用户的文字描述生成图片。

使用场景：
- 用户想要创建、生成、绘制图片
- 用户描述了想要的图片内容
- 用户提供了参考图片并想要生成类似或修改后的图片

不适用场景：
- 用户想要生成视频（使用 generate_video 工具）
- 用户只是在聊天，没有生成图片的意图

当前使用模型：${getCurrentImageModel()}`,

  inputSchema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: '图片描述提示词，详细描述想要生成的图片内容、风格、构图等',
      },
      size: {
        type: 'string',
        description: '图片尺寸比例',
        enum: getImageSizeOptions(),
        default: '1x1',
      },
      referenceImages: {
        type: 'array',
        description: '参考图片 URL 列表，用于图生图或风格参考',
        items: {
          type: 'string',
        },
      },
      resolution: {
        type: 'string',
        description: '分辨率档位（1K/2K/4K）',
        enum: ['1k', '2k', '4k'],
        default: '1k',
      },
      quality: {
        type: 'string',
        description: 'GPT Image 官方画质；兼容旧调用时仍接受 1k/2k/4k',
        enum: ['auto', 'low', 'medium', 'high'],
        default: 'auto',
      },
      generationMode: {
        type: 'string',
        description: '生成模式',
        enum: ['text_to_image', 'image_to_image', 'image_edit'],
        default: 'text_to_image',
      },
      maskImage: {
        type: 'string',
        description: '编辑蒙版图片 URL 或 data URL',
      },
      inputFidelity: {
        type: 'string',
        description: 'GPT Image 输入保真度',
        enum: ['high', 'low'],
      },
      background: {
        type: 'string',
        description: 'GPT Image 背景模式',
        enum: ['transparent', 'opaque', 'auto'],
      },
      outputFormat: {
        type: 'string',
        description: 'GPT Image 输出格式',
        enum: ['png', 'jpeg', 'webp'],
      },
      outputCompression: {
        type: 'number',
        description: 'GPT Image 输出压缩率（0-100）',
      },
      model: {
        type: 'string',
        description: getImageModelSchemaDescription(),
        default: getImageModelSchemaDefault(),
      },
      count: {
        type: 'number',
        description: '生成数量，1-10 之间，默认为 1',
        default: 1,
      },
      assetMetadata: {
        type: 'object',
        description: '写入素材库的轻量业务元数据',
        properties: {
          category: {
            type: 'string',
            enum: ['GENERAL', 'CHARACTER'],
          },
          characterName: {
            type: 'string',
          },
          characterPrompt: {
            type: 'string',
          },
        },
      },
    },
    required: ['prompt'],
  },

  supportedModes: ['async', 'queue'],

  promptGuidance: {
    whenToUse:
      '当用户想要生成单张或多张图片时使用。适用于：创作插画、生成照片、艺术创作、图生图风格转换等。',

    parameterGuidance: {
      prompt:
        '将用户描述扩展为详细的英文提示词，包含：主体描述、风格（如 cinematic, watercolor, anime）、光线（如 soft lighting, golden hour）、构图（如 close-up, wide shot）、质量词（如 high quality, detailed）。',
      size: '根据内容选择：人像用 9x16，风景用 16x9，正方形内容用 1x1。默认 1x1。',
      referenceImages:
        '当用户提供参考图片时使用占位符如 ["[图片1]"]，系统会自动替换为真实 URL。',
      count: '用户明确要求批量生成时使用，如 "+3 画一只猫" 则 count=3。',
    },

    bestPractices: [
      'prompt 使用英文能获得更好的生成效果',
      '添加风格关键词如 "professional photography"、"digital art"、"oil painting"',
      '描述光线和氛围如 "warm lighting"、"dramatic shadows"、"soft bokeh"',
      '使用质量词如 "highly detailed"、"8k resolution"、"masterpiece"',
      '对于人物，描述表情、姿势、服装等细节',
    ],

    examples: [
      {
        input: '画一只猫',
        args: {
          prompt:
            'A cute orange kitten with fluffy fur and big eyes, sitting in warm sunlight, soft bokeh background, professional photography, highly detailed',
          size: '1x1',
        },
      },
      {
        input: '赛博朋克城市',
        args: {
          prompt:
            'Cyberpunk cityscape at night, neon lights reflecting on wet streets, towering skyscrapers with holographic advertisements, flying cars, rain, cinematic atmosphere, highly detailed, 8k',
          size: '16x9',
        },
      },
      {
        input: '[图片1] 把这张图变成水彩风格',
        args: {
          prompt:
            'Transform to watercolor painting style, soft brush strokes, artistic color palette, delicate watercolor texture, maintain original composition',
          referenceImages: ['[图片1]'],
        },
        explanation: '图生图使用 referenceImages 传递参考图片',
      },
    ],
  },

  execute: async (
    params: Record<string, unknown>,
    options?: MCPExecuteOptions
  ): Promise<MCPResult> => {
    const rawParams = params as unknown as ImageGenerationParams;
    const mode = options?.mode || 'async';

    // 规范化 size：将不在可用范围内的 size 自动转换为最接近的可用值
    const typedParams: ImageGenerationParams = {
      ...rawParams,
      size: rawParams.size
        ? normalizeToClosestImageSize(rawParams.size, '1x1')
        : rawParams.size,
    };

    if (mode === 'queue') {
      return createQueueTask(
        typedParams,
        options || {},
        getImageQueueConfig(typedParams)
      );
    }

    return executeAsync(typedParams);
  },
};

/**
 * 便捷方法：直接生成图片（async 模式）
 */
export async function generateImage(
  params: ImageGenerationParams
): Promise<MCPResult> {
  return imageGenerationTool.execute(
    params as unknown as Record<string, unknown>,
    { mode: 'async' }
  );
}

/**
 * 便捷方法：创建图片生成任务（queue 模式）
 */
export async function createImageTask(
  params: ImageGenerationParams,
  options?: Omit<MCPExecuteOptions, 'mode'>
): Promise<MCPTaskResult> {
  const result = await imageGenerationTool.execute(
    params as unknown as Record<string, unknown>,
    {
      ...options,
      mode: 'queue',
    }
  );
  return result as MCPTaskResult;
}
