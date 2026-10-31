/* Local-only synthetic browser harness. Run with Node; never connects to Canvas.
   Exercises the real dashboard modal, port relay, DOMPurify, and JSZip with synthetic data. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');
const output = process.env.CDL_TEST_OUTPUT || path.join(require('os').tmpdir(), 'canvas-offline-harness');
fs.mkdirSync(output, { recursive: true });
const harness = `(() => {
const originalFetch = window.fetch.bind(window);
const origin = 'https://fixture.canvas-user-content.com', base = '/api/v1/courses/42';
const scenario = new URL(location.href).searchParams.get('scenario');
const pages = [{ page_id:1, url:'lesson', title:'Lesson and schedule', body:'<h2 id="intro">Introduction</h2><table><tr><th>Week</th><th>Reading</th></tr><tr><td>1</td><td><a href="/files/9?wrap=1">Lecture notes</a></td></tr></table><p><a href="/files/9/download">Same notes again</a></p><img src="/files/10/preview" alt="Course diagram"><p><a href="/courses/42/assignments/3">Assignment instructions</a></p><iframe title="Lecture recording" src="https://video.example/embed"></iframe><a href="https://reading.example/book?id=abc">Online reading</a>', published:true }];
const data = {
'/api/v1/users/self/profile': {id:7}, [base]:{name:'Offline export demonstration'},
[base+'/pages']:pages, [base+'/pages/page_id:1']:pages[0],
[base+'/discussion_topics']:[{id:2,title:'Welcome announcement',message:'<p>Read the course notes before class.</p>',posted_at:'2026-09-01T12:00:00Z',attachments:[{id:9}]}],
[base+'/discussion_topics/2']:{id:2},
[base+'/assignments']:[{id:3,name:'First assignment',description:'<p>Compare the two algorithms.</p><ul><li>Explain your approach.</li><li>Include references.</li></ul>',submission_types:['online_upload'],due_at:'2026-11-01T04:59:00Z'},{id:4,name:'Quiz excluded',is_quiz_assignment:true,description:'DO NOT EXPORT'}],
[base+'/assignments/3']:{id:3},
[base+'/modules']:[{id:20,name:'Week 1'}],
[base+'/modules/20/items']:[{id:100,type:'Page',page_url:'lesson',title:'Lesson and schedule'},{id:101,type:'Assignment',content_id:3,title:'First assignment'},{id:102,type:'File',content_id:9,title:'Lecture notes'}],
[base+'/files']:{error:'Canvas returned HTTP 403. Other course files could not be listed.',status:403},
'/api/v1/files/9':{id:9,display_name:'lecture-notes.txt','content-type':'text/plain',size:37,url:origin+'/files/9/download?verifier=SECRET'},
'/api/v1/files/10':{id:10,display_name:'diagram.svg','content-type':'image/svg+xml',size:200,url:origin+'/files/10/download?verifier=SECRET'}
};
if(scenario==='large') Object.assign(data['/api/v1/files/9'],{display_name:'synthetic-32MiB.bin','content-type':'application/octet-stream',size:32*1024*1024});
const connections = [], backgroundMessages = [];
function event() { const listeners = new Set(); return {addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn),emit:value=>[...listeners].forEach(fn=>fn(value))}; }
window.fixtureRead=async(input,courseId)=>{
const p = new URL(input,location.origin).pathname.replace('/courses/'+courseId,'/courses/42');
const d=scenario==='auth' && p==='/api/v1/users/self/profile'?{error:'Sign in to Canvas, then retry.',status:401}:data[p]||{error:'Fixture route unavailable',status:404};
if(p==='/api/v1/courses/42') return {data:{name:courseId==='42'?'Data Science demonstration':'Algorithms demonstration'}};
return d.error?d:{data:JSON.parse(JSON.stringify(d))};
};
window.chrome={runtime:{
onConnect:{addListener:fn=>connections.push(fn)},onMessage:{addListener:fn=>backgroundMessages.push(fn)},
connect:()=>{
const client={name:'cdl-offline-asset-v1',onMessage:event(),onDisconnect:event()}, server={name:client.name,sender:{tab:{id:42,url:'https://school.example/'}},onMessage:event(),onDisconnect:event()};
let closed=false;
client.postMessage=msg=>queueMicrotask(()=>{if(!closed)server.onMessage.emit(msg)});server.postMessage=msg=>queueMicrotask(()=>{if(!closed)client.onMessage.emit(msg)});
const close=()=>{if(closed)return;closed=true;queueMicrotask(()=>{client.onDisconnect.emit();server.onDisconnect.emit()});};client.disconnect=server.disconnect=close;
connections.forEach(fn=>fn(server));return client;
},
sendMessage:async msg=>{
if(msg.action==='offline_save_archive'){
if(scenario==='save-error')return {error:'Synthetic ZIP save interruption.'};
const blob=await originalFetch(msg.url).then(r=>r.blob());const result=await originalFetch('/capture',{method:'POST',body:blob});if(!result.ok)return {error:'Capture failed'};return {id:17};
}
return {state:'complete'};
}},storage:{session:{get:async()=>({}),set:async()=>{}}}};
window.fetch=async(url,options)=>{
if(String(url).startsWith(origin+'/files/')) {
if(scenario==='large' && String(url).includes('/9/')) {const response=new Response(new Uint8Array(32*1024*1024),{headers:{'content-type':'application/octet-stream'}});Object.defineProperty(response,'url',{value:String(url)});return response;}
if(scenario==='file-error' && String(url).includes('/10/')) {const response=new Response('denied',{status:403});Object.defineProperty(response,'url',{value:String(url)});return response;}
const body=String(url).includes('/9/')?'These are synthetic lecture notes.':'<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><rect width="300" height="100" fill="#eee"/><text x="20" y="55" font-size="22">Offline course diagram</text></svg>';
const response=new Response(body,{headers:{'content-type':String(url).includes('/9/')?'text/plain':'image/svg+xml'}});Object.defineProperty(response,'url',{value:String(url)});return response;
}
return originalFetch(url,options);
};
})();`;
const dashboard = `<!doctype html><html><head><meta charset="utf-8"><title>Canvas dashboard — local export test</title><link rel="stylesheet" href="/src/content/inject-ui.css"><link rel="stylesheet" href="/src/offline/modal.css"><style>body{font:16px system-ui;background:#f5f5f5;margin:40px;color:#30343a;--ic-brand-primary:#0374b5}#dashboard{display:flex;gap:24px}.ic-DashboardCard{width:280px;overflow:hidden;background:white;border:1px solid #ddd;border-radius:6px}.ic-DashboardCard__header{padding:30px 20px;background:#e4edf1}.ic-DashboardCard a{color:#174b6c;text-decoration:none}.ic-DashboardCard__action-container{padding:18px}</style></head><body><div id="application"><a id="global_nav_dashboard_link" href="/">Dashboard</a><h1>Dashboard</h1><div id="dashboard"><div class="ic-DashboardCard"><div class="ic-DashboardCard__header"><a href="/courses/42"><h3 class="ic-DashboardCard__header-title">Data Science demonstration</h3></a></div><div class="ic-DashboardCard__action-container">Fall semester · Course materials</div></div><div class="ic-DashboardCard"><div class="ic-DashboardCard__header"><a href="/courses/77"><h3 class="ic-DashboardCard__header-title">Algorithms demonstration</h3></a></div><div class="ic-DashboardCard__action-container">Fall semester · Course materials</div></div></div></div><script src="/harness.js"></script><script src="/src/vendor/purify.min.js"></script><script src="/src/vendor/jszip.min.js"></script><script src="/src/content/ui-builder.js"></script><script src="/src/offline/transport.js"></script><script src="/src/offline/core.js"></script><script src="/src/offline/io.js"></script><script src="/src/offline/styles.js"></script><script src="/src/offline/modal.js"></script><script src="/src/background/offline-downloads.js"></script><script src="/fixture-transport.js"></script><script src="/src/content/offline-entry.js"></script></body></html>`;
http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'POST' && url.pathname === '/capture') {
        let size = 0; const chunks = [];
        for await (const chunk of req) { size += chunk.length; if (size > 300 * 1024 * 1024) { res.writeHead(413); return res.end(); } chunks.push(chunk); }
        fs.writeFileSync(path.join(output, 'fixture-course.zip'), Buffer.concat(chunks));
        res.end('saved'); return;
    }
    if (url.pathname === '/' || url.pathname === '/dashboard') {res.setHeader('content-type','text/html');res.end(url.searchParams.get('scenario')==='dark'?dashboard.replace('</head>','<style>body{background:#17202b!important;color:#f5f5f5!important}.ic-DashboardCard{background:#222e3c!important}.ic-DashboardCard__header{background:#34445a!important}h2,h3,button,legend{color:#f5f5f5!important}</style></head>'):dashboard);return;}
    if (url.pathname === '/fixture-transport.js') {res.setHeader('content-type','text/javascript');res.end('window.CanvasOfflineTransport.createLocalTransport=(origin,courseId)=>(path)=>window.fixtureRead(path,courseId);');return;}
    if (url.pathname === '/harness.js') { res.setHeader('content-type', 'text/javascript'); res.end(harness); return; }
    const servingArchive = url.pathname.startsWith('/archive/');
    const serveRoot = servingArchive ? path.join(output, 'extracted') : root;
    let file = path.resolve(serveRoot, '.' + (servingArchive ? url.pathname.slice('/archive'.length) : url.pathname));
    if (!file.startsWith(serveRoot + path.sep)) { res.writeHead(403); res.end(); return; }
    try {
        let content = fs.readFileSync(file);
        res.setHeader('content-type', ({ '.js':'text/javascript','.html':'text/html','.css':'text/css','.png':'image/png' })[path.extname(file)] || 'application/octet-stream');
        res.end(content);
    } catch { res.writeHead(404); res.end(); }
}).listen(4179, '127.0.0.1', () => console.log('Offline test harness: http://127.0.0.1:4179/\nFixture output: ' + output));
