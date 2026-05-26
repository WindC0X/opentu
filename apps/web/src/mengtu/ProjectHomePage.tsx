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
  Plus,
  RefreshCw,
} from 'lucide-react';

import {
  ApiClientError,
  createProject,
  getHomeSummary,
  listProjects,
  openProjectCanvas,
} from './api-client';
import type { CanvasBootContext, HomeSummary, ProjectSummary } from './types';
import styles from './ProjectHomePage.module.scss';

type HomeStatus = 'loading' | 'ready' | 'unauthenticated' | 'error';

interface ProjectHomePageProps {
  onOpenCanvas: (bootContext: CanvasBootContext) => void;
}

export function ProjectHomePage({ onOpenCanvas }: ProjectHomePageProps) {
  const [status, setStatus] = useState<HomeStatus>('loading');
  const [summary, setSummary] = useState<HomeSummary | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [creating, setCreating] = useState(false);
  const [openingProjectId, setOpeningProjectId] = useState<string | null>(null);

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

  const handleOpen = async (project: ProjectSummary) => {
    setMessage('');
    setOpeningProjectId(project.id);
    try {
      onOpenCanvas(await openProjectCanvas(project.id));
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
        icon={<LogIn size={22} />}
        title="请先登录"
        text="当前会话不可用。"
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
        <button className={styles.ghostButton} onClick={() => void load()}>
          <RefreshCw size={16} />
          刷新
        </button>
      </header>

      <div className={styles.content}>
        <section className={styles.summaryGrid} aria-label="首页摘要">
          <SummaryPanel
            label="当前点数"
            value={summary?.quota.balanceAmount ?? 0}
          />
          <SummaryPanel label="最近资产" value={summary?.recentAssets.length ?? 0} />
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
                      workspace {project.opentuWorkspaceId}
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
