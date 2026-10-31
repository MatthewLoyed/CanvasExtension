const fs = require('fs');
const path = require('path');
const { TextEncoder, TextDecoder } = require('util');
const { Blob } = require('buffer');
global.TextEncoder = TextEncoder; global.TextDecoder = TextDecoder;
window.eval(fs.readFileSync(path.join(__dirname, '../../src/vendor/purify.min.js'), 'utf8'));
window.eval(fs.readFileSync(path.join(__dirname, '../../src/offline/core.js'), 'utf8'));
const { Session, safeName, fileIdentity, canonical, sanitizedBody } = window.CanvasOffline;
const ORIGIN = 'https://school.instructure.com';
const base = '/api/v1/courses/42';
const choices = { pages: true, announcements: true, assignments: true, files: true };
function fixture(overrides = {}, options = {}) {
    const data = {
        '/api/v1/users/self/profile': { id: 7, name: 'MUST NOT EXPORT' },
        [base]: { name: 'Fixture course', enrollments: [{ type: 'student' }] },
        [base + '/pages']: [{ page_id: 1, url: 'lesson', title: 'Lesson', published: true,
            body: '<h2 id="start">Topic</h2><table><tr><td>Cell</td></tr></table><a href="../files/9?wrap=1">slides</a><a href="/files/9/download?verifier=secret">again</a><img src="/files/10/preview" alt="Diagram"><a href="/courses/42/assignments/3">Task</a><a href="https://video.example/watch?id=abc">Recording</a>' }],
        [base + '/discussion_topics']: [{ id: 2, title: 'Old announcement', message: '<p>September news</p>', posted_at: '2020-09-01T00:00:00Z', attachments: [{ id: 9 }], entries: [{ message: 'STUDENT REPLY' }] }],
        [base + '/assignments']: [{ id: 3, name: 'Task', description: '<p>Instructions</p>', due_at: '2026-10-01T12:00:00Z', submission_types: ['online_upload'], secure_params: 'SECRET', submission: { body: 'STUDENT WORK' } },
            { id: 4, name: 'Quiz', is_quiz_assignment: true, description: 'QUIZ ANSWER' },
            { id: 5, name: 'LTI', submission_types: ['external_tool'], description: 'TOOL CONTENT' }],
        [base + '/modules']: [{ id: 20, name: 'Week 1' }],
        [base + '/modules/20/items']: [{ id: 100, type: 'Page', page_url: 'lesson', title: 'Lesson' }, { id: 101, type: 'File', content_id: 9, title: 'slides' }],
        [base + '/files']: { error: 'Course Files denied', status: 403 },
        '/api/v1/files/9': { id: 9, display_name: 'slides.html', 'content-type': 'text/html', size: 10, url: ORIGIN + '/files/9/download?verifier=SECRET' },
        '/api/v1/files/10': { id: 10, display_name: 'diagram.png', 'content-type': 'image/png', size: 10, url: ORIGIN + '/files/10/download?verifier=SECRET' },
        [base + '/pages/page_id:1']: { page_id: 1, published: true },
        [base + '/discussion_topics/2']: { id: 2 },
        [base + '/assignments/3']: { id: 3 }
    };
    Object.assign(data, overrides);
    const requests = [];
    const request = jest.fn(async input => {
        const u = new URL(input, ORIGIN); requests.push(u.pathname + u.search);
        const result = data[u.pathname];
        if (typeof result === 'function') return result(u);
        if (!result) return { error: 'Missing fixture: ' + u.pathname, status: 404 };
        return result.error ? result : { data: JSON.parse(JSON.stringify(result)) };
    });
    const s = new Session({ origin: ORIGIN, courseId: 42, request, sleep: async () => {}, ...options });
    return { s, requests, data, request };
}
function asset(bytes = [1, 2, 3], mime = 'image/png') {
    return { ok: true, status: 200, url: ORIGIN + '/files/9/download', headers: { get: () => mime },
        body: { getReader: () => { let sent = false; return { read: async () => sent ? { done: true } : (sent = true, { done: false, value: new Uint8Array(bytes) }), cancel: async () => {} }; } } };
}
beforeEach(() => { window.Blob = Blob; });

test.each(['https://cdn.inst-fs-iad-prod.inscloudgate.net/a/slides.pdf','https://instructure-uploads.s3.amazonaws.com/account_1/attachments/9/slides.pdf'])('accepts documented Canvas file redirects: %s', async url => {
    const { s } = fixture(); await s.scan(choices);
    await s.fetchFiles(async () => ({...asset(),url}));
    expect([...s.files.values()].every(file=>file.state==='saved')).toBe(true);
});
test.each(['https://inscloudgate.net.evil.example/a','http://cdn.inscloudgate.net/a','https://other-bucket.s3.amazonaws.com/a'])('rejects unsupported file redirects: %s', async url => {
    const { s } = fixture(); await s.scan(choices);
    await s.fetchFiles(async () => ({...asset(),url}));
    expect([...s.files.values()].every(file=>file.state==='failed')).toBe(true);
});
test('enumerates selected types outside modules, keeps old announcements, deduplicates assets, reports denied catalog', async () => {
    const { s, requests } = fixture(); await s.scan(choices);
    expect(s.documents).toHaveLength(5); expect(s.files.size).toBe(2);
    expect(s.files.get('9').refs).toContain('Module: Week 1');
    expect(s.coverage).toContainEqual({ name: 'Other course files', state: 'incomplete', reason: 'Course Files denied' });
    expect(requests.some(p => /entries|submissions|grades|quizzes/.test(p))).toBe(false);
    expect(requests.find(p => p.includes('discussion_topics?'))).toContain('only_announcements=true');
});
test('HTML reader works without scripts or JSON fetch and rewrites local documents, files, module aliases, and image previews', async () => {
    const { s } = fixture(); await s.scan(choices); await s.fetchFiles(async () => asset());
    const entries = s.buildEntries(); const doc = entries.get('pages/1-Lesson.html');
    expect(doc).toContain('../files/9-slides.html'); expect(doc).toContain('../files/10-diagram.png');
    expect(doc).toContain('../assignments/3-Task.html'); expect(doc).toContain('<table>');
    expect(doc).toContain('https://video.example/watch?id=abc'); expect(doc).toContain('Online only');
    expect(entries.has('index.html')).toBe(true); expect(entries.has('export-report.html')).toBe(true);
    const manifest = entries.get('manifest.json');
    for (const secret of ['SECRET','STUDENT WORK','STUDENT REPLY','QUIZ ANSWER','TOOL CONTENT','MUST NOT EXPORT','secure_params']) expect(manifest + doc).not.toContain(secret);
    expect(JSON.parse(manifest).partial).toBe(true);
    expect(entries.get('index.html')).not.toMatch(/<script|fetch\(/);
});
test('files unchecked saves text but annotates missing images and attachments without metadata requests', async () => {
    const { s, requests } = fixture(); await s.scan({ ...choices, files: false });
    const entries = s.buildEntries(); expect(s.files.size).toBe(0);
    expect(entries.get('pages/1-Lesson.html')).toContain('Files &amp; images not selected');
    expect(requests.some(p => p.startsWith('/api/v1/files/'))).toBe(false);
    expect(requests.some(p => p === base + '/files?per_page=50')).toBe(false);
    expect(entries.get('announcements/2-Old announcement.html')).toContain('Attachment 9');
});
test('follows next links after empty filtered pages and rejects a repeated or off-origin next link', async () => {
    let i = 0;
    const { s } = fixture({ [base + '/pages']: () => ++i === 1 ? { data: [], link: `<${ORIGIN}${base}/pages?page=2>; rel="next"` } : { data: [{ page_id: 8, title: 'Unmoduled', url: 'other', body: '' }] } });
    await s.scan({ pages: true }); expect(s.documents[0].title).toBe('Unmoduled'); expect(i).toBe(2);
    const off = fixture({ [base + '/pages']: () => ({ data: [], link: '<https://evil.example/api/v1/courses/42/pages>; rel="next"' }) });
    await off.s.scan({ pages: true }); expect(off.s.coverage[0].state).toBe('incomplete');
    expect(off.request.mock.calls.every(([url]) => new URL(url, ORIGIN).origin === ORIGIN)).toBe(true);
});
test('locked and missing bodies never leak text, and Studio becomes a reportable placeholder', async () => {
    const { s } = fixture({ [base + '/pages']: [{ page_id: 1, url: 'locked', title: 'Locked', locked_for_user: true, body: 'LOCKED SECRET' }, { page_id: 2, url: 'studio', title: 'Studio', body: '<iframe title="Lecture recording" src="https://media.example/embed"></iframe>' }] });
    await s.scan({ pages: true }); const entries = s.buildEntries();
    expect([...entries.values()].join('')).not.toContain('LOCKED SECRET');
    expect(entries.get('pages/2-Studio.html')).toContain('not included');
    expect(s.report().items.find(d => d.id === '2').notices.length).toBeGreaterThan(0);
});
test('DOMPurify and CSS filtering remove active markup, network styles, forms, and clobbering', () => {
    const html = sanitizedBody('<script>alert(1)</script><img src="https://evil/a" onerror="alert(1)" srcset="https://evil/b 2x"><p style="background:url(https://evil/c);position:fixed;text-align:center">Text</p><form action="https://evil"><input value="secret"></form><a href="javascript:alert(1)">bad</a><svg onload="alert(1)"><a href="javascript:alert(1)">x</a></svg>').innerHTML;
    expect(html).not.toMatch(/script|onerror|srcset|background|position|<form|<input|javascript:|<svg/);
    expect(html).toContain('text-align:center');
});
test('IDs survive same-name and reserved/path-like titles; identities normalize preview aliases', () => {
    expect(safeName('../CON.txt')).not.toContain('/'); expect(safeName('CON.txt')).toBe('_CON.txt');
    expect(safeName('NUL')).toBe('_NUL'); expect(safeName('x'.repeat(200)).length).toBe(85);
    expect(fileIdentity('/courses/42/files?preview=123', ORIGIN)).toBe('123');
    expect(fileIdentity('/files/123/preview', ORIGIN)).toBe('123');
    expect(fileIdentity('https://evil/files/123', ORIGIN)).toBeNull();
    expect(canonical('javascript:alert(1)', ORIGIN)).toBeNull();
    expect(canonical('https://video.example/watch?id=abc&token=SECRET', ORIGIN)).toBe('https://video.example/watch?id=abc');
});
test('failed files can be retried without fetching successful binary contents again', async () => {
    const { s } = fixture(); await s.scan(choices);
    const fetcher = jest.fn(async url => { if (url.includes('/10/')) throw new Error('offline'); return asset(); });
    await s.fetchFiles(fetcher); expect(s.files.get('10').state).toBe('failed');
    expect(s.buildEntries().has('files/9-slides.html')).toBe(true);
    fetcher.mockImplementation(async () => asset()); await s.fetchFiles(fetcher);
    expect(fetcher).toHaveBeenCalledTimes(3); expect(s.files.get('10').state).toBe('saved');
    expect(s.buildEntries().has('files/10-diagram.png')).toBe(true);
});
test('an auth interruption pauses, and an account change rejects reuse of retained content', async () => {
    const { s, data } = fixture(); await s.scan(choices);
    data['/api/v1/files/9'] = { error: 'expired', status: 401 };
    await expect(s.fetchFiles(async () => asset())).rejects.toMatchObject({ code: 'auth' });
    data['/api/v1/users/self/profile'] = { id: 999 };
    await expect(s.fetchFiles(async () => asset())).rejects.toMatchObject({ code: 'account' });
});
test('newly locked content and disallowed metadata hosts cannot enter the archive', async () => {
    const { s, data } = fixture(); await s.scan(choices); data[base + '/pages/page_id:1'] = { locked_for_user: true };
    data['/api/v1/files/9'].url = 'https://evil.example/file';
    const fetcher = jest.fn(async () => asset()); await s.fetchFiles(fetcher);
    expect(s.documents[0].state).toBe('unavailable'); expect(s.files.get('9').state).toBe('failed'); expect(fetcher).toHaveBeenCalledTimes(1);
});
test('bounded pagination, streamed sizes, and abort are explicit failures', async () => {
    const limited = fixture({}, { limits: { records: 1 } }); await expect(limited.s.scan(choices)).rejects.toMatchObject({ code: 'limit' });
    const { s } = fixture({}, { limits: { fileBytes: 11 } }); await s.scan(choices);
    await s.fetchFiles(async () => asset(new Array(12).fill(1))); expect(s.files.get('9').state).toBe('failed'); expect(s.usedBytes).toBe(0);
    const abort = new AbortController(); const cancelled = fixture({}, { signal: abort.signal }); abort.abort();
    await expect(cancelled.s.scan(choices)).rejects.toMatchObject({ code: 'cancelled' });
});
test('429 and server errors retry only within a bounded budget', async () => {
    let n = 0; const { s } = fixture({ [base + '/pages']: () => ++n < 3 ? { error: 'busy', status: 429 } : { data: [] } });
    await s.scan({ pages: true }); expect(n).toBe(3);
    let m = 0; const fail = fixture({ [base + '/pages']: () => (++m, { error: 'down', status: 503 }) });
    await fail.s.scan({ pages: true }); expect(m).toBe(4); expect(fail.s.coverage[0].state).toBe('incomplete');
});
test('account changes during collection are fatal before retaining the response', async () => {
    let reads = 0;
    const { s } = fixture({ '/api/v1/users/self/profile': () => ({ data: { id: ++reads > 2 ? 99 : 7 } }) });
    await expect(s.scan(choices)).rejects.toMatchObject({ code: 'account' });
    expect(s.documents).toHaveLength(0);
});
test('module-file aliases are local and missing fragments appear in the report', async () => {
    const { s } = fixture({ [base + '/pages']: [{ page_id:1,url:'lesson',title:'Lesson',body:'<a href="/courses/42/modules/items/101">Module file</a><a href="#missing">Jump</a>' }] });
    await s.scan(choices); await s.fetchFiles(async () => asset());
    const body = s.buildEntries().get('pages/1-Lesson.html');
    expect(body).toContain('../files/9-slides.html'); expect(s.report().items[0].notices).toContain('Fragment target not found: missing');
});
test('a misleading HTML file response and saved-file access loss never silently succeed', async () => {
    const { s, data } = fixture(); await s.scan(choices);
    const html = new TextEncoder().encode('<html><title>CAS Login</title><form id="login"></form></html>');
    await expect(s.fetchFiles(async () => asset([...html], 'text/html'))).rejects.toMatchObject({code:'auth'});
    expect(s.usedBytes).toBe(0);
    await s.fetchFiles(async () => asset()); data['/api/v1/files/9'] = {id:9,locked_for_user:true};
    await s.fetchFiles(async () => asset()); expect(s.files.get('9').state).toBe('unavailable'); expect(s.files.get('9').bytes).toBeUndefined();
});
test('metadata filenames preserve extensions behind extensionless display labels and long Unicode names', async () => {
    const filename = '課'.repeat(150) + '.pdf';
    const { s } = fixture({ '/api/v1/files/9': {id:9,display_name:'Welcome to class',filename,'content-type':'application/pdf',size:4,url:ORIGIN+'/files/9/download'} });
    await s.scan(choices); const file = s.files.get('9');
    expect(file.title).toBe('Welcome to class'); expect(file.path.endsWith('.pdf')).toBe(true);
    expect(new TextEncoder().encode(file.path.split('/').pop()).length).toBeLessThan(255);
    expect(fileIdentity('/courses/99/files/9', ORIGIN+'/courses/42/pages/lesson')).toBeNull();
});
test('endless empty pagination is bounded even without any discovered records', async () => {
    let n=0; const {s} = fixture({[base+'/pages']:()=>({data:[],link:'<'+ORIGIN+base+'/pages?page='+(++n)+'\u003e; rel="next"'})},{limits:{pages:2}});
    await expect(s.scan({pages:true})).rejects.toMatchObject({code:'limit'}); expect(n).toBe(2);
});
test('a disabled Pages list still preserves an accessible front page and module page', async () => {
    const { s } = fixture({
        [base+'/pages']:{error:'Pages disabled',status:404},
        [base+'/front_page']:{page_id:8,url:'home',title:'Course home',body:'<p>Welcome</p>'},
        [base+'/pages/lesson']:{page_id:1,url:'lesson',title:'Lesson',body:'<p>Module material</p>'}
    });
    await s.scan(choices);
    expect(s.documents.filter(d=>d.kind==='pages').map(d=>d.title)).toEqual(['Course home','Lesson']);
    expect(s.coverage).toContainEqual({name:'Pages',state:'incomplete',reason:'Pages disabled'});
    expect(s.aliases.get('/courses/42/modules/items/100').title).toBe('Lesson');
});

test('worker pool bounds concurrency and stops queued work on fatal failure', async () => {
    const {s}=fixture(); let active=0,peak=0,started=0;
    await s.parallel([1,2,3,4,5,6],async()=>{
        started++;peak=Math.max(peak,++active);
        await new Promise(resolve=>setTimeout(resolve,5));active--;
    });
    expect(peak).toBe(3);expect(started).toBe(6);
    started=0;
    await expect(s.parallel([1,2,3,4,5,6],async n=>{
        started++;if(n===1)throw new window.CanvasOffline.ArchiveError('Sign in','auth');
        await new Promise(resolve=>setTimeout(resolve,5));s.check();
    })).rejects.toMatchObject({code:'auth'});
    expect(started).toBeLessThanOrEqual(3);expect(s.signal).toBeUndefined();
});
test('concurrent attachment streams share one archive byte budget', async () => {
    const {s}=fixture();await s.scan(choices);
    s.limits.bytes=s.sourceBytes+5;
    await s.fetchFiles(async()=>asset([1,2,3,4]));
    expect(s.usedBytes).toBe(4);expect(s.pendingBytes).toBe(0);
    expect([...s.files.values()].filter(f=>f.state==='saved')).toHaveLength(1);
    expect([...s.files.values()].filter(f=>f.state==='failed')).toHaveLength(1);
});
test('cancellation drains all workers and restores the parent signal', async()=>{
    const controller=new AbortController();const {s}=fixture({}, {signal:controller.signal});
    let started=0;
    await expect(s.parallel([1,2,3,4,5],async()=>{
        started++;await Promise.resolve();controller.abort();s.check();
    })).rejects.toMatchObject({code:'cancelled'});
    expect(started).toBe(3);expect(s.signal).toBe(controller.signal);
});
test('reports discovery, access and download timings without attachment credentials', async()=>{
    const {s}=fixture();await s.scan(choices);await s.fetchFiles(async()=>asset());
    expect(s.report().timings).toEqual({discoveryMs:expect.any(Number),accessMs:expect.any(Number),downloadMs:expect.any(Number),discoveryStagesMs:expect.objectContaining({Pages:expect.any(Number),'Module structure and linked files':expect.any(Number)})});
});

test('authentication failure aborts sibling attachment transfers before building an archive', async()=>{
    const {s}=fixture();await s.scan(choices);let aborted=false;
    await expect(s.fetchFiles(async(url,options)=>{
        if(url.includes('/9/')) {await Promise.resolve();return {...asset(),status:401,ok:false};}
        return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>{aborted=true;reject(new TypeError('Aborted'));},{once:true}));
    })).rejects.toMatchObject({code:'auth'});
    expect(aborted).toBe(true);expect(s.pendingBytes).toBe(0);
});

test('attachment estimates stay monotonic through out-of-order completions and failures',async()=>{
    const updates=[];const {s}=fixture({}, {progress:(message,percent,detail)=>{if(detail?.estimated)updates.push({percent,detail});}});
    await s.scan(choices);
    await s.fetchFiles(async url=>{if(url.includes('/9/')){await new Promise(resolve=>setTimeout(resolve,5));return {...asset(),ok:false,status:403};}return asset();});
    expect(updates.length).toBeGreaterThan(2);
    expect(updates.every((u,i)=>u.percent>=0 && u.percent<=100 && (!i || u.percent>=updates[i-1].percent))).toBe(true);
    expect(updates.at(-1).percent).toBe(100);expect(updates.at(-1).detail.current).toBe(2);
    expect([...s.files.values()].filter(f=>f.state==='failed')).toHaveLength(1);
});
test('nine attachment workers run at once while retaining the shared size budget',async()=>{
    const {s}=fixture();await s.scan(choices);
    for(let id=11;id<=18;id++)s.addFile(id,'test');
    const get=s.get.bind(s);s.get=async route=>route.startsWith('/api/v1/files/')?{data:{id:route.split('/').pop(),display_name:'fixture.pdf','content-type':'application/pdf',size:3,url:ORIGIN+'/files/'+route.split('/').pop()+'/download'}}:get(route);
    let active=0,peak=0;
    await s.fetchFiles(async()=>{peak=Math.max(peak,++active);await new Promise(resolve=>setTimeout(resolve,5));active--;return asset();});
    expect(peak).toBe(9);expect(s.usedBytes).toBe(30);expect(s.pendingBytes).toBe(0);
});

test('independent collection discovery overlaps with a cap of three requests',async()=>{
    const {s,request}=fixture();let active=0,peak=0;
    s.request=async(...args)=>{
        peak=Math.max(peak,++active);
        try{await new Promise(resolve=>setTimeout(resolve,3));return await request(...args);}finally{active--;}
    };
    await s.scan(choices);
    expect(peak).toBe(3);expect(s.discoveryCache).toBeNull();
    expect(s.documents).toHaveLength(5);expect(s.files.size).toBe(2);
});
test('module discovery overlaps, shares duplicate page reads and preserves every module alias',async()=>{
    const mods=[20,21,22,23].map(id=>({id,name:'Week '+id}));
    const overrides={ [base+'/pages']:{error:'disabled',status:404},[base+'/modules']:mods,
        [base+'/front_page']:{error:'missing',status:404},
        [base+'/pages/lesson']:{page_id:1,url:'lesson',title:'Lesson',body:'<p>Lesson</p>'}};
    for(const mod of mods)overrides[base+'/modules/'+mod.id+'/items']=[{id:mod.id+100,type:'Page',page_url:'lesson',title:'Lesson'}];
    const {s,request,requests}=fixture(overrides);let active=0,peak=0;
    s.request=async(route,signal)=>{
        const moduleItems=String(route).includes('/items?');if(moduleItems)peak=Math.max(peak,++active);
        try{await new Promise(resolve=>setTimeout(resolve,3));return await request(route,signal);}finally{if(moduleItems)active--;}
    };
    await s.scan({pages:true});
    expect(peak).toBe(3);expect(requests.filter(p=>p===base+'/pages/lesson')).toHaveLength(1);
    expect(s.documents).toHaveLength(1);expect(s.modules).toHaveLength(4);
    for(const mod of mods)expect(s.aliases.get('/courses/42/modules/items/'+(mod.id+100))).toBe(s.documents[0]);
    await s.fetchFiles(async()=>asset());
    expect(requests).toContain(base+'/pages/page_id:1');
});
test('discovery cache never bypasses fresh document access checks',async()=>{
    const {s,data,requests}=fixture({[base+'/pages']:[{page_id:1,url:'lesson',title:'Lesson'}],
        [base+'/pages/page_id:1']:{page_id:1,url:'lesson',title:'Lesson',body:'<p>Visible</p>'}});
    await s.scan({pages:true});data[base+'/pages/page_id:1']={page_id:1,locked_for_user:true};
    await s.fetchFiles(async()=>asset());
    expect(requests.filter(p=>p===base+'/pages/page_id:1')).toHaveLength(2);
    expect(s.documents[0].state).toBe('unavailable');expect(s.documents[0].body).toBe('');
});

test('metadata preparation uses six workers and preserves unavailable file reporting',async()=>{
    const overrides={[base+'/modules/20/items']:Array.from({length:12},(_,i)=>({id:200+i,type:'File',content_id:30+i,title:'File'}))};
    for(let id=30;id<42;id++)overrides['/api/v1/files/'+id]={id,display_name:'File.pdf','content-type':'application/pdf',size:3,locked_for_user:id===41,url:ORIGIN+'/files/'+id+'/download'};
    const {s,request}=fixture(overrides);let active=0,peak=0;
    s.request=async(route,signal)=>{
        const metadata=String(route).startsWith('/api/v1/files/');if(metadata)peak=Math.max(peak,++active);
        try{await new Promise(resolve=>setTimeout(resolve,3));return await request(route,signal);}finally{if(metadata)active--;}
    };
    await s.scan({files:true});expect(peak).toBe(6);
    expect(s.files.size).toBe(12);expect(s.files.get('41').state).toBe('unavailable');
});
test('six concurrent content rechecks still detect changed locks before export',async()=>{
    const pages=Array.from({length:12},(_,i)=>({page_id:i+1,url:'page-'+i,title:'Page',body:'<p>Visible</p>'}));
    const overrides={[base+'/pages']:pages,[base+'/modules']:[]};
    for(let id=1;id<=12;id++)overrides[base+'/pages/page_id:'+id]={page_id:id,locked_for_user:id===12};
    const {s,request}=fixture(overrides);await s.scan({pages:true});let active=0,peak=0;
    s.request=async(route,signal)=>{
        const detail=String(route).includes('/pages/page_id:');if(detail)peak=Math.max(peak,++active);
        try{await new Promise(resolve=>setTimeout(resolve,3));return await request(route,signal);}finally{if(detail)active--;}
    };
    await s.fetchFiles(async()=>asset());expect(peak).toBe(6);
    expect(s.documents.find(d=>d.id==='12').state).toBe('unavailable');
    expect(s.documents.find(d=>d.id==='12').body).toBe('');
});
