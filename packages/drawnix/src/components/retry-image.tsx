/**
 * RetryImage Component
 *
 * An image component that automatically retries loading on failure.
 * Features:
 * - Retries up to 5 times with exponential backoff
 * - Automatically bypasses Service Worker on timeout or repeated failures
 * - Shows skeleton loading state during download
 * - Smooth fade-in animation when loaded
 * - Lazy loading and async decoding for performance
 * - Graceful degradation for virtual paths when SW is unavailable
 */

import React, {
  forwardRef,
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import { unifiedCacheService } from '../services/unified-cache-service';
import { normalizeImageDataUrl } from '@aitu/utils';
import {
  isGeneratedImageCacheUrl,
  rehydrateGeneratedImageCacheUrl,
  resolveGeneratedImageContentUrl,
} from '../utils/generated-media-cache';

export interface RetryImageProps
  extends React.ImgHTMLAttributes<HTMLImageElement> {
  /** Image source URL */
  src: string;
  /** Alt text for accessibility */
  alt: string;
  /** Maximum number of retry attempts (default: 5) */
  maxRetries?: number;
  /** Initial retry delay in ms (default: 1000) */
  initialRetryDelay?: number;
  /** Callback when image loads successfully */
  onLoadSuccess?: () => void;
  /** Callback for every native image load error before RetryImage applies its retry policy */
  onAttemptError?: (event: React.SyntheticEvent<HTMLImageElement, Event>) => void;
  /** Callback when all retries fail */
  onLoadFailure?: (error: Error) => void;
  /** Optional fallback element to display on failure */
  fallback?: React.ReactNode;
  /** Show skeleton loading state (default: true) */
  showSkeleton?: boolean;
  /** Number of retries before bypassing SW (default: 2) */
  bypassSWAfterRetries?: number;
  /** Use eager loading for cached images (default: auto-detect from URL) */
  eager?: boolean;
  /** Optional wrapper class name */
  wrapperClassName?: string;
  /** Optional wrapper style */
  wrapperStyle?: React.CSSProperties;
  /** Stable local cache URL to repair when src is a generated thumbnail URL */
  rehydrateCacheUrl?: string;
  /** Same-origin broker content URL for generated-media cache rehydration */
  rehydrateSourceUrl?: string;
  /** Metadata to preserve when re-caching generated media */
  rehydrateMetadata?: Record<string, unknown>;
}

/**
 * Skeleton loading component
 */
const ImageSkeleton: React.FC<{
  className?: string;
  style?: React.CSSProperties;
}> = ({ className, style }) => (
  <div
    className={className}
    style={{
      ...style,
      background:
        'linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)',
      backgroundSize: '200% 100%',
      animation: 'shimmer 1.5s infinite',
      borderRadius: '8px',
      minHeight: '100px',
      width: '100%',
    }}
  >
    <style>
      {`
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}
    </style>
  </div>
);

/**
 * Add bypass_sw parameter to URL to skip Service Worker interception
 */
function addBypassSWParam(url: string): string {
  if (url.startsWith('data:') || url.startsWith('blob:')) {
    return url;
  }

  try {
    const urlObj = new URL(url, window.location.origin);
    // 避免重复添加
    if (!urlObj.searchParams.has('bypass_sw')) {
      urlObj.searchParams.set('bypass_sw', '1');
    }
    return urlObj.toString();
  } catch {
    // 如果 URL 解析失败，直接拼接
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}bypass_sw=1`;
  }
}

/**
 * RetryImage component - displays an image with automatic retry on load failure
 */
/**
 * 检测 URL 是否来自缓存（应该立即加载）
 */
function isCachedUrl(url: string): boolean {
  return (
    url.startsWith('data:') ||
    url.startsWith('blob:') ||
    url.includes('/__aitu_cache__/') ||
    url.includes('/asset-library/') ||
    url.includes('thumbnail=')
  );
}

/**
 * 检测 URL 是否是虚拟路径（需要 SW 拦截）
 */
function isVirtualUrl(url: string): boolean {
  if (url.startsWith('/__aitu_cache__/') || url.startsWith('/asset-library/')) {
    return true;
  }
  try {
    const parsed = new URL(url, window.location.origin);
    return (
      parsed.origin === window.location.origin &&
      (parsed.pathname.startsWith('/__aitu_cache__/') ||
        parsed.pathname.startsWith('/asset-library/'))
    );
  } catch {
    return false;
  }
}

/**
 * 检测 Service Worker 是否可用
 */
function isSWAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    !!navigator.serviceWorker.controller
  );
}

export const RetryImage = forwardRef<HTMLImageElement, RetryImageProps>(
  (
    {
      src,
      alt,
      maxRetries = 5,
      initialRetryDelay = 1000,
      onLoadSuccess,
      onAttemptError,
      onLoadFailure,
      fallback,
      showSkeleton = true,
      bypassSWAfterRetries = 2,
      eager,
      wrapperClassName,
      wrapperStyle,
      rehydrateCacheUrl,
      rehydrateSourceUrl,
      rehydrateMetadata,
      onLoad,
      onError,
      ...imgProps
    },
    ref
  ) => {
    // 存量数据可能存有原始 base64，先统一转为 data URL
    const normalizedSrc = useMemo(() => normalizeImageDataUrl(src), [src]);
    const effectiveRehydrateSourceUrl = useMemo(
      () =>
        resolveGeneratedImageContentUrl({
          contentUrl: rehydrateSourceUrl,
          metadata: rehydrateMetadata,
        }),
      [rehydrateMetadata, rehydrateSourceUrl]
    );
    // 自动检测是否应该 eager 加载
    const shouldEagerLoad = eager ?? isCachedUrl(normalizedSrc);

    const [imageSrc, setImageSrc] = useState<string>(normalizedSrc);
    const [retryCount, setRetryCount] = useState<number>(0);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [hasError, setHasError] = useState<boolean>(false);
    const [bypassSW, setBypassSW] = useState<boolean>(false);
    const shouldHideWhileLoading = showSkeleton && isLoading;
    // 存储降级创建的 blob URL，用于清理
    const blobUrlRef = useRef<string | null>(null);
    const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    /**
     * 尝试将虚拟路径降级为 blob URL
     * 当 SW 不可用时，直接从 Cache Storage 读取并创建 blob URL
     */
    const tryFallbackToBlobUrl = useCallback(
      async (url: string): Promise<string | null> => {
        if (!isVirtualUrl(url)) {
          return null;
        }

        try {
          const cacheUrl = rehydrateCacheUrl || url;
          let blob = await unifiedCacheService.getCachedBlob(cacheUrl);
          if (
            !blob &&
            effectiveRehydrateSourceUrl &&
            isGeneratedImageCacheUrl(cacheUrl)
          ) {
            blob = await rehydrateGeneratedImageCacheUrl(
              cacheUrl,
              effectiveRehydrateSourceUrl,
              rehydrateMetadata
            );
          }
          if (blob && blob.size > 0) {
            const blobUrl = URL.createObjectURL(blob);
            return blobUrl;
          }
        } catch (error) {
          console.warn(
            '[RetryImage] Failed to get blob for virtual URL:',
            url,
            error
          );
        }
        return null;
      },
      [effectiveRehydrateSourceUrl, rehydrateCacheUrl, rehydrateMetadata]
    );

    // Calculate exponential backoff delay
    const getRetryDelay = useCallback(
      (attemptNumber: number): number => {
        return initialRetryDelay * Math.pow(2, attemptNumber);
      },
      [initialRetryDelay]
    );

    // Handle image load success
    const handleLoad = useCallback(
      (event: React.SyntheticEvent<HTMLImageElement, Event>) => {
        setIsLoading(false);
        setHasError(false);
        onLoad?.(event);
        onLoadSuccess?.();
      },
      [onLoad, onLoadSuccess]
    );

    // Handle image load error with retry logic
    const handleError = useCallback(
      async (event: React.SyntheticEvent<HTMLImageElement, Event>) => {
        onAttemptError?.(event);

        if (normalizedSrc.startsWith('data:')) {
          setIsLoading(false);
          setHasError(true);
          onError?.(event);
          onLoadFailure?.(new Error('Failed to load inline data image'));
          return;
        }

        if (retryCount < maxRetries) {
          const delay = getRetryDelay(retryCount);
          const nextRetryCount = retryCount + 1;

          // 检查是否应该绕过 SW
          const shouldBypassSW =
            nextRetryCount >= bypassSWAfterRetries && !bypassSW;

          if (shouldBypassSW) {
            setBypassSW(true);
          }

          const canRehydrateGeneratedContent =
            !!effectiveRehydrateSourceUrl &&
            isGeneratedImageCacheUrl(rehydrateCacheUrl || normalizedSrc);

          // 对于虚拟路径，在绕过 SW 后尝试降级到 blob URL。
          // 生成图的本地 Cache Storage miss 可能只是后端 content 仍在写入/预热中；
          // 后续图片加载重试必须继续尝试 rehydrate，而不是只在首次 bypass SW 时尝试一次。
          if (
            (shouldBypassSW || canRehydrateGeneratedContent) &&
            isVirtualUrl(normalizedSrc) &&
            !blobUrlRef.current
          ) {
            const blobUrl = await tryFallbackToBlobUrl(normalizedSrc);
            if (blobUrl) {
              blobUrlRef.current = blobUrl;
              setRetryCount(nextRetryCount);
              setImageSrc(blobUrl);
              return;
            }
          }

          // Schedule retry
          retryTimeoutRef.current = setTimeout(() => {
            setRetryCount(nextRetryCount);

            // 如果已经有 blob URL，继续使用它
            if (blobUrlRef.current) {
              // 添加时间戳强制重新加载 blob URL
              setImageSrc(`${blobUrlRef.current}#retry=${Date.now()}`);
              return;
            }

            // 构建重试 URL
            let retryUrl = normalizedSrc;

            // 如果需要绕过 SW，添加 bypass_sw 参数
            if (shouldBypassSW || bypassSW) {
              retryUrl = addBypassSWParam(retryUrl);
            }

            // 添加时间戳强制刷新
            const separator = retryUrl.includes('?') ? '&' : '?';
            retryUrl = `${retryUrl}${separator}_retry=${Date.now()}`;

            setImageSrc(retryUrl);
          }, delay);
        } else {
          // All retries exhausted
          setIsLoading(false);
          setHasError(true);
          onError?.(event);
          const error = new Error(
            `Failed to load image after ${maxRetries} retries`
          );
          onLoadFailure?.(error);
        }
      },
      [
        retryCount,
        maxRetries,
        normalizedSrc,
        getRetryDelay,
        onAttemptError,
        onError,
        onLoadFailure,
        bypassSW,
        bypassSWAfterRetries,
        rehydrateCacheUrl,
        effectiveRehydrateSourceUrl,
        tryFallbackToBlobUrl,
      ]
    );

    // Reset state when src changes and handle virtual path fallback
    useEffect(() => {
      // 清理之前的 blob URL
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }

      setRetryCount(0);
      setIsLoading(true);
      setHasError(false);
      setBypassSW(false);

      // 检查是否需要虚拟路径降级
      // 条件：是虚拟路径 && SW 不可用
      if (isVirtualUrl(normalizedSrc) && !isSWAvailable()) {
        // 异步尝试降级
        tryFallbackToBlobUrl(normalizedSrc).then((blobUrl) => {
          if (blobUrl) {
            blobUrlRef.current = blobUrl;
            setImageSrc(blobUrl);
          } else {
            // 降级失败，仍然使用原始 URL（可能会失败，但有重试机制）
            setImageSrc(normalizedSrc);
          }
        });
      } else {
        setImageSrc(normalizedSrc);
      }

      // Clear any pending retry timeouts
      return () => {
        if (retryTimeoutRef.current) {
          clearTimeout(retryTimeoutRef.current);
        }
      };
    }, [normalizedSrc, tryFallbackToBlobUrl]);

    // Cleanup on unmount
    useEffect(() => {
      return () => {
        if (retryTimeoutRef.current) {
          clearTimeout(retryTimeoutRef.current);
        }
        // 清理 blob URL
        if (blobUrlRef.current) {
          URL.revokeObjectURL(blobUrlRef.current);
          blobUrlRef.current = null;
        }
      };
    }, []);

    // Render fallback if all retries failed
    if (hasError && fallback) {
      return <>{fallback}</>;
    }

    const needsWrapper =
      showSkeleton || Boolean(wrapperClassName) || Boolean(wrapperStyle);
    const imageElement = (
      <img
        {...imgProps}
        ref={ref}
        src={imageSrc}
        alt={alt}
        loading={shouldEagerLoad ? 'eager' : 'lazy'}
        decoding={shouldEagerLoad ? 'sync' : 'async'}
        referrerPolicy="no-referrer"
        onLoad={handleLoad}
        onError={handleError}
        style={{
          ...imgProps.style,
          opacity: shouldHideWhileLoading ? 0 : 1,
          transition: 'opacity 0.3s ease-out',
          ...(needsWrapper ? { width: '100%', height: '100%' } : null),
        }}
      />
    );

    if (!needsWrapper) {
      return imageElement;
    }

    // Render image with skeleton loading state
    return (
      <div
        className={wrapperClassName}
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          ...wrapperStyle,
        }}
      >
        {/* Skeleton shown while loading */}
        {isLoading && showSkeleton && (
          <ImageSkeleton
            className={imgProps.className}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              ...imgProps.style,
            }}
          />
        )}
        {/* Actual image with fade-in effect */}
        {imageElement}
      </div>
    );
  }
);

RetryImage.displayName = 'RetryImage';
