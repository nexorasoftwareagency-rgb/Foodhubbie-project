/* Shared top-nav behaviour: active link, mobile drawer, "More" menu. */
(function () {
  var nav = document.querySelector('header nav');
  if (!nav) return;

  var links = nav.querySelector('.links');
  var toggle = nav.querySelector('.nav-toggle');
  var more = nav.querySelector('.nav-more');
  var moreBtn = nav.querySelector('.nav-more-btn');

  var norm = function (p) {
    p = (p || '').split('#')[0].split('?')[0].replace(/\/+$/, '');
    p = p.split('/').pop().replace(/\.html$/, '');
    return p || 'index';
  };
  var here = norm(location.pathname);
  var activeInMenu = false;
  nav.querySelectorAll('a.link').forEach(function (a) {
    var href = norm(a.getAttribute('href'));
    if (href && href === here) {
      a.classList.add('active');
      a.setAttribute('aria-current', 'page');
      if (more && more.querySelector('.nav-more-menu').contains(a)) activeInMenu = true;
    }
  });
  if (activeInMenu && moreBtn) moreBtn.classList.add('active');

  function closeMore() {
    if (!more) return;
    more.classList.remove('open');
    if (moreBtn) moreBtn.setAttribute('aria-expanded', 'false');
  }
  function closeAll() {
    if (links) links.classList.remove('open');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
    closeMore();
  }

  if (toggle && links) {
    toggle.addEventListener('click', function () {
      var open = links.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      if (!open) closeMore();
    });
  }

  if (moreBtn && more) {
    moreBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = more.classList.toggle('open');
      moreBtn.setAttribute('aria-expanded', String(open));
    });
  }

  document.addEventListener('click', function (e) {
    if (!nav.contains(e.target)) closeAll();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeAll();
  });
  nav.querySelectorAll('.links a').forEach(function (a) {
    a.addEventListener('click', closeAll);
  });
})();
