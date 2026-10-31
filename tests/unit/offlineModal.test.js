const fs=require('fs'), path=require('path');
let dialog, view, scan, fetchFiles, save, pendingScan;
const flush=async()=>{for(let i=0;i<15;i++) await Promise.resolve();};
const $=id=>dialog.querySelector('#cdl-export-'+id);
beforeEach(()=>{
    document.body.innerHTML='';
    window.eval(fs.readFileSync(path.join(__dirname,'../../src/offline/styles.js'),'utf8'));
    window.eval(fs.readFileSync(path.join(__dirname,'../../src/content/ui-builder.js'),'utf8'));
    dialog=window.CanvasDownloaderUI.createOfflineDialog(); document.body.append(dialog.cdlHost);
    dialog.showModal=()=>{dialog.open=true;}; dialog.close=()=>{dialog.open=false;};
    scan=jest.fn(async()=>{}); fetchFiles=jest.fn(async()=>{}); save=jest.fn(async()=>{});
    window.CanvasOffline={safeName:x=>x,ArchiveError:class extends Error{constructor(message,code){super(message);this.code=code;}},Session:class{
        constructor(options){this.progress=options.progress;this.title='First course';this.courseId=options.courseId;this.coverage=[];this.files=new Map();this.documents=[{id:'1',state:'ready'}];}
        scan(selected){this.selection=selected;return scan(this);}
        fetchFiles(){return fetchFiles(this);}
        buildEntries(){this.documents.forEach(d=>{d.state='saved';});return new Map([['index.html','fixture']]);}
        report(){return {items:this.documents,coverage:this.coverage};}
        clear(){} check(){}
    }};
    window.CanvasOfflineTransport={createLocalTransport:jest.fn(()=>async()=>({data:{name:'First course'}}))};
    window.CanvasOfflineIO={fetchAsset:jest.fn(),saveBlob:save};
    window.JSZip=class{file(){} async generateAsync(options,progress){progress({percent:100});return new Blob(['fixture']);}};
    window.eval(fs.readFileSync(path.join(__dirname,'../../src/offline/modal.js'),'utf8'));
    view=window.CanvasOfflineModal.create(dialog);
});
test('one click starts the complete export without choices or acknowledgement',async()=>{
    await view.open({courseId:'1',title:'First',origin:location.origin});
    expect(scan).toHaveBeenCalledTimes(1);expect(scan.mock.calls[0][0].selection).toEqual({pages:true,announcements:true,assignments:true,files:true});
    expect(save).toHaveBeenCalledTimes(1);expect($('title').textContent).toBe('Course exported');
    expect(dialog.querySelectorAll('input,fieldset,details')).toHaveLength(0);
    expect(document.querySelector('dialog')).toBeNull();expect(dialog.cdlHost.shadowRoot.querySelector('dialog')).toBe(dialog);
});
test('shows current attachment and count while downloading, then clears the detail',async()=>{
    fetchFiles.mockImplementation(async s=>{
        s.progress('Fetching files',undefined,{phase:'download',current:3,total:12,item:'Lecture.pdf',bytes:1048576,size:2097152});
        expect($('status').textContent).toBe('Downloading attachments…');
        expect($('detail').textContent).toBe('3 of 12 · Lecture.pdf · 1.0 MB of 2.0 MB');
        expect($('detail').hidden).toBe(false);
    });
    await view.open({courseId:'1',title:'First',origin:location.origin});
    expect($('detail').hidden).toBe(true);expect(dialog.dataset.state).toBe('success');
});
test('uses pagehide cleanup and only warns about leaving during an export',async()=>{
    const add=jest.spyOn(window,'addEventListener'),remove=jest.spyOn(window,'removeEventListener');
    window.CanvasOfflineModal.create(dialog);
    expect(add.mock.calls.some(([event])=>event==='unload')).toBe(false);
    expect(add.mock.calls.some(([event])=>event==='pagehide')).toBe(true);
    await view.open({courseId:'1',title:'First',origin:location.origin});
    expect(remove.mock.calls.some(([event])=>event==='beforeunload')).toBe(true);
    add.mockRestore();remove.mockRestore();
});
test('missing collections do not block export and are summarized after saving',async()=>{
    scan.mockImplementation(async s=>{s.coverage=[{name:'Pages',state:'incomplete',reason:'HTTP 404'}];});
    await view.open({courseId:'1',title:'First',origin:location.origin});
    expect(save).toHaveBeenCalledTimes(1);expect($('summary').hidden).toBe(false);
    expect($('summary').textContent).toContain('export-report.html');expect(dialog.textContent).not.toContain('404');
});
test('closing and reopening preserves an active run and its course',async()=>{
    scan.mockImplementation(()=>new Promise(resolve=>{pendingScan=resolve;}));
    const running=view.open({courseId:'1',title:'First',origin:location.origin});await flush();
    $('close').click();expect(dialog.open).toBe(false);
    await view.open({courseId:'2',title:'Second',origin:location.origin});
    expect(dialog.open).toBe(true);expect(scan).toHaveBeenCalledTimes(1);expect($('course').textContent).toBe('First');
    pendingScan();await running;expect(save).toHaveBeenCalledTimes(1);
});
test('another click after completion starts a fresh export for the selected course',async()=>{
    await view.open({courseId:'1',title:'First',origin:location.origin});
    await view.open({courseId:'2',title:'Second',origin:location.origin});
    expect(scan.mock.calls.at(-1)[0].courseId).toBe('2');expect(save).toHaveBeenCalledTimes(2);
});
test('a save failure shows a simple retry, never success or raw technical details',async()=>{
    save.mockRejectedValue(new Error('HTTP 599 internal message'));
    await view.open({courseId:'1',title:'First',origin:location.origin});
    expect($('title').textContent).toContain('couldn’t finish');expect($('status').textContent).toContain('try again');
    expect($('retry').hidden).toBe(false);expect(dialog.textContent).not.toContain('599');
});

test('estimated attachment percentage is visible and accessible without implying overall completion',async()=>{
    fetchFiles.mockImplementation(async s=>{
        s.progress('Downloading attachments…',42.7,{phase:'download',current:8,total:20,item:'Lecture.pdf',estimated:true});
        expect($('progress').value).toBe(42.7);
        expect($('detail').textContent).toContain('About 42% · 8 of 20 processed');
        expect($('progress').getAttribute('aria-valuetext')).toContain('Downloading attachments… 42 percent, estimated');
    });
    await view.open({courseId:'1',title:'First',origin:location.origin});
});

test('publishes progress outside the modal and clears busy state on completion or failure',async()=>{
    const notify=jest.fn();const tracked=window.CanvasOfflineModal.create(dialog,notify);
    await tracked.open({courseId:'1',title:'First',origin:location.origin});
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({courseId:'1',busy:true,message:'Finding course materials…'}));
    expect(notify.mock.calls.at(-1)[0]).toMatchObject({courseId:'1',busy:false});
    save.mockRejectedValue(new Error('save failed'));notify.mockClear();
    await tracked.open({courseId:'1',title:'First',origin:location.origin});
    expect(notify.mock.calls.some(([state])=>state.busy===false)).toBe(true);
    expect(notify.mock.calls.at(-1)[0].busy).toBe(false);
});
