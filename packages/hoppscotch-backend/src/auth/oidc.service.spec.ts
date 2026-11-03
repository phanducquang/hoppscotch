import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { mockDeep, mockReset } from 'jest-mock-extended';
import type * as oidc from 'openid-client';
import {
  OIDC_TRANSACTION_MAX_AGE_MS,
  OidcProtocolClient,
  OidcService,
  OidcTransaction,
} from './oidc.service';

const DEFAULT_CONFIG = {
  'INFRA.OIDC_ISSUER': 'http://id.example.test/realms/hoppscotch',
  'INFRA.OIDC_CLIENT_ID': 'hoppscotch',
  'INFRA.OIDC_CLIENT_SECRET': 'client-secret',
  'INFRA.OIDC_CALLBACK_URL': 'http://api.example.test/v1/auth/oidc/callback',
  'INFRA.OIDC_SCOPE': 'openid profile email',
  'INFRA.SESSION_SECRET': 'transaction-cookie-session-secret',
  'INFRA.SESSION_COOKIE_NAME': '',
  'INFRA.ALLOW_SECURE_COOKIES': 'false',
};

const configService = mockDeep<ConfigService>();
const protocolClient = mockDeep<OidcProtocolClient>();

const makeConfiguration = (metadataOverrides: Record<string, unknown> = {}) =>
  ({
    serverMetadata: () => ({
      issuer: DEFAULT_CONFIG['INFRA.OIDC_ISSUER'],
      authorization_endpoint: `${DEFAULT_CONFIG['INFRA.OIDC_ISSUER']}/protocol/openid-connect/auth`,
      token_endpoint: `${DEFAULT_CONFIG['INFRA.OIDC_ISSUER']}/protocol/openid-connect/token`,
      userinfo_endpoint: `${DEFAULT_CONFIG['INFRA.OIDC_ISSUER']}/protocol/openid-connect/userinfo`,
      jwks_uri: `${DEFAULT_CONFIG['INFRA.OIDC_ISSUER']}/protocol/openid-connect/certs`,
      ...metadataOverrides,
    }),
  }) as unknown as oidc.Configuration;

const createResponse = () =>
  ({
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  }) as unknown as Response;

describe('OidcService', () => {
  let service: OidcService;

  beforeEach(() => {
    mockReset(configService);
    mockReset(protocolClient);

    configService.get.mockImplementation((key: string) => DEFAULT_CONFIG[key]);
    protocolClient.discovery.mockResolvedValue(makeConfiguration());
    protocolClient.randomPKCECodeVerifier.mockReturnValue('pkce-verifier');
    protocolClient.calculatePKCECodeChallenge.mockResolvedValue(
      'pkce-challenge',
    );
    protocolClient.randomState.mockReturnValue('random-state');
    protocolClient.randomNonce.mockReturnValue('random-nonce');
    protocolClient.buildAuthorizationUrl.mockImplementation(
      (_configuration, parameters) => {
        const url = new URL(
          `${DEFAULT_CONFIG['INFRA.OIDC_ISSUER']}/protocol/openid-connect/auth`,
        );
        url.searchParams.set(
          'client_id',
          DEFAULT_CONFIG['INFRA.OIDC_CLIENT_ID'],
        );
        Object.entries(parameters).forEach(([key, value]) =>
          url.searchParams.set(key, value),
        );
        return url;
      },
    );

    service = new OidcService(configService, protocolClient);
  });

  describe('discovery', () => {
    it('discovers from the configured issuer and caches the result', async () => {
      const first = await service.getConfiguration();
      const second = await service.getConfiguration();

      expect(first).toBe(second);
      expect(protocolClient.discovery).toHaveBeenCalledTimes(1);
      expect(protocolClient.discovery).toHaveBeenCalledWith(
        new URL(DEFAULT_CONFIG['INFRA.OIDC_ISSUER']),
        DEFAULT_CONFIG['INFRA.OIDC_CLIENT_ID'],
        DEFAULT_CONFIG['INFRA.OIDC_CLIENT_SECRET'],
        undefined,
        { execute: [protocolClient.allowInsecureRequests] },
      );
    });

    it('does not enable insecure requests for an HTTPS issuer', async () => {
      configService.get.mockImplementation((key: string) =>
        key === 'INFRA.OIDC_ISSUER'
          ? 'https://id.example.test'
          : DEFAULT_CONFIG[key],
      );
      protocolClient.discovery.mockResolvedValue(
        makeConfiguration({ issuer: 'https://id.example.test' }),
      );

      await service.getConfiguration();

      expect(protocolClient.discovery).toHaveBeenCalledWith(
        new URL('https://id.example.test'),
        DEFAULT_CONFIG['INFRA.OIDC_CLIENT_ID'],
        DEFAULT_CONFIG['INFRA.OIDC_CLIENT_SECRET'],
        undefined,
        undefined,
      );
    });

    it('handles provider discovery failures and allows a retry', async () => {
      protocolClient.discovery
        .mockRejectedValueOnce(new Error('provider unavailable'))
        .mockResolvedValueOnce(makeConfiguration());

      await expect(service.getConfiguration()).rejects.toThrow(
        'OIDC discovery failed',
      );
      await expect(service.getConfiguration()).resolves.toBeDefined();
      expect(protocolClient.discovery).toHaveBeenCalledTimes(2);
    });

    it('rejects discovery metadata with the wrong issuer', async () => {
      protocolClient.discovery.mockResolvedValue(
        makeConfiguration({ issuer: 'https://attacker.example.com' }),
      );

      await expect(service.getConfiguration()).rejects.toThrow(
        'OIDC discovery failed',
      );
    });

    it('rejects incomplete discovery metadata', async () => {
      protocolClient.discovery.mockResolvedValue(
        makeConfiguration({ jwks_uri: undefined }),
      );

      await expect(service.getConfiguration()).rejects.toThrow(
        'OIDC discovery failed',
      );
    });

    it('rejects an invalid configured issuer before discovery', async () => {
      configService.get.mockImplementation((key: string) =>
        key === 'INFRA.OIDC_ISSUER' ? 'not-a-url' : DEFAULT_CONFIG[key],
      );

      await expect(service.getConfiguration()).rejects.toThrow(
        'OIDC configuration is invalid',
      );
      expect(protocolClient.discovery).not.toHaveBeenCalled();
    });
  });

  describe('authorization request', () => {
    it('generates Authorization Code + PKCE S256, state, and nonce', async () => {
      const result = await service.createAuthorizationRequest(
        'http://localhost:3000',
      );
      const parameters = protocolClient.buildAuthorizationUrl.mock.calls[0][1];

      expect(parameters).toEqual({
        redirect_uri: DEFAULT_CONFIG['INFRA.OIDC_CALLBACK_URL'],
        response_type: 'code',
        scope: 'openid profile email',
        state: 'random-state',
        nonce: 'random-nonce',
        code_challenge: 'pkce-challenge',
        code_challenge_method: 'S256',
      });
      expect(result.authorizationUrl.searchParams.get('response_type')).toBe(
        'code',
      );
      expect(result.authorizationUrl.searchParams.get('code_verifier')).toBe(
        null,
      );
      expect(result.transaction).toEqual({
        codeVerifier: 'pkce-verifier',
        state: 'random-state',
        nonce: 'random-nonce',
        redirectUri: 'http://localhost:3000',
        createdAt: expect.any(Number),
      });
    });
  });

  describe('transaction cookie', () => {
    const transaction: OidcTransaction = {
      codeVerifier: 'pkce-verifier',
      state: 'random-state',
      nonce: 'random-nonce',
      redirectUri: 'http://localhost:3000',
      createdAt: Date.now(),
    };

    it('round-trips an encrypted HttpOnly five-minute transaction cookie', () => {
      const res = createResponse();
      service.saveTransaction(res, transaction);

      const [cookieName, cookieValue, options] = (res.cookie as jest.Mock).mock
        .calls[0];
      expect(cookieName).toBe('__oauth_nonce_oidc');
      expect(cookieValue).not.toContain(transaction.codeVerifier);
      expect(cookieValue).not.toContain(transaction.nonce);
      expect(options).toEqual({
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        maxAge: OIDC_TRANSACTION_MAX_AGE_MS,
        path: '/v1/auth/oidc',
      });

      const req = { cookies: { [cookieName]: cookieValue } } as Request;
      expect(service.consumeTransaction(req, res)).toEqual(transaction);
      expect(res.clearCookie).toHaveBeenCalledWith(cookieName, {
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        path: '/v1/auth/oidc',
      });
    });

    it.each([
      [
        'false',
        'https://api.example.test/v1/auth/oidc/callback',
        '/v1/auth/oidc',
      ],
      [
        'true',
        'https://hoppscotch.example.test/backend/v1/auth/oidc/callback',
        '/backend/v1/auth/oidc',
      ],
    ])(
      'round-trips and clears the public cookie path with subpath access %s',
      (subpathAccess, callbackUrl, cookiePath) => {
        configService.get.mockImplementation((key: string) => {
          if (key === 'INFRA.OIDC_CALLBACK_URL') return callbackUrl;
          if (key === 'ENABLE_SUBPATH_BASED_ACCESS') return subpathAccess;
          return DEFAULT_CONFIG[key];
        });
        const res = createResponse();

        service.saveTransaction(res, transaction);

        const [cookieName, cookieValue, options] = (res.cookie as jest.Mock)
          .mock.calls[0];
        expect(options).toEqual({
          httpOnly: true,
          sameSite: 'lax',
          secure: true,
          maxAge: OIDC_TRANSACTION_MAX_AGE_MS,
          path: cookiePath,
        });
        const callbackPath = new URL(callbackUrl).pathname;
        expect(callbackPath.startsWith(`${options.path}/`)).toBe(true);

        const req = { cookies: { [cookieName]: cookieValue } } as Request;
        expect(service.consumeTransaction(req, res)).toEqual(transaction);
        expect(res.clearCookie).toHaveBeenCalledWith(cookieName, {
          httpOnly: true,
          sameSite: 'lax',
          secure: true,
          path: cookiePath,
        });
      },
    );

    it.each([undefined, 'not-a-url'])(
      'can clear a transaction when OIDC has no valid callback (%s)',
      (callbackUrl) => {
        configService.get.mockImplementation((key: string) =>
          key === 'INFRA.OIDC_CALLBACK_URL' ? callbackUrl : DEFAULT_CONFIG[key],
        );
        const res = createResponse();

        expect(() => service.clearTransaction(res)).not.toThrow();
        expect(res.clearCookie).toHaveBeenCalledWith(
          '__oauth_nonce_oidc',
          expect.objectContaining({ path: '/v1/auth/oidc' }),
        );
      },
    );

    it('rejects and clears an expired transaction', () => {
      const res = createResponse();
      service.saveTransaction(res, {
        ...transaction,
        createdAt: Date.now() - OIDC_TRANSACTION_MAX_AGE_MS - 1,
      });
      const [cookieName, cookieValue] = (res.cookie as jest.Mock).mock.calls[0];
      const req = { cookies: { [cookieName]: cookieValue } } as Request;

      expect(() => service.consumeTransaction(req, res)).toThrow(
        'OIDC transaction is invalid or expired',
      );
      expect(res.clearCookie).toHaveBeenCalled();
    });

    it('rejects and clears a missing transaction', () => {
      const res = createResponse();
      const req = { cookies: {} } as Request;

      expect(() => service.consumeTransaction(req, res)).toThrow(
        'OIDC transaction is missing',
      );
      expect(res.clearCookie).toHaveBeenCalledWith('__oauth_nonce_oidc', {
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        path: '/v1/auth/oidc',
      });
    });

    it('rejects a tampered transaction cookie', () => {
      const res = createResponse();
      service.saveTransaction(res, transaction);
      const [cookieName, cookieValue] = (res.cookie as jest.Mock).mock.calls[0];
      const cookieParts = cookieValue.split('.');
      cookieParts[2] = `${cookieParts[2][0] === 'A' ? 'B' : 'A'}${cookieParts[2].slice(1)}`;
      const req = {
        cookies: { [cookieName]: cookieParts.join('.') },
      } as Request;

      expect(() => service.consumeTransaction(req, res)).toThrow(
        'OIDC transaction is invalid',
      );
    });

    it('sets Secure when the callback uses HTTPS', () => {
      configService.get.mockImplementation((key: string) =>
        key === 'INFRA.OIDC_CALLBACK_URL'
          ? 'https://api.example.test/v1/auth/oidc/callback'
          : DEFAULT_CONFIG[key],
      );
      const res = createResponse();

      service.saveTransaction(res, transaction);

      expect((res.cookie as jest.Mock).mock.calls[0][2].secure).toBe(true);
    });
  });

  describe('authorization code exchange', () => {
    const transaction: OidcTransaction = {
      codeVerifier: 'pkce-verifier',
      state: 'random-state',
      nonce: 'random-nonce',
      redirectUri: 'http://localhost:3000',
      createdAt: Date.now(),
    };

    const mockTokenClaims = (overrides: Record<string, unknown> = {}) => {
      protocolClient.authorizationCodeGrant.mockResolvedValue({
        access_token: 'provider-access-token',
        token_type: 'bearer',
        claims: () => ({
          iss: DEFAULT_CONFIG['INFRA.OIDC_ISSUER'],
          sub: 'provider-subject',
          aud: DEFAULT_CONFIG['INFRA.OIDC_CLIENT_ID'],
          nonce: 'random-nonce',
          email: 'user@example.com',
          email_verified: true,
          name: 'OIDC User',
          picture: 'https://example.com/avatar.png',
          iat: 1,
          exp: 2,
          ...overrides,
        }),
        expiresIn: () => 300,
      } as never);
    };

    it('passes state, nonce, and PKCE checks and extracts verified claims', async () => {
      mockTokenClaims();

      const identity = await service.exchangeAuthorizationCode(
        new URL(
          `${DEFAULT_CONFIG['INFRA.OIDC_CALLBACK_URL']}?code=code&state=random-state`,
        ),
        transaction,
      );

      expect(protocolClient.authorizationCodeGrant).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(URL),
        {
          expectedState: 'random-state',
          expectedNonce: 'random-nonce',
          pkceCodeVerifier: 'pkce-verifier',
          idTokenExpected: true,
        },
      );
      expect(identity).toEqual({
        issuer: DEFAULT_CONFIG['INFRA.OIDC_ISSUER'],
        subject: 'provider-subject',
        email: 'user@example.com',
        emailVerified: true,
        name: 'OIDC User',
        picture: 'https://example.com/avatar.png',
      });
    });

    it('rejects a state mismatch before exchanging the code', async () => {
      await expect(
        service.exchangeAuthorizationCode(
          new URL(
            `${DEFAULT_CONFIG['INFRA.OIDC_CALLBACK_URL']}?code=code&state=wrong-state`,
          ),
          transaction,
        ),
      ).rejects.toThrow('OIDC state is invalid');
      expect(protocolClient.discovery).not.toHaveBeenCalled();
      expect(protocolClient.authorizationCodeGrant).not.toHaveBeenCalled();
    });

    it.each([
      ['issuer', { iss: 'https://attacker.example.com' }],
      ['audience', { aud: 'another-client' }],
      ['nonce', { nonce: 'wrong-nonce' }],
    ])('rejects an invalid ID token %s', async (_claim, overrides) => {
      mockTokenClaims(overrides);

      await expect(
        service.exchangeAuthorizationCode(
          new URL(
            `${DEFAULT_CONFIG['INFRA.OIDC_CALLBACK_URL']}?code=code&state=random-state`,
          ),
          transaction,
        ),
      ).rejects.toThrow('OIDC ID token claims are invalid');
    });

    it('rejects an ID token without required identity claims', async () => {
      protocolClient.authorizationCodeGrant.mockResolvedValue({
        access_token: 'provider-access-token',
        token_type: 'bearer',
        claims: () => undefined,
        expiresIn: () => 300,
      } as never);

      await expect(
        service.exchangeAuthorizationCode(
          new URL(
            `${DEFAULT_CONFIG['INFRA.OIDC_CALLBACK_URL']}?code=code&state=random-state`,
          ),
          transaction,
        ),
      ).rejects.toThrow('OIDC ID token is missing claims');
    });

    it('rejects an ID token that fails cryptographic validation', async () => {
      protocolClient.authorizationCodeGrant.mockRejectedValue(
        new Error('JWT signature verification failed'),
      );

      await expect(
        service.exchangeAuthorizationCode(
          new URL(
            `${DEFAULT_CONFIG['INFRA.OIDC_CALLBACK_URL']}?code=code&state=random-state`,
          ),
          transaction,
        ),
      ).rejects.toThrow('JWT signature verification failed');
    });
  });
});
