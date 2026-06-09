import React, { type CSSProperties } from 'react';
import { isCreativeEmbeddedMode } from '../../services/creative-mode';
import {
  type CreativeDocumentCloudSyncService,
  type CreativeDocumentCloudSyncStatus,
} from '../../services/creative-document-sync';
import { useCreativeDocumentCloudSyncStatus } from '../../hooks/use-creative-document-sync-status';

interface BadgeTone {
  background: string;
  border: string;
  color: string;
}

const BADGE_TONES: Record<string, BadgeTone> = {
  idle: {
    background: 'rgba(248, 250, 252, 0.94)',
    border: 'rgba(148, 163, 184, 0.55)',
    color: '#475569',
  },
  local: {
    background: 'rgba(255, 251, 235, 0.95)',
    border: 'rgba(245, 158, 11, 0.45)',
    color: '#92400e',
  },
  syncing: {
    background: 'rgba(239, 246, 255, 0.95)',
    border: 'rgba(59, 130, 246, 0.45)',
    color: '#1d4ed8',
  },
  cloud: {
    background: 'rgba(240, 253, 244, 0.95)',
    border: 'rgba(34, 197, 94, 0.45)',
    color: '#166534',
  },
  conflict: {
    background: 'rgba(254, 242, 242, 0.96)',
    border: 'rgba(239, 68, 68, 0.5)',
    color: '#991b1b',
  },
};

export interface CreativeDocumentCloudSyncBadgeProps {
  service?: CreativeDocumentCloudSyncService | null;
  locationLike?: Pick<Location, 'pathname'> | null;
}

export function getCreativeDocumentCloudSyncStatusLabel(
  status: CreativeDocumentCloudSyncStatus
): string {
  if (status.syncState === 'conflict' || status.saveState === 'conflict') {
    return status.frozenBoardCount > 0
      ? `同步冲突 · 已冻结 ${status.frozenBoardCount}`
      : '同步冲突';
  }
  if (status.syncing || status.syncState === 'syncing') {
    return '正在同步';
  }
  if (status.saveState === 'cloud-saved') {
    return '云端已保存';
  }
  if (status.saveState === 'local-saved') {
    return status.pendingMutationCount > 0
      ? `本地已保存 · 待同步 ${status.pendingMutationCount}`
      : '本地已保存';
  }
  return '云同步就绪';
}

function getToneKey(status: CreativeDocumentCloudSyncStatus): keyof typeof BADGE_TONES {
  if (status.syncState === 'conflict' || status.saveState === 'conflict') {
    return 'conflict';
  }
  if (status.syncing || status.syncState === 'syncing') {
    return 'syncing';
  }
  if (status.saveState === 'cloud-saved') {
    return 'cloud';
  }
  if (status.saveState === 'local-saved') {
    return 'local';
  }
  return 'idle';
}

export const CreativeDocumentCloudSyncBadge: React.FC<
  CreativeDocumentCloudSyncBadgeProps
> = ({ service, locationLike }) => {
  const embedded = isCreativeEmbeddedMode(locationLike);
  const status = useCreativeDocumentCloudSyncStatus({
    service,
    locationLike,
    enabled: embedded,
  });

  if (!embedded) {
    return null;
  }

  const label = getCreativeDocumentCloudSyncStatusLabel(status);
  const tone = BADGE_TONES[getToneKey(status)];
  const style: CSSProperties = {
    position: 'fixed',
    right: 16,
    bottom: 16,
    zIndex: 1000,
    display: 'inline-flex',
    alignItems: 'center',
    maxWidth: 240,
    padding: '6px 10px',
    borderRadius: 999,
    border: `1px solid ${tone.border}`,
    background: tone.background,
    color: tone.color,
    boxShadow: '0 8px 24px rgba(15, 23, 42, 0.12)',
    fontSize: 12,
    fontWeight: 600,
    lineHeight: 1.2,
    pointerEvents: 'none',
    userSelect: 'none',
    backdropFilter: 'blur(8px)',
  };

  return (
    <div
      data-testid="creative-document-sync-status"
      role="status"
      aria-live="polite"
      aria-label={`创作云同步状态：${label}`}
      style={style}
    >
      {label}
    </div>
  );
};
