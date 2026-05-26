DO $$ BEGIN
  CREATE TYPE mt_project_status AS ENUM ('active', 'archived', 'deleted');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE mt_canvas_sync_status AS ENUM (
    'pending',
    'running',
    'succeeded',
    'failed'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS mt_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES mt_tenants(id),
  owner_user_id uuid NOT NULL REFERENCES mt_users(id),
  title varchar(120) NOT NULL,
  status mt_project_status NOT NULL DEFAULT 'active',
  opentu_workspace_id varchar(160),
  last_opened_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT mt_projects_title_not_blank
    CHECK (length(trim(title)) > 0)
);

CREATE INDEX IF NOT EXISTS mt_projects_owner_status_idx
  ON mt_projects (tenant_id, owner_user_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS mt_projects_workspace_uidx
  ON mt_projects (tenant_id, opentu_workspace_id)
  WHERE opentu_workspace_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS mt_canvas_sync_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES mt_tenants(id),
  project_id uuid NOT NULL REFERENCES mt_projects(id),
  image_task_id uuid,
  asset_id uuid,
  status mt_canvas_sync_status NOT NULL DEFAULT 'pending',
  retry_count integer NOT NULL DEFAULT 0,
  last_error_code varchar(120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mt_canvas_sync_records_retry_non_negative
    CHECK (retry_count >= 0)
);

CREATE INDEX IF NOT EXISTS mt_canvas_sync_records_project_status_idx
  ON mt_canvas_sync_records (tenant_id, project_id, status);
