import {
  isAllowedAuthRedirectUri,
  isValidLocalhostRedirectUri,
} from './redirect-uri.validator';

describe('isValidLocalhostRedirectUri', () => {
  describe('valid loopback URIs', () => {
    test('Should return true for http://localhost with a port', () => {
      expect(
        isValidLocalhostRedirectUri('http://localhost:3000/device-token'),
      ).toBe(true);
    });

    test('Should return true for http://localhost without a port', () => {
      expect(isValidLocalhostRedirectUri('http://localhost/callback')).toBe(
        true,
      );
    });

    test('Should return true for http://127.0.0.1 with a port', () => {
      expect(
        isValidLocalhostRedirectUri('http://127.0.0.1:8080/callback'),
      ).toBe(true);
    });

    test('Should return true for http://[::1] IPv6 loopback', () => {
      expect(isValidLocalhostRedirectUri('http://[::1]:9090/callback')).toBe(
        true,
      );
    });
  });

  describe('DNS wildcard bypass vectors', () => {
    test('Should reject localhost subdomain via sslip.io wildcard DNS', () => {
      expect(
        isValidLocalhostRedirectUri(
          'http://localhost.1.2.3.4.sslip.io:3000/steal',
        ),
      ).toBe(false);
    });

    test('Should reject localhost subdomain via nip.io wildcard DNS', () => {
      expect(
        isValidLocalhostRedirectUri('http://localhost.10.0.0.1.nip.io/steal'),
      ).toBe(false);
    });

    test('Should reject localhost as a subdomain of attacker domain', () => {
      expect(
        isValidLocalhostRedirectUri('http://localhost.evil.com/steal'),
      ).toBe(false);
    });

    test('Should reject localhost with trailing dot FQDN trick', () => {
      expect(isValidLocalhostRedirectUri('http://localhost./callback')).toBe(
        false,
      );
    });

    test('Should reject domain that starts with localhost string', () => {
      expect(
        isValidLocalhostRedirectUri('http://localhostevil.com/callback'),
      ).toBe(false);
    });
  });

  describe('protocol enforcement', () => {
    test('Should reject https since loopback listeners do not serve TLS', () => {
      expect(
        isValidLocalhostRedirectUri('https://localhost:3000/callback'),
      ).toBe(false);
    });

    test('Should reject ftp protocol', () => {
      expect(isValidLocalhostRedirectUri('ftp://localhost/callback')).toBe(
        false,
      );
    });
  });

  describe('credential and remote host rejection', () => {
    test('Should reject URL with embedded credentials', () => {
      expect(
        isValidLocalhostRedirectUri('http://user:pass@localhost:3000/callback'),
      ).toBe(false);
    });

    test('Should reject an arbitrary remote host', () => {
      expect(
        isValidLocalhostRedirectUri('http://attacker.com:3000/callback'),
      ).toBe(false);
    });

    test('Should reject 0.0.0.0 since it is not a loopback address', () => {
      expect(isValidLocalhostRedirectUri('http://0.0.0.0:3000/callback')).toBe(
        false,
      );
    });
  });

  describe('malformed and empty input', () => {
    test('Should return false for empty string', () => {
      expect(isValidLocalhostRedirectUri('')).toBe(false);
    });

    test('Should return false for undefined', () => {
      expect(isValidLocalhostRedirectUri(undefined)).toBe(false);
    });

    test('Should return false for null', () => {
      expect(isValidLocalhostRedirectUri(null)).toBe(false);
    });

    test('Should return false for a plain string that is not a URL', () => {
      expect(isValidLocalhostRedirectUri('not-a-url')).toBe(false);
    });

    test('Should return false for a relative path', () => {
      expect(isValidLocalhostRedirectUri('/device-token')).toBe(false);
    });
  });
});

describe('isAllowedAuthRedirectUri', () => {
  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3100/',
    'https://hoppscotch.example.com',
  ];

  test('accepts app and admin URLs from configured origins', () => {
    expect(
      isAllowedAuthRedirectUri('http://localhost:3000', allowedOrigins),
    ).toBe(true);
    expect(
      isAllowedAuthRedirectUri(
        'http://localhost:3100/admin?from=oidc',
        allowedOrigins,
      ),
    ).toBe(true);
  });

  test('rejects an external redirect URI', () => {
    expect(
      isAllowedAuthRedirectUri(
        'https://attacker.example.com/steal',
        allowedOrigins,
      ),
    ).toBe(false);
  });

  test('rejects suffix and credential-based origin bypasses', () => {
    expect(
      isAllowedAuthRedirectUri(
        'http://localhost:3000.attacker.example.com',
        allowedOrigins,
      ),
    ).toBe(false);
    expect(
      isAllowedAuthRedirectUri(
        'http://localhost:3000@attacker.example.com',
        allowedOrigins,
      ),
    ).toBe(false);
  });

  test('rejects malformed, non-HTTP, and absent URLs', () => {
    expect(isAllowedAuthRedirectUri('not-a-url', allowedOrigins)).toBe(false);
    expect(
      isAllowedAuthRedirectUri('javascript:alert(1)', allowedOrigins),
    ).toBe(false);
    expect(isAllowedAuthRedirectUri(undefined, allowedOrigins)).toBe(false);
  });

  test('ignores malformed configured origins', () => {
    expect(
      isAllowedAuthRedirectUri('https://hoppscotch.example.com', [
        '',
        'not-a-url',
      ]),
    ).toBe(false);
  });
});
