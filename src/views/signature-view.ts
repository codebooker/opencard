import { esc } from "./html";

// A reusable "email signature" block: live preview + copy-to-clipboard (rich HTML
// and plain text) + the raw HTML source. Used by the admin preview and /me.
export function signatureBlock(html: string, text: string): string {
  return `
  <div class="stat" style="max-width:720px">
    <p class="muted" style="margin:0 0 8px">Preview — this is exactly what pastes into your email client:</p>
    <div id="sig-html" style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:16px">${html}</div>
    <textarea id="sig-text" style="position:absolute;left:-9999px" aria-hidden="true">${esc(text)}</textarea>
    <p style="margin-top:12px">
      <button type="button" class="btn" onclick="ocCopySig()">Copy signature</button>
      <button type="button" class="btn secondary" onclick="ocCopyText()">Copy plain text</button>
      <span id="sig-copied" class="muted" style="margin-left:8px"></span>
    </p>
    <details style="margin-top:8px"><summary class="muted">HTML source</summary>
      <textarea readonly rows="8" style="width:100%;font:12px monospace;margin-top:6px">${esc(html)}</textarea>
    </details>
  </div>
  <script>
  function ocFlash(msg){var e=document.getElementById('sig-copied');if(e){e.textContent=msg;setTimeout(function(){e.textContent='';},2000);}}
  function ocCopySig(){
    var el=document.getElementById('sig-html');
    var html=el.innerHTML, text=document.getElementById('sig-text').value;
    try{
      if(navigator.clipboard&&window.ClipboardItem){
        navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([html],{type:'text/html'}),'text/plain':new Blob([text],{type:'text/plain'})})]).then(function(){ocFlash('Copied — paste into your email signature settings.');},ocSelectFallback);
      } else { ocSelectFallback(); }
    }catch(e){ ocSelectFallback(); }
  }
  function ocSelectFallback(){
    var el=document.getElementById('sig-html');
    var r=document.createRange();r.selectNode(el);var s=window.getSelection();s.removeAllRanges();s.addRange(r);
    try{document.execCommand('copy');ocFlash('Copied.');}catch(e){ocFlash('Select the preview and copy.');}
    s.removeAllRanges();
  }
  function ocCopyText(){
    var t=document.getElementById('sig-text').value;
    if(navigator.clipboard){navigator.clipboard.writeText(t).then(function(){ocFlash('Plain text copied.');});}
  }
  </script>`;
}
