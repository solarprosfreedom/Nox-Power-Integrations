function firstForwardedValue(value: string | null): string {
  return value?.split(",", 1)[0]?.trim() ?? "";
}

export function requestIsSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    const requestUrl = new URL(request.url);
    const host =
      firstForwardedValue(request.headers.get("x-forwarded-host")) ||
      request.headers.get("host") ||
      requestUrl.host;
    const protocol =
      firstForwardedValue(request.headers.get("x-forwarded-proto")) ||
      requestUrl.protocol.slice(0, -1);
    const originUrl = new URL(origin);
    return originUrl.host === host && originUrl.protocol === `${protocol}:`;
  } catch {
    return false;
  }
}
