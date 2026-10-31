const fs = require('fs'); const path = require('path');
const script = fs.readFileSync(path.join(__dirname, '../../src/content/offline-entry.js'), 'utf8');
let open;
beforeEach(() => {
    window.eval(fs.readFileSync(path.join(__dirname, '../../src/offline/styles.js'), 'utf8'));
    window.eval(fs.readFileSync(path.join(__dirname, '../../src/content/ui-builder.js'), 'utf8'));
    open = jest.fn(); window.CanvasOfflineModal = { create: jest.fn(() => ({open})) };
});
test('secondary action is non-submitting, works with zero surface files, and never duplicates', () => {
    history.replaceState({}, '', '/courses/42/pages/empty');
    document.body.innerHTML = '<div id="application"></div><nav id="breadcrumbs"></nav><main id="content"><form></form></main>';
    const sendMessage = jest.fn(async()=>({success:true})); global.chrome = {runtime:{sendMessage}};
    window.eval(script); window.eval(script);
    const buttons = document.querySelectorAll('#cdl-save-offline'); expect(buttons).toHaveLength(1);
    expect(buttons[0].type).toBe('button'); buttons[0].click();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(expect.objectContaining({courseId:'42',origin:location.origin}));
    expect(document.getElementById('cdl-offline-host').shadowRoot.querySelector('dialog')).not.toBeNull();
});
test('each dashboard card gets its own export action without nesting a button in a link', () => {
    history.replaceState({}, '', '/');
    document.body.innerHTML = '<div id="application"><a id="global_nav_dashboard_link"></a><div id="dashboard"><div class="ic-DashboardCard"><a href="/courses/1"><h3 class="ic-DashboardCard__header-title">First course</h3></a></div><div class="ic-DashboardCard"><a href="/courses/2"><h3 class="ic-DashboardCard__header-title">Second course</h3></a></div></div></div>';
    window.eval(script); window.eval(script);
    expect(document.querySelectorAll('.cdl-export-course-button')).toHaveLength(2);
    expect(document.querySelectorAll('a button')).toHaveLength(0);
    document.querySelector('[data-course-id="2"]').click();
    expect(open).toHaveBeenCalledWith({courseId:'2',title:'Second course',origin:location.origin});
});
test('ordinary websites and non-course pages do not get an offline action', () => {
    history.replaceState({}, '', '/courses'); document.body.innerHTML = '<main id="content"></main>';
    window.eval(script); expect(document.getElementById('cdl-save-offline')).toBeNull();
});

test('active course button shows phase progress and reopens the same export',()=>{
    history.replaceState({}, '', '/');
    document.body.innerHTML='<div id="application"><a id="global_nav_dashboard_link"></a><div class="ic-DashboardCard"><a href="/courses/1">First</a></div><div class="ic-DashboardCard"><a href="/courses/2">Second</a></div></div>';
    window.eval(script);
    const first=document.querySelector('[data-course-id="1"]'),second=document.querySelector('[data-course-id="2"]');
    first.click();const notify=window.CanvasOfflineModal.create.mock.calls[0][1];
    notify({courseId:'1',busy:true,message:'Finding course content…'});
    expect(first.querySelector('progress').hidden).toBe(false);
    expect(first.querySelector('progress').hasAttribute('value')).toBe(false);
    notify({courseId:'1',busy:true,message:'Downloading attachments…',percent:42});
    expect(first.textContent).toContain('42%');expect(first.querySelector('progress').value).toBe(42);
    expect(first.getAttribute('aria-label')).toContain('Open export progress');
    expect(second.textContent).toBe('Export course');expect(second.querySelector('progress').hidden).toBe(true);
    first.click();expect(open).toHaveBeenCalledTimes(2);
    notify({courseId:'1',busy:false});expect(first.textContent).toBe('Export course');
    expect(first.querySelector('progress').hidden).toBe(true);
});
