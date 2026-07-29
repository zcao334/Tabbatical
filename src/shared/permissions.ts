/**
 * Host-permission helpers.
 *
 * These live in shared/ rather than background/ because the *request* has to
 * come from a user gesture, which only exists in the side panel, while the
 * *check* is used by background extraction.
 */

/** Only http(s) pages can be scripted; everything else is off-limits to extensions. */
export function isInjectableUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function originPatternFor(url: string): string | null {
  try {
    return `${new URL(url).origin}/*`;
  } catch {
    return null;
  }
}

export async function hasHostPermission(url: string): Promise<boolean> {
  const origin = originPatternFor(url);
  if (!origin) return false;
  return chrome.permissions.contains({ origins: [origin] });
}

/**
 * Must be called synchronously from a user gesture — awaiting anything first
 * (including a hasHostPermission check) can invalidate the gesture and make
 * Chrome reject the request outright.
 *
 * Safe to call unconditionally: when access is already granted it resolves
 * true without prompting, which is why callers don't need to pre-check.
 */
export async function requestHostPermission(url: string): Promise<boolean> {
  const origin = originPatternFor(url);
  if (!origin) return false;
  return chrome.permissions.request({ origins: [origin] });
}
