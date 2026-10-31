/* One click exports all supported accessible materials. Details live in the ZIP report. */
(() => {
    const ALL = Object.freeze({ pages: true, announcements: true, assignments: true, files: true });
    window.CanvasOfflineModal = { create(dialog, onProgress = () => {}) {
        const $ = id => dialog.querySelector('#cdl-export-' + id);
        let session, candidate, controller, context, busy = false;
        function progress(message, percent, detail = {}) {
            const labels = { scan: 'Finding course content…', prepare: 'Preparing attachments…', access: 'Checking available content…', download: 'Downloading attachments…', reuse: 'Keeping saved attachments…' };
            if (labels[detail.phase]) message = labels[detail.phase];
            $('status').textContent = message;
            const parts = [];
            if (detail.estimated && Number.isFinite(percent)) parts.push(`About ${Math.floor(percent)}% · ${detail.current} of ${detail.total} processed`);
            else if (detail.total) parts.push(`${detail.current} of ${detail.total}`);
            if (detail.item || detail.section) parts.push(detail.item || detail.section);
            if (detail.bytes) parts.push(`${(detail.bytes / 1048576).toFixed(1)} MB${detail.size ? ` of ${(detail.size / 1048576).toFixed(1)} MB` : ''}`);
            $('detail').textContent = parts.join(' · '); $('detail').hidden = !parts.length;
            $('detail').title = parts.join(' · ');
            if (Number.isFinite(percent)) {
                $('progress').max = 100; $('progress').value = percent;
                $('progress').setAttribute('aria-valuetext', `${message} ${Math.floor(percent)} percent${detail.estimated ? ', estimated' : ''}`);
            }
            else { $('progress').removeAttribute('value'); $('progress').removeAttribute('aria-valuetext'); }
            onProgress({ courseId: context?.courseId, busy, message, percent });
        }
        function running(value) {
            busy = value; $('progress').hidden = !value; $('cancel').hidden = !value;
            $('done').hidden = value; $('retry').hidden = true;
            dialog.dataset.state = value ? 'running' : 'idle';
            window.removeEventListener('beforeunload', preventLeaving);
            if (value) window.addEventListener('beforeunload', preventLeaving);
            if (!value) onProgress({ courseId: context?.courseId, busy: false });
        }
        function preventLeaving(event) { event.preventDefault(); event.returnValue = ''; }
        function clear() { session?.clear(); candidate?.clear(); session = candidate = null; }
        async function run(fresh = false) {
            if (busy) return;
            if (fresh) clear();
            controller = new AbortController(); running(true);
            $('title').textContent = 'Exporting course'; $('summary').hidden = true;
            $('note').textContent = 'You can close this window while it runs. Stay on this Canvas page.';
            progress('Finding course materials…');
            try {
                if (!session) {
                    candidate = new CanvasOffline.Session({ ...context,
                        request: CanvasOfflineTransport.createLocalTransport(context.origin, context.courseId),
                        signal: controller.signal, progress });
                    await candidate.scan(ALL); session = candidate; candidate = null;
                }
                session.signal = controller.signal;
                $('course').textContent = session.title || context.title;
                await session.fetchFiles(CanvasOfflineIO.fetchAsset);
                const available = [...session.documents, ...session.files.values()].some(item => ['ready','saved'].includes(item.state));
                if (!available) throw new CanvasOffline.ArchiveError('No course materials are available to export.', 'empty');
                progress('Creating your ZIP…');
                const zip = new JSZip();
                for (const [path, content] of session.buildEntries()) zip.file(path, content);
                const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE', streamFiles: true }, info => {
                    session.check(); progress('Creating your ZIP…', info.percent);
                });
                session.check(); progress('Saving your ZIP…');
                const filename = `${CanvasOffline.safeName(session.title, 55)}-${context.courseId}-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
                await CanvasOfflineIO.saveBlob(blob, filename, controller.signal);
                const report = session.report();
                const saved = report.items.filter(item => item.state === 'saved').length;
                const gaps = report.coverage.some(c => c.state !== 'enumerated') || report.items.some(i => ['failed','unavailable'].includes(i.state));
                $('title').textContent = 'Course exported';
                progress(`Saved ${saved} item${saved === 1 ? '' : 's'} in your ZIP.`);
                $('summary').hidden = !gaps;
                $('summary').textContent = 'Some course content wasn’t available. Details are included in export-report.html inside the ZIP.';
                $('note').textContent = 'Extract the ZIP, then open index.html.';
                running(false);
                dialog.dataset.state = 'success';
                $('retry').hidden = !report.items.some(i => i.state === 'failed');
                $('retry').textContent = 'Retry missing items';
            } catch (error) {
                const cancelled = controller.signal.aborted;
                if (cancelled || ['account','auth'].includes(error.code)) clear();
                candidate?.clear(); candidate = null;
                running(false); $('title').textContent = cancelled ? 'Export cancelled' : 'Export couldn’t finish';
                dialog.dataset.state = cancelled ? 'idle' : 'error';
                let message = 'The export was interrupted. Please try again.';
                if (cancelled) message = 'No new archive was saved.';
                else if (error.code === 'auth') message = 'Please sign in to Canvas, then try again.';
                else if (error.code === 'account') message = 'Your Canvas account changed. Please try again.';
                else if (error.code === 'limit') message = 'This course is too large for one export. Try downloading its modules instead.';
                else if (error.code === 'empty') message = 'No course materials are available to export.';
                progress(message); $('note').textContent = '';
                $('retry').textContent = 'Try again'; $('retry').hidden = cancelled;
            }
        }
        $('close').addEventListener('click', () => dialog.close());
        $('done').addEventListener('click', () => dialog.close());
        $('cancel').addEventListener('click', () => { controller?.abort(); progress('Cancelling…'); });
        $('retry').addEventListener('click', () => run(false));
        dialog.addEventListener('click', event => {
            const r = dialog.getBoundingClientRect();
            if (event.target === dialog && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)) dialog.close();
        });
        window.addEventListener('pagehide', () => { controller?.abort(); clear(); window.removeEventListener('beforeunload', preventLeaving); });
        return { open(nextContext) {
            if (!dialog.open) dialog.showModal();
            if (busy) {
                if (context.courseId !== nextContext.courseId) $('note').textContent = 'An export is already running. Finish or cancel it before starting another course.';
                return;
            }
            context = nextContext; $('course').textContent = context.title;
            return run(true);
        } };
    } };
})();
