DO $$ BEGIN
  CREATE TYPE mt_image_task_operation_type AS ENUM (
    'text_to_image',
    'image_to_image',
    'inpaint',
    'reference_generate',
    'prompt_optimize'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE mt_image_task_status AS ENUM (
    'queued',
    'running',
    'persisting',
    'succeeded',
    'failed',
    'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE mt_provider_usage_status AS ENUM (
    'succeeded',
    'failed',
    'timeout',
    'partial_succeeded'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE mt_price_policy_unit AS ENUM ('per_task', 'per_image', 'fixed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE mt_price_policy_status AS ENUM ('draft', 'active', 'retired');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE mt_provider_status AS ENUM ('active', 'degraded', 'disabled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE mt_model_visibility AS ENUM (
    'public',
    'beta',
    'admin_only',
    'disabled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE mt_model_health_status AS ENUM (
    'healthy',
    'degraded',
    'disabled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE mt_model_support_level AS ENUM (
    'native',
    'wrapped',
    'experimental',
    'unsupported'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE mt_outbox_status AS ENUM (
    'pending',
    'processing',
    'published',
    'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE mt_canvas_sync_status ADD VALUE IF NOT EXISTS 'not_required';

CREATE TABLE IF NOT EXISTS mt_price_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  policy_key varchar(120) NOT NULL,
  version integer NOT NULL,
  operation_type mt_image_task_operation_type NOT NULL,
  model_key varchar(120),
  unit mt_price_policy_unit NOT NULL,
  amount integer NOT NULL,
  status mt_price_policy_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mt_price_policies_amount_positive CHECK (amount > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS mt_price_policies_key_version_uidx
  ON mt_price_policies (tenant_id, policy_key, version);

CREATE TABLE IF NOT EXISTS mt_provider_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  provider_key varchar(120) NOT NULL,
  display_name varchar(160) NOT NULL,
  status mt_provider_status NOT NULL DEFAULT 'active',
  is_default boolean NOT NULL DEFAULT false,
  data_retention_policy text,
  data_training_usage text,
  data_region varchar(120),
  terms_url text,
  privacy_url text,
  last_reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS mt_provider_configs_key_uidx
  ON mt_provider_configs (tenant_id, provider_key);

CREATE TABLE IF NOT EXISTS mt_model_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  provider_config_id uuid NOT NULL REFERENCES mt_provider_configs(id),
  display_name varchar(160) NOT NULL,
  model_key varchar(120) NOT NULL,
  model_family varchar(120) NOT NULL,
  provider_model_id varchar(160) NOT NULL,
  model_version varchar(120) NOT NULL,
  price_policy_id uuid NOT NULL REFERENCES mt_price_policies(id),
  fallback_group_id uuid,
  visibility mt_model_visibility NOT NULL DEFAULT 'public',
  health_status mt_model_health_status NOT NULL DEFAULT 'healthy',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS mt_model_configs_key_uidx
  ON mt_model_configs (tenant_id, model_key);

CREATE TABLE IF NOT EXISTS mt_model_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  model_key varchar(120) NOT NULL,
  operation_type mt_image_task_operation_type NOT NULL,
  supported boolean NOT NULL DEFAULT true,
  support_level mt_model_support_level NOT NULL DEFAULT 'native',
  max_reference_images integer NOT NULL DEFAULT 0,
  supported_ratios jsonb NOT NULL DEFAULT '[]'::jsonb,
  supported_sizes jsonb NOT NULL DEFAULT '[]'::jsonb,
  supports_mask boolean NOT NULL DEFAULT false,
  supports_seed boolean NOT NULL DEFAULT false,
  supports_batch boolean NOT NULL DEFAULT false,
  max_batch_size integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mt_model_capabilities_batch_positive CHECK (max_batch_size > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS mt_model_capabilities_operation_uidx
  ON mt_model_capabilities (tenant_id, model_key, operation_type);

ALTER TABLE mt_quota_ledger
  ADD COLUMN IF NOT EXISTS price_policy_id uuid REFERENCES mt_price_policies(id);

ALTER TABLE mt_quota_ledger
  ADD COLUMN IF NOT EXISTS price_version integer;

CREATE TABLE IF NOT EXISTS mt_image_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  owner_user_id uuid NOT NULL REFERENCES mt_users(id),
  project_id uuid NOT NULL REFERENCES mt_projects(id),
  operation_type mt_image_task_operation_type NOT NULL,
  status mt_image_task_status NOT NULL DEFAULT 'queued',
  canvas_sync_status mt_canvas_sync_status NOT NULL DEFAULT 'pending',
  user_prompt text NOT NULL,
  optimized_prompt text,
  final_prompt text NOT NULL,
  ratio varchar(20) NOT NULL,
  batch_size integer NOT NULL,
  requested_provider varchar(120) NOT NULL,
  requested_model_key varchar(120) NOT NULL,
  actual_provider varchar(120),
  actual_model_key varchar(120),
  model_family varchar(120) NOT NULL,
  model_version varchar(120) NOT NULL,
  normalized_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_provider_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  price_policy_id uuid NOT NULL REFERENCES mt_price_policies(id),
  price_version integer NOT NULL,
  quoted_price_amount integer NOT NULL,
  quoted_price_unit varchar(40) NOT NULL DEFAULT 'points',
  settled_price_amount integer,
  settled_at timestamptz,
  quota_hold_ledger_id uuid NOT NULL REFERENCES mt_quota_ledger(id),
  provider_usage_id uuid,
  success_count integer NOT NULL DEFAULT 0,
  failure_count integer NOT NULL DEFAULT 0,
  failure_code varchar(120),
  failure_message text,
  internal_error_detail text,
  parent_task_id uuid,
  idempotency_key varchar(200) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mt_image_tasks_batch_allowed CHECK (batch_size IN (1, 2, 4)),
  CONSTRAINT mt_image_tasks_quote_positive CHECK (quoted_price_amount > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS mt_image_tasks_idempotency_uidx
  ON mt_image_tasks (tenant_id, owner_user_id, idempotency_key);

CREATE INDEX IF NOT EXISTS mt_image_tasks_project_status_idx
  ON mt_image_tasks (tenant_id, project_id, status);

CREATE TABLE IF NOT EXISTS mt_provider_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  image_task_id uuid NOT NULL REFERENCES mt_image_tasks(id),
  provider_config_id uuid NOT NULL REFERENCES mt_provider_configs(id),
  provider_model_id varchar(160),
  request_id varchar(160),
  status mt_provider_usage_status NOT NULL,
  provider_cost_amount integer,
  provider_cost_currency varchar(16),
  latency_ms integer,
  raw_error_code varchar(120),
  raw_error_message text,
  request_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mt_provider_usage_task_idx
  ON mt_provider_usage (tenant_id, image_task_id);

CREATE TABLE IF NOT EXISTS mt_outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  event_type varchar(120) NOT NULL,
  aggregate_type varchar(80) NOT NULL,
  aggregate_id uuid NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status mt_outbox_status NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  idempotency_key varchar(200) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS mt_outbox_events_idempotency_uidx
  ON mt_outbox_events (tenant_id, idempotency_key);

CREATE INDEX IF NOT EXISTS mt_outbox_events_status_idx
  ON mt_outbox_events (tenant_id, status);

INSERT INTO mt_price_policies (
  id,
  tenant_id,
  policy_key,
  version,
  operation_type,
  model_key,
  unit,
  amount,
  status
) VALUES (
  '00000000-0000-0000-0000-00000000f101',
  '00000000-0000-0000-0000-000000000001',
  'mock_text_to_image',
  1,
  'text_to_image',
  'mock-image-v1',
  'per_image',
  10,
  'active'
) ON CONFLICT DO NOTHING;

INSERT INTO mt_provider_configs (
  id,
  tenant_id,
  provider_key,
  display_name,
  status,
  is_default
) VALUES (
  '00000000-0000-0000-0000-00000000f001',
  '00000000-0000-0000-0000-000000000001',
  'mock',
  'Mock Provider',
  'active',
  true
) ON CONFLICT DO NOTHING;

INSERT INTO mt_model_configs (
  id,
  tenant_id,
  provider_config_id,
  display_name,
  model_key,
  model_family,
  provider_model_id,
  model_version,
  price_policy_id,
  visibility,
  health_status
) VALUES (
  '00000000-0000-0000-0000-00000000f201',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-00000000f001',
  'Mock Image v1',
  'mock-image-v1',
  'mock-image',
  'mock-image-v1',
  '2026-05-27',
  '00000000-0000-0000-0000-00000000f101',
  'public',
  'healthy'
) ON CONFLICT DO NOTHING;

INSERT INTO mt_model_capabilities (
  id,
  tenant_id,
  model_key,
  operation_type,
  supported,
  support_level,
  max_reference_images,
  supported_ratios,
  supported_sizes,
  supports_mask,
  supports_seed,
  supports_batch,
  max_batch_size
) VALUES (
  '00000000-0000-0000-0000-00000000f301',
  '00000000-0000-0000-0000-000000000001',
  'mock-image-v1',
  'text_to_image',
  true,
  'native',
  0,
  '["1:1", "16:9", "9:16"]'::jsonb,
  '[]'::jsonb,
  false,
  false,
  true,
  4
) ON CONFLICT DO NOTHING;
