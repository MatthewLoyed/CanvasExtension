/* Dashboard course-card actions and the same in-place dialog on course pages. */
(() => {
    let view, dialog, active;
    function updateButton(element) {
        const running = active?.busy && element.dataset.courseId === active.courseId;
        const label = element.querySelector('.cdl-export-button-label');
        const meter = element.querySelector('progress');
        element.classList.toggle('cdl-export-running', !!running);
        meter.hidden = !running;
        if (running) {
            const percent = Number.isFinite(active.percent) ? Math.max(0, Math.min(100, active.percent)) : null;
            const text = active.message || 'Exporting course…';
            label.textContent = text + (percent == null ? '' : ` ${Math.floor(percent)}%`);
            if (percent == null) meter.removeAttribute('value'); else meter.value = percent;
            element.setAttribute('aria-label', `${element.dataset.courseTitle}: ${label.textContent}. Open export progress`);
            element.title = 'Open export progress';
        } else {
            label.textContent = 'Export course';
            element.setAttribute('aria-label', `Export course: ${element.dataset.courseTitle}`);
            element.removeAttribute('title');
        }
    }
    function updateProgress(state) {
        active = state;
        document.querySelectorAll('.cdl-export-course-button').forEach(updateButton);
    }
    function canvas() {
        return !!document.querySelector('#application') && !!document.querySelector('#global_nav_dashboard_link, #breadcrumbs, .ic-app-nav-toggle-and-main-content');
    }
    function show(courseId, title) {
        if (!view) {
            dialog = window.CanvasDownloaderUI.createOfflineDialog(); document.body.append(dialog.cdlHost);
            view = window.CanvasOfflineModal.create(dialog, updateProgress);
        }
        view.open({ courseId: String(courseId), title, origin: location.origin });
    }
    function button(courseId, title, card) {
        const element = document.createElement('button'); element.type = 'button';
        element.className = 'cdl-export-course-button';
        const label = document.createElement('span'); label.className = 'cdl-export-button-label';
        const meter = document.createElement('progress'); meter.max = 100; meter.hidden = true;
        meter.setAttribute('aria-hidden', 'true'); element.append(label, meter);
        element.style.setProperty('color', '#fff', 'important');
        element.style.setProperty('background-color', '#086baf', 'important');
        element.dataset.courseId = courseId; element.setAttribute('aria-label', `Export course: ${title}`);
        element.dataset.courseTitle = title; updateButton(element);
        if (!card) element.id = 'cdl-save-offline';
        element.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); show(courseId, title); });
        return element;
    }
    function mount() {
        if (!canvas()) return;
        if (/^\/(?:dashboard\/?)?$/.test(location.pathname)) {
            for (const card of document.querySelectorAll('.ic-DashboardCard')) {
                if (card.querySelector('.cdl-export-course-button')) continue;
                const link = [...card.querySelectorAll('a[href]')].find(a => {
                    try { const u = new URL(a.href, location.href); return u.origin === location.origin && /^\/courses\/\d+\/?$/.test(u.pathname); } catch { return false; }
                });
                if (!link) continue;
                const courseId = new URL(link.href).pathname.match(/\/courses\/(\d+)/)[1];
                const title = card.querySelector('.ic-DashboardCard__header-title')?.textContent.trim() || link.getAttribute('aria-label') || link.textContent.trim();
                const row = document.createElement('div'); row.className = 'cdl-export-card-action';
                row.append(button(courseId, title, true)); card.append(row);
            }
        } else {
            const courseId = location.pathname.match(/^\/courses\/(\d+)(?:\/|$)/)?.[1];
            const content = document.getElementById('content');
            if (courseId && content && !document.getElementById('cdl-save-offline')) content.prepend(button(courseId, document.title, false));
        }
    }
    mount();
    let scheduled = false;
    new MutationObserver(() => {
        if (!scheduled) { scheduled = true; setTimeout(() => { scheduled = false; mount(); }, 250); }
    }).observe(document.body, { childList: true, subtree: true });
})();
