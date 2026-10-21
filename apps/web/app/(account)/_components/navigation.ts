/** Only the server's local OAuth authorization route is an accepted login return. */
export function safeAuthorizationReturn(
  value: string | null,
  origin: string,
): string | null {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\r\n]/.test(value)
  )
    return null;
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || url.pathname !== "/authorize") return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}
