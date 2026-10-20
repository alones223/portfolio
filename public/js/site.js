(function () {
  'use strict';

  // ---- Mobile navigation -------------------------------------------------
  var toggle = document.querySelector('.nav-toggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      var open = document.body.classList.toggle('nav-open');
      toggle.setAttribute('aria-expanded', String(open));
    });
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

  // Matches the reflow breakpoint in public/css/canvas.css: below it the layers
  // stack in a single column, so no scaling is applied.
  var STACKED = window.matchMedia && window.matchMedia('(max-width: 900px)');

  function fitCanvases() {
    var stacked = STACKED && STACKED.matches;
    Array.prototype.forEach.call(canvases, function (section) {
      var board = section.querySelector('.canvas-board');
      if (!board) return;
      var lock = section.classList.contains('canvas-lock');
      if (stacked && !lock) {
        section.classList.remove('is-scaled');
        section.classList.remove('is-centered');
        section.style.removeProperty('--canvas-scale');
        return;
      }
      var style = window.getComputedStyle(section);
      var boardWidth = parseFloat(style.getPropertyValue('--canvas-w')) || 1425;
      var scale = Math.min(1, section.clientWidth / boardWidth);
      section.style.setProperty('--canvas-scale', String(scale));
      section.classList.add('is-scaled');
      // Wider than the board: keep the designed size and centre it. The
      // section background (the hero water, for example) still fills the page.
      section.classList.toggle('is-centered', lock && scale > 0.999);
    });
  }

  if (canvases.length) {
    fitCanvases();
    var fitTimer = null;
    window.addEventListener('resize', function () {
      clearTimeout(fitTimer);
      fitTimer = setTimeout(fitCanvases, 120);
    });
    if (STACKED) {
      var onBreakpoint = function () { fitCanvases(); };
      if (STACKED.addEventListener) STACKED.addEventListener('change', onBreakpoint);
      else if (STACKED.addListener) STACKED.addListener(onBreakpoint);
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitCanvases);
  }

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
