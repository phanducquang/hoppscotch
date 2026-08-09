import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Post,
  Query,
  Request,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { SignInMagicDto } from './dto/signin-magic.dto';
import { VerifyMagicDto } from './dto/verify-magic.dto';
import { Request as ExpressRequest, Response } from 'express';
import * as E from 'fp-ts/Either';
import { RTJwtAuthGuard } from './guards/rt-jwt-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { GqlUser } from 'src/decorators/gql-user.decorator';
import { AuthUser } from 'src/types/AuthUser';
import { RTCookie } from 'src/decorators/rt-cookie.decorator';
import { AuthProvider, authCookieHandler, authProviderCheck } from './helper';
import {
  isAllowedAuthRedirectUri,
  isValidLocalhostRedirectUri,
} from './redirect-uri.validator';
import { GoogleSSOGuard } from './guards/google-sso.guard';
import { GithubSSOGuard } from './guards/github-sso.guard';
import { MicrosoftSSOGuard } from './guards/microsoft-sso.guard';
import { ThrottlerBehindProxyGuard } from 'src/guards/throttler-behind-proxy.guard';
import { SkipThrottle } from '@nestjs/throttler';
import { AUTH_PROVIDER_NOT_SPECIFIED } from 'src/errors';
import { ConfigService } from '@nestjs/config';
import { throwHTTPErr } from 'src/utils';
import { UserLastLoginInterceptor } from 'src/interceptors/user-last-login.interceptor';
import { OidcService } from './oidc.service';

@UseGuards(ThrottlerBehindProxyGuard)
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private authService: AuthService,
    private configService: ConfigService,
    private oidcService: OidcService,
  ) {}

  @Get('providers')
  async getAuthProviders() {
    const providers = await this.authService.getAuthProviders();
    const oidcDisplayName = providers.includes(AuthProvider.OIDC)
      ? this.configService.get<string>('INFRA.OIDC_DISPLAY_NAME')?.trim() ||
        'OpenID Connect'
      : undefined;

    return { providers, oidcDisplayName };
  }

  /**
   ** Route to initiate magic-link auth for a users email
   */
  @Post('signin')
  async signInMagicLink(
    @Body() authData: SignInMagicDto,
    @Query('origin') origin: string,
  ) {
    if (
      !authProviderCheck(
        AuthProvider.EMAIL,
        this.configService.get('INFRA.VITE_ALLOWED_AUTH_PROVIDERS'),
      )
    ) {
      throwHTTPErr({ message: AUTH_PROVIDER_NOT_SPECIFIED, statusCode: 404 });
    }

    const deviceIdToken = await this.authService.signInMagicLink(
      authData.email,
      origin,
    );
    if (E.isLeft(deviceIdToken)) throwHTTPErr(deviceIdToken.left);
    return deviceIdToken.right;
  }

  /**
   ** Route to verify and sign in a valid user via magic-link
   */
  @Post('verify')
  async verify(@Body() data: VerifyMagicDto, @Res() res: Response) {
    const authTokens = await this.authService.verifyMagicLinkTokens(data);
    if (E.isLeft(authTokens)) throwHTTPErr(authTokens.left);
    authCookieHandler(res, authTokens.right, false, null, this.configService);
  }

  /**
   ** Route to refresh auth tokens with Refresh Token Rotation
   * @see https://auth0.com/docs/secure/tokens/refresh-tokens/refresh-token-rotation
   */
  @Get('refresh')
  @UseGuards(RTJwtAuthGuard)
  async refresh(
    @GqlUser() user: AuthUser,
    @RTCookie() refresh_token: string,
    @Res() res,
  ) {
    const newTokenPair = await this.authService.refreshAuthTokens(
      refresh_token,
      user,
    );
    if (E.isLeft(newTokenPair)) throwHTTPErr(newTokenPair.left);
    authCookieHandler(res, newTokenPair.right, false, null, this.configService);
  }

  /**
   ** Route to initiate SSO auth via Google
   */
  @Get('google')
  @UseGuards(GoogleSSOGuard)
  async googleAuth(@Request() req) {
    void req;
  }

  /**
   ** Callback URL for Google SSO
   * @see https://auth0.com/docs/get-started/authentication-and-authorization-flow/authorization-code-flow#how-it-works
   */
  @Get('google/callback')
  @SkipThrottle()
  @UseGuards(GoogleSSOGuard)
  @UseInterceptors(UserLastLoginInterceptor)
  async googleAuthRedirect(@Request() req, @Res() res) {
    const authTokens = await this.authService.generateAuthTokens(req.user.uid);
    if (E.isLeft(authTokens)) throwHTTPErr(authTokens.left);
    authCookieHandler(
      res,
      authTokens.right,
      true,
      req.authInfo.state.redirect_uri,
      this.configService,
    );
  }

  /**
   ** Route to initiate SSO auth via Github
   */
  @Get('github')
  @UseGuards(GithubSSOGuard)
  async githubAuth(@Request() req) {
    void req;
  }

  /**
   ** Callback URL for Github SSO
   * @see https://auth0.com/docs/get-started/authentication-and-authorization-flow/authorization-code-flow#how-it-works
   */
  @Get('github/callback')
  @SkipThrottle()
  @UseGuards(GithubSSOGuard)
  @UseInterceptors(UserLastLoginInterceptor)
  async githubAuthRedirect(@Request() req, @Res() res) {
    const authTokens = await this.authService.generateAuthTokens(req.user.uid);
    if (E.isLeft(authTokens)) throwHTTPErr(authTokens.left);
    authCookieHandler(
      res,
      authTokens.right,
      true,
      req.authInfo.state.redirect_uri,
      this.configService,
    );
  }

  /**
   ** Route to initiate SSO auth via Microsoft
   */
  @Get('microsoft')
  @UseGuards(MicrosoftSSOGuard)
  async microsoftAuth(@Request() req) {
    void req;
  }

  /**
   ** Callback URL for Microsoft SSO
   * @see https://auth0.com/docs/get-started/authentication-and-authorization-flow/authorization-code-flow#how-it-works
   */
  @Get('microsoft/callback')
  @SkipThrottle()
  @UseGuards(MicrosoftSSOGuard)
  @UseInterceptors(UserLastLoginInterceptor)
  async microsoftAuthRedirect(@Request() req, @Res() res) {
    const authTokens = await this.authService.generateAuthTokens(req.user.uid);
    if (E.isLeft(authTokens)) throwHTTPErr(authTokens.left);
    authCookieHandler(
      res,
      authTokens.right,
      true,
      req.authInfo.state.redirect_uri,
      this.configService,
    );
  }

  /**
   * Start a generic OpenID Connect Authorization Code + PKCE flow.
   */
  @Get('oidc')
  async oidcAuth(
    @Query('redirect_uri') redirectUri: string,
    @Res() res: Response,
  ) {
    this.assertOidcEnabled();

    if (!isAllowedAuthRedirectUri(redirectUri, this.getAuthRedirectOrigins())) {
      throwHTTPErr({ message: 'Invalid OIDC redirect URI', statusCode: 400 });
    }

    const authorizationRequest =
      await this.oidcService.createAuthorizationRequest(redirectUri);
    this.oidcService.saveTransaction(res, authorizationRequest.transaction);

    return res.redirect(
      HttpStatus.FOUND,
      authorizationRequest.authorizationUrl.href,
    );
  }

  /**
   * Complete and validate the OIDC protocol exchange. Hoppscotch user/session
   * resolution is intentionally added in the following integration phase.
   */
  @Get('oidc/callback')
  @SkipThrottle()
  async oidcAuthCallback(@Request() req: ExpressRequest, @Res() res: Response) {
    if (!this.isOidcEnabled()) {
      this.oidcService.clearTransaction(res);
      throwHTTPErr({ message: AUTH_PROVIDER_NOT_SPECIFIED, statusCode: 404 });
    }

    const transaction = this.oidcService.consumeTransaction(req, res);
    const callbackUrl = new URL(
      this.configService.get<string>('INFRA.OIDC_CALLBACK_URL'),
    );
    callbackUrl.search = new URL(req.originalUrl, callbackUrl).search;

    const identity = await this.oidcService.exchangeAuthorizationCode(
      callbackUrl,
      transaction,
    );
    const user = await this.authService.resolveOidcUser(identity);
    const authTokens = await this.authService.generateAuthTokens(user.uid);
    if (E.isLeft(authTokens)) throwHTTPErr(authTokens.left);

    return authCookieHandler(
      res,
      authTokens.right,
      true,
      transaction.redirectUri,
      this.configService,
    );
  }

  /**
   ** Log user out by clearing cookies containing auth tokens
   */
  @Get('logout')
  async logout(@Res() res: Response) {
    res.clearCookie('access_token');
    res.clearCookie('refresh_token');
    return res.status(200).send();
  }

  @Get('verify/admin')
  @UseGuards(JwtAuthGuard)
  async verifyAdmin(@GqlUser() user: AuthUser) {
    const userInfo = await this.authService.verifyAdmin(user);
    if (E.isLeft(userInfo)) throwHTTPErr(userInfo.left);
    return userInfo.right;
  }

  @Get('desktop')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(UserLastLoginInterceptor)
  async desktopAuthCallback(
    @GqlUser() user: AuthUser,
    @Query('redirect_uri') redirectUri: string,
  ) {
    if (!isValidLocalhostRedirectUri(redirectUri)) {
      throwHTTPErr({
        message: 'Invalid desktop callback URL',
        statusCode: 400,
      });
    }

    const tokens = await this.authService.generateAuthTokens(user.uid);
    if (E.isLeft(tokens)) throwHTTPErr(tokens.left);

    return tokens.right;
  }

  @Get('verify-token')
  @UseGuards(JwtAuthGuard)
  async verifyToken(@GqlUser() user: AuthUser) {
    return {
      isValid: true,
      uid: user.uid,
      message: 'Token is valid',
    };
  }

  private isOidcEnabled(): boolean {
    return authProviderCheck(
      AuthProvider.OIDC,
      this.configService.get('INFRA.VITE_ALLOWED_AUTH_PROVIDERS'),
    );
  }

  private assertOidcEnabled(): void {
    if (!this.isOidcEnabled()) {
      throwHTTPErr({ message: AUTH_PROVIDER_NOT_SPECIFIED, statusCode: 404 });
    }
  }

  private getAuthRedirectOrigins(): string[] {
    const whitelistedOrigins =
      this.configService.get<string>('WHITELISTED_ORIGINS')?.split(',') ?? [];

    return [
      ...whitelistedOrigins,
      this.configService.get<string>('VITE_BASE_URL'),
      this.configService.get<string>('VITE_ADMIN_URL'),
    ];
  }
}
