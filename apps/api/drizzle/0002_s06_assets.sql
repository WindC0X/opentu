DO $$ BEGIN
  CREATE TYPE mt_asset_kind AS ENUM ('image', 'mask', 'preset');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE mt_asset_origin AS ENUM (
    'upload',
    'generated',
    'mask',
    'preset'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE mt_asset_visibility_status AS ENUM (
    'normal',
    'discarded',
    'hidden',
    'deleted'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE mt_aigc_metadata_status AS ENUM (
    'unknown',
    'present',
    'removed',
    'not_applicable'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE mt_asset_variant_type AS ENUM (
    'original',
    'provider_input',
    'thumb',
    'preview'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE mt_asset_relation_type AS ENUM (
    'source',
    'mask',
    'reference',
    'result'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE mt_asset_reference_role AS ENUM (
    'general',
    'subject',
    'style',
    'composition',
    'background'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS mt_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES mt_tenants(id),
  owner_user_id uuid NOT NULL REFERENCES mt_users(id),
  project_id uuid NOT NULL REFERENCES mt_projects(id),
  asset_kind mt_asset_kind NOT NULL DEFAULT 'image',
  origin mt_asset_origin NOT NULL DEFAULT 'upload',
  visibility_status mt_asset_visibility_status NOT NULL DEFAULT 'normal',
  favorite boolean NOT NULL DEFAULT false,
  selected boolean NOT NULL DEFAULT false,
  mime_type varchar(80) NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  size_bytes integer NOT NULL,
  sha256 varchar(64) NOT NULL,
  ai_generated boolean NOT NULL DEFAULT false,
  generation_task_id uuid,
  provider varchar(120),
  model_key varchar(120),
  model_version varchar(120),
  has_provider_watermark boolean,
  aigc_metadata_status mt_aigc_metadata_status NOT NULL DEFAULT 'not_applicable',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT mt_assets_dimensions_positive CHECK (width > 0 AND height > 0),
  CONSTRAINT mt_assets_size_positive CHECK (size_bytes > 0),
  CONSTRAINT mt_assets_sha256_shape CHECK (length(sha256) = 64)
);

CREATE INDEX IF NOT EXISTS mt_assets_owner_status_idx
  ON mt_assets (tenant_id, owner_user_id, visibility_status);

CREATE INDEX IF NOT EXISTS mt_assets_project_created_idx
  ON mt_assets (tenant_id, project_id, created_at);

CREATE INDEX IF NOT EXISTS mt_assets_owner_sha_idx
  ON mt_assets (tenant_id, owner_user_id, sha256);

CREATE TABLE IF NOT EXISTS mt_asset_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES mt_tenants(id),
  asset_id uuid NOT NULL REFERENCES mt_assets(id),
  variant_type mt_asset_variant_type NOT NULL,
  storage_key text NOT NULL,
  mime_type varchar(80) NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  size_bytes integer NOT NULL,
  sha256 varchar(64) NOT NULL,
  exif_removed boolean NOT NULL DEFAULT false,
  created_by_job_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mt_asset_variants_dimensions_positive CHECK (width > 0 AND height > 0),
  CONSTRAINT mt_asset_variants_size_positive CHECK (size_bytes > 0),
  CONSTRAINT mt_asset_variants_sha256_shape CHECK (length(sha256) = 64)
);

CREATE UNIQUE INDEX IF NOT EXISTS mt_asset_variants_asset_type_uidx
  ON mt_asset_variants (asset_id, variant_type);

CREATE UNIQUE INDEX IF NOT EXISTS mt_asset_variants_storage_key_uidx
  ON mt_asset_variants (storage_key);

CREATE TABLE IF NOT EXISTS mt_asset_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES mt_tenants(id),
  task_id uuid,
  source_asset_id uuid REFERENCES mt_assets(id),
  result_asset_id uuid NOT NULL REFERENCES mt_assets(id),
  mask_asset_id uuid REFERENCES mt_assets(id),
  reference_asset_id uuid REFERENCES mt_assets(id),
  relation_type mt_asset_relation_type NOT NULL,
  reference_role mt_asset_reference_role,
  candidate_index integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mt_asset_relations_candidate_non_negative
    CHECK (candidate_index IS NULL OR candidate_index >= 0)
);

CREATE INDEX IF NOT EXISTS mt_asset_relations_result_idx
  ON mt_asset_relations (tenant_id, result_asset_id);

CREATE INDEX IF NOT EXISTS mt_asset_relations_task_idx
  ON mt_asset_relations (tenant_id, task_id);
