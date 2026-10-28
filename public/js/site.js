(function () {
  'use strict';

  // ---- Mobile navigation + one-page section tabs -------------------------
  var toggle = document.querySelector('.nav-toggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      var open = document.body.classList.toggle('nav-open');
      toggle.setAttribute('aria-expanded', String(open));
    });
  }

  var navLinks = Array.prototype.slice.call(document.querySelectorAll('.site-nav a[href*="#"]'));
  var anchors = navLinks.map(function (link) {
    var hash = (link.getAttribute('href') || '').split('#')[1];
    return { link: link, el: hash ? document.getElementById(hash) : null };
  }).filter(function (item) { return item.el; });

  function closeNav() {
    document.body.classList.remove('nav-open');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }
  navLinks.forEach(function (link) {
    link.addEventListener('click', closeNav);
  });

  // Browsers with scroll-target-group paint the current tab in CSS.
  // Everyone else gets the same underline from the scroll position.
  var cssSpy = window.CSS && CSS.supports && CSS.supports('selector(:target-current)');
  if (anchors.length) {
    var currentId = '';
    var ticking = false;
    function setActive(id) {
      if (!id || id === currentId) return;
      currentId = id;
      anchors.forEach(function (item) {
        var on = item.el.id === id;
        if (!cssSpy) item.link.classList.toggle('active', on);
        if (on) item.link.setAttribute('aria-current', 'location');
        else item.link.removeAttribute('aria-current');
      });
    }
    function sectionAtHeader() {
      var header = document.querySelector('.site-header');
      var line = (header ? header.offsetHeight : 112) + 160;
      var id = anchors[0].el.id;
      anchors.forEach(function (item) {
        if (item.el.getBoundingClientRect().top <= line) id = item.el.id;
      });
      setActive(id);
    }
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        ticking = false;
        sectionAtHeader();
      });
    }, { passive: true });
    sectionAtHeader();
  }

  // ---- Reveal-on-scroll animation ---------------------------------------
  var revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('in-view');
          io.unobserve(e.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px' });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('in-view'); });
  }

  // ---- Layout canvases ---------------------------------------------------
  // Each canvas section is laid out on a 1425px-wide board. Scale that board
  // to the width we actually have, so the arrangement stays identical.
  var canvases = document.querySelectorAll('.content-section.layout-canvas');

  // Matches the reflow breakpoints in public/css/canvas.css. Unlocked boards
  // stack below 900px. Locked boards keep scaling until 768px, then stack too,
  // so body text is not shrunk with the whole canvas.
  var STACKED = window.matchMedia && window.matchMedia('(max-width: 900px)');
  var PHONE = window.matchMedia && window.matchMedia('(max-width: 768px)');

  function fitCanvases() {
    var stacked = STACKED && STACKED.matches;
    var phone = PHONE && PHONE.matches;
    Array.prototype.forEach.call(canvases, function (section) {
      var board = section.querySelector('.canvas-board');
      if (!board) return;
      var lock = section.classList.contains('canvas-lock');
      if (phone || (stacked && !lock)) {
        section.classList.remove('is-scaled');
        section.classList.remove('is-centered');
        section.style.removeProperty('--canvas-scale');
        return;
      }
      var style = window.getComputedStyle(section);
      var boardWidth = parseFloat(style.getPropertyValue('--canvas-w')) || 1425;
      var screenMode = section.getAttribute('data-canvas-width') === 'screen';
      // Screen-locked boards always fill the section width. Other boards still
      // shrink to fit, and may letterbox when locked and the screen is wider.
      var scale = boardWidth > 0 ? (section.clientWidth / boardWidth) : 1;
      if (!screenMode) scale = Math.min(1, scale);
      section.style.setProperty('--canvas-scale', String(scale));
      section.classList.add('is-scaled');
      section.classList.toggle('is-centered', !screenMode && lock && scale > 0.999);
    });
  }

  if (canvases.length) {
    fitCanvases();
    var fitTimer = null;
    window.addEventListener('resize', function () {
      clearTimeout(fitTimer);
      fitTimer = setTimeout(fitCanvases, 120);
    });
    [STACKED, PHONE].forEach(function (mq) {
      if (!mq) return;
      var onBreakpoint = function () { fitCanvases(); };
      if (mq.addEventListener) mq.addEventListener('change', onBreakpoint);
      else if (mq.addListener) mq.addListener(onBreakpoint);
    });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitCanvases);
  }

  // Canvas boards change height after fonts and images load. A hash link
  // scrolled too early lands on the previous section, so correct it once
  // the page has settled and again when a tab is clicked.
  function syncHeaderOffset() {
    var header = document.querySelector('.site-header');
    if (header) document.documentElement.style.scrollPaddingTop = header.offsetHeight + 'px';
  }
  function scrollToHash() {
    var id = decodeURIComponent((location.hash || '').replace(/^#/, ''));
    var el = id && document.getElementById(id);
    if (!el) return;
    syncHeaderOffset();
    el.scrollIntoView({ block: 'start' });
  }
  syncHeaderOffset();
  window.addEventListener('hashchange', scrollToHash);
  window.addEventListener('resize', syncHeaderOffset);
  window.addEventListener('load', function () {
    fitCanvases();
    scrollToHash();
  });

  // Layer animations: play once when the layer scrolls into view.
  var animatedLayers = document.querySelectorAll('.canvas-anim.is-animated[data-anim]');
  if (animatedLayers.length) {
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    Array.prototype.forEach.call(animatedLayers, function (layer) {
      var name = layer.getAttribute('data-anim');
      if (name !== 'float' && name !== 'pulse') {
        layer.style.setProperty('--anim-duration', (parseFloat(layer.getAttribute('data-anim-duration')) || 0.9) + 's');
      }
      layer.style.setProperty('--anim-delay', (parseFloat(layer.getAttribute('data-anim-delay')) || 0) + 's');
    });
    if (reduceMotion || !('IntersectionObserver' in window)) {
      Array.prototype.forEach.call(animatedLayers, function (layer) {
        layer.classList.add('anim-in');
        layer.style.opacity = '1';
      });
    } else {
      var animIo = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          e.target.classList.add('anim-in');
          animIo.unobserve(e.target);
        });
      }, { rootMargin: '0px 0px -6% 0px' });
      Array.prototype.forEach.call(animatedLayers, function (layer) { animIo.observe(layer); });
    }
  }

  // ---- Lightbox for gallery / showcase images ---------------------------
  var lb = document.querySelector('.lightbox');
  if (lb) {
    var lbImg = lb.querySelector('img');
    var lbCap = lb.querySelector('figcaption');
    var group = [];
    var index = 0;
    var lastFocus = null;

    function render() {
      var btn = group[index];
      lbImg.src = btn.dataset.full;
      lbImg.alt = btn.dataset.caption || '';
      lbCap.textContent = '';
      if (btn.dataset.caption) {
        btn.dataset.caption.split('\n').forEach(function (line, i) {
          if (i) lbCap.appendChild(document.createElement('br'));
          lbCap.appendChild(document.createTextNode(line));
        });
      }
      if (btn.dataset.link) {
        var a = document.createElement('a');
        a.href = btn.dataset.link;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = 'Go to link ↗';
        lbCap.appendChild(document.createElement('br'));
        lbCap.appendChild(a);
      }
      lb.classList.toggle('single', group.length < 2);
    }

    function open(btn) {
      var list = btn.closest('.items') || btn.closest('.layer-gallery');
      group = Array.prototype.slice.call((list || document).querySelectorAll('.zoom'));
      index = Math.max(0, group.indexOf(btn));
      lastFocus = btn;
      render();
      lb.hidden = false;
      document.body.classList.add('lb-open');
      lb.querySelector('.lb-close').focus();
    }

    function close() {
      lb.hidden = true;
      lbImg.removeAttribute('src');
      document.body.classList.remove('lb-open');
      if (lastFocus) lastFocus.focus();
    }

    function step(d) {
      index = (index + d + group.length) % group.length;
      render();
    }

    document.addEventListener('click', function (e) {
      var btn = e.target.closest('.zoom');
      if (btn && btn.dataset.link && btn.dataset.link.charAt(0) === '/') {
        window.location.href = btn.dataset.link;
        return;
      }
      if (btn) open(btn);
    });
    lb.querySelector('.lb-close').addEventListener('click', close);
    lb.querySelector('.lb-prev').addEventListener('click', function () { step(-1); });
    lb.querySelector('.lb-next').addEventListener('click', function () { step(1); });
    lb.addEventListener('click', function (e) { if (e.target === lb) close(); });
    document.addEventListener('keydown', function (e) {
      if (lb.hidden) return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'ArrowRight') step(1);
    });
  }

  // ---- Contact form -------------------------------------------------------
  var form = document.querySelector('.contact-form');
  if (form) {
    var status = form.querySelector('.form-status');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      status.className = 'form-status';
      var data = Object.fromEntries(new FormData(form).entries());
      var missing = ['name', 'email', 'subject', 'message'].filter(function (k) { return !String(data[k] || '').trim(); });
      if (missing.length) {
        status.textContent = 'Please fill in every required field.';
        status.classList.add('error');
        form.elements[missing[0]].focus();
        return;
      }
      var button = form.querySelector('button[type=submit]');
      button.disabled = true;
      fetch('/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
        .then(function (res) {
          if (!res.ok) throw new Error(res.body.error || 'Error');
          form.reset();
          status.textContent = status.dataset.success;
          status.classList.add('ok');
        })
        .catch(function (err) {
          status.textContent = err.message || 'Something went wrong. Please try again.';
          status.classList.add('error');
        })
        .finally(function () { button.disabled = false; });
    });
  }
})();
