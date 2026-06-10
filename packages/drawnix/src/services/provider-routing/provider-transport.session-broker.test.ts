import { afterEach, describe, expect, it } from 'vitest';
import {
  clearCreativeSessionAuthMaterial,
  setCreativeSessionAuthMaterial,
} from '../creative-mode';
import { ProviderTransport } from './provider-transport';
import type { ResolvedProviderContext } from './types';

describe('ProviderTransport session-broker auth', () => {
  afterEach(() => {
    clearCreativeSessionAuthMaterial();
  });

  it('uses same-origin credentials and never sends API-key headers for session-broker', async () => {
    setCreativeSessionAuthMaterial({
      csrfToken: 'csrf-1',
      nonce: 'nonce-1',
    });
    const transport = new ProviderTransport();
    const context: ResolvedProviderContext = {
      profileId: 'new-api-creative',
      profileName: 'Creative',
      providerType: 'openai-compatible',
      baseUrl: '/creative/relay/v1',
      apiKey: 'must-not-leak',
      authType: 'session-broker',
      extraHeaders: {
        Authorization: 'Bearer must-not-leak',
        'X-API-Key': 'must-not-leak',
        'X-Trace-Id': 'trace-1',
      },
    };

    const prepared = transport.prepareRequest(context, {
      path: '/chat/completions',
      method: 'POST',
      query: { api_key: 'must-not-leak', safe: '1' },
      headers: {
        'Content-Type': 'application/json',
        authorization: 'Bearer request-leak',
        'x-api-key': 'request-leak',
      },
      body: '{}',
    });

    expect(prepared.url).toBe('/creative/relay/v1/chat/completions?safe=1');
    expect(prepared.init.credentials).toBe('same-origin');
    expect(prepared.headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-Trace-Id': 'trace-1',
      'X-Creative-CSRF': 'csrf-1',
      'X-Creative-Nonce': 'nonce-1',
    });
    expect(
      Object.keys(prepared.headers).map((key) => key.toLowerCase())
    ).not.toContain('authorization');
    expect(
      Object.keys(prepared.headers).map((key) => key.toLowerCase())
    ).not.toContain('x-api-key');
    expect(JSON.stringify(prepared)).not.toContain('must-not-leak');
    expect(JSON.stringify(prepared)).not.toContain('request-leak');
  });

  it('strips normalized sensitive query keys while preserving safe query keys for session-broker', () => {
    const transport = new ProviderTransport();
    const context: ResolvedProviderContext = {
      profileId: 'new-api-creative',
      profileName: 'Creative',
      providerType: 'openai-compatible',
      baseUrl: '/creative/relay/v1',
      apiKey: 'context-query-secret',
      authType: 'session-broker',
    };
    const leakQueries = {
      apiKey: 'leak-apiKey',
      api_key: 'leak-api_key',
      'api-key': 'leak-api-key',
      baseUrl: 'leak-baseUrl',
      base_url: 'leak-base_url',
      'base-url': 'leak-base-url',
      baseurl: 'leak-baseurl',
      channelId: 'leak-channelId',
      channel_id: 'leak-channel_id',
      'channel-id': 'leak-channel-id',
      providerOverride: 'leak-providerOverride',
      provider_override: 'leak-provider_override',
      'provider-override': 'leak-provider-override',
      accessToken: 'leak-accessToken',
      access_token: 'leak-access_token',
      'access-token': 'leak-access-token',
      refreshToken: 'leak-refreshToken',
      refresh_token: 'leak-refresh_token',
      'refresh-token': 'leak-refresh-token',
      idToken: 'leak-idToken',
      id_token: 'leak-id_token',
      'id-token': 'leak-id-token',
      internalToken: 'leak-internalToken',
      internal_token: 'leak-internal_token',
      'internal-token': 'leak-internal-token',
      upstreamKey: 'leak-upstreamKey',
      upstream_key: 'leak-upstream_key',
      'upstream-key': 'leak-upstream-key',
      Authorization: 'leak-Authorization',
      token: 'leak-token',
      key: 'leak-key',
      provider: 'leak-provider',
    };

    const prepared = transport.prepareRequest(context, {
      path: '/chat/completions',
      query: {
        ...leakQueries,
        safe: '1',
        model: 'safe-model',
        include_usage: true,
      },
    });

    expect(prepared.url).toBe(
      '/creative/relay/v1/chat/completions?safe=1&model=safe-model&include_usage=true'
    );
    expect(prepared.init.credentials).toBe('same-origin');

    const preparedHeaders = JSON.stringify(prepared.headers);
    const preparedInit = JSON.stringify(prepared.init);
    for (const leakValue of Object.values(leakQueries)) {
      expect(prepared.url).not.toContain(leakValue);
      expect(preparedHeaders).not.toContain(leakValue);
      expect(preparedInit).not.toContain(leakValue);
    }
    expect(prepared.url).not.toContain('context-query-secret');
    expect(preparedHeaders).not.toContain('context-query-secret');
    expect(preparedInit).not.toContain('context-query-secret');
  });

  it('strips auth material from embedded path query and proxy-style auth headers for session-broker', () => {
    setCreativeSessionAuthMaterial({
      csrfToken: 'csrf-path',
      nonce: 'nonce-path',
    });
    const transport = new ProviderTransport();
    const context: ResolvedProviderContext = {
      profileId: 'new-api-creative',
      profileName: 'Creative',
      providerType: 'openai-compatible',
      baseUrl: '/creative/relay/v1',
      apiKey: 'context-path-secret',
      authType: 'session-broker',
      extraHeaders: {
        'Proxy-Authorization': 'Basic proxy-leak',
        'X-OpenAI-Api-Key': 'openai-header-leak',
        'X-Safe-Trace': 'trace-ok',
      },
    };

    const prepared = transport.prepareRequest(context, {
      path: '/chat/completions?api_key=path-leak&Authorization=path-bearer&safe=1',
      query: {
        token: 'query-token-leak',
        upstream_key: 'query-upstream-leak',
        safe2: '2',
      },
      headers: {
        'X-Provider-Authorization': 'provider-header-leak',
        'X-Request-Id': 'request-ok',
      },
    });

    expect(prepared.url).toBe(
      '/creative/relay/v1/chat/completions?safe=1&safe2=2'
    );
    expect(prepared.init.credentials).toBe('same-origin');
    expect(prepared.headers).toMatchObject({
      'X-Safe-Trace': 'trace-ok',
      'X-Request-Id': 'request-ok',
      'X-Creative-CSRF': 'csrf-path',
      'X-Creative-Nonce': 'nonce-path',
    });
    expect(JSON.stringify(prepared)).not.toMatch(
      /context-path-secret|path-leak|path-bearer|query-token-leak|query-upstream-leak|proxy-leak|openai-header-leak|provider-header-leak/i
    );
  });

  it('strips provider routing query and headers for session-broker relay calls', () => {
    const transport = new ProviderTransport();
    const context: ResolvedProviderContext = {
      profileId: 'new-api-creative',
      profileName: 'Creative',
      providerType: 'openai-compatible',
      baseUrl: '/creative/relay/v1',
      apiKey: '',
      authType: 'session-broker',
      extraHeaders: {
        'X-Provider': 'extra-provider-leak',
        'X-Provider-Id': 'extra-provider-id-leak',
        'X-Channel-Id': 'extra-channel-leak',
        'X-Group': 'extra-group-leak',
        'X-Group-Id': 'extra-group-id-leak',
        'X-Base-URL': 'extra-base-url-leak',
        'X-Model': 'extra-model-leak',
        'X-Model-Override': 'extra-model-override-leak',
        'X-Upstream-Key': 'extra-upstream-key-leak',
        'X-Safe-Trace': 'trace-ok',
      },
    };

    const prepared = transport.prepareRequest(context, {
      path: '/videos/task-1?provider=path-provider-leak&providerId=path-provider-id-leak&channel=path-channel-leak&group=path-group-leak&groupId=path-group-id-leak&baseUrl=path-base-leak&modelId=path-model-id-leak&x_upstream_base_url=path-upstream-base-leak&safe=1',
      headers: {
        Provider: 'request-provider-leak',
        ProviderId: 'request-provider-id-leak',
        Channel: 'request-channel-leak',
        Group: 'request-group-leak',
        GroupId: 'request-group-id-leak',
        BaseUrl: 'request-base-url-leak',
        Model: 'request-model-leak',
        ModelId: 'request-model-id-leak',
        UpstreamKey: 'request-upstream-key-leak',
        'X-Request-Id': 'request-ok',
      },
    });

    expect(prepared.url).toBe('/creative/relay/v1/videos/task-1?safe=1');
    expect(prepared.headers).toMatchObject({
      'X-Safe-Trace': 'trace-ok',
      'X-Request-Id': 'request-ok',
    });
    expect(JSON.stringify(prepared)).not.toMatch(
      /provider-leak|provider-id-leak|channel-leak|group-leak|group-id-leak|base-url-leak|base-leak|model-leak|model-id-leak|model-override-leak|upstream-key-leak|upstream-base-leak/i
    );
  });

  it('strips server-selected model query overrides on session-broker Suno relay paths', () => {
    const transport = new ProviderTransport();
    const context: ResolvedProviderContext = {
      profileId: 'new-api-creative',
      profileName: 'Creative',
      providerType: 'openai-compatible',
      baseUrl: '/creative/relay/v1',
      apiKey: '',
      authType: 'session-broker',
      extraHeaders: {
        'X-Model': 'extra-model-leak',
        'X-Model-Override': 'extra-model-override-leak',
        'X-Safe-Trace': 'trace-ok',
      },
    };

    const prepared = transport.prepareRequest(context, {
      path: '/suno/fetch/task-1?model=path-model-leak&modelId=path-model-id-leak&provider=path-provider-leak&safe=1',
      query: {
        modelOverride: 'query-model-override-leak',
        x_model: 'query-x-model-leak',
        safe2: '2',
      },
      headers: {
        Model: 'request-model-leak',
        ModelId: 'request-model-id-leak',
        'Idempotency-Key': 'opentu-audio-local-task',
      },
    });

    expect(prepared.url).toBe(
      '/creative/relay/v1/suno/fetch/task-1?safe=1&safe2=2'
    );
    expect(prepared.headers).toMatchObject({
      'X-Safe-Trace': 'trace-ok',
      'Idempotency-Key': 'opentu-audio-local-task',
    });
    expect(JSON.stringify(prepared)).not.toMatch(
      /model-leak|model-id-leak|model-override-leak|x-model-leak|provider-leak/i
    );
  });

  it('strips server-selected model and MJ selected-key/notifyHook material on session-broker MJ relay paths', () => {
    const transport = new ProviderTransport();
    const context: ResolvedProviderContext = {
      profileId: 'new-api-creative',
      profileName: 'Creative',
      providerType: 'openai-compatible',
      baseUrl: '/creative/relay/v1',
      apiKey: '',
      authType: 'session-broker',
      extraHeaders: {
        'X-Model': 'extra-model-leak',
        'X-Selected-Key': 'extra-selected-key-leak',
        'X-Notify-Hook': 'extra-notify-hook-leak',
        'X-Safe-Trace': 'trace-ok',
      },
    };

    const prepared = transport.prepareRequest(context, {
      path: '/mj/task/task-1/fetch?model=path-model-leak&selectedKey=path-selected-key-leak&notifyHook=path-notify-hook-leak&provider=path-provider-leak&safe=1',
      query: {
        modelOverride: 'query-model-override-leak',
        selected_key: 'query-selected-key-leak',
        notify_hook: 'query-notify-hook-leak',
        safe2: '2',
      },
      headers: {
        Model: 'request-model-leak',
        SelectedKey: 'request-selected-key-leak',
        NotifyHook: 'request-notify-hook-leak',
        'Idempotency-Key': 'opentu-image-local-task',
      },
    });

    expect(prepared.url).toBe(
      '/creative/relay/v1/mj/task/task-1/fetch?safe=1&safe2=2'
    );
    expect(prepared.headers).toMatchObject({
      'X-Safe-Trace': 'trace-ok',
      'Idempotency-Key': 'opentu-image-local-task',
    });
    expect(JSON.stringify(prepared)).not.toMatch(
      /model-leak|model-override-leak|selected-key-leak|notify-hook-leak|provider-leak/i
    );
  });

  it('rejects absolute upstream request paths for session-broker relay calls', () => {
    const transport = new ProviderTransport();
    const context: ResolvedProviderContext = {
      profileId: 'new-api-creative',
      profileName: 'Creative',
      providerType: 'openai-compatible',
      baseUrl: '/creative/relay/v1',
      apiKey: '',
      authType: 'session-broker',
    };

    expect(() =>
      transport.prepareRequest(context, {
        path: 'https://upstream.example/v1/chat/completions?api_key=absolute-leak',
      })
    ).toThrow(/session-broker.*relative path/i);
  });

  it('rejects absolute upstream baseUrl values for session-broker relay calls', () => {
    const transport = new ProviderTransport();
    const context: ResolvedProviderContext = {
      profileId: 'new-api-creative',
      profileName: 'Creative',
      providerType: 'openai-compatible',
      baseUrl: 'https://upstream.example/v1',
      apiKey: '',
      authType: 'session-broker',
    };

    expect(() =>
      transport.prepareRequest(context, {
        path: '/videos',
      })
    ).toThrow(/session-broker.*\/creative\/relay\/v1/i);
  });

  it('rejects non-canonical relative baseUrl values for session-broker relay calls', () => {
    const transport = new ProviderTransport();
    const context: ResolvedProviderContext = {
      profileId: 'new-api-creative',
      profileName: 'Creative',
      providerType: 'openai-compatible',
      baseUrl: '/creative/relay/v1/v1',
      apiKey: '',
      authType: 'session-broker',
    };

    expect(() =>
      transport.prepareRequest(context, {
        path: '/videos',
      })
    ).toThrow(/session-broker.*\/creative\/relay\/v1/i);
  });

  it('keeps bearer behavior unchanged for standalone API-key mode', () => {
    const transport = new ProviderTransport();
    const prepared = transport.prepareRequest(
      {
        profileId: 'standalone',
        profileName: 'Standalone',
        providerType: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'standalone-key',
        authType: 'bearer',
      },
      { path: '/chat/completions' }
    );

    expect(prepared.init.credentials).toBeUndefined();
    expect(prepared.headers.Authorization).toBe('Bearer standalone-key');
  });

  it('keeps query behavior unchanged for standalone API-key mode', () => {
    const transport = new ProviderTransport();
    const prepared = transport.prepareRequest(
      {
        profileId: 'standalone-query',
        profileName: 'Standalone Query',
        providerType: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'standalone-query-key',
        authType: 'query',
      },
      {
        path: '/chat/completions',
        query: { safe: '1' },
      }
    );

    expect(prepared.init.credentials).toBeUndefined();
    expect(prepared.url).toBe(
      'https://api.example.com/v1/chat/completions?safe=1&api_key=standalone-query-key'
    );
  });
});
