import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  AlertCircle,
  FolderOpen,
  LogIn,
  LogOut,
  Plus,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';

import {
  ApiClientError,
  createProject,
  getHomeSummary,
  listAssets,
  listProjects,
  login,
  logout,
  openProjectCanvas,
} from './api-client';
import type {
  CanvasBootContext,
  CanvasShellContext,
  HomeSummary,
  ProjectSummary,
} from './types';
import styles from './ProjectHomePage.module.scss';

type HomeStatus = 'loading' | 'ready' | 'unauthenticated' | 'error';

interface ProjectHomePageProps {
  onOpenAdmin?: () => void;
  onOpenCanvas: (
    bootContext: CanvasBootContext,
    shellContext: CanvasShellContext
  ) => void;
}

export function ProjectHomePage({ onOpenAdmin, onOpenCanvas }: ProjectHomePageProps) {
  const [status, setStatus] = useState<HomeStatus>('loading');
  const [summary, setSummary] = useState<HomeSummary | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [assetCount, setAssetCount] = useState(0);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [creating, setCreating] = useState(false);
  const [openingProjectId, setOpeningProjectId] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginForm, setLoginForm] = useState({ login: '', password: '' });

  const load = useCallback(async () => {
    setStatus('loading');
    setMessage('');
    try {
      const [nextSummary, nextProjects] = await Promise.all([
        getHomeSummary(),
        listProjects(),
      ]);
      setSummary(nextSummary);
      setProjects(nextProjects);
      try {
        setAssetCount((await listAssets()).length);
      } catch {
        setAssetCount(nextSummary.recentAssets.length);
      }
      setStatus('ready');
    } catch (error) {
      if (error instanceof ApiClientError && error.code === 'UNAUTHENTICATED') {
        setStatus('unauthenticated');
        return;
      }
      setMessage(error instanceof Error ? error.message : '加载失败');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const recentProjectCount = useMemo(
    () => summary?.projects.total ?? projects.length,
    [projects.length, summary?.projects.total]
  );

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage('');
    setCreating(true);
    try {
      const project = await createProject(title);
      setProjects((current) => [project, ...current]);
      setSummary((current) =>
        current
          ? {
              ...current,
              projects: {
                items: [project, ...current.projects.items].slice(0, 5),
                total: current.projects.total + 1,
              },
            }
          : current
      );
      setTitle('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '新建项目失败');
    } finally {
      setCreating(false);
    }
  };

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage('');
    setLoggingIn(true);
    try {
      await login({
        login: loginForm.login.trim(),
        password: loginForm.password,
      });
      setLoginForm({ login: '', password: '' });
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '登录失败');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    setMessage('');
    try {
      await logout();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '退出失败');
      return;
    }
    setSummary(null);
    setProjects([]);
    setAssetCount(0);
    setStatus('unauthenticated');
  };

  const handleOpen = async (project: ProjectSummary) => {
    setMessage('');
    setOpeningProjectId(project.id);
    try {
      const bootContext = await openProjectCanvas(project.id);
      if (!summary) {
        throw new Error('缺少当前账号信息，无法进入画布');
      }
      onOpenCanvas(bootContext, {
        projectId: project.id,
        projectTitle: project.title,
        quota: summary.quota,
        user: summary.user,
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '无法进入画布');
    } finally {
      setOpeningProjectId(null);
    }
  };

  if (status === 'loading') {
    return <StatusPanel icon={<RefreshCw size={22} />} title="加载中" />;
  }

  if (status === 'unauthenticated') {
    return (
      <StatusPanel
        action={
          <form className={styles.loginForm} onSubmit={handleLogin}>
            <label>
              账号
              <input
                autoComplete="username"
                className={styles.input}
                onChange={(event) =>
                  setLoginForm((current) => ({
                    ...current,
                    login: event.target.value,
                  }))
                }
                placeholder="用户名或邮箱"
                value={loginForm.login}
              />
            </label>
            <label>
              密码
              <input
                autoComplete="current-password"
                className={styles.input}
                onChange={(event) =>
                  setLoginForm((current) => ({
                    ...current,
                    password: event.target.value,
                  }))
                }
                placeholder="密码"
                type="password"
                value={loginForm.password}
              />
            </label>
            {message && <p className={styles.errorTextInline}>{message}</p>}
            <button className={styles.button} disabled={loggingIn} type="submit">
              <LogIn size={16} />
              登录
            </button>
            <p className={styles.statusHint}>
              第一版不开放公开注册；账号由管理员创建或通过邀请码准入。
            </p>
          </form>
        }
        icon={<LogIn size={22} />}
        title="登录梦图"
        text="使用内测账号进入项目、画布和后台。"
      />
    );
  }

  if (status === 'error') {
    return (
      <StatusPanel
        action={
          <button className={styles.ghostButton} onClick={() => void load()}>
            <RefreshCw size={16} />
            重试
          </button>
        }
        icon={<AlertCircle size={22} />}
        title="加载失败"
        text={message}
      />
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <h1 className={styles.brandName}>梦图</h1>
          <span className={styles.brandMeta}>
            {summary?.user.username ?? 'user'} · {summary?.user.role ?? 'user'}
          </span>
        </div>
        <div className={styles.topbarActions}>
          {summary?.user.role === 'admin' && onOpenAdmin && (
            <button className={styles.ghostButton} onClick={onOpenAdmin}>
              <ShieldCheck size={16} />
              后台
            </button>
          )}
          <button className={styles.ghostButton} onClick={() => void load()}>
            <RefreshCw size={16} />
            刷新
          </button>
          <button className={styles.ghostButton} onClick={() => void handleLogout()}>
            <LogOut size={16} />
            退出
          </button>
        </div>
      </header>

      <div className={styles.content}>
        <section className={styles.summaryGrid} aria-label="首页摘要">
          <SummaryPanel
            label="当前点数"
            value={summary?.quota.balanceAmount ?? 0}
          />
          <SummaryPanel label="最近资产" value={assetCount} />
          <SummaryPanel label="最近任务" value={summary?.recentTasks.length ?? 0} />
        </section>

        <section className={styles.projectPanel} aria-labelledby="projects-title">
          <div className={styles.projectHeader}>
            <div>
              <h2 className={styles.sectionTitle} id="projects-title">
                项目
              </h2>
              <p className={styles.sectionMeta}>{recentProjectCount} 个项目</p>
            </div>
            <form className={styles.createForm} onSubmit={handleCreate}>
              <input
                aria-label="项目名称"
                className={styles.input}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="项目名称"
                value={title}
              />
              <button className={styles.button} disabled={creating} type="submit">
                <Plus size={16} />
                新建项目
              </button>
            </form>
          </div>

          {message && <p className={styles.errorText}>{message}</p>}

          {projects.length === 0 ? (
            <div className={styles.emptyState}>
              <FolderOpen size={28} />
              <span>暂无项目</span>
            </div>
          ) : (
            <div className={styles.projectList}>
              {projects.map((project) => (
                <article className={styles.projectItem} key={project.id}>
                  <div>
                    <h3 className={styles.projectTitle}>{project.title}</h3>
                    <span className={styles.projectMeta}>
                      画布工作区 {project.opentuWorkspaceId}
                    </span>
                  </div>
                  <button
                    aria-label={`打开画布 ${project.title}`}
                    className={styles.button}
                    disabled={openingProjectId === project.id}
                    onClick={() => void handleOpen(project)}
                    type="button"
                  >
                    <FolderOpen size={16} />
                    进入画布
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function SummaryPanel({ label, value }: { label: string; value: number }) {
  return (
    <section className={styles.panel}>
      <p className={styles.panelLabel}>{label}</p>
      <p className={styles.panelValue}>{value}</p>
    </section>
  );
}

function StatusPanel({
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
    <main className={styles.statusBand}>
      <section className={styles.statusPanel}>
        {icon}
        <h1 className={styles.statusTitle}>{title}</h1>
        {text && <p className={styles.statusText}>{text}</p>}
        {action}
      </section>
    </main>
  );
}
