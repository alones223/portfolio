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

  // ---- Works grid: pack cells, then open a project in place --------------
  // A block that does not fit the remaining columns moves to the next row.
  // Later blocks do not jump back into the gap it left.
  var worksGrid = document.querySelector('.works-cells');
  if (worksGrid) {
    function worksColumns() {
      var n = parseInt(getComputedStyle(worksGrid).getPropertyValue('--works-cols'), 10);
      return n === 1 || n === 2 ? n : 3;
    }
    function cellSpan(el, cols) {
      var match = /^([1-3])x([1-3])$/.exec(el.getAttribute('data-size') || '');
      var w = match ? Number(match[1]) : 1;
      var h = match ? Number(match[2]) : 1;
      if (w > cols) w = cols;
      return { w: w, h: h };
    }
    function packWorks() {
      var cols = worksColumns();
      var cells = Array.prototype.slice.call(worksGrid.querySelectorAll('.works-cell'));
      var visible = cells.filter(function (el) { return !el.hidden; });
      cells.forEach(function (el) {
        if (el.hidden) {
          el.style.gridColumn = '';
          el.style.gridRow = '';
        }
      });
      var occ = [];
      function taken(r, c) { return occ[r] && occ[r][c]; }
      function fits(r, c, w, h) {
        if (c + w > cols) return false;
        for (var rr = r; rr < r + h; rr++) {
          for (var cc = c; cc < c + w; cc++) if (taken(rr, cc)) return false;
        }
        return true;
      }
      function mark(r, c, w, h) {
        for (var rr = r; rr < r + h; rr++) {
          occ[rr] = occ[rr] || [];
          for (var cc = c; cc < c + w; cc++) occ[rr][cc] = 1;
        }
      }
      var row = 0;
      var col = 0;
      visible.forEach(function (el) {
        var span = cellSpan(el, cols);
        var guard = 0;
        while (guard < 400) {
          while (taken(row, col)) {
            col += 1;
            if (col >= cols) { col = 0; row += 1; }
          }
          if (fits(row, col, span.w, span.h)) break;
          row += 1;
          col = 0;
          guard += 1;
        }
        el.style.gridColumn = (col + 1) + ' / span ' + span.w;
        el.style.gridRow = (row + 1) + ' / span ' + span.h;
        mark(row, col, span.w, span.h);
        col += span.w;
        if (col >= cols) { col = 0; row += 1; }
      });
      var reading = visible.map(function (el) {
        return {
          el: el,
          row: parseInt(el.style.gridRow, 10) || 0,
          col: parseInt(el.style.gridColumn, 10) || 0,
        };
      }).sort(function (a, b) { return a.row - b.row || a.col - b.col; });
      reading.forEach(function (item, i) {
        var num = String(i + 1).padStart(2, '0');
        var node = item.el.querySelector('.works-num');
        if (node) node.textContent = num;
        var opener = item.el.querySelector('.works-open');
        if (opener) opener.dataset.num = num;
        var index = item.el.getAttribute('data-work-index');
        var feature = document.querySelector('.works-feature[data-work-index="' + index + '"]');
        if (feature) feature.dataset.num = num;
      });
    }
    var packQueued = false;
    function schedulePack() {
      if (packQueued) return;
      packQueued = true;
      requestAnimationFrame(function () {
        packQueued = false;
        packWorks();
      });
    }
    packWorks();
    window.addEventListener('resize', schedulePack);

    var selectedTags = [];
    var tagRow = document.querySelector('.works-tags');
    function cellTags(el) {
      try {
        var tags = JSON.parse(el.getAttribute('data-tags') || '[]');
        return Array.isArray(tags) ? tags : [];
      } catch (err) {
        return [];
      }
    }
    function applyTagFilter() {
      var worksSlot = worksGrid.closest('.works-slot');
      var all = selectedTags.length === 0;
      if (worksSlot) worksSlot.dataset.filter = all ? 'all' : 'tags';
      if (tagRow) {
        tagRow.querySelectorAll('.works-tag').forEach(function (btn) {
          var tag = btn.getAttribute('data-tag') || '';
          var on = all ? tag === '' : selectedTags.indexOf(tag) >= 0;
          btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
      }
      worksGrid.querySelectorAll('.works-cell').forEach(function (el) {
        if (all) {
          el.hidden = false;
          return;
        }
        var tags = cellTags(el);
        el.hidden = !selectedTags.some(function (tag) { return tags.indexOf(tag) >= 0; });
      });
      packWorks();
    }
    if (tagRow) {
      tagRow.addEventListener('click', function (e) {
        var btn = e.target.closest('.works-tag');
        if (!btn || !tagRow.contains(btn)) return;
        var tag = btn.getAttribute('data-tag') || '';
        if (!tag) selectedTags = [];
        else if (selectedTags.indexOf(tag) >= 0) selectedTags = selectedTags.filter(function (item) { return item !== tag; });
        else selectedTags = selectedTags.concat(tag);
        applyTagFilter();
      });
    }

    var popup = document.querySelector('.work-popup');
    if (popup) {
      var cover = popup.querySelector('.work-popup-cover');
      var numEl = popup.querySelector('.work-popup-num');
      var metaEl = popup.querySelector('.work-popup-meta');
      var titleEl = popup.querySelector('.work-popup-title');
      var introEl = popup.querySelector('.work-popup-intro');
      var tagsEl = popup.querySelector('.work-popup-tags');
      var scrollY = 0;
      var locked = false;
      function showLine(el, text) {
        el.hidden = !text;
        el.textContent = text || '';
      }
      function lockScroll() {
        scrollY = window.scrollY;
        document.body.classList.add('work-open');
        document.body.style.top = (-scrollY) + 'px';
        locked = true;
      }
      function unlockScroll() {
        if (!locked) return;
        locked = false;
        document.body.classList.remove('work-open');
        document.body.style.top = '';
        window.scrollTo(0, scrollY);
      }
      function showTags(raw) {
        var tags = [];
        try { tags = JSON.parse(raw || '[]'); } catch (err) { tags = []; }
        if (!Array.isArray(tags)) tags = [];
        tagsEl.replaceChildren.apply(tagsEl, tags.map(function (tag) {
          var li = document.createElement('li');
          li.textContent = tag;
          return li;
        }));
        tagsEl.hidden = tags.length === 0;
      }
      function openWork(btn) {
        var bits = [btn.dataset.category, btn.dataset.year].filter(Boolean);
        titleEl.textContent = btn.dataset.title || '';
        showLine(numEl, btn.dataset.num || '');
        showLine(metaEl, bits.join(' · '));
        showLine(introEl, btn.dataset.intro || '');
        showTags(btn.dataset.tags);
        if (btn.dataset.image) {
          cover.hidden = false;
          cover.src = btn.dataset.image;
          cover.alt = btn.dataset.title || '';
        } else {
          cover.hidden = true;
          cover.removeAttribute('src');
        }
        lockScroll();
        popup.showModal();
      }
      function closeWork() {
        if (popup.open) popup.close();
      }
      var worksSlot = worksGrid.closest('.works-slot') || worksGrid;
      worksSlot.addEventListener('click', function (e) {
        var btn = e.target.closest('.works-open, .works-feature');
        if (!btn || !worksSlot.contains(btn)) return;
        openWork(btn);
      });
      popup.querySelector('.work-popup-close').addEventListener('click', closeWork);
      popup.addEventListener('click', function (e) { if (e.target === popup) closeWork(); });
      popup.addEventListener('close', unlockScroll);
    }
  }
})();
