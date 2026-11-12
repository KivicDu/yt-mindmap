// Set theme before first paint so there is no flash of the wrong palette.
;(function () {
  try {
    var stored = localStorage.getItem('ytmm:theme')
    document.documentElement.dataset.theme = stored === 'dark' ? 'dark' : 'light'
  } catch {
    document.documentElement.dataset.theme = 'light'
  }
})()
