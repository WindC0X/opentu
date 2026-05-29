import type { ProviderCredentialResolver } from './types';

export class EnvProviderCredentialResolver implements ProviderCredentialResolver {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async resolve(
    input: Parameters<ProviderCredentialResolver['resolve']>[0]
  ): Promise<string | null> {
    if (!input.credential) {
      return null;
    }

    for (const key of credentialEnvKeys(
      input.model.providerKey,
      input.credential.credentialKind
    )) {
      const value = this.env[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }

    return null;
  }
}

export class StaticProviderCredentialResolver
  implements ProviderCredentialResolver
{
  constructor(private readonly values: Record<string, string>) {}

  async resolve(
    input: Parameters<ProviderCredentialResolver['resolve']>[0]
  ): Promise<string | null> {
    if (!input.credential) {
      return null;
    }
    const keys = credentialEnvKeys(
      input.model.providerKey,
      input.credential.credentialKind
    );
    return keys.map((key) => this.values[key]).find(Boolean) ?? null;
  }
}

function credentialEnvKeys(providerKey: string, credentialKind: string): string[] {
  const provider = toEnvSegment(providerKey);
  const kind = toEnvSegment(credentialKind);
  return [
    `PROVIDER_SECRET_${provider}_${kind}`,
    `PROVIDER_SECRET_${provider}`,
    provider === 'GRSAI' && kind === 'API_KEY' ? 'GRSAI_API_KEY' : '',
  ].filter(Boolean);
}

function toEnvSegment(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toUpperCase();
}
