/* Deliberately local colors: host themes cannot make light-dialog text disappear. */
window.CanvasOfflineCSS = `
:host{all:initial;color-scheme:light}
dialog{box-sizing:border-box;width:480px;max-width:calc(100vw - 32px);max-height:85vh;overflow:auto;margin:auto;padding:24px;border:1px solid #d7dade;border-top:4px solid #8a1c1c;border-radius:14px;background:#fff!important;color:#202124!important;color-scheme:light!important;font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 20px 70px #10182840}
dialog::backdrop{background:rgba(20,25,32,.46)}
*{box-sizing:border-box} [hidden]{display:none!important}
header{display:flex;justify-content:space-between;align-items:center;gap:16px}
.brand{display:flex;align-items:center;gap:9px;font-size:13px;font-weight:600;color:#701616}
.brand img{border-radius:50%;flex:none}
h2{color:#202124!important;font:600 22px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:16px 0 8px}
p{color:#202124;margin:12px 0}#cdl-export-course{font-weight:600;overflow-wrap:anywhere}
.note{color:#5f6368;font-size:12px}
.status-panel{background:#eef6ff;border:1px solid #d4e5fb;border-radius:10px;padding:14px 16px;margin:20px 0 16px}
#cdl-export-status{margin:0;font-weight:600;color:#124978}
#cdl-export-detail{margin:6px 0 0;font-size:12px;color:#435871;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
dialog[data-state=running] #cdl-export-detail{display:block!important;height:1.55em;min-height:1.55em}
dialog[data-state=success] .status-panel{background:#edf8f1;border-color:#c6e8d1}
dialog[data-state=success] #cdl-export-status{color:#20633a}
dialog[data-state=error] .status-panel{background:#fff5ed;border-color:#f0d5bc}
progress{width:100%;height:8px;accent-color:#086baf;margin:8px 0}
footer{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}
button{font:600 13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:9px 15px;border:1px solid #c8ccd1;border-radius:7px;background:#fff;color:#30343a!important;cursor:pointer;transition:background .16s,box-shadow .16s,transform .16s}
button:hover{background:#f0f5fb;transform:translateY(-1px);box-shadow:0 3px 8px #183b5620}
button:active{transform:translateY(0);box-shadow:none}
button.primary{background:#086baf;border-color:#086baf;color:#fff!important}
button.primary:hover{background:#07558b;border-color:#07558b}
#cdl-export-close{font-size:24px;line-height:1;padding:0 4px;border:0;color:#30343a!important}
:focus-visible{outline:3px solid #086baf;outline-offset:3px}
@media(prefers-reduced-motion:reduce){button{transition:none}button:hover{transform:none}}
`;
