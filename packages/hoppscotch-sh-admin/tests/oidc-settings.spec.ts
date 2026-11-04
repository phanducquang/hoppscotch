import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_CONFIGS, getConfigValidationIssues } from '../src/helpers/configs';
import { InfraConfigEnum, ServiceStatus } from '../src/helpers/backend/graphql';
import { useConfigHandler } from '../src/composables/useConfigHandler';

const state = vi.hoisted(() => ({
  mounts: [] as Array<() => Promise<void>>,
  fetches: 0,
  callback: null as string | null,
}));
vi.mock('vue', async (original) => ({
  ...(await original<typeof import('vue')>()),
  onMounted: (fn: () => Promise<void>) => state.mounts.push(fn),
}));
vi.mock('../src/composables/i18n', () => ({
  useI18n: () => (key: string) => key,
}));
vi.mock('../src/composables/toast', () => ({
  useToast: () => ({ error: vi.fn() }),
}));
vi.mock('../src/helpers/errors', () => ({
  getCompiledErrorMessage: () => undefined,
}));
vi.mock('../src/composables/useClientHandler', async () => {
  const { ref } = await import('vue');
  return {
    useClientHandler: () => {
      const infra = state.fetches++ % 2 === 0;
      return {
        fetching: ref(false),
        error: ref(null),
        fetchData: vi.fn(),
        dataAsList: ref(
          infra
            ? ALL_CONFIGS.flat().map(({ name }) => ({
                name,
                value:
                  name === 'OIDC_CLIENT_SECRET'
                    ? 'must-never-display'
                    : name === 'OIDC_CALLBACK_URL'
                      ? (state.callback ??
                        'https://hopp.test/backend/v1/auth/oidc/callback')
                      : name === 'OIDC_ISSUER'
                        ? 'https://id.test/realms/hopp'
                        : name === 'OIDC_SCOPE'
                          ? 'openid profile email'
                          : name === 'PROXY_APP_URL'
                            ? 'https://proxy.test'
                            : '10',
              }))
            : ['OIDC', 'GOOGLE']
        ),
      };
    },
  };
});

async function load() {
  const handler = useConfigHandler();
  await state.mounts[0]();
  return handler.workingConfigs.value!;
}

beforeEach(() => {
  state.mounts = [];
  state.fetches = 0;
  state.callback = null;
  vi.stubEnv('VITE_BACKEND_API_URL', 'https://hopp.test/backend/v1');
});

describe('OIDC settings', () => {
  it('loads enabled OIDC and the public subpath callback without exposing the secret', async () => {
    const config = await load();
    expect(config.providers.oidc.enabled).toBe(true);
    expect(config.providers.oidc.fields.client_secret).toBe('');
    expect(config.providers.oidc.fields.callback_url).toBe(
      'https://hopp.test/backend/v1/auth/oidc/callback'
    );
    expect(config.providers.google.enabled).toBe(true);
  });

  it('derives a missing public callback from the backend URL', async () => {
    state.callback = '';
    const config = await load();
    expect(config.providers.oidc.fields.callback_url).toBe(
      'https://hopp.test/backend/v1/auth/oidc/callback'
    );
  });

  it.each(['', 'replacement-secret'])(
    'saves OIDC with secret %j',
    async (secret) => {
      const config = await load();
      config.providers.oidc.fields.client_secret = secret;
      const handler = useConfigHandler(config);
      const executeMutation = vi.fn().mockResolvedValue({});
      await handler.updateInfraConfigs({ executeMutation } as never);
      const updates = executeMutation.mock.calls[0][0].infraConfigs;
      expect(updates).toContainEqual({
        name: InfraConfigEnum.OidcIssuer,
        value: 'https://id.test/realms/hopp',
      });
      const secretUpdate = updates.find(
        (entry: { name: string }) =>
          entry.name === InfraConfigEnum.OidcClientSecret
      );
      expect(secretUpdate).toEqual(
        secret
          ? { name: InfraConfigEnum.OidcClientSecret, value: secret }
          : undefined
      );
    }
  );

  it.each([true, false])(
    'sends the OIDC provider status %s alongside other providers',
    async (enabled) => {
      const config = await load();
      config.providers.oidc.enabled = enabled;
      const executeMutation = vi.fn().mockResolvedValue({});
      await useConfigHandler(config).updateAuthProvider({
        executeMutation,
      } as never);
      expect(executeMutation.mock.calls[0][0].providerInfo).toEqual(
        expect.arrayContaining([
          {
            provider: 'OIDC',
            status: enabled ? ServiceStatus.Enable : ServiceStatus.Disable,
          },
          { provider: 'GOOGLE', status: ServiceStatus.Enable },
        ])
      );
    }
  );

  it('allows blank optional display name and a retained secret', async () => {
    const config = await load();
    config.providers.oidc.fields.display_name = '';
    expect(
      getConfigValidationIssues(config).filter(
        (issue) => issue.section === 'oidc'
      )
    ).toEqual([]);
  });

  it.each([
    ['issuer', 'not-a-url'],
    ['callback_url', 'ftp://hopp.test/callback'],
    ['scope', 'profile email'],
    ['client_id', ''],
  ])('flags invalid OIDC field %s', async (field, value) => {
    const config = await load();
    config.providers.oidc.fields[field as 'issuer'] = value;
    expect(getConfigValidationIssues(config)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ section: 'oidc', fieldKey: field }),
      ])
    );
    config.providers.oidc.enabled = false;
    expect(
      getConfigValidationIssues(config).filter(
        (issue) => issue.section === 'oidc'
      )
    ).toEqual([]);
  });
});
