// Run before styles and React, including under the production script-src 'self' CSP.
// Keep this storage key/event aligned with @zeus/ui/application.
(() => {
  const root = document.documentElement;
  const syncChrome = () => {
    const dark = root.classList.contains('dark');
    root.style.colorScheme = dark ? 'dark' : 'light';
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', dark ? '#262626' : '#ffffff');
  };
  const apply = (value) => {
    root.classList.toggle('dark', value === 'dark');
    syncChrome();
  };
  root.classList.add('zeus');
  let saved = 'light';
  try {
    saved = localStorage.getItem('zeus:theme');
  } catch {
    /* Storage may be disabled. */
  }
  apply(saved);
  window.addEventListener('zeus:theme-change', syncChrome);
  window.addEventListener('storage', (event) => {
    if (event.key === 'zeus:theme' || event.key === null) {
      apply(event.newValue);
      // Also notify mounted controls when another tab clears storage entirely.
      window.dispatchEvent(new CustomEvent('zeus:theme-change'));
    }
  });
})();
