import { ConfigService } from '@nestjs/config';
import { HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { mockDeep, mockReset } from 'jest-mock-extended';
import * as E from 'fp-ts/Either';
import { AuthUser } from 'src/types/AuthUser';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import {
  OidcAuthorizationRequest,
  OidcIdentity,
  OidcService,
  OidcTransaction,
} from './oidc.service';

const DEFAULT_CONFIG = {
  'INFRA.VITE_ALLOWED_AUTH_PROVIDERS': 'EMAIL,OIDC',
  'INFRA.OIDC_CALLBACK_URL': 'http://api.example.test/v1/auth/oidc/callback',
  'INFRA.OIDC_DISPLAY_NAME': 'Keycloak',
  'INFRA.ACCESS_TOKEN_VALIDITY': '86400000',
  'INFRA.REFRESH_TOKEN_VALIDITY': '604800000',
  'INFRA.ALLOW_SECURE_COOKIES': 'false',
  WHITELISTED_ORIGINS: 'http://localhost:3000,http://localhost:3100',
  VITE_BASE_URL: 'http://localhost:3000',
  VITE_ADMIN_URL: 'http://localhost:3100',
};

const transaction: OidcTransaction = {
  codeVerifier: 'pkce-verifier',
  state: 'random-state',
  nonce: 'random-nonce',
  redirectUri: 'http://localhost:3000',
  createdAt: Date.now(),
};

const authorizationRequest: OidcAuthorizationRequest = {
  authorizationUrl: new URL('https://id.example.test/authorize?state=random'),
  transaction,
};

const identity: OidcIdentity = {
  issuer: 'https://id.example.test',
  subject: 'provider-subject',
  email: 'user@example.com',
  emailVerified: true,
};

const user: AuthUser = {
  uid: 'hoppscotch-user',
  email: 'user@example.com',
  displayName: 'OIDC User',
  photoURL: null,
  isAdmin: false,
  refreshToken: null,
  lastLoggedOn: new Date(),
  lastActiveOn: null,
  createdOn: new Date(),
  currentGQLSession: null,
  currentRESTSession: null,
};

const authService = mockDeep<AuthService>();
const configService = mockDeep<ConfigService>();
const oidcService = mockDeep<OidcService>();

const createResponse = () => {
  const res = {
    redirect: jest.fn(),
    status: jest.fn(),
    send: jest.fn(),
    cookie: jest.fn(),
  } as unknown as Response;
  (res.redirect as jest.Mock).mockReturnValue(res);
  (res.status as jest.Mock).mockReturnValue(res);
  (res.send as jest.Mock).mockReturnValue(res);
  return res;
};

describe('AuthController OIDC routes', () => {
  let controller: AuthController;

  beforeEach(() => {
    mockReset(authService);
    mockReset(configService);
    mockReset(oidcService);
    configService.get.mockImplementation((key: string) => DEFAULT_CONFIG[key]);
    oidcService.createAuthorizationRequest.mockResolvedValue(
      authorizationRequest,
    );
    oidcService.consumeTransaction.mockReturnValue(transaction);
    oidcService.exchangeAuthorizationCode.mockResolvedValue(identity);
    authService.resolveOidcUser.mockResolvedValue(user);
    authService.generateAuthTokens.mockResolvedValue(
      E.right({
        access_token: 'hoppscotch-access-token',
        refresh_token: 'hoppscotch-refresh-token',
      }),
    );
    controller = new AuthController(authService, configService, oidcService);
  });

  it('returns the configured OIDC display name with enabled providers', async () => {
    authService.getAuthProviders.mockReturnValue(['EMAIL', 'OIDC']);

    await expect(controller.getAuthProviders()).resolves.toEqual({
      providers: ['EMAIL', 'OIDC'],
      oidcDisplayName: 'Keycloak',
    });
  });

  it('uses the generic OIDC display name when none is configured', async () => {
    authService.getAuthProviders.mockReturnValue(['OIDC']);
    configService.get.mockImplementation((key: string) =>
      key === 'INFRA.OIDC_DISPLAY_NAME' ? '   ' : DEFAULT_CONFIG[key],
    );

    await expect(controller.getAuthProviders()).resolves.toEqual({
      providers: ['OIDC'],
      oidcDisplayName: 'OpenID Connect',
    });
  });

  it('does not return OIDC metadata when OIDC is disabled', async () => {
    authService.getAuthProviders.mockReturnValue(['EMAIL']);

    await expect(controller.getAuthProviders()).resolves.toEqual({
      providers: ['EMAIL'],
      oidcDisplayName: undefined,
    });
  });

  it('starts OIDC for an allowed app origin and redirects to the provider', async () => {
    const res = createResponse();

    await controller.oidcAuth('http://localhost:3000', res);

    expect(oidcService.createAuthorizationRequest).toHaveBeenCalledWith(
      'http://localhost:3000',
    );
    expect(oidcService.saveTransaction).toHaveBeenCalledWith(res, transaction);
    expect(res.redirect).toHaveBeenCalledWith(
      HttpStatus.FOUND,
      authorizationRequest.authorizationUrl.href,
    );
  });

  it('rejects an external redirect before OIDC discovery', async () => {
    await expect(
      controller.oidcAuth('https://attacker.example.com', createResponse()),
    ).rejects.toThrow('Invalid OIDC redirect URI');
    expect(oidcService.createAuthorizationRequest).not.toHaveBeenCalled();
  });

  it('returns 404 when OIDC is not enabled', async () => {
    configService.get.mockImplementation((key: string) =>
      key === 'INFRA.VITE_ALLOWED_AUTH_PROVIDERS'
        ? 'EMAIL'
        : DEFAULT_CONFIG[key],
    );

    await expect(
      controller.oidcAuth('http://localhost:3000', createResponse()),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('resolves the identity and creates the existing Hoppscotch session', async () => {
    const res = createResponse();
    const req = {
      originalUrl:
        '/v1/auth/oidc/callback?code=authorization-code&state=random-state',
      cookies: { transaction: 'encrypted' },
    } as unknown as Request;

    await controller.oidcAuthCallback(req, res);

    expect(oidcService.consumeTransaction).toHaveBeenCalledWith(req, res);
    expect(oidcService.exchangeAuthorizationCode).toHaveBeenCalledWith(
      new URL(
        'http://api.example.test/v1/auth/oidc/callback?code=authorization-code&state=random-state',
      ),
      transaction,
    );
    expect(authService.resolveOidcUser).toHaveBeenCalledWith(identity);
    expect(authService.generateAuthTokens).toHaveBeenCalledWith(user.uid);
    expect(res.cookie).toHaveBeenNthCalledWith(
      1,
      'access_token',
      'hoppscotch-access-token',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax' }),
    );
    expect(res.cookie).toHaveBeenNthCalledWith(
      2,
      'refresh_token',
      'hoppscotch-refresh-token',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax' }),
    );
    expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
    expect(res.redirect).toHaveBeenCalledWith(transaction.redirectUri);
  });

  it('clears the transaction and rejects a callback when OIDC is disabled', async () => {
    configService.get.mockImplementation((key: string) =>
      key === 'INFRA.VITE_ALLOWED_AUTH_PROVIDERS'
        ? 'EMAIL'
        : DEFAULT_CONFIG[key],
    );
    const res = createResponse();

    await expect(
      controller.oidcAuthCallback(
        { originalUrl: '/v1/auth/oidc/callback' } as Request,
        res,
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(oidcService.clearTransaction).toHaveBeenCalledWith(res);
    expect(oidcService.consumeTransaction).not.toHaveBeenCalled();
  });
});
