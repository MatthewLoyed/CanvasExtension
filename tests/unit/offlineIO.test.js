const fs=require('fs'),path=require('path');
const script=fs.readFileSync(path.join(__dirname,'../../src/offline/io.js'),'utf8');
const worker=fs.readFileSync(path.join(__dirname,'../../src/background/offline-downloads.js'),'utf8');
const flush=async()=>{for(let i=0;i<12;i++) await Promise.resolve();};
let receive,disconnect,port,io;
beforeEach(()=>{
    window.CanvasOffline={ArchiveError:class extends Error{constructor(message,code){super(message);this.code=code;}}};
    window.eval(script);io=window.CanvasOfflineIO;
    port={postMessage:jest.fn(),disconnect:jest.fn(),onMessage:{addListener:fn=>{receive=fn;}},onDisconnect:{addListener:fn=>{disconnect=fn;}}};
});
test('asset bridge reads one bounded chunk at a time and disconnects when done',async()=>{
    const pending=io.fetchAsset('https://school.example/files/1',{}, {connect:()=>port});
    receive({type:'headers',ok:true,status:200,url:'https://school.example/files/1',contentType:'text/plain'});
    const response=await pending,reader=response.body.getReader();const chunk=reader.read();
    expect(port.postMessage).toHaveBeenLastCalledWith({type:'pull'});
    receive({type:'chunk',done:false,bytes:btoa('ABC')});expect([...(await chunk).value]).toEqual([65,66,67]);
    const end=reader.read();receive({type:'chunk',done:true});expect(await end).toEqual({done:true});expect(port.disconnect).toHaveBeenCalled();
});
test('an error between chunks is retained instead of becoming a successful empty stream',async()=>{
    const pending=io.fetchAsset('https://school.example/files/1',{}, {connect:()=>port});
    receive({type:'headers',ok:true,status:200,url:'https://school.example/files/1'});const response=await pending;
    receive({type:'error',message:'Timed out',code:'file'});
    await expect(response.body.getReader().read()).rejects.toThrow('Timed out');
});
test('abort releases the connection and rejects the pending read',async()=>{
    const controller=new AbortController();const pending=io.fetchAsset('https://school.example/files/1',{signal:controller.signal},{connect:()=>port});
    receive({type:'headers',ok:true,status:200,url:'https://school.example/files/1'});const response=await pending;
    const read=response.body.getReader().read();controller.abort();await expect(read).rejects.toMatchObject({name:'AbortError'});expect(port.disconnect).toHaveBeenCalled();
});
test('ZIP save verifies completion through messages without creating a new tab',async()=>{
    URL.createObjectURL=jest.fn(()=> 'blob:http://localhost/fixture');URL.revokeObjectURL=jest.fn();
    const sendMessage=jest.fn(async msg=>msg.action==='offline_save_archive'?{id:12}:{state:'complete'});
    await io.saveBlob(new Blob(['archive']),'course.zip',new AbortController().signal,{sendMessage});
    expect(sendMessage).toHaveBeenNthCalledWith(1,{action:'offline_save_archive',url:'blob:http://localhost/fixture',filename:'course.zip'});
    expect(sendMessage).toHaveBeenNthCalledWith(2,{action:'offline_archive_status',id:12});expect(URL.revokeObjectURL).toHaveBeenCalled();
});
describe('privileged background endpoints',()=>{
    let handler,connect,chromeApi;
    beforeEach(()=>{
        chromeApi=global.chrome={runtime:{onMessage:{addListener:fn=>{handler=fn;}},onConnect:{addListener:fn=>{connect=fn;}}},
            downloads:{download:jest.fn(async()=>12),search:jest.fn(async()=>[{state:'complete'}]),cancel:jest.fn(async()=>{})},
            storage:{session:{get:jest.fn(async()=>({})),set:jest.fn(async()=>{})}}};
        window.eval(worker);
    });
    const source={tab:{id:7,url:'https://school.example/'}};
    test('dashboard saves are owned by the requesting tab, and other tabs cannot inspect them',async()=>{
        const reply=jest.fn();handler({action:'offline_save_archive',url:'blob:https://school.example/fixture',filename:'course.zip'},source,reply);await flush();
        expect(reply).toHaveBeenCalledWith({id:12});const other=jest.fn();handler({action:'offline_archive_status',id:12},{tab:{id:8,url:'https://school.example/'}},other);await flush();
        expect(other.mock.calls[0][0].error).toContain('does not belong');expect(chromeApi.downloads.search).not.toHaveBeenCalled();
    });
    test('foreign blob URLs and path-traversal filenames never reach Downloads',async()=>{
        for(const [url,filename] of [['blob:https://evil.example/id','course.zip'],['blob:https://school.example/id','../course.zip']]){
            const reply=jest.fn();handler({action:'offline_save_archive',url,filename},source,reply);await flush();expect(reply.mock.calls[0][0].error).toContain('Invalid');
        }
        expect(chromeApi.downloads.download).not.toHaveBeenCalled();
    });
    test('non-Canvas-shaped source routes cannot save archives',()=>{
        const reply=jest.fn();handler({action:'offline_save_archive'},{tab:{id:7,url:'https://school.example/account'}},reply);
        expect(reply.mock.calls[0][0].error).toContain('dashboard');
    });
    test('file relay refuses foreign hosts before fetching',async()=>{
        let message;const relay={name:'cdl-offline-asset-v1',sender:source,postMessage:jest.fn(),onMessage:{addListener:fn=>{message=fn;}},onDisconnect:{addListener:jest.fn()}};
        global.fetch=jest.fn();connect(relay);await message({type:'start',url:'https://evil.example/file'});
        expect(fetch).not.toHaveBeenCalled();expect(relay.postMessage).toHaveBeenCalledWith(expect.objectContaining({type:'error'}));
    });
    test('relay accepts Canvas file storage redirects used by the real course',async()=>{
        let message;const relay={name:'cdl-offline-asset-v1',sender:source,postMessage:jest.fn(),onMessage:{addListener:fn=>{message=fn;}},onDisconnect:{addListener:jest.fn()}};
        global.fetch=jest.fn(async()=>({ok:true,status:200,url:'https://cdn.inst-fs-iad-prod.inscloudgate.net/id/Assignment_4.pdf',headers:{get:()=> 'application/pdf'},body:{getReader:()=>({read:async()=>({done:true}),cancel:async()=>{}})}}));
        connect(relay);await message({type:'start',url:'https://school.example/files/9/download'});
        expect(relay.postMessage).toHaveBeenCalledWith(expect.objectContaining({type:'headers'}));
        await message({type:'pull'});
    });
    test('relay applies backpressure and caps every encoded chunk',async()=>{
        let message,stop;const relay={name:'cdl-offline-asset-v1',sender:source,postMessage:jest.fn(),onMessage:{addListener:fn=>{message=fn;}},onDisconnect:{addListener:fn=>{stop=fn;}}};
        const reader={read:jest.fn(async()=>({value:new Uint8Array(300000),done:false})),cancel:jest.fn(async()=>{})};
        global.fetch=jest.fn(async()=>({ok:true,status:200,url:'https://school.example/files/1',headers:{get:()=> 'application/octet-stream'},body:{getReader:()=>reader}}));
        connect(relay);await message({type:'start',url:'https://school.example/files/1'});
        expect(reader.read).not.toHaveBeenCalled();await message({type:'pull'});
        expect(reader.read).toHaveBeenCalledTimes(1);expect(atob(relay.postMessage.mock.calls.at(-1)[0].bytes).length).toBe(256*1024);
        await message({type:'pull'});expect(reader.read).toHaveBeenCalledTimes(1);
        expect(atob(relay.postMessage.mock.calls.at(-1)[0].bytes).length).toBe(300000-256*1024);stop();
    });
});
