(function () {
  var root = document.documentElement;
  var progressBar = document.getElementById('progressBar');
  var themeButton = document.getElementById('themeToggle');
  var menuButton = document.getElementById('menuToggle');
  var sidebar = document.getElementById('tocShell');
  var overlay = document.getElementById('sidebarOverlay');
  var backToTop = document.getElementById('backToTop');
  var tocLinks = Array.from(document.querySelectorAll('[data-toc]'));
  var targets = tocLinks.map(function (link) { return document.getElementById(link.dataset.toc); }).filter(Boolean);
  var storageKey = 'big-group-answer-theme';
  var storedTheme = null;
  try { storedTheme = localStorage.getItem(storageKey); } catch (error) {}
  if (storedTheme) root.dataset.theme = storedTheme;

  themeButton.addEventListener('click', function () {
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(storageKey, root.dataset.theme); } catch (error) {}
  });

  function closeMenu() {
    sidebar.classList.remove('open');
    overlay.classList.remove('visible');
    menuButton.setAttribute('aria-expanded', 'false');
  }
  menuButton.addEventListener('click', function () {
    var willOpen = !sidebar.classList.contains('open');
    sidebar.classList.toggle('open', willOpen);
    overlay.classList.toggle('visible', willOpen);
    menuButton.setAttribute('aria-expanded', String(willOpen));
  });
  overlay.addEventListener('click', closeMenu);
  tocLinks.forEach(function (link) { link.addEventListener('click', closeMenu); });
  document.addEventListener('keydown', function (event) { if (event.key === 'Escape') closeMenu(); });

  document.querySelectorAll('.copy-button').forEach(function (button) {
    button.addEventListener('click', function () {
      var code = button.closest('.code-card').querySelector('code').textContent;
      navigator.clipboard.writeText(code).then(function () {
        button.textContent = '已复制';
        setTimeout(function () { button.textContent = '复制'; }, 1200);
      });
    });
  });

  function updateScroll() {
    var max = document.documentElement.scrollHeight - window.innerHeight;
    var ratio = max > 0 ? window.scrollY / max : 0;
    progressBar.style.width = Math.min(100, Math.max(0, ratio * 100)) + '%';
    backToTop.classList.toggle('visible', window.scrollY > 700);
    var activeId = targets.length ? targets[0].id : '';
    targets.forEach(function (target) { if (target.getBoundingClientRect().top <= 210) activeId = target.id; });
    tocLinks.forEach(function (link) { link.classList.toggle('active', link.dataset.toc === activeId); });
  }
  updateScroll();
  window.addEventListener('scroll', updateScroll, { passive: true });
  window.addEventListener('load', updateScroll, { once: true });
  window.addEventListener('resize', function () {
    if (!window.matchMedia('(max-width: 940px)').matches) closeMenu();
  }, { passive: true });
  backToTop.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
})();
