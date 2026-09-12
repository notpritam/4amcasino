/** Only in-app destinations that are safe to retain across sign-in. */
export function authDestination(search: string): string | null {
  const value = new URLSearchParams(search).get('next');
  return value && /^\/(?:tournaments(?:\/[a-zA-Z0-9_-]+)?|agents)$/.test(value) ? value : null;
}
