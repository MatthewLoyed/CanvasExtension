/* Course discovery and selection. No DOM rendering or download side effects. */
(() => {
    const api = window.CanvasDownloader;

    api.mapLimit = async function (items, limit, visit) {
        const results = new Array(items.length);
        let next = 0;
        await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
            while (next < items.length) {
                const index = next++;
                results[index] = await visit(items[index], index);
            }
        }));
        return results;
    };

    api.isModuleListPage = () => /^\/courses\/\d+\/modules\/?$/.test(location.pathname) ||
        (!!document.querySelector('#context_modules') && /^\/courses\/\d+\/?$/.test(location.pathname));

    api.scanCourse = async function (courseId, onProgress = () => {}, cancelled = () => false) {
        const courseName = api.getCourseName();
        const groups = [];
        const check = () => { if (cancelled()) throw new Error('Scan cancelled'); };
        const modules = await api.fetchCourseModules(courseId, page => onProgress({ phase: 'modules', page, groups: [] }));
        check();
        modules.forEach(mod => {
            if (mod.state !== 'locked' && !mod.locked_for_user) groups.push({ id: String(mod.id), name: mod.name || 'Untitled module', files: [], scanning: true });
        });
        onProgress({ phase: 'items', completed: 0, total: groups.length, groups });
        let completed = 0;
        await api.mapLimit(groups, 3, async group => {
            check();
            const mod = modules.find(item => String(item.id) === group.id);
            let items = mod.items;
            if (!Array.isArray(items) || items.length < (mod.items_count || 0)) {
                try {
                    items = await api.fetchCanvasApi(`${location.origin}/api/v1/courses/${courseId}/modules/${group.id}/items?include[]=content_details&per_page=50`, 150);
                } catch (error) {
                    if (error.status === 403 || error.status === 404) {
                        group.unavailable = true;
                        items = [];
                    } else throw error;
                }
            }
            const discovered = await api.mapLimit(items || [], 3, async item => {
                check();
                if (item.content_details?.locked_for_user || item.published === false) return [];
                if (item.type === 'File' && item.content_id) {
                    return [{ href: `${location.origin}/courses/${courseId}/files/${item.content_id}/download`, text: item.title || 'File', type: 'file' }];
                }
                if (item.type === 'Page' && item.page_url) {
                    const page = await api.fetchPageBody(courseId, item.page_url);
                    if (!page) return [];
                    return api.parsePageBodyForFiles(page.body, `${location.origin}/courses/${courseId}/pages/${encodeURIComponent(item.page_url)}`);
                }
                if ((item.type === 'Assignment' || item.type === 'Discussion') && item.content_id) {
                    const bucket = item.type === 'Assignment' ? 'assignments' : 'discussion_topics';
                    try {
                        const data = await api.fetchCanvasApi(`${location.origin}/api/v1/courses/${courseId}/${bucket}/${item.content_id}`, 0);
                        return api.parsePageBodyForFiles(data[0]?.description || data[0]?.message || '', location.origin);
                    } catch (error) {
                        if (error.status === 403 || error.status === 404) return [];
                        throw error;
                    }
                }
                if (item.type === 'ExternalUrl' && /^https?:\/\//i.test(item.external_url || '')) {
                    const file = { href: item.external_url, text: item.title || 'External file', type: 'file' };
                    // Ordinary websites, tools and recordings are not file counts.
                    if (/\.(pdf|docx?|pptx?|xlsx?|zip|txt)(?:[?#]|$)/i.test(file.href + ' ' + file.text)) return [file];
                    const resolved = await api.resolveFileUrl(file);
                    return resolved ? [file] : [];
                }
                return [];
            });
            check();
            const files = api.uniqueFiles(discovered.flat());
            await api.mapLimit(files, 4, async file => {
                const match = new URL(file.href, location.href).pathname.match(/\/files\/(\d+)/);
                if (!match) return;
                try {
                    const data = (await api.fetchCanvasApi(`${location.origin}/api/v1/files/${match[1]}`, 0))[0];
                    if (data.locked_for_user || data.hidden_for_user) { file.unavailable = true; return; }
                    file.text = data.display_name || data.filename || file.text;
                    const ext = data.filename?.match(/\.([a-z0-9]{1,10})$/i);
                    file.type = ext ? '.' + ext[1].toLowerCase() : (api.mimeToExtension(data['content-type']) || 'file');
                } catch (error) {
                    if (error.status === 403 || error.status === 404) file.unavailable = true;
                    else throw error;
                }
            });
            check();
            group.files = files.filter(file => !file.unavailable).map(file => ({
                ...file, href: api.transformDownloadUrl(file.href).url, courseName,
                moduleId: group.id, moduleName: group.name, source: 'course'
            }));
            group.scanning = false;
            onProgress({ phase: 'items', completed: ++completed, total: groups.length, groups });
        });
        check();
        return groups.filter(group => !group.unavailable);
    };

    api.CourseSelection = class {
        constructor() { this.groups = []; this.selected = new Map(); this.known = new Map(); this.defaults = new Map(); this.defaultSelection = true; }
        update(groups) {
            this.groups = groups;
            for (const group of groups) {
                if (!this.defaults.has(group.id)) this.defaults.set(group.id, this.defaultSelection);
                const keys = new Set(group.files.map(file => api.getResourceKey(file.href)));
                const previous = this.known.get(group.id) || new Set();
                const selected = this.selected.get(group.id) || new Set();
                for (const key of selected) if (!keys.has(key)) selected.delete(key);
                for (const key of keys) if (!previous.has(key) && this.defaults.get(group.id) !== false) selected.add(key);
                this.selected.set(group.id, selected);
                this.known.set(group.id, keys);
            }
        }
        toggleModule(id, checked) {
            this.defaults.set(id, checked);
            this.selected.set(id, checked ? new Set(this.known.get(id) || []) : new Set());
        }
        toggleFile(id, href, checked) {
            const selected = this.selected.get(id);
            const key = api.getResourceKey(href);
            if (checked) selected.add(key); else selected.delete(key);
        }
        selectAll(checked) { this.defaultSelection = checked; this.groups.forEach(group => this.toggleModule(group.id, checked)); }
        files() {
            const seen = new Set();
            const files = [];
            for (const group of this.groups) for (const file of group.files) {
                const key = api.getResourceKey(file.href);
                if (!seen.has(key) && this.selected.get(group.id)?.has(key)) {
                    seen.add(key);
                    files.push({ ...file, moduleId: group.id, moduleName: group.name });
                }
            }
            return files;
        }
    };
})();
