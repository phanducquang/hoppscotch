// Only true loopback addresses are safe for native app redirects
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

export function isValidLocalhostRedirectUri(
  uri: string | undefined | null,
): boolean {
  if (!uri) return false;

  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }

  // no https — desktop loopback listeners don't serve TLS
  if (url.protocol !== 'http:') return false;

  // block credential-stuffed URIs like http://user:pass@localhost
  if (url.username || url.password) return false;

  // exact match only
  return LOOPBACK_HOSTS.indexOf(url.hostname) !== -1;
}

/**
 * Validate a browser authentication redirect against configured web origins.
 * Paths, queries, and fragments are allowed only after the URL's origin has
 * matched an explicitly configured HTTP(S) origin.
 */
export function isAllowedAuthRedirectUri(
  uri: string | undefined | null,
  allowedOrigins: Array<string | undefined | null>,
): boolean {
  if (!uri) return false;

  let redirectUrl: URL;
  try {
    redirectUrl = new URL(uri);
  } catch {
    return false;
  }

  if (
    !['http:', 'https:'].includes(redirectUrl.protocol) ||
    redirectUrl.username ||
    redirectUrl.password
  ) {
    return false;
  }

  return allowedOrigins.some((configuredOrigin) => {
    if (!configuredOrigin?.trim()) return false;

    try {
      const allowedUrl = new URL(configuredOrigin.trim());
      return (
        ['http:', 'https:'].includes(allowedUrl.protocol) &&
        !allowedUrl.username &&
        !allowedUrl.password &&
        redirectUrl.origin === allowedUrl.origin
      );
    } catch {
      return false;
    }
  });
}
