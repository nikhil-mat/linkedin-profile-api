// Local dev UI, served at GET /ui. Same-origin, so it calls /profile directly with no CORS
// and credentials never leave the machine. Not intended for deployment.
export const UI = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Profile API — local console</title>
<style>
:root{--bg:#0f1115;--panel:#161a21;--line:#252b36;--fg:#e6e9ef;--dim:#8b94a7;--acc:#5aa9e6;
--ok:#3fb950;--warn:#d29922;--err:#f85149;--mono:ui-monospace,SFMono-Regular,Menlo,monospace}
@media(prefers-color-scheme:light){:root{--bg:#fbfbfd;--panel:#fff;--line:#e3e6ec;--fg:#1a1d24;--dim:#666f80}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,sans-serif}
.wrap{max-width:1100px;margin:0 auto;padding:24px 20px 60px}
h1{font-size:15px;margin:0 0 2px;font-weight:600}
.sub{color:var(--dim);font-size:12px;margin-bottom:18px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:14px 16px;margin-bottom:14px}
label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--dim);margin-bottom:4px}
input[type=text],input[type=password]{width:100%;padding:8px 10px;background:var(--bg);color:var(--fg);
border:1px solid var(--line);border-radius:6px;font:13px var(--mono)}
input:focus{outline:2px solid var(--acc);outline-offset:-1px}
.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:700px){.row{grid-template-columns:1fr}}
.opts{display:flex;flex-wrap:wrap;gap:14px;align-items:center;margin:12px 0 0;font-size:13px}
.opts label{text-transform:none;letter-spacing:0;font-size:13px;color:var(--fg);display:flex;gap:6px;align-items:center;margin:0}
button{background:var(--acc);color:#04121e;border:0;border-radius:6px;padding:9px 18px;font-weight:600;
font-size:13px;cursor:pointer}
button:disabled{opacity:.5;cursor:default}
button.ghost{background:transparent;color:var(--dim);border:1px solid var(--line);font-weight:400}
.bar{display:flex;gap:10px;align-items:center;margin-top:14px}
.badge{display:inline-block;font:11px var(--mono);padding:2px 7px;border-radius:4px;border:1px solid var(--line);color:var(--dim)}
.badge.ok{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 40%,transparent)}
.badge.warn{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 40%,transparent)}
.badge.err{color:var(--err);border-color:color-mix(in srgb,var(--err) 40%,transparent)}
.hd{display:flex;gap:14px;align-items:flex-start}
.hd img{width:64px;height:64px;border-radius:8px;object-fit:cover;background:var(--line);flex:none}
.hd h2{margin:0 0 2px;font-size:17px}
.meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.sec h3{font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:var(--dim);margin:0 0 8px}
.item{padding:9px 0;border-top:1px solid var(--line)}
.item:first-of-type{border-top:0}
.t{font-weight:600}
.d{color:var(--dim);font-size:12.5px}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{font-size:12px;padding:3px 9px;border:1px solid var(--line);border-radius:99px}
pre{margin:0;font:12px/1.55 var(--mono);white-space:pre-wrap;word-break:break-word;max-height:60vh;overflow:auto}
.err-box{border-color:color-mix(in srgb,var(--err) 45%,var(--line))}
.hint{color:var(--dim);font-size:12.5px;margin-top:6px}
.note{font-size:11.5px;color:var(--dim);margin-top:8px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
.cov h3{font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:var(--dim);margin:0}
.covhd{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.cov table{width:100%;border-collapse:collapse;font-size:12.5px;table-layout:fixed}
.cov th{text-align:left;font:11px/1.4 var(--mono);text-transform:uppercase;letter-spacing:.5px;
color:var(--dim);padding:0 10px 6px 0;border-bottom:1px solid var(--line);font-weight:400}
.cov td{padding:6px 10px 6px 0;border-bottom:1px solid var(--line);vertical-align:top}
.cov th:first-child,.cov td:first-child{width:34%}
.cov th:last-child,.cov td:last-child{width:110px;padding-right:0}
.cov td.k{font:12px var(--mono);word-break:break-word}
.cov td.v{word-break:break-word;overflow-wrap:anywhere}
.cov td.v.none{color:var(--dim)}
.cov tr.idle td{opacity:.42}
[hidden]{display:none!important}
.s{font:11px var(--mono)}
.s.filled{color:var(--ok)}.s.empty{color:var(--dim)}.s.unavail{color:var(--warn)}
.s.extra{color:var(--acc)}.s.missing{color:var(--err)}
.cov td.v .why{color:var(--warn);font-size:11.5px}
</style></head><body><div class="wrap">
<h1>Profile API — local console</h1>
<div class="sub">Same-origin calls to <code>/profile</code>. Credentials stay in this browser and this machine.</div>

<div class="card">
  <label for="u">Profile URL or slug</label>
  <input id="u" type="text" placeholder="https://www.linkedin.com/in/…  or  complete-at-cap" autocomplete="off">
  <div class="row" style="margin-top:12px">
    <div><label for="a">x-li-at</label><input id="a" type="password" autocomplete="off"></div>
    <div><label for="j">x-li-jsessionid</label><input id="j" type="password" autocomplete="off"></div>
  </div>
  <div class="opts">
    <label><input type="checkbox" id="e-social"> social</label>
    <label><input type="checkbox" id="e-counts"> counts</label>
    <label><input type="checkbox" id="e-company"> company</label>
    <label><input type="checkbox" id="e-interests"> interests</label>
    <label><input type="checkbox" id="e-endorsements"> endorsements</label>
  </div>
  <div class="bar">
    <button id="go">Fetch</button>
    <button class="ghost" id="raw" hidden>Raw JSON</button>
    <span id="status" class="badge" hidden></span>
  </div>
  <div class="note">Each enrichment adds one upstream request. Nothing is sent until you press Fetch.</div>
  <div class="note" style="margin-top:10px;border-top:1px solid var(--line);padding-top:10px">
    Or render a saved capture with no request at all —
    <input type="file" id="fx" accept=".json,application/json" style="font:12px var(--mono);color:var(--dim)">
    <span class="d">captures/profile-&lt;handle&gt;/envelope.json</span>
  </div>
</div>

<div id="out"></div>

<div class="card cov">
  <div class="covhd">
    <h3>Field coverage</h3>
    <span id="covsum" class="badge">awaiting fetch</span>
    <label style="margin-left:auto;text-transform:none;letter-spacing:0;font-size:12.5px;
      color:var(--fg);display:flex;gap:6px;align-items:center;margin:0">
      <input type="checkbox" id="hide"> hide empty</label>
  </div>
  <table><thead><tr><th>Field</th><th>Our value</th><th>Status</th></tr></thead>
  <tbody id="covbody"></tbody></table>
  <div class="note">Rendered from the same upstream request as the cards above
    — it reads the response already on screen, so it costs nothing extra.</div>
</div>
</div>
<script>
// The field list is FETCHED from /schema, never hardcoded here. It used to be a literal copy of
// a vendor's column list, which meant adding a field meant remembering to edit this file too.
let PB = [];
const $=s=>document.querySelector(s), out=$('#out');
const K='li-console';
try{const s=JSON.parse(localStorage.getItem(K)||'{}');$('#a').value=s.a||'';$('#j').value=s.j||'';$('#u').value=s.u||'';}catch{}
const save=()=>{try{localStorage.setItem(K,JSON.stringify({a:$('#a').value,j:$('#j').value,u:$('#u').value}))}catch{}};
const esc=s=>String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
let last=null,showRaw=false;

function badge(t,c){return '<span class="badge '+(c||'')+'">'+esc(t)+'</span>'}
function list(title,arr,fmt){
  if(!arr||!arr.length) return '';
  return '<div class="card sec"><h3>'+esc(title)+' · '+arr.length+'</h3>'+arr.map(fmt).join('')+'</div>';
}
function render(d){
  if(showRaw) return '<div class="card"><pre>'+esc(JSON.stringify(d,null,2))+'</pre></div>';
  if(!d.ok){
    return '<div class="card err-box"><h3 style="color:var(--err);margin:0 0 6px">'+esc(d.error||'error')+'</h3>'+
      (d.upstreamStatus?badge('upstream '+d.upstreamStatus,'err'):'')+
      (d.retryable===false?badge('not retryable'):'')+
      (d.hint?'<div class="hint">'+esc(d.hint)+'</div>':'')+'</div>';
  }
  const p=d.profile||{}, m=d.meta||{};
  let h='<div class="card"><div class="hd">'+
    (p.profilePicture?'<img src="'+esc(p.profilePicture)+'" alt="">':'<div class="hd-ph" style="width:64px;height:64px;border-radius:8px;background:var(--line)"></div>')+
    '<div><h2>'+esc(p.name||'—')+'</h2><div class="d">'+esc(p.headline||'')+'</div>'+
    '<div class="d">'+esc(p.location||'')+(p.industry?' · '+esc(p.industry):'')+'</div>'+
    '<div class="meta">'+
      badge('state: '+(m.state||'?'), m.state==='complete'?'ok':'warn')+
      (m.upstreamRequests!=null?badge(m.upstreamRequests+' upstream req'):'')+
      (m.source?badge(m.source):'')+
      (p.connectionDegree?badge(p.connectionDegree):'')+
      (p.followers!=null?badge(p.followers.toLocaleString()+' followers'):'')+
      (p.connectionsText?badge(p.connectionsText+' connections'):'')+
      (p.premium?badge('premium'):'')+
      (p.isOpenToWork?badge('#OpenToWork','ok'):'')+(p.isHiring?badge('#Hiring','ok'):'')+
    '</div></div></div>';
  if(m.truncated&&m.truncated.length) h+='<div class="meta" style="margin-top:10px">'+m.truncated.map(t=>badge('truncated: '+t,'warn')).join('')+'</div>';
  if(m.unresolved&&m.unresolved.length) h+='<div class="meta" style="margin-top:6px">'+m.unresolved.map(t=>badge('unresolved: '+t,'warn')).join('')+'</div>';
  if(m.enrichmentSkipped) h+='<div class="meta" style="margin-top:6px">'+Object.entries(m.enrichmentSkipped).map(([k,v])=>badge(k+': '+v,'err')).join('')+'</div>';
  h+='</div>';
  if(p.about) h+='<div class="card sec"><h3>About</h3><div style="white-space:pre-wrap">'+esc(p.about)+'</div></div>';
  h+='<div class="grid">';
  h+=list('Experience',p.experience,e=>'<div class="item"><div class="t">'+esc(e.title)+'</div>'+
    '<div class="d">'+esc(e.company||'')+(e.employmentType?' · '+esc(e.employmentType):'')+'</div>'+
    '<div class="d">'+esc(e.dates&&e.dates.text||'')+(e.location?' · '+esc(e.location):'')+'</div></div>');
  h+=list('Education',p.education,e=>'<div class="item"><div class="t">'+esc(e.school)+'</div>'+
    '<div class="d">'+[e.degree,e.fieldOfStudy].filter(Boolean).map(esc).join(' · ')+'</div>'+
    '<div class="d">'+esc(e.dates&&e.dates.text||'')+'</div></div>');
  for(const [k,t] of [['certifications','Certifications'],['languages','Languages'],['courses','Courses'],
      ['honors','Honors'],['publications','Publications'],['patents','Patents'],
      ['organizations','Organizations'],['volunteering','Volunteering'],['projects','Projects'],['testScores','Test scores']]){
    h+=list(t,p[k],x=>'<div class="item"><div class="t">'+esc(x.name||x.title||x.role||'—')+'</div>'+
      '<div class="d">'+[x.authority,x.proficiency,x.institution,x.publisher,x.organization,x.positionHeld,x.number].filter(Boolean).map(esc).join(' · ')+'</div></div>');
  }
  if(p.skills&&p.skills.length) h+='<div class="card sec"><h3>Skills · '+p.skills.length+'</h3><div class="chips">'+
    p.skills.map(s=>'<span class="chip">'+esc(s.name)+(s.endorsements?' <span class="d">'+s.endorsements+'</span>':'')+'</span>').join('')+'</div></div>';
  if(p.interests&&p.interests.length) h+='<div class="card sec"><h3>Interests · '+p.interests.length+'</h3>'+
    p.interests.slice(0,12).map(i=>'<div class="item"><div class="t">'+esc(i.name)+'</div><div class="d">'+
    (i.followers!=null?i.followers.toLocaleString()+' followers':'')+'</div></div>').join('')+'</div>';
  h+='</div>';
  if(p.company) h+='<div class="card sec"><h3>Company</h3><div class="item"><div class="t">'+esc(p.company.name||'')+'</div>'+
    '<div class="d">'+esc(p.company.description||'')+'</div><div class="d">'+
    [p.company.websiteUrl,p.company.staffCount&&p.company.staffCount+' staff'].filter(Boolean).map(esc).join(' · ')+'</div></div></div>';
  return h;
}
// The coverage table is persistent: it lists all 49 fields greyed out before any fetch, so the
// schema is visible up front, then fills in from the profile in the response.
function covRow(cls,label,val,status,why,idle){
  return '<tr class="'+cls+'"><td class="k">'+esc(label)+'</td>'+
    '<td class="v'+(val?'':' none')+'">'+(val?esc(val):'—')+
      (why?'<div class="why">'+esc(why)+'</div>':'')+'</td>'+
    '<td><span class="s '+status+'">'+(idle?'—':status)+'</span></td></tr>';
}
function show(v){
  if(v==null||v==='') return '';
  if(Array.isArray(v)) return v.join(', ');
  if(typeof v==='object') return JSON.stringify(v);
  return String(v);
}
function coverage(){
  const prof=last&&last.ok?(last.profile||null):null;
  const un=(last&&last.unavailable)||{};
  const hide=$('#hide').checked;
  let filled=0,empty=0,unavail=0,extra=0,rows='';
  const seen=new Set();
  for(const [k,label,unavailReason] of PB){
    seen.add(k);
    if(!prof){ rows+=covRow('idle',label,'','empty','',true); continue }
    const rawv=prof[k];
    const v=Array.isArray(rawv)? (rawv.length? rawv.length+' x '+JSON.stringify(rawv[0]).slice(0,120) : '') : show(rawv);
    let st;
    if(un[k]||unavailReason){ st='unavail'; unavail++ }
    else if(!(k in flat)){ st='missing' }
    else if(v){ st='filled'; filled++ }
    else { st='empty'; empty++ }
    if(hide&&st==='empty') continue;
    rows+=covRow('',label,v,st,(un[k]&&un[k].reason)||unavailReason);
  }
  if(prof) for(const k of Object.keys(prof)){
    if(seen.has(k)) continue;
    extra++;
    const rawv=prof[k];
    const v=Array.isArray(rawv)? (rawv.length? rawv.length+' x '+JSON.stringify(rawv[0]).slice(0,120) : '') : show(rawv);
    if(hide&&!v) continue;
    rows+=covRow('',k,v,'extra');
  }
  $('#covbody').innerHTML=rows;
  $('#covsum').className='badge'+(prof?(filled>=PB.length-unavail?' ok':' warn'):'');
  $('#covsum').textContent = prof
    ? filled+' of '+PB.length+' filled · '+empty+' empty · '+unavail+' unavailable · '+extra+' extra'
    : (PB.length? PB.length+' fields · awaiting fetch' : 'loading schema…');
}
$('#hide').onchange=coverage;
fetch('/schema').then(r=>r.json()).then(j=>{
  PB=(j.fields||[]).map(f=>[f.key, f.label||f.key, (j.enrichment||{})[f.key]?('needs ?enrich='+j.enrichment[f.key]):null]);
  coverage();
}).catch(()=>{ $('#covsum').textContent='could not load /schema'; });
coverage();
$('#raw').onclick=()=>{showRaw=!showRaw;$('#raw').textContent=showRaw?'Rendered':'Raw JSON';out.innerHTML=render(last)};
$('#go').onclick=async()=>{
  const u=$('#u').value.trim(); if(!u) return $('#u').focus();
  save();
  const enrich=['social','counts','company','interests','endorsements'].filter(x=>$('#e-'+x).checked).join(',');
  const qs=new URLSearchParams({url:u}); if(enrich) qs.set('enrich',enrich);
  const st=$('#status'); st.hidden=false; st.className='badge'; st.textContent='fetching…';
  $('#go').disabled=true; out.innerHTML='';
  const t0=Date.now();
  try{
    const r=await fetch('/profile?'+qs,{headers:{'x-li-at':$('#a').value.trim(),'x-li-jsessionid':$('#j').value.trim()}});
    last=await r.json();
    st.className='badge '+(last.ok?'ok':'err'); st.textContent=(last.ok?'ok':'failed')+' · '+(Date.now()-t0)+'ms';
    $('#raw').hidden=false; showRaw=false; $('#raw').textContent='Raw JSON';
    out.innerHTML=render(last); coverage();
  }catch(e){
    st.className='badge err'; st.textContent='network error';
    out.innerHTML='<div class="card err-box"><pre>'+esc(String(e))+'</pre><div class="hint">Is the worker running on this port?</div></div>';
  }finally{$('#go').disabled=false}
};
$('#fx').onchange=async e=>{
  const f=e.target.files&&e.target.files[0]; if(!f) return;
  const st=$('#status'); st.hidden=false;
  try{
    const j=JSON.parse(await f.text());
    // tolerate three shapes: the full envelope, a bare profile, or a raw Voyager payload
    if(j&&j.data&&j.included) throw new Error('that is a raw Voyager payload — run: node tools/envelope.mjs');
    last = j && j.ok!==undefined ? j : {ok:true,profile:j,meta:{state:'?',upstreamRequests:0}};
    if(!last.flat) last.flat=null;
    st.className='badge ok'; st.textContent='fixture · '+f.name+(last.meta&&last.meta.source?' · '+last.meta.source:'');
    $('#raw').hidden=false; showRaw=false; $('#raw').textContent='Raw JSON';
    out.innerHTML=render(last); coverage();
  }catch(err){
    st.className='badge err'; st.textContent='bad fixture';
    out.innerHTML='<div class="card err-box"><pre>'+esc(String(err&&err.message||err))+'</pre></div>';
  }
};
$('#u').addEventListener('keydown',e=>{if(e.key==='Enter')$('#go').click()});
</script></body></html>`;
