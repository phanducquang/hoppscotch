import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import * as crypto from 'crypto';
import type * as oidc from 'openid-client';

export const OIDC_PROTOCOL_CLIENT = Symbol('OIDC_PROTOCOL_CLIENT');
export const OIDC_TRANSACTION_MAX_AGE_MS = 5 * 60 * 1000;

export type OidcProtocolClient = Pick<
  typeof oidc,
  | 'allowInsecureRequests'
  | 'authorizationCodeGrant'
  | 'buildAuthorizationUrl'
  | 'calculatePKCECodeChallenge'
  | 'discovery'
  | 'fetchUserInfo'
  | 'randomNonce'
  | 'randomPKCECodeVerifier'
  | 'randomState'
>;

export interface OidcTransaction {
  codeVerifier: string;
  state: string;
  nonce: string;
  redirectUri: string;
  createdAt: number;
}

export interface OidcAuthorizationRequest {
  authorizationUrl: URL;
  transaction: OidcTransaction;
}

export interface OidcIdentity {
  issuer: string;
  subject: string;
  email?: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
}

interface OidcSettings {
  issuer: string;
  issuerUrl: URL;
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  scope: string;
}

interface CachedConfiguration {
  fingerprint: string;
  promise: Promise<oidc.Configuration>;
}

@Injectable()
export class OidcService {
  private cachedConfiguration: CachedConfiguration | null = null;

  constructor(
    private readonly configService: ConfigService,
    @Inject(OIDC_PROTOCOL_CLIENT)
    private readonly protocolClient: OidcProtocolClient,
  ) {}

  private loadSettings(): OidcSettings {
    const issuer = this.configService.get<string>('INFRA.OIDC_ISSUER')?.trim();
    const clientId = this.configService
      .get<string>('INFRA.OIDC_CLIENT_ID')
      ?.trim();
    const clientSecret = this.configService
      .get<string>('INFRA.OIDC_CLIENT_SECRET')
      ?.trim();
    const callbackUrl = this.configService
      .get<string>('INFRA.OIDC_CALLBACK_URL')
      ?.trim();
    const scope = this.configService
      .get<string>('INFRA.OIDC_SCOPE')
      ?.trim()
      .split(/\s+/)
      .join(' ');

    let issuerUrl: URL;
    let parsedCallbackUrl: URL;
    try {
      issuerUrl = new URL(issuer);
      parsedCallbackUrl = new URL(callbackUrl);
    } catch (error) {
      throw new ServiceUnavailableException('OIDC configuration is invalid', {
        cause: error,
      });
    }

    if (
      !clientId ||
      !clientSecret ||
      !scope ||
      !scope.split(' ').includes('openid') ||
      !['http:', 'https:'].includes(issuerUrl.protocol) ||
      !['http:', 'https:'].includes(parsedCallbackUrl.protocol)
    ) {
      throw new ServiceUnavailableException('OIDC configuration is invalid');
    }

    return {
      issuer,
      issuerUrl,
      clientId,
      clientSecret,
      callbackUrl,
      scope,
    };
  }

  /**
   * Discover and cache the provider configuration for the current InfraConfig.
   * The issuer URL is passed to openid-client so discovery uses the standard
   * OpenID Connect well-known document and validates the discovered issuer.
   */
  async getConfiguration(): Promise<oidc.Configuration> {
    const settings = this.loadSettings();
    const fingerprint = JSON.stringify([
      settings.issuer,
      settings.clientId,
      settings.clientSecret,
    ]);

    if (this.cachedConfiguration?.fingerprint === fingerprint) {
      return this.cachedConfiguration.promise;
    }

    const execute =
      settings.issuerUrl.protocol === 'http:'
        ? [this.protocolClient.allowInsecureRequests]
        : undefined;

    const promise = this.protocolClient
      .discovery(
        settings.issuerUrl,
        settings.clientId,
        settings.clientSecret,
        undefined,
        execute ? { execute } : undefined,
      )
      .then((configuration) => {
        const metadata = configuration.serverMetadata();
        if (
          metadata.issuer !== settings.issuer ||
          !metadata.authorization_endpoint ||
          !metadata.token_endpoint ||
          !metadata.jwks_uri
        ) {
          throw new Error('OIDC discovery metadata is incomplete');
        }

        return configuration;
      })
      .catch((error) => {
        if (this.cachedConfiguration?.fingerprint === fingerprint) {
          this.cachedConfiguration = null;
        }
        throw new ServiceUnavailableException('OIDC discovery failed', {
          cause: error,
        });
      });

    this.cachedConfiguration = { fingerprint, promise };
    return promise;
  }

  async createAuthorizationRequest(
    redirectUri: string,
  ): Promise<OidcAuthorizationRequest> {
    const settings = this.loadSettings();
    const configuration = await this.getConfiguration();
    const codeVerifier = this.protocolClient.randomPKCECodeVerifier();
    const codeChallenge =
      await this.protocolClient.calculatePKCECodeChallenge(codeVerifier);
    const state = this.protocolClient.randomState();
    const nonce = this.protocolClient.randomNonce();

    const authorizationUrl = this.protocolClient.buildAuthorizationUrl(
      configuration,
      {
        redirect_uri: settings.callbackUrl,
        response_type: 'code',
        scope: settings.scope,
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      },
    );

    return {
      authorizationUrl,
      transaction: {
        codeVerifier,
        state,
        nonce,
        redirectUri,
        createdAt: Date.now(),
      },
    };
  }

  saveTransaction(res: Response, transaction: OidcTransaction): void {
    res.cookie(
      this.getTransactionCookieName(),
      this.encryptTransaction(transaction),
      this.getTransactionCookieOptions(),
    );
  }

  clearTransaction(res: Response): void {
    res.clearCookie(
      this.getTransactionCookieName(),
      this.getTransactionCookieClearOptions(),
    );
  }

  consumeTransaction(req: Request, res: Response): OidcTransaction {
    const cookieName = this.getTransactionCookieName();
    const cookieValue = req.cookies?.[cookieName];

    this.clearTransaction(res);

    if (!cookieValue) {
      throw new UnauthorizedException('OIDC transaction is missing');
    }

    const transaction = this.decryptTransaction(cookieValue);
    const now = Date.now();

    if (
      !this.isOidcTransaction(transaction) ||
      transaction.createdAt > now + 60_000 ||
      now - transaction.createdAt > OIDC_TRANSACTION_MAX_AGE_MS
    ) {
      throw new UnauthorizedException('OIDC transaction is invalid or expired');
    }

    return transaction;
  }

  async exchangeAuthorizationCode(
    currentUrl: URL,
    transaction: OidcTransaction,
  ): Promise<OidcIdentity> {
    if (currentUrl.searchParams.get('state') !== transaction.state) {
      throw new UnauthorizedException('OIDC state is invalid');
    }

    const settings = this.loadSettings();
    const configuration = await this.getConfiguration();

    const tokens = await this.protocolClient.authorizationCodeGrant(
      configuration,
      currentUrl,
      {
        expectedState: transaction.state,
        expectedNonce: transaction.nonce,
        pkceCodeVerifier: transaction.codeVerifier,
        idTokenExpected: true,
      },
    );
    const claims = tokens.claims();

    if (!claims?.iss || !claims.sub) {
      throw new UnauthorizedException('OIDC ID token is missing claims');
    }

    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (
      claims.iss !== settings.issuer ||
      !audience.includes(settings.clientId) ||
      claims.nonce !== transaction.nonce
    ) {
      throw new UnauthorizedException('OIDC ID token claims are invalid');
    }

    let email = typeof claims.email === 'string' ? claims.email : undefined;
    let emailVerified = claims.email_verified === true;
    let name = typeof claims.name === 'string' ? claims.name : undefined;
    let picture =
      typeof claims.picture === 'string' ? claims.picture : undefined;

    if (!email && tokens.access_token) {
      const metadata = configuration.serverMetadata();
      if (metadata.userinfo_endpoint) {
        const userInfo = await this.protocolClient.fetchUserInfo(
          configuration,
          tokens.access_token,
          claims.sub,
        );
        email = typeof userInfo.email === 'string' ? userInfo.email : undefined;
        emailVerified = userInfo.email_verified === true;
        name =
          name ??
          (typeof userInfo.name === 'string' ? userInfo.name : undefined);
        picture =
          picture ??
          (typeof userInfo.picture === 'string' ? userInfo.picture : undefined);
      }
    }

    return {
      issuer: claims.iss,
      subject: claims.sub,
      email,
      emailVerified,
      name,
      picture,
    };
  }

  private getTransactionCookieName(): string {
    const sessionCookieName = this.configService.get<string>(
      'INFRA.SESSION_COOKIE_NAME',
    );
    return `${sessionCookieName || '__oauth_nonce'}_oidc`;
  }

  private getTransactionCookiePath(): string {
    try {
      // Use the public callback path: a reverse proxy may strip /backend before
      // forwarding to Nest, but the browser must send the cookie to that path.
      const callbackUrl = new URL(
        this.configService.get<string>('INFRA.OIDC_CALLBACK_URL'),
      );
      return callbackUrl.pathname.replace(/\/callback\/?$/, '') || '/';
    } catch {
      // Clearing a transaction must still work when OIDC is disabled/unset.
      return '/v1/auth/oidc';
    }
  }

  private getTransactionCookieOptions() {
    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: this.shouldUseSecureCookies(),
      maxAge: OIDC_TRANSACTION_MAX_AGE_MS,
      path: this.getTransactionCookiePath(),
    };
  }

  private getTransactionCookieClearOptions() {
    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: this.shouldUseSecureCookies(),
      path: this.getTransactionCookiePath(),
    };
  }

  private shouldUseSecureCookies(): boolean {
    if (
      this.configService.get<string>('INFRA.ALLOW_SECURE_COOKIES') === 'true'
    ) {
      return true;
    }

    try {
      return (
        new URL(this.configService.get<string>('INFRA.OIDC_CALLBACK_URL'))
          .protocol === 'https:'
      );
    } catch {
      return false;
    }
  }

  private getTransactionEncryptionKey(): Buffer {
    const sessionSecret = this.configService.get<string>(
      'INFRA.SESSION_SECRET',
    );
    if (!sessionSecret) {
      throw new ServiceUnavailableException(
        'OIDC transaction encryption is not configured',
      );
    }

    return crypto
      .createHash('sha256')
      .update(`hoppscotch-oidc:${sessionSecret}`)
      .digest();
  }

  private encryptTransaction(transaction: OidcTransaction): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(
      'aes-256-gcm',
      this.getTransactionEncryptionKey(),
      iv,
    );
    cipher.setAAD(Buffer.from(this.getTransactionCookieName()));
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(transaction), 'utf8'),
      cipher.final(),
    ]);
    const authenticationTag = cipher.getAuthTag();

    return [
      'v1',
      iv.toString('base64url'),
      encrypted.toString('base64url'),
      authenticationTag.toString('base64url'),
    ].join('.');
  }

  private decryptTransaction(value: string): unknown {
    try {
      const [version, encodedIv, encodedData, encodedTag, extra] =
        value.split('.');
      if (
        version !== 'v1' ||
        !encodedIv ||
        !encodedData ||
        !encodedTag ||
        extra
      ) {
        throw new Error('Malformed OIDC transaction');
      }

      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        this.getTransactionEncryptionKey(),
        Buffer.from(encodedIv, 'base64url'),
      );
      decipher.setAAD(Buffer.from(this.getTransactionCookieName()));
      decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(encodedData, 'base64url')),
        decipher.final(),
      ]);

      return JSON.parse(decrypted.toString('utf8'));
    } catch (error) {
      throw new UnauthorizedException('OIDC transaction is invalid', {
        cause: error,
      });
    }
  }

  private isOidcTransaction(value: unknown): value is OidcTransaction {
    if (!value || typeof value !== 'object') return false;
    const transaction = value as Record<string, unknown>;

    return (
      typeof transaction.codeVerifier === 'string' &&
      transaction.codeVerifier.length > 0 &&
      typeof transaction.state === 'string' &&
      transaction.state.length > 0 &&
      typeof transaction.nonce === 'string' &&
      transaction.nonce.length > 0 &&
      typeof transaction.redirectUri === 'string' &&
      transaction.redirectUri.length > 0 &&
      typeof transaction.createdAt === 'number' &&
      Number.isFinite(transaction.createdAt)
    );
  }
}
