// Applies the saved or system theme before first paint, so the page never flashes the wrong one.
// A separate file (not inline in index.html) so the Content-Security-Policy can be script-src 'self'.
;(function () {
  var theme = 'system'
  try {
    theme = localStorage.getItem('fpts-theme') || 'system'
  } catch (e) {
    // Storage blocked: follow the system.
  }
  var dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
})()
