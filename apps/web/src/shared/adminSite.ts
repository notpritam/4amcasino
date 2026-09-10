export const ADMIN_HOST = 'admin.4amcasino.com';
export const isAdminSite = () => window.location.hostname === ADMIN_HOST;

/** Only allow local admin destinations after sign-in, never an arbitrary URL. */
export function adminDestination(search = window.location.search): string {
  const next = new URLSearchParams(search).get('next');
  if (isAdminSite()) {
    return next && /^\/(?:settings|revenue|rooms|users|requests)?$/.test(next) ? next : '/';
  }
  return next && /^\/admin(?:\/(?:settings|revenue|rooms|users|requests))?$/.test(next)
    ? next
    : '/admin';
}
