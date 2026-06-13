import { type CSSProperties, useState } from 'react';
import { isEmbeddedInNewApi } from '../utils/embed-detection';

const RETURN_TO_CONSOLE_URL = '/dashboard';
export const RETURN_BUTTON_LEFT =
  'calc(var(--aitu-toolbar-right-edge, 58px) + 16px)';
export const RETURN_BUTTON_Z_INDEX = 4100;

export function getReturnButtonStyle(): CSSProperties {
  return {
    position: 'fixed',
    top: 16,
    left: RETURN_BUTTON_LEFT,
    zIndex: RETURN_BUTTON_Z_INDEX,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 12px',
    border: '1px solid rgba(255, 255, 255, 0.18)',
    borderRadius: 999,
    background: 'rgba(17, 24, 39, 0.78)',
    color: '#fff',
    boxShadow: '0 8px 24px rgba(15, 23, 42, 0.18)',
    backdropFilter: 'blur(8px)',
    cursor: 'pointer',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: 13,
    fontWeight: 600,
    lineHeight: '18px',
  };
}

export function ReturnButton() {
  const [isEmbedded] = useState(() => isEmbeddedInNewApi());

  if (!isEmbedded) {
    return null;
  }

  const handleReturnToConsole = () => {
    window.location.href = RETURN_TO_CONSOLE_URL;
  };

  return (
    <button
      type="button"
      aria-label="返回控制台"
      title="返回控制台"
      onClick={handleReturnToConsole}
      style={getReturnButtonStyle()}
    >
      <span aria-hidden="true">←</span>
      <span>返回控制台</span>
    </button>
  );
}
