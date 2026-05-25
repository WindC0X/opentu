CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
  CREATE TYPE mt_user_role AS ENUM ('user', 'admin');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE mt_user_status AS ENUM ('invited', 'active', 'disabled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE mt_code_status AS ENUM ('active', 'used', 'expired', 'disabled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE mt_quota_owner_type AS ENUM ('user', 'team');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE mt_quota_ledger_entry_type AS ENUM (
    'grant',
    'redemption',
    'hold',
    'consume',
    'release',
    'refund',
    'adjustment'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS mt_tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(200) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mt_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES mt_tenants(id),
  email varchar(320) NOT NULL,
  username varchar(120) NOT NULL,
  password_hash text NOT NULL,
  role mt_user_role NOT NULL DEFAULT 'user',
  status mt_user_status NOT NULL DEFAULT 'active',
  terms_accepted_at timestamptz,
  terms_version varchar(64),
  privacy_version varchar(64),
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS mt_users_tenant_email_uidx
  ON mt_users (tenant_id, email);

CREATE UNIQUE INDEX IF NOT EXISTS mt_users_tenant_username_uidx
  ON mt_users (tenant_id, username);

CREATE TABLE IF NOT EXISTS mt_user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES mt_tenants(id),
  user_id uuid NOT NULL REFERENCES mt_users(id),
  session_hash varchar(128) NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS mt_user_sessions_hash_uidx
  ON mt_user_sessions (tenant_id, session_hash);

CREATE TABLE IF NOT EXISTS mt_invite_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES mt_tenants(id),
  code_hash varchar(128) NOT NULL,
  status mt_code_status NOT NULL DEFAULT 'active',
  initial_quota_amount integer NOT NULL DEFAULT 0,
  max_uses integer NOT NULL DEFAULT 1,
  used_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz,
  created_by_admin_id uuid NOT NULL REFERENCES mt_users(id),
  used_by_user_id uuid REFERENCES mt_users(id),
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mt_invite_codes_amount_non_negative
    CHECK (initial_quota_amount >= 0),
  CONSTRAINT mt_invite_codes_usage_valid
    CHECK (max_uses > 0 AND used_count >= 0 AND used_count <= max_uses)
);

CREATE UNIQUE INDEX IF NOT EXISTS mt_invite_codes_hash_uidx
  ON mt_invite_codes (tenant_id, code_hash);

CREATE TABLE IF NOT EXISTS mt_redemption_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES mt_tenants(id),
  code_hash varchar(128) NOT NULL,
  quota_amount integer NOT NULL,
  status mt_code_status NOT NULL DEFAULT 'active',
  max_uses integer NOT NULL,
  used_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz,
  created_by_admin_id uuid NOT NULL REFERENCES mt_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mt_redemption_codes_amount_positive CHECK (quota_amount > 0),
  CONSTRAINT mt_redemption_codes_usage_valid
    CHECK (max_uses > 0 AND used_count >= 0 AND used_count <= max_uses)
);

CREATE UNIQUE INDEX IF NOT EXISTS mt_redemption_codes_hash_uidx
  ON mt_redemption_codes (tenant_id, code_hash);

CREATE TABLE IF NOT EXISTS mt_quota_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES mt_tenants(id),
  owner_type mt_quota_owner_type NOT NULL DEFAULT 'user',
  owner_id uuid NOT NULL,
  balance_amount integer NOT NULL DEFAULT 0,
  held_amount integer NOT NULL DEFAULT 0,
  allow_overdraft boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mt_quota_accounts_amounts_non_negative
    CHECK (balance_amount >= 0 AND held_amount >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS mt_quota_accounts_owner_uidx
  ON mt_quota_accounts (tenant_id, owner_type, owner_id);

CREATE TABLE IF NOT EXISTS mt_quota_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES mt_tenants(id),
  account_id uuid NOT NULL REFERENCES mt_quota_accounts(id),
  user_id uuid NOT NULL REFERENCES mt_users(id),
  entry_type mt_quota_ledger_entry_type NOT NULL,
  amount integer NOT NULL,
  balance_after integer NOT NULL,
  held_after integer NOT NULL,
  related_task_id uuid,
  related_redemption_id uuid,
  reason text,
  operator_admin_id uuid REFERENCES mt_users(id),
  idempotency_key varchar(200) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mt_quota_ledger_amount_positive CHECK (amount > 0),
  CONSTRAINT mt_quota_ledger_balances_non_negative
    CHECK (balance_after >= 0 AND held_after >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS mt_quota_ledger_idempotency_uidx
  ON mt_quota_ledger (tenant_id, idempotency_key);

CREATE TABLE IF NOT EXISTS mt_redemption_code_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES mt_tenants(id),
  redemption_code_id uuid NOT NULL REFERENCES mt_redemption_codes(id),
  user_id uuid NOT NULL REFERENCES mt_users(id),
  quota_ledger_id uuid NOT NULL REFERENCES mt_quota_ledger(id),
  redeemed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS mt_redemption_code_redemptions_user_code_uidx
  ON mt_redemption_code_redemptions (
    tenant_id,
    redemption_code_id,
    user_id
  );

ALTER TABLE mt_quota_ledger
  ADD CONSTRAINT mt_quota_ledger_related_redemption_fk
  FOREIGN KEY (related_redemption_id)
  REFERENCES mt_redemption_code_redemptions(id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS mt_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES mt_tenants(id),
  actor_user_id uuid NOT NULL REFERENCES mt_users(id),
  action varchar(120) NOT NULL,
  target_type varchar(80) NOT NULL,
  target_id varchar(120) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
