import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { mockDeep } from 'jest-mock-extended';
import { AuthProvider, authCookieHandler, authProviderCheck } from './helper';
import { getAuthProviderRequiredKeys } from 'src/infra-config/helper';
import { InfraConfigEnum } from 'src/types/InfraConfig';

describe('authCookieHandler redirects', () => {
  const appUrl = 'https://hoppscotch.example.test';
  const adminUrl = `${appUrl}/admin`;
  const config = {
    VITE_BASE_URL: appUrl,
    VITE_ADMIN_URL: adminUrl,
    WHITELISTED_ORIGINS: `${appUrl},https://trusted.example.test`,
    'INFRA.ACCESS_TOKEN_VALIDITY': '86400000',
    'INFRA.REFRESH_TOKEN_VALIDITY': '604800000',
    'INFRA.ALLOW_SECURE_COOKIES': 'true',
  };

  const redirectTo = (redirectUrl: string | null, overrides = {}) => {
    const configService = mockDeep<ConfigService>();
    const values = { ...config, ...overrides };
    configService.get.mockImplementation((key: string) => values[key]);
    const res = {
      cookie: jest.fn(),
      status: jest.fn(),
      redirect: jest.fn(),
    } as unknown as Response;
    (res.status as jest.Mock).mockReturnValue(res);

    authCookieHandler(
      res,
      { access_token: 'access-token', refresh_token: 'refresh-token' },
      true,
      redirectUrl,
      configService,
    );

    return res;
  };

  it.each([
    appUrl,
    adminUrl,
    `${adminUrl}/users?from=oidc#settings`,
    'https://trusted.example.test/after-login',
  ])('preserves a redirect within an allowed origin: %s', (redirectUrl) => {
    expect(redirectTo(redirectUrl).redirect).toHaveBeenCalledWith(redirectUrl);
  });

  it('allows a separate admin origin configured only in VITE_ADMIN_URL', () => {
    const adminUrl = 'https://admin.example.test';
    const res = redirectTo(adminUrl, { VITE_ADMIN_URL: adminUrl });

    expect(res.redirect).toHaveBeenCalledWith(adminUrl);
  });

  it.each([
    'https://attacker.example.test/admin',
    `${appUrl}.attacker.example.test/admin`,
    'https://hoppscotch.example.test@attacker.example.test/admin',
    'https://user:pass@hoppscotch.example.test/admin',
    'https://hoppscotch.example.test:444/admin',
    'http://hoppscotch.example.test/admin',
    '//attacker.example.test/admin',
    'javascript:alert(1)',
    null,
  ])('falls back to the app for an invalid redirect: %s', (redirectUrl) => {
    expect(redirectTo(redirectUrl).redirect).toHaveBeenCalledWith(appUrl);
  });
});

describe('OIDC auth provider configuration', () => {
  it('defines OIDC as an AuthProvider', () => {
    expect(AuthProvider.OIDC).toBe('OIDC');
    expect(Object.values(AuthProvider)).toContain('OIDC');
  });

  it('accepts OIDC as the only allowed auth provider', () => {
    expect(authProviderCheck(AuthProvider.OIDC, 'OIDC')).toBe(true);
  });

  it('accepts OIDC alongside email authentication', () => {
    expect(authProviderCheck(AuthProvider.EMAIL, 'EMAIL,OIDC')).toBe(true);
    expect(authProviderCheck(AuthProvider.OIDC, 'EMAIL,OIDC')).toBe(true);
  });

  it('lists every required OIDC configuration key', () => {
    const requiredKeys = getAuthProviderRequiredKeys({ INFRA: {} });

    expect(requiredKeys[AuthProvider.OIDC]).toEqual([
      InfraConfigEnum.OIDC_ISSUER,
      InfraConfigEnum.OIDC_CLIENT_ID,
      InfraConfigEnum.OIDC_CLIENT_SECRET,
      InfraConfigEnum.OIDC_CALLBACK_URL,
      InfraConfigEnum.OIDC_SCOPE,
    ]);
    expect(requiredKeys[AuthProvider.OIDC]).not.toContain(
      InfraConfigEnum.OIDC_DISPLAY_NAME,
    );
  });
});
