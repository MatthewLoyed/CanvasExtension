const fs = require('fs'); const path = require('path');
const {TextEncoder, TextDecoder} = require('util'); global.TextEncoder=TextEncoder; global.TextDecoder=TextDecoder;
window.eval(fs.readFileSync(path.join(__dirname, '../../src/offline/transport.js'), 'utf8'));
const { canvasRead, createLocalTransport } = window.CanvasOfflineTransport;
beforeEach(() => {
    history.replaceState({}, '', '/courses/42/modules');
    document.body.innerHTML = '<div id="application"></div><nav id="breadcrumbs"></nav>';
    global.fetch = jest.fn();
});
test.each(['/api/v1/courses/43/pages', '/api/v1/courses/42/grades', '/api/v1/courses/42/assignments/1/submissions', '/api/v1/users/self/files', 'https://evil.example/api/v1/files/1'])('refuses unsupported or cross-origin route %s', async route => {
    const result = await canvasRead(location.origin, '42', route); expect(result.error).toBeTruthy(); expect(fetch).not.toHaveBeenCalled();
});
test('rejects course-prefix confusion and source tab navigation', async () => {
    history.replaceState({}, '', '/courses/420/modules');
    expect((await canvasRead(location.origin, '42', '/api/v1/courses/42')).error).toContain('selected course');
    expect(fetch).not.toHaveBeenCalled();
});
test('Canvas detection is required even on a similarly shaped URL', async () => {
    document.body.innerHTML = ''; expect((await canvasRead(location.origin, '42', '/api/v1/courses/42')).error).toContain('selected course');
});
test('login HTML is an auth interruption rather than content', async () => {
    fetch.mockResolvedValue({ ok:true, url:location.origin+'/login', headers:{get:()=> 'text/html'} });
    expect((await canvasRead(location.origin, '42', '/api/v1/courses/42')).status).toBe(401);
});
test('local reads use the dashboard login without scripting or tab creation', async () => {
    history.replaceState({}, '', '/'); document.body.innerHTML='<div id="application"><a id="global_nav_dashboard_link"></a><div id="dashboard"></div></div>';
    let sent=false;
    fetch.mockResolvedValue({ok:true,url:location.origin+'/api/v1/courses/42',headers:{get:()=> 'application/json'},body:{getReader:()=>({read:async()=>sent?{done:true}:(sent=true,{done:false,value:new TextEncoder().encode('{"id":42}')})})}});
    const request=createLocalTransport(location.origin,'42');
    expect((await request('/api/v1/courses/42')).data).toEqual({id:42});
    expect(fetch.mock.calls[0][1].credentials).toBe('include');
});
test('bounded JSON reads retain pagination headers and clean up their abort controllers', async () => {
    let sent=false;
    fetch.mockResolvedValue({ok:true,url:location.origin+'/api/v1/courses/42',headers:{get:name=>name==='content-type'?'application/json':name==='link'?'<http://localhost/api/v1/courses/42/pages?page=2>; rel="next"':null},
        body:{getReader:()=>({read:async()=>sent?{done:true}:(sent=true,{value:new TextEncoder().encode('{"id":42}'),done:false})})}});
    const result=await canvasRead(location.origin,'42','/api/v1/courses/42',new AbortController().signal);
    expect(result.data).toEqual({id:42}); expect(result.link).toContain('next');
    expect(fetch.mock.calls[0][1].credentials).toBe('include'); expect(fetch.mock.calls[0][1].method).toBeUndefined();
});
test('JSON safety limit cancels the stream without parsing a truncated response', async () => {
    const cancel=jest.fn(async()=>{});
    fetch.mockResolvedValue({ok:true,url:location.origin+'/api/v1/courses/42',headers:{get:()=> 'application/json'},
        body:{getReader:()=>({read:async()=>({value:new Uint8Array(8*1024*1024+1),done:false}),cancel})}});
    expect((await canvasRead(location.origin,'42','/api/v1/courses/42')).status).toBe(413); expect(cancel).toHaveBeenCalled();
});
