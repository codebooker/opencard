import { esc } from "./html";
import { asLabeled, asSocials, LabeledValue, SocialLink } from "../types";
import { CARD_LAYOUTS } from "../layouts";

// ---- Social link types ----
export const SOCIAL_TYPES: [string, string][] = [
  ["linkedin", "LinkedIn"],
  ["twitter", "X / Twitter"],
  ["instagram", "Instagram"],
  ["facebook", "Facebook"],
  ["youtube", "YouTube"],
  ["tiktok", "TikTok"],
  ["github", "GitHub"],
  ["whatsapp", "WhatsApp"],
  ["website", "Website"],
  ["other", "Other"],
];

export function socialOptions(selected: string): string {
  return SOCIAL_TYPES.map(
    ([v, l]) => `<option value="${v}" ${v === selected ? "selected" : ""}>${l}</option>`
  ).join("");
}

export function socialRow(type = "", value = ""): string {
  return `<div class="social-row">
    <select class="social-type">${socialOptions(type || "linkedin")}</select>
    <input class="social-url" value="${esc(value)}" placeholder="https://..." />
    <button type="button" class="social-remove btn secondary" title="Remove">✕</button>
  </div>`;
}

// ---- Self-service field catalog (keys + labels) ----
export const SELF_FIELDS: [string, string][] = [
  ["photo", "Profile photo"],
  ["bio", "Bio"],
  ["title", "Job title"],
  ["department", "Department"],
  ["pronouns", "Pronouns"],
  ["phones", "Phone numbers"],
  ["emails", "Email addresses"],
  ["websites", "Websites"],
  ["socials", "Social links"],
  ["name", "Name"],
];
export const DEFAULT_SELF_FIELDS = ["photo", "bio", "phones", "emails", "socials"];

function linesFromLabeled(items: LabeledValue[]): string {
  return items.map((i) => `${i.label} | ${i.value}`).join("\n");
}

// ---- Reusable field markup ----
export function photoField(currentUrl?: string | null): string {
  // "Adjust" reloads the saved photo into the cropper. Only offered for
  // same-origin uploads — external URLs would taint the canvas export.
  const adjustable = !!currentUrl && currentUrl.startsWith("/uploads/");
  return `<h3>Profile photo</h3>
    ${
      currentUrl
        ? `<p class="muted">Current: <img src="${esc(
            currentUrl
          )}" style="height:54px;width:54px;border-radius:50%;object-fit:cover;vertical-align:middle" />${
            adjustable
              ? ` <button type="button" id="adjustPhoto" class="btn secondary" data-src="${esc(
                  currentUrl
                )}" style="margin-left:8px;padding:5px 10px;font-size:13px">Adjust (zoom / position)</button>`
              : ""
          }</p>`
        : ""
    }
    <input type="file" id="photoFile" name="photoFile" accept="image/*" />
    <div id="cropper" class="cropper" hidden>
      <div class="crop-stage" id="cropStage"><img id="cropImg" alt="" draggable="false" /></div>
      <div class="crop-controls">
        <label class="crop-zoom">Zoom <input type="range" id="cropZoom" min="1" max="3" step="0.01" value="1" /></label>
        <div class="nudge">
          <button type="button" data-nudge="up" title="Up">↑</button>
          <button type="button" data-nudge="down" title="Down">↓</button>
          <button type="button" data-nudge="left" title="Left">←</button>
          <button type="button" data-nudge="right" title="Right">→</button>
        </div>
      </div>
      <p class="muted">Drag the photo to reposition, or use the arrows. Saved as a square avatar.</p>
    </div>
    <label>…or paste a photo URL</label><input name="photoUrl" value="${esc(currentUrl || "")}" />`;
}

export function labeledField(label: string, name: string, items: unknown, placeholder: string): string {
  return `<label>${esc(label)}</label><textarea name="${name}" rows="2" placeholder="${esc(
    placeholder
  )}">${esc(linesFromLabeled(asLabeled(items)))}</textarea>`;
}

// ---- Labeled multi-value rows (phones / emails / websites): dropdown + value ----
export const PHONE_LABELS = ["Work", "Mobile", "Personal", "Home", "Main", "Fax", "Other"];
export const EMAIL_LABELS = ["Work", "Personal", "Other"];
export const WEB_LABELS = ["Website", "Company", "Portfolio", "Blog", "LinkedIn", "Other"];

function labelOptions(options: string[], selected: string): string {
  // If the saved label isn't in the list, keep it as a selected option so nothing is lost.
  const list = options.includes(selected) || !selected ? options : [selected, ...options];
  return list
    .map((o) => `<option ${o === (selected || options[0]) ? "selected" : ""}>${esc(o)}</option>`)
    .join("");
}

function labeledRow(options: string[], label: string, value: string, placeholder: string): string {
  return `<div class="lr-row">
    <select class="lr-label">${labelOptions(options, label)}</select>
    <input class="lr-value" value="${esc(value)}" placeholder="${esc(placeholder)}" />
    <button type="button" class="lr-remove btn secondary" title="Remove">✕</button>
  </div>`;
}

export function labeledRowsField(opts: {
  name: string;
  title: string;
  placeholder: string;
  options: string[];
  items: unknown;
}): string {
  const items = asLabeled(opts.items);
  const rows = items.length ? items : [{ label: opts.options[0], value: "" }];
  return `<label>${esc(opts.title)}</label>
    <div class="labeled-rows" data-name="${esc(opts.name)}" data-options="${esc(
    JSON.stringify(opts.options)
  )}" data-placeholder="${esc(opts.placeholder)}">
      ${rows.map((i) => labeledRow(opts.options, i.label, i.value, opts.placeholder)).join("")}
    </div>
    <button type="button" class="lr-add btn secondary" data-for="${esc(opts.name)}">+ Add ${esc(
    opts.title.toLowerCase()
  )}</button>
    <textarea name="${esc(opts.name)}" class="lr-data" hidden></textarea>`;
}

export function socialsField(socials: unknown): string {
  return `<label>Social links</label>
    <div id="socials-rows" class="social-rows">
      ${asSocials(socials)
        .map((s: SocialLink) => socialRow(s.type, s.value))
        .join("")}
    </div>
    <button type="button" id="add-social" class="btn secondary">+ Add social link</button>
    <textarea name="socials" id="socials-data" hidden></textarea>`;
}

// ---- Reusable client scripts (returned WITHOUT <script> wrapper) ----
export function cropperScript(): string {
  return `(function(){
    var input=document.getElementById('photoFile');
    if(!input) return;
    var cropper=document.getElementById('cropper');
    var stage=document.getElementById('cropStage');
    var img=document.getElementById('cropImg');
    var zoom=document.getElementById('cropZoom');
    var form=input.closest('form');
    var S=300, nw=0, nh=0, base=1, k=1, ox=0, oy=0, ready=false, done=false;
    function apply(){
      k=base*parseFloat(zoom.value);
      var w=nw*k, h=nh*k;
      img.style.width=w+'px'; img.style.height=h+'px';
      img.style.left=(S/2 - w/2 + ox)+'px'; img.style.top=(S/2 - h/2 + oy)+'px';
    }
    function clamp(){
      var halfW=(nw*k)/2, halfH=(nh*k)/2;
      var mx=Math.max(0, halfW - S/2), my=Math.max(0, halfH - S/2);
      ox=Math.max(-mx, Math.min(mx, ox)); oy=Math.max(-my, Math.min(my, oy));
    }
    function loadIntoCropper(url){
      img.onload=function(){
        nw=img.naturalWidth; nh=img.naturalHeight; base=Math.max(S/nw, S/nh);
        ox=0; oy=0; zoom.value=1; ready=true; done=false; apply(); cropper.hidden=false;
      };
      // Preview failed (unsupported format, blocked URL): disarm the cropper so
      // the submit interception can't run against a broken image — the picked
      // file still uploads as-is, it just skips the crop step.
      img.onerror=function(){ ready=false; cropper.hidden=true; };
      img.src=url;
    }
    input.addEventListener('change', function(){
      var f=input.files && input.files[0]; if(!f) return;
      loadIntoCropper(URL.createObjectURL(f));
    });
    // Re-crop the already-saved photo (same-origin uploads only).
    var adjust=document.getElementById('adjustPhoto');
    if(adjust){ adjust.addEventListener('click', function(){
      loadIntoCropper(adjust.getAttribute('data-src'));
      cropper.scrollIntoView({behavior:'smooth', block:'center'});
    }); }
    zoom.addEventListener('input', function(){ apply(); clamp(); apply(); });
    var btns=document.querySelectorAll('[data-nudge]');
    for(var i=0;i<btns.length;i++){
      btns[i].addEventListener('click', function(){
        var d=this.getAttribute('data-nudge'), s=16;
        if(d==='up') oy-=s; else if(d==='down') oy+=s; else if(d==='left') ox-=s; else if(d==='right') ox+=s;
        clamp(); apply();
      });
    }
    var drag=false, px=0, py=0;
    stage.addEventListener('pointerdown', function(e){ if(!ready)return; drag=true; px=e.clientX; py=e.clientY; try{stage.setPointerCapture(e.pointerId);}catch(_){} });
    stage.addEventListener('pointermove', function(e){ if(!drag)return; ox+=e.clientX-px; oy+=e.clientY-py; px=e.clientX; py=e.clientY; clamp(); apply(); });
    stage.addEventListener('pointerup', function(){ drag=false; });
    form.addEventListener('submit', function(e){
      if(!ready || done) return;
      // If the crop export fails for ANY reason, the save must still go
      // through with the original file — never let the cropper eat a submit.
      try{
        e.preventDefault();
        var T=600, cv=document.createElement('canvas'); cv.width=T; cv.height=T;
        var ctx=cv.getContext('2d'); ctx.fillStyle='#fff'; ctx.fillRect(0,0,T,T);
        var sc=T/S, ds=k*sc, dw=nw*ds, dh=nh*ds, cx=T/2+ox*sc, cy=T/2+oy*sc;
        ctx.drawImage(img, cx-dw/2, cy-dh/2, dw, dh);
        cv.toBlob(function(blob){
          try{ if(blob){ var file=new File([blob],'photo.jpg',{type:'image/jpeg'}); var dt=new DataTransfer(); dt.items.add(file); input.files=dt.files; } }catch(_){}
          done=true; form.submit();
        }, 'image/jpeg', 0.9);
      }catch(_){ done=true; form.submit(); }
    });
  })();`;
}

export function socialsScript(): string {
  return `(function(){
    var rows=document.getElementById('socials-rows');
    var data=document.getElementById('socials-data');
    var addBtn=document.getElementById('add-social');
    if(!rows||!data||!addBtn) return;
    var TYPES=${JSON.stringify(SOCIAL_TYPES)};
    function options(){ return TYPES.map(function(t){ return '<option value="'+t[0]+'">'+t[1]+'</option>'; }).join(''); }
    function sync(){
      var lines=[]; var list=rows.querySelectorAll('.social-row');
      for(var i=0;i<list.length;i++){
        var t=list[i].querySelector('.social-type').value;
        var u=list[i].querySelector('.social-url').value.trim();
        if(u) lines.push(t+' | '+u);
      }
      data.value=lines.join('\\n');
    }
    rows.addEventListener('input', sync);
    rows.addEventListener('change', sync);
    rows.addEventListener('click', function(e){
      if(e.target.classList.contains('social-remove')){ var row=e.target.closest('.social-row'); if(row) row.remove(); sync(); }
    });
    addBtn.addEventListener('click', function(){
      var div=document.createElement('div'); div.className='social-row';
      div.innerHTML='<select class="social-type">'+options()+'</select>'+
        '<input class="social-url" placeholder="https://..." />'+
        '<button type="button" class="social-remove btn secondary" title="Remove">\\u2715</button>';
      rows.appendChild(div); div.querySelector('.social-url').focus();
    });
    sync();
  })();`;
}

export function labeledRowsScript(): string {
  return `(function(){
    function opts(list, sel){ return list.map(function(o){ return '<option'+(o===sel?' selected':'')+'>'+o+'</option>'; }).join(''); }
    function group(name){ return document.querySelector('.labeled-rows[data-name="'+name+'"]'); }
    function listOf(g){ try { return JSON.parse(g.getAttribute('data-options')||'[]'); } catch(e){ return []; } }
    function sync(g){
      var name=g.getAttribute('data-name');
      var ta=document.querySelector('textarea.lr-data[name="'+name+'"]');
      if(!ta) return;
      var lines=[], rows=g.querySelectorAll('.lr-row');
      for(var i=0;i<rows.length;i++){
        var label=rows[i].querySelector('.lr-label').value;
        var val=rows[i].querySelector('.lr-value').value.trim();
        if(val) lines.push(label+' | '+val);
      }
      ta.value=lines.join('\\n');
    }
    function addRow(g){
      var list=listOf(g), ph=g.getAttribute('data-placeholder')||'';
      var div=document.createElement('div'); div.className='lr-row';
      div.innerHTML='<select class="lr-label">'+opts(list,list[0])+'</select>'+
        '<input class="lr-value" placeholder="'+ph+'" />'+
        '<button type="button" class="lr-remove btn secondary" title="Remove">\\u2715</button>';
      g.appendChild(div); div.querySelector('.lr-value').focus();
    }
    var groups=document.querySelectorAll('.labeled-rows');
    for(var i=0;i<groups.length;i++){ (function(g){
      g.addEventListener('input', function(){ sync(g); });
      g.addEventListener('change', function(){ sync(g); });
      sync(g);
    })(groups[i]); }
    document.addEventListener('click', function(e){
      var t=e.target;
      if(t.classList && t.classList.contains('lr-remove')){
        var g=t.closest('.labeled-rows'), row=t.closest('.lr-row');
        if(row) row.remove(); if(g) sync(g);
      } else if(t.classList && t.classList.contains('lr-add')){
        var g=group(t.getAttribute('data-for')); if(g){ addRow(g); sync(g); }
      }
    });
  })();`;
}

// ---- Visual design controls (layout thumbnails + color swatches + font) with live preview ----
export const FONT_OPTIONS: [string, string][] = [
  ["system", "System (sans-serif)"],
  ["grotesk", "Helvetica / Grotesk"],
  ["rounded", "Rounded"],
  ["serif", "Serif (Georgia)"],
  ["mono", "Monospace"],
];

const LAYOUT_THUMBS: Record<string, string> = {
  classic: `<svg viewBox="0 0 40 60"><rect width="40" height="22" rx="2" fill="currentColor"/><circle cx="20" cy="22" r="6" fill="#fff" stroke="currentColor" stroke-width="2"/><rect x="9" y="32" width="22" height="3" rx="1.5" fill="#cbd5e1"/><rect x="11" y="39" width="18" height="2" rx="1" fill="#e5e7eb"/><rect x="6" y="49" width="28" height="6" rx="3" fill="currentColor"/></svg>`,
  banner: `<svg viewBox="0 0 40 60"><rect width="40" height="13" rx="2" fill="currentColor"/><circle cx="20" cy="13" r="5" fill="#fff" stroke="currentColor" stroke-width="2"/><rect x="9" y="24" width="22" height="3" rx="1.5" fill="#cbd5e1"/><rect x="11" y="31" width="18" height="2" rx="1" fill="#e5e7eb"/><rect x="6" y="49" width="28" height="6" rx="3" fill="currentColor"/></svg>`,
  minimal: `<svg viewBox="0 0 40 60"><circle cx="20" cy="12" r="6" fill="#fff" stroke="currentColor" stroke-width="2"/><rect x="9" y="24" width="22" height="3" rx="1.5" fill="#cbd5e1"/><rect x="11" y="31" width="18" height="2" rx="1" fill="#e5e7eb"/><rect x="6" y="49" width="28" height="6" rx="3" fill="currentColor"/></svg>`,
  wave: `<svg viewBox="0 0 40 60"><path d="M0,0 H40 V21 H29 C24,21.2 22.5,29.5 18.6,30 H0 Z" fill="currentColor"/><rect x="9" y="34" width="22" height="3" rx="1.5" fill="#cbd5e1"/><rect x="11" y="41" width="18" height="2" rx="1" fill="#e5e7eb"/><rect x="6" y="50" width="28" height="6" rx="3" fill="currentColor"/></svg>`,
  split: `<svg viewBox="0 0 40 60"><rect width="3" height="60" fill="currentColor"/><rect x="3" width="37" height="12" fill="currentColor"/><rect x="7" y="7" width="11" height="11" rx="3" fill="#fff" stroke="currentColor" stroke-width="2"/><rect x="7" y="24" width="20" height="3" rx="1.5" fill="#cbd5e1"/><rect x="7" y="31" width="15" height="2" rx="1" fill="#e5e7eb"/><rect x="6" y="49" width="28" height="6" rx="3" fill="currentColor"/></svg>`,
  spotlight: `<svg viewBox="0 0 40 60"><rect width="40" height="34" rx="2" fill="currentColor"/><rect y="22" width="40" height="12" fill="currentColor" opacity="0.55"/><rect x="5" y="24" width="20" height="3" rx="1.5" fill="#fff"/><rect x="5" y="29" width="14" height="2" rx="1" fill="#fff" opacity="0.8"/><rect x="9" y="41" width="22" height="2" rx="1" fill="#e5e7eb"/><rect x="6" y="49" width="28" height="6" rx="3" fill="currentColor"/></svg>`,
  frame: `<svg viewBox="0 0 40 60"><rect x="1.5" y="1.5" width="37" height="57" rx="3" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="20" cy="14" r="6" fill="#fff" stroke="currentColor" stroke-width="2"/><rect x="10" y="26" width="20" height="3" rx="1.5" fill="#cbd5e1"/><rect x="14" y="33" width="12" height="2" rx="1" fill="#e5e7eb"/><rect x="16" y="39" width="8" height="2" rx="1" fill="currentColor"/><rect x="8" y="47" width="24" height="6" rx="3" fill="currentColor"/></svg>`,
};

export function designControls(v: {
  layout?: string | null;
  primaryColor?: string | null;
  textColor?: string | null;
  bgColor?: string | null;
  font?: string | null;
  logoUrl?: string | null;
}): string {
  const layout = v.layout || "classic";
  const primary = v.primaryColor || "#1f6f43";
  const text = v.textColor || "#111827";
  const bg = v.bgColor || "#ffffff";
  const font = v.font || "system";
  const logo = v.logoUrl || "";
  const src =
    `/preview/card?layout=${encodeURIComponent(layout)}&primary=${encodeURIComponent(primary)}` +
    `&text=${encodeURIComponent(text)}&bg=${encodeURIComponent(bg)}&font=${encodeURIComponent(font)}` +
    (logo ? `&logo=${encodeURIComponent(logo)}` : "");

  const thumbs = [...CARD_LAYOUTS]
    .map(
      (l) => `<label class="layout-thumb ${l === layout ? "sel" : ""}">
        <input type="radio" name="layout" value="${l}" ${l === layout ? "checked" : ""} />
        ${LAYOUT_THUMBS[l]}<span>${l}</span></label>`
    )
    .join("");

  return `<div class="design-editor">
    <div class="design-controls">
      <label>Layout</label>
      <div class="layout-thumbs">${thumbs}</div>
      <div class="grid2">
        <div><label>Primary color</label><input type="color" class="color" name="primaryColor" value="${esc(primary)}" /></div>
        <div><label>Font</label><select name="font">${FONT_OPTIONS.map(
          ([fv, fl]) => `<option value="${fv}" ${fv === font ? "selected" : ""}>${esc(fl)}</option>`
        ).join("")}</select></div>
      </div>
      <div class="grid2">
        <div><label>Text color</label><input type="color" class="color" name="textColor" value="${esc(text)}" /></div>
        <div><label>Background</label><input type="color" class="color" name="bgColor" value="${esc(bg)}" /></div>
      </div>
    </div>
    <div class="design-preview-wrap">
      <div class="device"><iframe id="design-preview" src="${src}" title="Live preview"></iframe></div>
      <p class="muted">Live preview — updates as you edit</p>
    </div>
  </div>`;
}

export function designScripts(): string {
  return `<script>(function(){
    var ed=document.querySelector('.design-editor'); if(!ed) return;
    var iframe=document.getElementById('design-preview');
    var form=ed.closest('form');
    var t;
    function v(sel){ var el=ed.querySelector(sel); return el?el.value:''; }
    function layoutVal(){ var r=ed.querySelector('input[name=layout]:checked'); return r?r.value:'classic'; }
    function logoVal(){ var l=form&&form.querySelector('input[name=logoUrl]'); return (l&&/^https:|^\\/uploads\\//.test(l.value))?l.value:''; }
    function qrVal(){ var q=form&&form.querySelector('input[name=showQr]'); return (q && !q.checked) ? '0' : '1'; }
    function update(){
      var p=new URLSearchParams();
      p.set('layout', layoutVal());
      p.set('primary', v('input[name=primaryColor]'));
      p.set('text', v('input[name=textColor]'));
      p.set('bg', v('input[name=bgColor]'));
      p.set('font', v('select[name=font]')||'system');
      p.set('qr', qrVal());
      var lg=logoVal(); if(lg) p.set('logo', lg);
      iframe.src='/preview/card?'+p.toString();
    }
    function go(){ clearTimeout(t); t=setTimeout(update, 200); }
    ed.addEventListener('input', go);
    ed.addEventListener('change', function(e){
      if(e.target && e.target.name==='layout'){
        var labs=ed.querySelectorAll('.layout-thumb'); for(var i=0;i<labs.length;i++) labs[i].classList.remove('sel');
        var lab=e.target.closest('.layout-thumb'); if(lab) lab.classList.add('sel');
      }
      go();
    });
    if(form){
      var lu=form.querySelector('input[name=logoUrl]'); if(lu) lu.addEventListener('input', go);
      var qr=form.querySelector('input[name=showQr]'); if(qr) qr.addEventListener('change', go);
    }
  })();</script>`;
}

export function tplPickScript(): string {
  return `(function(){
    var pick=document.querySelector('.tpl-pick'); if(!pick) return;
    pick.addEventListener('change', function(e){
      if(e.target && e.target.name==='templateId'){
        var labs=pick.querySelectorAll('label'); for(var i=0;i<labs.length;i++) labs[i].classList.remove('sel');
        var lab=e.target.closest('label'); if(lab) lab.classList.add('sel');
      }
    });
  })();`;
}

export function editorScripts(): string {
  return `<script>${cropperScript()}</script><script>${socialsScript()}</script><script>${labeledRowsScript()}</script><script>${tplPickScript()}</script>`;
}

// Live card preview for the CARD editor: rebuilds the /preview/card?live=1
// iframe from the form's current state as the admin types. Design comes from
// the selected template's data-* attributes, falling back to the brand/store
// default embedded on the rail, plus any per-card overrides.
export function cardLivePreviewScript(): string {
  return `(function(){
    var rail=document.getElementById('card-live-rail'); if(!rail) return;
    var iframe=document.getElementById('card-live-preview');
    var form=document.querySelector('form.editor'); if(!form||!iframe) return;
    var base={}; try{ base=JSON.parse(rail.getAttribute('data-base')||'{}'); }catch(_){}
    var photoObjUrl=null;
    var photoInput=document.getElementById('photoFile');
    if(photoInput){ photoInput.addEventListener('change', function(){
      var f=photoInput.files&&photoInput.files[0];
      if(f){ if(photoObjUrl) try{URL.revokeObjectURL(photoObjUrl);}catch(_){ } photoObjUrl=URL.createObjectURL(f); schedule(); }
    }); }
    function val(name){ var el=form.querySelector('[name="'+name+'"]'); return el?el.value.trim():''; }
    function rows(container){
      var out=[]; var list=document.querySelectorAll('.labeled-rows[data-name="'+container+'"] .lr-row');
      for(var i=0;i<list.length&&i<4;i++){
        var v=list[i].querySelector('.lr-value'); var l=list[i].querySelector('.lr-label');
        if(v&&v.value.trim()) out.push({label:l?l.value:'',value:v.value.trim()});
      }
      return out;
    }
    function socials(){
      var out=[]; var list=document.querySelectorAll('#socials-rows .social-row');
      for(var i=0;i<list.length&&i<8;i++){
        var t=list[i].querySelector('.social-type'); var u=list[i].querySelector('.social-url');
        if(t&&u&&u.value.trim()) out.push({type:t.value,value:u.value.trim()});
      }
      return out;
    }
    function design(){
      var d={layout:base.layout||'classic',primary:base.primary||'#1f6f43',text:base.text||'#111827',bg:base.bg||'#ffffff',font:base.font||'system',logo:base.logo||''};
      var sel=form.querySelector('input[name=templateId]:checked');
      if(sel&&sel.getAttribute('data-primary')){
        d.layout=sel.getAttribute('data-layout')||d.layout;
        d.primary=sel.getAttribute('data-primary')||d.primary;
        d.text=sel.getAttribute('data-text')||d.text;
        d.bg=sel.getAttribute('data-bg')||d.bg;
        d.font=sel.getAttribute('data-font')||d.font;
      }
      var lo=val('layout'); if(lo) d.layout=lo;
      var po=val('primaryColor'); if(/^#[0-9a-fA-F]{3,8}$/.test(po)) d.primary=po;
      return d;
    }
    function build(){
      var d=design();
      var dept='';
      var deptSel=form.querySelector('select[name=departmentId]');
      if(deptSel&&deptSel.value){ dept=deptSel.options[deptSel.selectedIndex].text; } else { dept=val('department'); }
      var photo=photoObjUrl||val('photoUrl');
      var p='/preview/card?live=1'
        +'&layout='+encodeURIComponent(d.layout)+'&primary='+encodeURIComponent(d.primary)
        +'&text='+encodeURIComponent(d.text)+'&bg='+encodeURIComponent(d.bg)+'&font='+encodeURIComponent(d.font)
        +(d.logo?'&logo='+encodeURIComponent(d.logo):'')
        +(photo?'&photo='+encodeURIComponent(photo):'')
        +'&name='+encodeURIComponent((val('firstName')+' '+val('lastName')).trim())
        +'&pronouns='+encodeURIComponent(val('pronouns'))
        +'&title='+encodeURIComponent(val('title'))
        +'&department='+encodeURIComponent(dept)
        +'&company='+encodeURIComponent(val('company'))
        +'&bio='+encodeURIComponent(val('bio'))
        +'&phones='+encodeURIComponent(JSON.stringify(rows('phones')))
        +'&emails='+encodeURIComponent(JSON.stringify(rows('emails')))
        +'&websites='+encodeURIComponent(JSON.stringify(rows('websites')))
        +'&socials='+encodeURIComponent(JSON.stringify(socials()))
        // Rooftop context so the dealer CTAs / OEM badges / footer render too.
        +'&locname='+encodeURIComponent(base.locName||'')
        +'&brandname='+encodeURIComponent(base.brandName||'')
        +'&sales='+encodeURIComponent(base.sales||'')
        +'&service='+encodeURIComponent(base.service||'')
        +'&locphone='+encodeURIComponent(base.locphone||'')
        +'&locweb='+encodeURIComponent(base.locweb||'')
        +'&oems='+encodeURIComponent(base.oems||'')
        +'&footer='+encodeURIComponent(base.footer||'1')
        +'&dealerheader='+encodeURIComponent(base.dealerheader||'1');
      var qrSel=form.querySelector('select[name=showQr]');
      var qr=qrSel&&qrSel.value?qrSel.value:(base.qrDefault||'1');
      p+='&qr='+encodeURIComponent(qr);
      return p;
    }
    var t=null;
    function schedule(){ if(t) clearTimeout(t); t=setTimeout(function(){ iframe.src=build(); },350); }
    form.addEventListener('input', schedule);
    form.addEventListener('change', schedule);
    iframe.src=build();
  })();`;
}

// ---- Styled QR designer (brand form) ----
// Renders the QR design controls + a live preview that hits /admin/qr-preview.
// Field names match qrDesignFromForm() in src/qr-style.ts.
export function qrDesignControls(current: {
  style?: string;
  fill?: string;
  fill2?: string | null;
  bg?: string;
  logoUrl?: string | null;
} | null, brandLogoUrl?: string | null, uid = "qr", previewPath = ""): string {
  const d = current || null;
  const custom = !!d;
  const style = d?.style || "square";
  const fill = d?.fill || "#111827";
  const fill2 = d?.fill2 || "";
  const transparent = d?.bg === "transparent";
  const bg = !d?.bg || d.bg === "transparent" ? "#ffffff" : d.bg;
  const hasLogo = !!d?.logoUrl;
  const ID = (n: string) => `${n}_${uid}`;
  return `<div class="grid2" id="${ID("qrDesigner")}">
    <div>
      <label class="chk"><input type="radio" name="qrMode" value="inherit" ${custom ? "" : "checked"} /> Standard QR (single color, auto)</label>
      <label class="chk"><input type="radio" name="qrMode" value="custom" ${custom ? "checked" : ""} /> Custom designed QR</label>
      <div id="${ID("qrOpts")}" style="${custom ? "" : "opacity:.45;pointer-events:none"}">
        <label>Dot style</label>
        <select name="qrStyle">
          <option value="square" ${style === "square" ? "selected" : ""}>Square (classic)</option>
          <option value="rounded" ${style === "rounded" ? "selected" : ""}>Rounded</option>
          <option value="dots" ${style === "dots" ? "selected" : ""}>Dots</option>
        </select>
        <label>Color</label><input type="color" name="qrFill" value="${esc(fill)}" />
        <label class="chk"><input type="checkbox" name="qrGradient" value="1" ${fill2 ? "checked" : ""} /> Gradient to second color</label>
        <input type="color" name="qrFill2" value="${esc(fill2 || "#25D1B3")}" />
        <label>Background</label><input type="color" name="qrBg" value="${esc(bg)}" />
        <label class="chk"><input type="checkbox" name="qrBgTransparent" value="1" ${transparent ? "checked" : ""} /> Transparent background</label>
        <label class="chk"><input type="checkbox" name="qrLogo" value="1" ${hasLogo ? "checked" : ""} ${brandLogoUrl ? "" : "disabled"} /> Brand logo in the middle${brandLogoUrl ? "" : " (upload a logo first)"}</label>
      </div>
    </div>
    <div style="text-align:center">
      <img id="${ID("qrPreview")}" alt="QR preview" style="width:180px;height:180px;border:1px solid #e5e7eb;border-radius:12px;background:#fff" />
      <p class="muted" style="font-size:12px">Live preview — always test-scan before printing.</p>
    </div>
  </div>
  <script>(function(){
    var root = document.getElementById(${JSON.stringify("qrDesigner_")} + ${JSON.stringify(uid)});
    var img = document.getElementById(${JSON.stringify("qrPreview_")} + ${JSON.stringify(uid)});
    var opts = document.getElementById(${JSON.stringify("qrOpts_")} + ${JSON.stringify(uid)});
    var logo = ${JSON.stringify(brandLogoUrl || "")};
    var ppath = ${JSON.stringify(previewPath || "")};
    function v(n){ var el = root.querySelector('[name='+JSON.stringify(n)+']'); return el ? el.value : ''; }
    function c(n){ var el = root.querySelector('[name='+JSON.stringify(n)+']'); return !!(el && el.checked); }
    function mode(){ var el = root.querySelector('[name=qrMode]:checked'); return el ? el.value : 'inherit'; }
    function update(){
      var custom = mode() === 'custom';
      opts.style.opacity = custom ? '' : '.45';
      opts.style.pointerEvents = custom ? '' : 'none';
      var q = custom
        ? 'style=' + encodeURIComponent(v('qrStyle')) +
          '&fill=' + encodeURIComponent(v('qrFill')) +
          (c('qrGradient') ? '&fill2=' + encodeURIComponent(v('qrFill2')) : '') +
          '&bg=' + encodeURIComponent(c('qrBgTransparent') ? 'transparent' : v('qrBg')) +
          (c('qrLogo') && logo ? '&logo=' + encodeURIComponent(logo) : '')
        : '';
      var qs = (ppath ? 'path=' + encodeURIComponent(ppath) : '') + (q ? (ppath ? '&' : '') + q : '');
      img.src = '/admin/qr-preview' + (qs ? '?' + qs : '');
    }
    root.addEventListener('input', update);
    root.addEventListener('change', update);
    update();
  })();</script>`;
}
