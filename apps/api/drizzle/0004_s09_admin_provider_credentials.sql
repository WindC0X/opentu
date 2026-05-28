CREATE TABLE IF NOT EXISTS mt_provider_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  provider_config_id uuid NOT NULL REFERENCES mt_provider_configs(id),
  credential_kind varchar(80) NOT NULL DEFAULT 'api_key',
  secret_hash varchar(128) NOT NULL,
  secret_last_four varchar(4) NOT NULL,
  masked_value varchar(160) NOT NULL,
  rotated_by_admin_id uuid NOT NULL REFERENCES mt_users(id),
  last_rotated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS mt_provider_credentials_provider_kind_uidx
  ON mt_provider_credentials (tenant_id, provider_config_id, credential_kind);
