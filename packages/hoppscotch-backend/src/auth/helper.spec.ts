import { AuthProvider, authProviderCheck } from './helper';
import { getAuthProviderRequiredKeys } from 'src/infra-config/helper';
import { InfraConfigEnum } from 'src/types/InfraConfig';

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
