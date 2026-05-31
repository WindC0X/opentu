import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  Activity,
  Boxes,
  ClipboardList,
  DatabaseBackup,
  DollarSign,
  Image,
  KeyRound,
  Plus,
  RefreshCw,
  Save,
  ServerCog,
  ShieldAlert,
  ShieldCheck,
  Users,
} from 'lucide-react';

import { ApiClientError } from '../mengtu/api-client';
import {
  adjustUserQuota,
  createInviteCode,
  createPricePolicy,
  createProvider,
  createRedemptionCode,
  loadAdminData,
  rotateProviderCredential,
  updateModel,
  updateProvider,
} from './api-client';
import type {
  AdminData,
  AdminOperationType,
  BackupStatus,
  BackupStatusSummary,
  ModelCapability,
  ModelHealthStatus,
  ModelSupportLevel,
  ModelVisibility,
  PricePolicyStatus,
  PricePolicyUnit,
  ProviderStatus,
} from './types';
import type { ImageTaskSummary } from '../mengtu/types';
import styles from './AdminPage.module.scss';

type AdminStatus = 'loading' | 'ready' | 'denied' | 'error';
type AdminSection =
  | 'users'
  | 'tasks'
  | 'assets'
  | 'backup'
  | 'providers'
  | 'models'
  | 'pricing'
  | 'audit';

interface AdminPageProps {
  onOpenHome: () => void;
}

const sections: Array<{
  icon: ReactNode;
  id: AdminSection;
  label: string;
}> = [
  { icon: <Users size={16} />, id: 'users', label: '用户' },
  { icon: <ClipboardList size={16} />, id: 'tasks', label: '任务' },
  { icon: <Image size={16} />, id: 'assets', label: '资产' },
  { icon: <DatabaseBackup size={16} />, id: 'backup', label: '备份' },
  { icon: <ServerCog size={16} />, id: 'providers', label: '供应商' },
  { icon: <Boxes size={16} />, id: 'models', label: '模型' },
  { icon: <DollarSign size={16} />, id: 'pricing', label: '价格' },
  { icon: <Activity size={16} />, id: 'audit', label: '审计' },
];

export function AdminPage({ onOpenHome }: AdminPageProps) {
  const [status, setStatus] = useState<AdminStatus>('loading');
  const [activeSection, setActiveSection] = useState<AdminSection>('users');
  const [data, setData] = useState<AdminData | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const [quotaForm, setQuotaForm] = useState({
    amount: '100',
    reason: 'admin adjustment',
    userId: '',
  });
  const [inviteForm, setInviteForm] = useState({
    code: '',
    initialQuotaAmount: '100',
    maxUses: '1',
  });
  const [redemptionForm, setRedemptionForm] = useState({
    code: '',
    maxUses: '10',
    quotaAmount: '20',
  });
  const [providerForm, setProviderForm] = useState({
    displayName: '',
    providerKey: '',
    reviewNotes: '',
    status: 'active' as ProviderStatus,
  });
  const [providerPatch, setProviderPatch] = useState({
    providerKey: 'mock',
    reviewNotes: '',
    status: 'active' as ProviderStatus,
  });
  const [credentialForm, setCredentialForm] = useState({
    credentialKind: 'api_key',
    providerKey: 'mock',
    secret: '',
  });
  const [modelForm, setModelForm] = useState({
    healthStatus: 'healthy' as ModelHealthStatus,
    modelKey: 'mock-image-v1',
    supportLevel: 'native' as ModelSupportLevel,
    visibility: 'public' as ModelVisibility,
  });
  const [priceForm, setPriceForm] = useState({
    amount: '10',
    modelKey: 'mock-image-v1',
    operationType: 'text_to_image' as AdminOperationType,
    policyKey: 'mock_text_to_image',
    status: 'active' as PricePolicyStatus,
    unit: 'per_image' as PricePolicyUnit,
  });

  const load = useCallback(async () => {
    setStatus('loading');
    setMessage('');
    try {
      const nextData = await loadAdminData();
      setData(nextData);
      setQuotaForm((current) => ({
        ...current,
        userId: current.userId || nextData.users[0]?.id || '',
      }));
      setProviderPatch((current) => ({
        ...current,
        providerKey:
          nextData.providers.find((provider) => provider.providerKey === current.providerKey)
            ?.providerKey ??
          nextData.providers[0]?.providerKey ??
          current.providerKey,
      }));
      setCredentialForm((current) => ({
        ...current,
        providerKey:
          nextData.providers.find((provider) => provider.providerKey === current.providerKey)
            ?.providerKey ??
          nextData.providers[0]?.providerKey ??
          current.providerKey,
      }));
      setModelForm((current) => ({
        ...current,
        modelKey:
          nextData.models.find((model) => model.modelKey === current.modelKey)
            ?.modelKey ??
          nextData.models[0]?.modelKey ??
          current.modelKey,
      }));
      setStatus('ready');
    } catch (error) {
      if (
        error instanceof ApiClientError &&
        (error.code === 'UNAUTHENTICATED' || error.code === 'FORBIDDEN')
      ) {
        setStatus('denied');
        return;
      }
      setMessage(error instanceof Error ? error.message : '加载失败');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const metrics = useMemo(
    () => ({
      assets: data?.assets.length ?? 0,
      audit: data?.auditLogs.length ?? 0,
      models: data?.models.length ?? 0,
      providers: data?.providers.length ?? 0,
      tasks: data?.tasks.length ?? 0,
      users: data?.users.length ?? 0,
    }),
    [data]
  );

  const runAction = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setMessage('');
    try {
      await action();
      setMessage(success);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const handleQuota = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runAction(
      () =>
        adjustUserQuota({
          amount: requiredNumber(quotaForm.amount, 'amount'),
          reason: quotaForm.reason,
          userId: quotaForm.userId,
        }),
      '点数调整已写入'
    );
  };

  const handleInvite = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runAction(
      () =>
        createInviteCode({
          code: optionalText(inviteForm.code),
          initialQuotaAmount: optionalNumber(inviteForm.initialQuotaAmount),
          maxUses: optionalNumber(inviteForm.maxUses),
        }),
      '邀请码已创建'
    );
  };

  const handleRedemption = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runAction(
      () =>
        createRedemptionCode({
          code: optionalText(redemptionForm.code),
          maxUses: optionalNumber(redemptionForm.maxUses),
          quotaAmount: requiredNumber(redemptionForm.quotaAmount, 'quotaAmount'),
        }),
      '兑换码已创建'
    );
  };

  const handleProviderCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runAction(
      () =>
        createProvider({
          displayName: providerForm.displayName,
          providerKey: providerForm.providerKey,
          reviewNotes: optionalText(providerForm.reviewNotes),
          status: providerForm.status,
        }),
      '供应商已创建'
    );
  };

  const handleProviderUpdate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runAction(
      () =>
        updateProvider({
          providerKey: providerPatch.providerKey,
          reviewNotes: optionalText(providerPatch.reviewNotes),
          status: providerPatch.status,
        }),
      '供应商状态已更新'
    );
  };

  const handleCredential = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runAction(
      () =>
        rotateProviderCredential({
          credentialKind: optionalText(credentialForm.credentialKind),
          providerKey: credentialForm.providerKey,
          secret: credentialForm.secret,
        }),
      '凭据已轮换'
    );
    setCredentialForm((current) => ({ ...current, secret: '' }));
  };

  const handleModelUpdate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runAction(
      () =>
        updateModel({
          healthStatus: modelForm.healthStatus,
          modelKey: modelForm.modelKey,
          supportLevel: modelForm.supportLevel,
          visibility: modelForm.visibility,
        }),
      '模型配置已更新'
    );
  };

  const handlePriceCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runAction(
      () =>
        createPricePolicy({
          amount: requiredNumber(priceForm.amount, 'amount'),
          modelKey: optionalText(priceForm.modelKey),
          operationType: priceForm.operationType,
          policyKey: priceForm.policyKey,
          status: priceForm.status,
          unit: priceForm.unit,
        }),
      '价格版本已创建'
    );
  };

  if (status === 'loading') {
    return <StatusView icon={<RefreshCw size={22} />} title="加载后台" />;
  }

  if (status === 'denied') {
    return (
      <StatusView
        action={<button onClick={onOpenHome}>返回首页</button>}
        icon={<ShieldAlert size={22} />}
        title="无后台权限"
        text="当前账号不能访问管理后台。"
      />
    );
  }

  if (status === 'error' || !data) {
    return (
      <StatusView
        action={<button onClick={() => void load()}>重试</button>}
        icon={<ShieldAlert size={22} />}
        title="后台加载失败"
        text={message}
      />
    );
  }

  return (
    <main className={styles.page}>
      <aside className={styles.sidebar}>
        <button className={styles.brandButton} onClick={onOpenHome} type="button">
          <ShieldCheck size={18} />
          梦图后台
        </button>
        <nav className={styles.nav} aria-label="后台分区">
          {sections.map((section) => (
            <button
              className={
                activeSection === section.id ? styles.navItemActive : styles.navItem
              }
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              type="button"
            >
              {section.icon}
              {section.label}
            </button>
          ))}
        </nav>
      </aside>

      <section className={styles.workspace}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Admin Provider Ops</p>
            <h1>运营控制台</h1>
          </div>
          <button className={styles.secondaryButton} onClick={() => void load()}>
            <RefreshCw size={16} />
            刷新
          </button>
        </header>

        <section className={styles.metrics} aria-label="后台摘要">
          <Metric label="用户" value={metrics.users} />
          <Metric label="任务" value={metrics.tasks} />
          <Metric label="资产" value={metrics.assets} />
          <Metric label="供应商" value={metrics.providers} />
          <Metric label="模型" value={metrics.models} />
          <Metric label="审计" value={metrics.audit} />
        </section>

        {message && <p className={styles.message}>{message}</p>}

        {activeSection === 'users' && (
          <Panel title="用户与点数">
            <div className={styles.formGrid}>
              <form className={styles.form} onSubmit={handleQuota}>
                <label>
                  用户
                  <select
                    value={quotaForm.userId}
                    onChange={(event) =>
                      setQuotaForm((current) => ({
                        ...current,
                        userId: event.target.value,
                      }))
                    }
                  >
                    {data.users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.username} · {user.email}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  点数
                  <input
                    value={quotaForm.amount}
                    onChange={(event) =>
                      setQuotaForm((current) => ({
                        ...current,
                        amount: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  原因
                  <input
                    value={quotaForm.reason}
                    onChange={(event) =>
                      setQuotaForm((current) => ({
                        ...current,
                        reason: event.target.value,
                      }))
                    }
                  />
                </label>
                <button disabled={busy} type="submit">
                  <Save size={16} />
                  调整点数
                </button>
              </form>
              <form className={styles.form} onSubmit={handleInvite}>
                <label>
                  邀请码
                  <input
                    placeholder="自动生成"
                    value={inviteForm.code}
                    onChange={(event) =>
                      setInviteForm((current) => ({
                        ...current,
                        code: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  初始点数
                  <input
                    value={inviteForm.initialQuotaAmount}
                    onChange={(event) =>
                      setInviteForm((current) => ({
                        ...current,
                        initialQuotaAmount: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  使用次数
                  <input
                    value={inviteForm.maxUses}
                    onChange={(event) =>
                      setInviteForm((current) => ({
                        ...current,
                        maxUses: event.target.value,
                      }))
                    }
                  />
                </label>
                <button disabled={busy} type="submit">
                  <Plus size={16} />
                  创建邀请
                </button>
              </form>
              <form className={styles.form} onSubmit={handleRedemption}>
                <label>
                  兑换码
                  <input
                    placeholder="自动生成"
                    value={redemptionForm.code}
                    onChange={(event) =>
                      setRedemptionForm((current) => ({
                        ...current,
                        code: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  点数
                  <input
                    value={redemptionForm.quotaAmount}
                    onChange={(event) =>
                      setRedemptionForm((current) => ({
                        ...current,
                        quotaAmount: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  使用次数
                  <input
                    value={redemptionForm.maxUses}
                    onChange={(event) =>
                      setRedemptionForm((current) => ({
                        ...current,
                        maxUses: event.target.value,
                      }))
                    }
                  />
                </label>
                <button disabled={busy} type="submit">
                  <Plus size={16} />
                  创建兑换
                </button>
              </form>
            </div>
            <DataTable
              headers={['用户', '邮箱', '角色', '状态', '最近登录']}
              rows={data.users.map((user) => [
                user.username,
                user.email,
                user.role,
                user.status,
                formatTime(user.lastLoginAt),
              ])}
            />
          </Panel>
        )}

        {activeSection === 'tasks' && (
          <Panel title="任务">
            <DataTable
              headers={[
                '任务',
                '状态',
                '操作',
                '用户',
                '模型路径',
                '供应商',
                '点数',
                '画布/资产',
                '错误',
              ]}
              rows={data.tasks.map((task) => [
                shortId(task.id),
                task.status,
                task.operationType,
                shortId(task.ownerUserId),
                `${task.requestedModelKey} -> ${task.actualModelKey ?? '-'}`,
                `${task.requestedProvider} -> ${task.actualProvider ?? '-'}`,
                formatTaskQuota(task),
                `${task.canvasSyncStatus} / ${task.assets.length} asset(s)`,
                task.failureCode || task.failureMessage
                  ? `${task.failureCode ?? '-'} ${task.failureMessage ?? ''}`.trim()
                  : '-',
              ])}
            />
          </Panel>
        )}

        {activeSection === 'assets' && (
          <Panel title="资产">
            <DataTable
              headers={['资产', '项目', '来源', '状态', '尺寸', '创建时间']}
              rows={data.assets.map((asset) => [
                shortId(asset.id),
                shortId(asset.projectId),
                asset.origin,
                asset.visibilityStatus,
                `${asset.width}x${asset.height}`,
                formatTime(asset.createdAt),
              ])}
            />
          </Panel>
        )}

        {activeSection === 'backup' && (
          <Panel title="备份状态">
            <BackupStatusPanel status={data.backupStatus} />
          </Panel>
        )}

        {activeSection === 'providers' && (
          <Panel title="供应商">
            <div className={styles.formGrid}>
              <form className={styles.form} onSubmit={handleProviderCreate}>
                <label>
                  Provider Key
                  <input
                    value={providerForm.providerKey}
                    onChange={(event) =>
                      setProviderForm((current) => ({
                        ...current,
                        providerKey: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  显示名
                  <input
                    value={providerForm.displayName}
                    onChange={(event) =>
                      setProviderForm((current) => ({
                        ...current,
                        displayName: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  状态
                  <ProviderStatusSelect
                    value={providerForm.status}
                    onChange={(statusValue) =>
                      setProviderForm((current) => ({
                        ...current,
                        status: statusValue,
                      }))
                    }
                  />
                </label>
                <button disabled={busy} type="submit">
                  <Plus size={16} />
                  新增供应商
                </button>
              </form>
              <form className={styles.form} onSubmit={handleProviderUpdate}>
                <label>
                  供应商
                  <ProviderSelect
                    providers={data.providers.map((provider) => provider.providerKey)}
                    value={providerPatch.providerKey}
                    onChange={(providerKey) =>
                      setProviderPatch((current) => ({
                        ...current,
                        providerKey,
                      }))
                    }
                  />
                </label>
                <label>
                  状态
                  <ProviderStatusSelect
                    value={providerPatch.status}
                    onChange={(statusValue) =>
                      setProviderPatch((current) => ({
                        ...current,
                        status: statusValue,
                      }))
                    }
                  />
                </label>
                <label>
                  备注
                  <input
                    value={providerPatch.reviewNotes}
                    onChange={(event) =>
                      setProviderPatch((current) => ({
                        ...current,
                        reviewNotes: event.target.value,
                      }))
                    }
                  />
                </label>
                <button disabled={busy} type="submit">
                  <Save size={16} />
                  更新供应商
                </button>
              </form>
              <form className={styles.form} onSubmit={handleCredential}>
                <label>
                  供应商
                  <ProviderSelect
                    providers={data.providers.map((provider) => provider.providerKey)}
                    value={credentialForm.providerKey}
                    onChange={(providerKey) =>
                      setCredentialForm((current) => ({
                        ...current,
                        providerKey,
                      }))
                    }
                  />
                </label>
                <label>
                  凭据类型
                  <input
                    value={credentialForm.credentialKind}
                    onChange={(event) =>
                      setCredentialForm((current) => ({
                        ...current,
                        credentialKind: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  Secret
                  <input
                    type="password"
                    value={credentialForm.secret}
                    onChange={(event) =>
                      setCredentialForm((current) => ({
                        ...current,
                        secret: event.target.value,
                      }))
                    }
                  />
                </label>
                <button disabled={busy} type="submit">
                  <KeyRound size={16} />
                  轮换凭据
                </button>
              </form>
            </div>
            <DataTable
              headers={[
                'Key',
                '名称',
                '状态',
                '默认',
                '凭据',
                '数据边界',
                '更新',
              ]}
              rows={data.providers.map((provider) => [
                provider.providerKey,
                provider.displayName,
                provider.status,
                provider.isDefault ? 'yes' : 'no',
                provider.credential?.maskedValue ?? '-',
                [
                  provider.dataRegion,
                  provider.dataRetentionPolicy,
                  provider.dataTrainingUsage,
                ]
                  .filter(Boolean)
                  .join(' / ') || '-',
                formatTime(provider.updatedAt),
              ])}
            />
          </Panel>
        )}

        {activeSection === 'models' && (
          <Panel title="模型">
            <form className={styles.inlineForm} onSubmit={handleModelUpdate}>
              <label>
                模型
                <select
                  value={modelForm.modelKey}
                  onChange={(event) =>
                    setModelForm((current) => ({
                      ...current,
                      modelKey: event.target.value,
                    }))
                  }
                >
                  {data.models.map((model) => (
                    <option key={model.id} value={model.modelKey}>
                      {model.modelKey}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                可见性
                <select
                  value={modelForm.visibility}
                  onChange={(event) =>
                    setModelForm((current) => ({
                      ...current,
                      visibility: event.target.value as ModelVisibility,
                    }))
                  }
                >
                  <option value="public">public</option>
                  <option value="beta">beta</option>
                  <option value="admin_only">admin_only</option>
                  <option value="disabled">disabled</option>
                </select>
              </label>
              <label>
                健康
                <select
                  value={modelForm.healthStatus}
                  onChange={(event) =>
                    setModelForm((current) => ({
                      ...current,
                      healthStatus: event.target.value as ModelHealthStatus,
                    }))
                  }
                >
                  <option value="healthy">healthy</option>
                  <option value="degraded">degraded</option>
                  <option value="disabled">disabled</option>
                </select>
              </label>
              <label>
                支持级别
                <select
                  value={modelForm.supportLevel}
                  onChange={(event) =>
                    setModelForm((current) => ({
                      ...current,
                      supportLevel: event.target.value as ModelSupportLevel,
                    }))
                  }
                >
                  <option value="native">native</option>
                  <option value="wrapped">wrapped</option>
                  <option value="experimental">experimental</option>
                  <option value="unsupported">unsupported</option>
                </select>
              </label>
              <button disabled={busy} type="submit">
                <Save size={16} />
                更新模型
              </button>
            </form>
            <DataTable
              headers={[
                '模型',
                '供应商',
                '可见性',
                '健康',
                '能力',
                '比例/分辨率',
                '参考/批量/mask',
              ]}
              rows={data.models.map((model) => [
                model.modelKey,
                model.providerKey ?? '-',
                model.visibility,
                model.healthStatus,
                model.capabilities.map(formatCapabilityOperation).join(', '),
                formatModelRatiosAndSizes(model.capabilities),
                formatModelLimits(model.capabilities),
              ])}
            />
          </Panel>
        )}

        {activeSection === 'pricing' && (
          <Panel title="价格">
            <form className={styles.inlineForm} onSubmit={handlePriceCreate}>
              <label>
                Policy Key
                <input
                  value={priceForm.policyKey}
                  onChange={(event) =>
                    setPriceForm((current) => ({
                      ...current,
                      policyKey: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                模型
                <input
                  value={priceForm.modelKey}
                  onChange={(event) =>
                    setPriceForm((current) => ({
                      ...current,
                      modelKey: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                点数
                <input
                  value={priceForm.amount}
                  onChange={(event) =>
                    setPriceForm((current) => ({
                      ...current,
                      amount: event.target.value,
                    }))
                  }
                />
              </label>
              <button disabled={busy} type="submit">
                <Plus size={16} />
                新价格版本
              </button>
            </form>
            <DataTable
              headers={['Policy', '版本', '操作', '模型', '点数', '状态']}
              rows={data.pricePolicies.map((policy) => [
                policy.policyKey,
                String(policy.version),
                policy.operationType,
                policy.modelKey ?? '-',
                String(policy.amount),
                policy.status,
              ])}
            />
          </Panel>
        )}

        {activeSection === 'audit' && (
          <Panel title="审计">
            <DataTable
              headers={['时间', '动作', '操作者', '对象', 'Metadata']}
              rows={data.auditLogs.map((log) => [
                formatTime(log.createdAt),
                log.action,
                shortId(log.actorUserId),
                `${log.targetType}:${shortId(log.targetId)}`,
                JSON.stringify(log.metadata),
              ])}
            />
          </Panel>
        )}
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <section className={styles.metric}>
      <span>{label}</span>
      <strong>{value}</strong>
    </section>
  );
}

function Panel({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className={styles.panel}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function BackupStatusPanel({ status }: { status: BackupStatusSummary }) {
  if (status.state === 'missing') {
    return <p className={styles.empty}>暂无备份记录</p>;
  }

  if (status.state === 'unavailable') {
    return (
      <section className={styles.backupNotice}>
        <strong>备份状态暂不可用</strong>
        <span>
          {status.errorCode}: {status.message}
        </span>
      </section>
    );
  }

  const backup = status.backup;
  return (
    <div className={styles.detailGrid}>
      <DetailItem label="状态" value={backup.status} />
      <DetailItem label="开始时间" value={formatTime(backup.startedAt)} />
      <DetailItem label="完成时间" value={formatTime(backup.finishedAt)} />
      <DetailItem label="耗时" value={formatDuration(backup.durationMs)} />
      <DetailItem label="输出目录" value={backup.outputDir} />
      <DetailItem label="Dump 文件" value={backup.dumpFile} />
      <DetailItem label="Manifest 文件" value={backup.manifestFile} />
      <DetailItem label="大小" value={formatBytes(backup.sizeBytes)} />
      <DetailItem label="SHA-256" value={checksumPrefix(backup.sha256)} />
      <DetailItem label="pg_dump" value={backup.pgDumpVersion ?? '-'} />
      <DetailItem label="DB Host Hash" value={backup.databaseHostHash ?? '-'} />
      <DetailItem label="DB Name Hash" value={backup.databaseNameHash ?? '-'} />
      <DetailItem label="保留天数" value={`${backup.retentionDays}`} />
      <DetailItem label="模式" value={backup.mode} />
      <DetailItem label="Dry Run" value={backup.dryRun ? 'yes' : 'no'} />
      <DetailItem label="错误" value={backupErrorText(backup)} />
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <section className={styles.detailItem}>
      <span>{label}</span>
      <strong>{value}</strong>
    </section>
  );
}

function DataTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: string[][];
}) {
  if (rows.length === 0) {
    return <p className={styles.empty}>暂无数据</p>;
  }
  return (
    <div className={styles.tableWrap}>
      <table>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${row[0]}-${rowIndex}`}>
              {row.map((cell, cellIndex) => (
                <td key={`${rowIndex}-${cellIndex}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusView({
  action,
  icon,
  text,
  title,
}: {
  action?: ReactNode;
  icon: ReactNode;
  text?: string;
  title: string;
}) {
  return (
    <main className={styles.statusPage}>
      <section className={styles.statusPanel}>
        {icon}
        <h1>{title}</h1>
        {text && <p>{text}</p>}
        {action}
      </section>
    </main>
  );
}

function ProviderSelect({
  onChange,
  providers,
  value,
}: {
  onChange: (value: string) => void;
  providers: string[];
  value: string;
}) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {providers.map((providerKey) => (
        <option key={providerKey} value={providerKey}>
          {providerKey}
        </option>
      ))}
    </select>
  );
}

function ProviderStatusSelect({
  onChange,
  value,
}: {
  onChange: (value: ProviderStatus) => void;
  value: ProviderStatus;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as ProviderStatus)}
    >
      <option value="active">active</option>
      <option value="degraded">degraded</option>
      <option value="disabled">disabled</option>
    </select>
  );
}

function requiredNumber(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${field} must be an integer`);
  }
  return parsed;
}

function optionalNumber(value: string): number | undefined {
  return value.trim() ? requiredNumber(value, 'value') : undefined;
}

function optionalText(value: string): string | undefined {
  return value.trim() ? value.trim() : undefined;
}

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}...` : value;
}

function formatTaskQuota(task: ImageTaskSummary): string {
  const settled =
    typeof task.settledPriceAmount === 'number'
      ? `settled ${task.settledPriceAmount}`
      : 'unsettled';
  return `quote ${task.quotedPriceAmount} v${task.priceVersion} / ${settled}`;
}

function formatCapabilityOperation(capability: ModelCapability): string {
  const support = capability.supported
    ? capability.supportLevel
    : 'unsupported';
  return `${capability.operationType}(${support})`;
}

function formatModelRatiosAndSizes(capabilities: ModelCapability[]): string {
  const ratios = Array.from(
    new Set(capabilities.flatMap((capability) => capability.supportedRatios))
  );
  const sizes = Array.from(
    new Set(capabilities.flatMap((capability) => capability.supportedSizes))
  );
  return [
    ratios.length ? `ratio ${ratios.join('/')}` : 'ratio -',
    sizes.length ? `size ${sizes.join('/')}` : 'size not exposed',
  ].join(' / ');
}

function formatModelLimits(capabilities: ModelCapability[]): string {
  if (capabilities.length === 0) {
    return '-';
  }
  const maxReferenceImages = Math.max(
    0,
    ...capabilities.map((capability) => capability.maxReferenceImages)
  );
  const maxBatchSize = Math.max(
    1,
    ...capabilities.map((capability) => capability.maxBatchSize)
  );
  const supportsMask = capabilities.some((capability) => capability.supportsMask);
  const supportsBatch = capabilities.some(
    (capability) => capability.supportsBatch
  );
  return `ref≤${maxReferenceImages} / batch${
    supportsBatch ? `≤${maxBatchSize}` : '=1'
  } / mask ${supportsMask ? 'yes' : 'no'}`;
}

function formatTime(value: string | null): string {
  if (!value) {
    return '-';
  }
  return new Date(value).toLocaleString();
}

function formatDuration(value: number): string {
  if (!Number.isFinite(value)) {
    return '-';
  }
  if (value < 1000) {
    return `${value}ms`;
  }
  return `${(value / 1000).toFixed(1)}s`;
}

function formatBytes(value: number | null): string {
  if (value === null) {
    return '-';
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function checksumPrefix(value: string | null): string {
  return value ? `${value.slice(0, 16)}...` : '-';
}

function backupErrorText(backup: BackupStatus): string {
  if (!backup.errorCode && !backup.errorMessage) {
    return '-';
  }
  return [backup.errorCode, backup.errorMessage].filter(Boolean).join(': ');
}
