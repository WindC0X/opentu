/**
 * 全局 React Error Boundary + 统一错误/崩溃恢复 UI
 * 合并原 CrashRecoveryDialog，一个组件覆盖所有场景：
 *   1. 崩溃恢复（连续崩溃检测）
 *   2. 初始化失败
 *   3. React 渲染错误
 *
 * 使用纯内联样式（CSS 可能加载失败时仍可正常显示）
 */

import React, { Component, ErrorInfo } from 'react';
import { collectAndDownloadErrorLog } from '../utils/error-log-exporter';

// ==================== Error Boundary ====================

const isCreativeEmbeddedBuild = import.meta.env.BASE_URL === '/creative/';
const LAZY_CHUNK_RETRY_KEY_PREFIX = 'aitu:lazy-chunk-retry';
const LAZY_CHUNK_RETRY_PARAM = '_lazy_chunk_retry';
const LAZY_CHUNK_RETRY_TS_PARAM = '_t';
const STATIC_CACHE_NAME_PREFIX = 'drawnix-static-v';
const DYNAMIC_IMPORT_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /Unable to preload CSS/i,
  /Loading chunk [\w-]+ failed/i,
  /ChunkLoadError/i,
];
let lazyAssetRecoveryScheduled = false;

function isCreativeEmbeddedPath(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return (
    window.location.pathname === '/creative' ||
    window.location.pathname.startsWith('/creative/')
  );
}

type ErrorLikeEvent = Event & {
  error?: unknown;
  reason?: unknown;
  payload?: unknown;
  message?: string;
};

function getAppVersion(): string {
  if (typeof document === 'undefined') {
    return 'unknown';
  }

  return (
    document
      .querySelector('meta[name="app-version"]')
      ?.getAttribute('content') || 'unknown'
  );
}

function getEventTargetAssetUrl(target: EventTarget | null): string | null {
  if (!(target instanceof HTMLElement)) {
    return null;
  }

  const assetTarget = target as HTMLElement & {
    src?: string;
    currentSrc?: string;
    href?: string;
  };

  return assetTarget.currentSrc || assetTarget.src || assetTarget.href || null;
}

function serializeError(error: unknown, depth = 0): string {
  if (error instanceof Error) {
    const parts = [error.name, error.message, error.stack];
    const errorWithCause = error as Error & { cause?: unknown };
    if (errorWithCause.cause && depth < 2) {
      parts.push(serializeError(errorWithCause.cause, depth + 1));
    }
    return parts.filter(Boolean).join('\n');
  }

  if (typeof Event !== 'undefined' && error instanceof Event) {
    const event = error as ErrorLikeEvent;
    const parts = [`event:${event.type}`];
    const targetAssetUrl = getEventTargetAssetUrl(event.target);

    if (event.message) {
      parts.push(event.message);
    }
    if (targetAssetUrl) {
      parts.push(targetAssetUrl);
    }

    if (depth < 2) {
      [event.error, event.reason, event.payload].forEach((value) => {
        if (value && value !== error) {
          parts.push(serializeError(value, depth + 1));
        }
      });
    }

    return parts.filter(Boolean).join('\n');
  }

  return String(error ?? '');
}

function extractModuleKey(errorText: string): string {
  const matchedUrl = errorText.match(
    /https?:\/\/[^\s)'"]+\.(?:js|css)(?:\?[^\s)'"]*)?/i
  );
  if (!matchedUrl) {
    return 'unknown-module';
  }

  try {
    return new URL(matchedUrl[0]).pathname;
  } catch {
    return matchedUrl[0];
  }
}

function isRecoverableDynamicImportError(error: unknown): boolean {
  const errorText = serializeError(error);
  return DYNAMIC_IMPORT_ERROR_PATTERNS.some((pattern) =>
    pattern.test(errorText)
  );
}

async function prepareDynamicImportRecoveryReload(
  moduleKey: string,
  errorText: string
): Promise<void> {
  const cleanupTasks: Promise<unknown>[] = [];

  try {
    navigator.serviceWorker?.controller?.postMessage({
      type: 'RECOVER_DYNAMIC_IMPORT_FAILURE',
      appVersion: getAppVersion(),
      moduleKey,
      error: errorText.slice(0, 500),
    });
  } catch {
    // Best-effort only. The reload path below still works without SW support.
  }

  if (typeof caches !== 'undefined') {
    cleanupTasks.push(
      caches
        .keys()
        .then((cacheNames) =>
          Promise.all(
            cacheNames
              .filter((name) => name.startsWith(STATIC_CACHE_NAME_PREFIX))
              .map((name) => caches.delete(name))
          )
        )
    );
  }

  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    cleanupTasks.push(
      navigator.serviceWorker
        .getRegistration()
        .then((registration) => registration?.update())
    );
  }

  await Promise.allSettled(cleanupTasks);
}

export function tryRecoverDynamicImportError(error: unknown): boolean {
  if (!isRecoverableDynamicImportError(error)) {
    return false;
  }

  if (lazyAssetRecoveryScheduled) {
    return true;
  }

  if (typeof window === 'undefined') {
    return false;
  }

  const errorText = serializeError(error);
  const moduleKey = extractModuleKey(errorText);
  const retryKey = `${LAZY_CHUNK_RETRY_KEY_PREFIX}:${getAppVersion()}:${moduleKey}`;

  try {
    if (sessionStorage.getItem(retryKey) === '1') {
      return false;
    }

    sessionStorage.setItem(retryKey, '1');
  } catch {
    const currentUrl = new URL(window.location.href);
    if (currentUrl.searchParams.has(LAZY_CHUNK_RETRY_PARAM)) {
      return false;
    }
  }

  lazyAssetRecoveryScheduled = true;

  const reloadUrl = new URL(window.location.href);
  reloadUrl.searchParams.set(LAZY_CHUNK_RETRY_PARAM, '1');
  reloadUrl.searchParams.set(LAZY_CHUNK_RETRY_TS_PARAM, String(Date.now()));

  console.warn(
    '[ErrorBoundary] Detected stale lazy asset. Reloading once to recover.',
    error
  );

  let didReload = false;
  const reload = () => {
    if (didReload) {
      return;
    }
    didReload = true;
    window.location.replace(reloadUrl.toString());
  };

  window.setTimeout(reload, 700);
  void prepareDynamicImportRecoveryReload(moduleKey, errorText).finally(reload);

  return true;
}

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  recoveringFromChunkError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    recoveringFromChunkError: false,
  };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const recoveringFromChunkError = tryRecoverDynamicImportError(error);
    this.setState({ errorInfo, recoveringFromChunkError });

    if (recoveringFromChunkError) {
      return;
    }

    console.error('[ErrorBoundary] React render error:', error, errorInfo);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    if (this.state.recoveringFromChunkError) {
      return (
        <ErrorFallbackUI
          variant="error"
          title="检测到静态资源已更新"
          description="当前页面引用的懒加载资源已失效，正在自动刷新一次以恢复工作台。若长时间未恢复，可手动点击安全模式。"
          errorMessage={this.state.error?.message || '动态资源加载失败'}
          errorStack={this.state.error?.stack}
          componentStack={this.state.errorInfo?.componentStack ?? undefined}
          onExportLog={() =>
            collectAndDownloadErrorLog(this.state.error, this.state.errorInfo)
          }
          onSafeModeReload={safeModeReload}
          onGoToDebug={goToDebug}
        />
      );
    }

    return (
      <ErrorFallbackUI
        variant="error"
        errorMessage={this.state.error?.message || '未知错误'}
        errorStack={this.state.error?.stack}
        componentStack={this.state.errorInfo?.componentStack ?? undefined}
        onExportLog={() =>
          collectAndDownloadErrorLog(this.state.error, this.state.errorInfo)
        }
        onSafeModeReload={safeModeReload}
        onGoToDebug={goToDebug}
      />
    );
  }
}

// ==================== Shared Helpers ====================

export function safeModeReload(): void {
  try {
    localStorage.setItem('aitu_safe_mode', 'true');
  } catch {
    /* ignore */
  }
  window.location.reload();
}

export function goToDebug(): void {
  const debugUrl = `/${['sw', 'debug.html'].join('-')}`;
  // iframe 内直接跳转，保持同一浏览上下文以访问 SW/IndexedDB 数据
  window.location.href = debugUrl;
}

// ==================== Unified Fallback UI ====================

type Variant = 'crash' | 'error';

export interface ErrorFallbackProps {
  /** 'crash' = 崩溃恢复（橙色），'error' = 初始化/渲染错误（红色） */
  variant: Variant;
  /** 仅 crash 模式 */
  crashCount?: number;
  memoryInfo?: { used: string; limit: string; percent: number } | null;
  onIgnore?: () => void;
  /** 仅 error 模式 */
  title?: string;
  description?: string;
  errorMessage?: string;
  errorStack?: string;
  componentStack?: string;
  /** 通用 */
  onExportLog?: () => void;
  onSafeModeReload: () => void;
  onGoToDebug: () => void;
}

const VARIANT_CONFIG: Record<
  Variant,
  {
    iconBg: string;
    iconStroke: string;
    iconPath: React.ReactNode;
    defaultTitle: string;
    defaultDesc: string;
  }
> = {
  crash: {
    iconBg: '#FFF3E0',
    iconStroke: '#F57C00',
    iconPath: (
      <>
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </>
    ),
    defaultTitle: '检测到页面异常退出',
    defaultDesc: '',
  },
  error: {
    iconBg: '#FFEBEE',
    iconStroke: '#E53935',
    iconPath: (
      <>
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </>
    ),
    defaultTitle: '应用渲染出错',
    defaultDesc: '页面遇到了意外错误，可能是画布数据异常或浏览器内存不足。',
  },
};

// PLACEHOLDER_COMPONENT_BODY

export const ErrorFallbackUI: React.FC<ErrorFallbackProps> = (props) => {
  const {
    variant,
    crashCount,
    memoryInfo,
    onIgnore,
    title,
    description,
    errorMessage,
    errorStack,
    componentStack,
    onExportLog,
    onSafeModeReload,
    onGoToDebug,
  } = props;
  const [showDetail, setShowDetail] = React.useState(false);
  const cfg = VARIANT_CONFIG[variant];
  const showStandaloneHelp =
    !isCreativeEmbeddedBuild && !isCreativeEmbeddedPath();

  const displayTitle = title || cfg.defaultTitle;
  const displayDesc = description || cfg.defaultDesc;

  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        {/* 图标 */}
        <div style={{ ...styles.iconWrap, backgroundColor: cfg.iconBg }}>
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke={cfg.iconStroke}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {cfg.iconPath}
          </svg>
        </div>

        <h2 style={styles.title}>{displayTitle}</h2>

        {/* crash 模式：原因说明 */}
        {variant === 'crash' && crashCount != null && (
          <p style={styles.desc}>
            页面已连续 {crashCount} 次未能正常加载，可能是因为：
            <br />• 画布元素过多导致内存不足
            <br />• 浏览器内存限制
            <br />
            <br />
            建议使用「安全模式」创建空白画布，稍后可从侧边栏切换到其他画布。
          </p>
        )}

        {/* error 模式：描述 */}
        {variant === 'error' && displayDesc && (
          <p style={styles.desc}>{displayDesc}</p>
        )}

        {/* 内存信息（crash 模式） */}
        {memoryInfo && <MemoryBar info={memoryInfo} />}

        {/* 错误详情（error 模式） */}
        {variant === 'error' && errorMessage && (
          <div style={styles.errorBox}>
            <div style={styles.errorMsg}>{errorMessage}</div>
            {(errorStack || componentStack) && (
              <button
                onClick={() => setShowDetail((v) => !v)}
                style={styles.detailToggle}
              >
                {showDetail ? '收起详情' : '展开详情'}
              </button>
            )}
            {showDetail && (
              <pre style={styles.errorDetail}>
                {errorStack}
                {componentStack && `\n\nComponent Stack:${componentStack}`}
              </pre>
            )}
          </div>
        )}

        {/* 操作按钮 */}
        <div style={styles.btnRow}>
          {variant === 'crash' && onIgnore && (
            <HoverButton
              label="继续加载"
              onClick={onIgnore}
              bg="#f5f5f5"
              bgHover="#e8e8e8"
              color="#666"
            />
          )}
          {variant === 'error' && onExportLog && (
            <HoverButton
              label="导出错误日志"
              onClick={onExportLog}
              bg="#f5f5f5"
              bgHover="#e8e8e8"
              color="#333"
            />
          )}
          <HoverButton
            label="安全模式"
            onClick={onSafeModeReload}
            bg="#F39C12"
            bgHover="#E67E22"
            color="#fff"
          />
        </div>

        {/* 分隔线 */}
        <div style={styles.divider} />

        {showStandaloneHelp && (
          <>
            {/* 底部帮助区域 */}
            <div style={styles.helpSection}>
              <div style={styles.helpRow}>
                {/* 二维码 */}
                <img
                  src="https://nav.ourzhishi.top/api/dynamic-image/qr-code"
                  alt="企业微信二维码"
                  style={styles.qrcode}
                  referrerPolicy="no-referrer"
                />
                {/* 右侧文字 + 按钮 */}
                <div style={styles.helpText}>
                  <p style={styles.helpTitle}>需要帮助？</p>
                  <p style={styles.helpDesc}>
                    扫码联系客服，或前往调试页面导出完整日志与备份数据
                  </p>
                  <HoverButton
                    label="打开调试页面"
                    onClick={onGoToDebug}
                    bg="#f0eefa"
                    bgHover="#e2ddf7"
                    color="#5A4FCF"
                    small
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// PLACEHOLDER_SUBCOMPONENTS

// ==================== Sub-components ====================

const MemoryBar: React.FC<{
  info: { used: string; limit: string; percent: number };
}> = ({ info }) => {
  const barColor =
    info.percent > 75 ? '#E53935' : info.percent > 50 ? '#FB8C00' : '#43A047';
  return (
    <div style={styles.memoryBox}>
      <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
        当前内存使用情况
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span style={{ fontSize: 14, color: '#333' }}>
          {info.used} / {info.limit}
        </span>
        <span style={{ fontSize: 14, fontWeight: 500, color: barColor }}>
          {info.percent.toFixed(0)}%
        </span>
      </div>
      <div
        style={{
          height: 4,
          backgroundColor: '#e0e0e0',
          borderRadius: 2,
          marginTop: 8,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${Math.min(info.percent, 100)}%`,
            backgroundColor: barColor,
            transition: 'width 0.3s ease',
          }}
        />
      </div>
    </div>
  );
};

const HoverButton: React.FC<{
  label: string;
  onClick: () => void;
  bg: string;
  bgHover: string;
  color: string;
  small?: boolean;
}> = ({ label, onClick, bg, bgHover, color, small }) => {
  const [hovered, setHovered] = React.useState(false);
  const btnStyle: React.CSSProperties = small
    ? { ...styles.btnSmall, backgroundColor: hovered ? bgHover : bg, color }
    : { ...styles.btn, backgroundColor: hovered ? bgHover : bg, color };
  return (
    <button
      onClick={onClick}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      style={btnStyle}
    >
      {label}
    </button>
  );
};

// ==================== Styles ====================

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 99999,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 32,
    maxWidth: 520,
    width: '90%',
    maxHeight: '90vh',
    overflowY: 'auto',
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 24px',
  },
  title: {
    margin: '0 0 12px',
    fontSize: 20,
    fontWeight: 600,
    textAlign: 'center',
    color: '#1a1a1a',
  },
  desc: {
    margin: '0 0 20px',
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    lineHeight: 1.6,
  },
  memoryBox: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: '12px 16px',
    marginBottom: 24,
  },
  errorBox: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: '12px 16px',
    marginBottom: 24,
  },
  errorMsg: { fontSize: 13, color: '#E53935', wordBreak: 'break-word' },
  detailToggle: {
    marginTop: 8,
    padding: 0,
    border: 'none',
    background: 'none',
    color: '#888',
    fontSize: 12,
    cursor: 'pointer',
    textDecoration: 'underline',
  },
  errorDetail: {
    marginTop: 8,
    padding: 8,
    backgroundColor: '#eee',
    borderRadius: 4,
    fontSize: 11,
    color: '#555',
    maxHeight: 150,
    overflow: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
  },
  btnRow: { display: 'flex', gap: 12 },
  btn: {
    flex: 1,
    padding: '12px 24px',
    fontSize: 14,
    fontWeight: 500,
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    transition: 'background-color 0.2s ease',
  },
  btnSmall: {
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 500,
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    transition: 'background-color 0.2s ease',
  },
  divider: {
    height: 1,
    backgroundColor: '#eee',
    margin: '24px 0',
  },
  helpSection: {
    padding: 0,
  },
  helpRow: {
    display: 'flex',
    gap: 16,
    alignItems: 'center',
  },
  qrcode: {
    width: 96,
    height: 96,
    borderRadius: 8,
    flexShrink: 0,
  },
  helpText: {
    flex: 1,
    minWidth: 0,
  },
  helpTitle: {
    margin: '0 0 4px',
    fontSize: 14,
    fontWeight: 500,
    color: '#333',
  },
  helpDesc: {
    margin: '0 0 12px',
    fontSize: 12,
    color: '#999',
    lineHeight: 1.5,
  },
};
