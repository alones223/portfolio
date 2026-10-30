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
  var workScroll = { y: 0, locked: false };
  var popupListenersBound = false;
  document.querySelectorAll('.works-cells').forEach(function (worksGrid) {
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
        var feature = (worksGrid.closest('.works-slot') || document).querySelector('.works-feature[data-work-index="' + index + '"]');
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
    var worksSlotForTags = worksGrid.closest('.works-slot') || worksGrid;
    var tagRow = worksSlotForTags.querySelector('.works-tags');
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
      var copyEl = popup.querySelector('.work-case-copy');
      var categoryEl = popup.querySelector('.work-case-category');
      var titleEl = popup.querySelector('.work-case-title');
      var introEl = popup.querySelector('.work-case-intro');
      var tagsEl = popup.querySelector('.work-case-tags');
      var factsEl = popup.querySelector('.work-case-facts');
      var sectionsEl = popup.querySelector('.work-case-sections');
      var piecesEl = popup.querySelector('.work-case-pieces');
      function showLine(el, text) {
        var value = text || '';
        el.hidden = !value;
        el.textContent = value;
      }
      function lockScroll() {
        workScroll.y = window.scrollY;
        document.body.classList.add('work-open');
        document.body.style.top = (-workScroll.y) + 'px';
        workScroll.locked = true;
      }
      function unlockScroll() {
        if (!workScroll.locked) return;
        workScroll.locked = false;
        document.body.classList.remove('work-open');
        document.body.style.top = '';
        window.scrollTo(0, workScroll.y);
      }
      function readCases(btn) {
        var slot = btn && btn.closest ? btn.closest('.works-slot') : null;
        var node = (slot && slot.querySelector('.works-cases-data')) || document.getElementById('works-cases');
        if (!node) return [];
        try {
          var data = JSON.parse(node.textContent || '[]');
          return Array.isArray(data) ? data : [];
        } catch (err) {
          return [];
        }
      }
      function fillTags(tags) {
        var list = Array.isArray(tags) ? tags : [];
        tagsEl.replaceChildren.apply(tagsEl, list.map(function (tag) {
          var li = document.createElement('li');
          li.textContent = tag;
          return li;
        }));
        tagsEl.hidden = list.length === 0;
      }
      function fillFacts(data) {
        var rows = [];
        if (data.role) rows.push(['Role', data.role]);
        if (data.year) rows.push(['Year', data.year]);
        if (data.output) rows.push(['Output', data.output]);
        factsEl.replaceChildren.apply(factsEl, rows.map(function (row) {
          var wrap = document.createElement('div');
          var dt = document.createElement('dt');
          var dd = document.createElement('dd');
          dt.textContent = row[0];
          dd.textContent = row[1];
          wrap.append(dt, dd);
          return wrap;
        }));
        factsEl.hidden = rows.length === 0;
      }
      function fillSections(sections) {
        var list = Array.isArray(sections) ? sections : [];
        sectionsEl.replaceChildren.apply(sectionsEl, list.map(function (section) {
          var block = document.createElement('section');
          block.className = 'work-case-section';
          if (section && section.title) {
            var heading = document.createElement('h3');
            heading.textContent = section.title;
            block.append(heading);
          }
          if (section && section.text) {
            var body = document.createElement('p');
            body.textContent = section.text;
            block.append(body);
          }
          return block;
        }));
      }
      function fillPieces(pieces, title) {
        var list = Array.isArray(pieces) ? pieces : [];
        piecesEl.replaceChildren.apply(piecesEl, list.map(function (piece, index) {
          var figure = document.createElement('figure');
          figure.className = 'work-case-piece';
          if (!piece) return figure;
          if (piece.kind === 'youtube' && piece.youtubeId) {
            var frame = document.createElement('iframe');
            frame.src = 'https://www.youtube-nocookie.com/embed/' + piece.youtubeId;
            frame.title = title || 'YouTube';
            frame.allowFullscreen = true;
            frame.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
            figure.append(frame);
          } else if (piece.kind === 'pdf' && piece.src) {
            var pdf = document.createElement('iframe');
            pdf.src = piece.src;
            pdf.title = title || 'PDF';
            figure.append(pdf);
          } else if (piece.src) {
            var img = document.createElement('img');
            img.src = piece.src;
            img.alt = title || '';
            if (index === 0) img.setAttribute('fetchpriority', 'high');
            else img.loading = 'lazy';
            figure.append(img);
          }
          return figure;
        }));
      }
      function openWork(btn) {
        var index = Number(btn.getAttribute('data-work-index'));
        var data = readCases(btn)[index];
        if (!data) return;
        showLine(categoryEl, data.category);
        showLine(titleEl, data.title);
        showLine(introEl, data.intro);
        fillTags(data.tags);
        fillFacts(data);
        fillSections(data.sections);
        fillPieces(data.pieces, data.title || '');
        if (data.title) {
          popup.setAttribute('aria-labelledby', 'work-popup-title');
          popup.removeAttribute('aria-label');
        } else {
          popup.removeAttribute('aria-labelledby');
          popup.setAttribute('aria-label', 'Project');
        }
        popup.scrollTop = 0;
        copyEl.scrollTop = 0;
        piecesEl.scrollTop = 0;
        lockScroll();
        if (!popup.open) popup.showModal();
      }
      function closeWork() {
        if (popup.open) popup.close();
        unlockScroll();
      }
      var worksSlot = worksGrid.closest('.works-slot') || worksGrid;
      worksSlot.addEventListener('click', function (e) {
        var btn = e.target.closest('.works-open, .works-feature');
        if (!btn || !worksSlot.contains(btn)) return;
        openWork(btn);
      });
      if (!popupListenersBound) {
        popupListenersBound = true;
        popup.querySelector('.work-popup-close').addEventListener('click', closeWork);
        // The close button unlocks itself. Escape still closes the dialog natively,
        // including browsers that do not emit the dialog close event.
        popup.addEventListener('keydown', function (e) {
          if (e.key === 'Escape') requestAnimationFrame(unlockScroll);
        });
        popup.addEventListener('close', unlockScroll);
        // Backdrop clicks are retargeted onto the dialog. Only a press and
        // release outside the panel closes it, and that path unlocks scroll
        // itself instead of waiting for the close event.
        var pressedOutside = false;
        function outsidePopup(e) {
          var rect = popup.getBoundingClientRect();
          return e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom;
        }
        popup.addEventListener('pointerdown', function (e) {
          pressedOutside = outsidePopup(e);
        });
        popup.addEventListener('pointerup', function (e) {
          var shouldClose = pressedOutside && outsidePopup(e);
          pressedOutside = false;
          if (!shouldClose || !popup.open) return;
          closeWork();
        });
      }
    }
  });

  // Hover shows the back. Play locks that side until the clip ends or pause.
  // The hover target is the outer card, so the flip itself does not flicker.
  var namecard = document.querySelector('.namecard');
  if (namecard) {
    var nameVideo = namecard.querySelector('video');
    var nameFrame = namecard.querySelector('iframe');
    var nameFrameSrc = nameFrame ? (nameFrame.getAttribute('data-src') || '') : '';
    var namePlay = namecard.querySelector('.namecard-play');
    var nameIcon = namecard.querySelector('.namecard-play-icon');
    var nameHolding = false;
    var namePlaying = false;
    function namecardShow(on) {
      namecard.classList.toggle('is-flipped', on);
      var front = namecard.querySelector('.namecard-front');
      var back = namecard.querySelector('.namecard-back');
      if (front) front.inert = on;
      if (back) back.inert = !on;
    }
    function namecardStop() {
      namePlaying = false;
      namecard.classList.remove('is-playing');
      if (namePlay) namePlay.setAttribute('aria-label', 'Play');
      if (nameIcon) nameIcon.textContent = '\u25B6';
      if (nameVideo) {
        nameVideo.pause();
        nameVideo.currentTime = 0;
      }
      if (nameFrame) nameFrame.removeAttribute('src');
    }
    function namecardApply() {
      var back = nameHolding || namePlaying;
      namecardShow(back);
      if (!back) namecardStop();
    }
    function namecardStart() {
      namePlaying = true;
      namecard.classList.add('is-playing');
      if (namePlay) namePlay.setAttribute('aria-label', 'Pause');
      if (nameIcon) nameIcon.textContent = '\u23F8';
      namecardApply();
      if (nameVideo) nameVideo.play().catch(function () {});
      if (nameFrame && nameFrameSrc) {
        var join = nameFrameSrc.indexOf('?') >= 0 ? '&' : '?';
        nameFrame.src = nameFrameSrc + join + 'autoplay=1';
      }
    }
    namecard.addEventListener('pointerenter', function (e) {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      nameHolding = true;
      namecardApply();
    });
    namecard.addEventListener('pointerleave', function (e) {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      nameHolding = false;
      namecardApply();
    });
    namecard.addEventListener('pointerup', function (e) {
      if (!e.pointerType || e.pointerType === 'mouse') return;
      nameHolding = true;
      namecardApply();
    });
    document.addEventListener('pointerup', function (e) {
      if (!e.pointerType || e.pointerType === 'mouse') return;
      if (namecard.contains(e.target)) return;
      nameHolding = false;
      namecardApply();
    });
    namecard.addEventListener('focusin', function () {
      nameHolding = true;
      namecardApply();
    });
    namecard.addEventListener('focusout', function (e) {
      if (namecard.contains(e.relatedTarget)) return;
      nameHolding = false;
      namecardApply();
    });
    if (namePlay) {
      namePlay.addEventListener('click', function () {
        if (namePlaying) {
          namePlaying = false;
          namecard.classList.remove('is-playing');
          if (namePlay) namePlay.setAttribute('aria-label', 'Play');
          if (nameIcon) nameIcon.textContent = '\u25B6';
          if (nameVideo) nameVideo.pause();
          if (nameFrame && nameFrame.contentWindow) {
            nameFrame.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), '*');
          }
          namecardApply();
          return;
        }
        namecardStart();
      });
    }
    if (nameVideo) {
      nameVideo.addEventListener('ended', function () {
        namePlaying = false;
        namecard.classList.remove('is-playing');
        if (namePlay) namePlay.setAttribute('aria-label', 'Play');
        if (nameIcon) nameIcon.textContent = '\u25B6';
        namecardApply();
      });
    }
    window.addEventListener('message', function (e) {
      if (!nameFrame || !namePlaying) return;
      var origin = String(e.origin || '');
      if (origin.indexOf('youtube') < 0) return;
      var payload = e.data;
      if (typeof payload === 'string') {
        try { payload = JSON.parse(payload); } catch (err) { return; }
      }
      if (payload && payload.event === 'onStateChange' && Number(payload.info) === 0) {
        namePlaying = false;
        namecard.classList.remove('is-playing');
        if (namePlay) namePlay.setAttribute('aria-label', 'Play');
        if (nameIcon) nameIcon.textContent = '\u25B6';
        namecardApply();
      }
    });
  }
})();
