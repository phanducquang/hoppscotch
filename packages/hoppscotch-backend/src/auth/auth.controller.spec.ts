import { ConfigService } from '@nestjs/config';
import { HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { mockDeep, mockReset } from 'jest-mock-extended';
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

const authService = mockDeep<AuthService>();
const configService = mockDeep<ConfigService>();
const oidcService = mockDeep<OidcService>();

const createResponse = () => {
  const res = {
    redirect: jest.fn(),
    status: jest.fn(),
    send: jest.fn(),
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
    controller = new AuthController(authService, configService, oidcService);
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

  it('consumes and validates the callback using the configured callback URL', async () => {
    const res = createResponse();
    const req = {
      originalUrl:
        '/v1/auth/oidc/callback?code=authorization-code&state=random-state',
      cookies: { transaction: 'encrypted' },
    } as Request;

    await controller.oidcAuthCallback(req, res);

    expect(oidcService.consumeTransaction).toHaveBeenCalledWith(req, res);
    expect(oidcService.exchangeAuthorizationCode).toHaveBeenCalledWith(
      new URL(
        'http://api.example.test/v1/auth/oidc/callback?code=authorization-code&state=random-state',
      ),
      transaction,
    );
    expect(res.status).toHaveBeenCalledWith(HttpStatus.NO_CONTENT);
    expect(res.send).toHaveBeenCalled();
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
