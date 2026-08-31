// INTERNAL. Builds a self-contained field explorer from src/schema.mjs + the saved captures.
//
//   node tools/field-explorer.mjs && open field-explorer.html
//
// Writes a single local HTML file with the example data INLINED, so it needs no server and no
// network. That is deliberate: captures/ holds real people's profile data, so this output is
// gitignored and must never be published anywhere.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { FIELDS, GROUPS, SECTIONS, UNAVAILABLE, ENRICHMENT } from '../src/schema.mjs';

const examples = [];
for (const d of readdirSync('captures').filter((x) => x.startsWith('profile-'))) {
  const f = `captures/${d}/envelope.json`;
  if (!existsSync(f)) continue;
  const env = JSON.parse(readFileSync(f, 'utf8'));
  examples.push({
    handle: d.replace(/^profile-/, ''),
    name: env.profile?.name ?? d,
    headline: env.profile?.headline ?? '',
    state: env.meta?.state ?? '?',
    truncated: env.meta?.truncated ?? [],
    unresolved: env.meta?.unresolved ?? [],
    profile: env.profile,
  });
}
if (!examples.length) { console.error('no captures — nothing to render'); process.exit(1); }

const DATA = JSON.stringify({ fields: FIELDS, groups: GROUPS, examples });

writeFileSync('field-explorer.html', `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Field explorer</title>
<style>
:root{--bg:#fbfbfd;--panel:#fff;--line:#e4e7ec;--fg:#16181d;--dim:#6b7280;--acc:#2563eb;
--ok:#15803d;--warn:#b45309;--mono:ui-monospace,SFMono-Regular,Menlo,monospace}
@media(prefers-color-scheme:dark){:root{--bg:#0f1115;--panel:#161a21;--line:#252b36;--fg:#e6e9ef;
--dim:#8b94a7;--acc:#5aa9e6;--ok:#3fb950;--warn:#d29922}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.55 system-ui,-apple-system,sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:22px 20px 70px}
h1{font-size:16px;margin:0 0 3px}
.sub{color:var(--dim);font-size:12.5px;margin-bottom:16px}
.bar{position:sticky;top:0;z-index:5;background:var(--bg);padding:10px 0 12px;border-bottom:1px solid var(--line);margin-bottom:16px}
.tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.tab{padding:7px 13px;border:1px solid var(--line);border-radius:999px;background:var(--panel);
cursor:pointer;font-size:13px;color:var(--fg);white-space:nowrap}
.tab[aria-selected=true]{background:var(--acc);border-color:var(--acc);color:#fff;font-weight:600}
.tab:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
.ctl{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
input[type=search]{flex:1;min-width:200px;padding:8px 11px;border:1px solid var(--line);
border-radius:7px;background:var(--panel);color:var(--fg);font:13px var(--mono)}
input:focus{outline:2px solid var(--acc);outline-offset:-1px}
label.ck{display:flex;gap:6px;align-items:center;font-size:13px;color:var(--dim);cursor:pointer}
.who{background:var(--panel);border:1px solid var(--line);border-radius:9px;padding:13px 15px;margin-bottom:14px}
.who h2{margin:0 0 2px;font-size:16px}
.who .d{color:var(--dim);font-size:12.5px}
.badge{display:inline-block;font:11px var(--mono);padding:2px 7px;border-radius:4px;border:1px solid var(--line);color:var(--dim);margin:6px 5px 0 0}
.badge.warn{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 45%,transparent)}
.badge.ok{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 45%,transparent)}
.grp{margin-bottom:20px}
.grp h3{font:11.5px var(--mono);text-transform:uppercase;letter-spacing:.7px;color:var(--dim);
margin:0 0 7px;display:flex;gap:9px;align-items:center}
.grp h3 span{color:var(--acc)}
table{width:100%;border-collapse:collapse;table-layout:fixed}
td{padding:7px 10px 7px 0;border-bottom:1px solid var(--line);vertical-align:top;font-size:13px}
td.k{width:31%;font:12px var(--mono);word-break:break-word}
td.k small{display:block;color:var(--dim);font:11px system-ui;margin-top:1px}
td.v{word-break:break-word;overflow-wrap:anywhere;white-space:pre-wrap}
td.v.none{color:var(--dim)}
td.s{width:104px;text-align:right;font:11px var(--mono)}
.s.filled{color:var(--ok)}.s.empty{color:var(--dim)}.s.unavail{color:var(--warn)}
.s.none{color:var(--dim);opacity:.75}
.why{color:var(--warn);font-size:11.5px;margin-top:3px}
.hint{color:var(--dim);font-size:12px;margin-top:18px}
mark{background:color-mix(in srgb,var(--acc) 28%,transparent);color:inherit;border-radius:2px}
</style></head><body><div class="wrap">
<h1>Field explorer</h1>
<div class="sub">Every field declared in <code>src/schema.mjs</code>, with real values.
Local file — nothing is fetched and nothing leaves this machine.</div>

<div class="bar">
  <div class="tabs" id="tabs" role="tablist"></div>
  <div class="ctl">
    <input type="search" id="q" placeholder="filter fields — name, label or value…" autocomplete="off">
    <label class="ck"><input type="checkbox" id="hide"> hide empty</label>
    <span class="badge" id="tally"></span>
  </div>
</div>
<div id="who"></div>
<div id="out"></div>
<div class="hint">← / → switch profile · <code>/</code> focuses the filter</div>
</div>
<script>
const D = ${DATA};
let cur = 0;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const hl = (s, q) => !q ? esc(s) : esc(s).replace(new RegExp('(' + q.replace(/[.*+?^\${}()|[\\]\\\\]/g,'\\\\$&') + ')','ig'), '<mark>$1</mark>');

D.examples.forEach((ex, i) => {
  const b = document.createElement('button');
  b.className = 'tab'; b.textContent = ex.name; b.setAttribute('role','tab');
  b.onclick = () => { cur = i; render(); };
  $('#tabs').append(b);
});

function render() {
  const ex = D.examples[cur], q = $('#q').value.trim(), hide = $('#hide').checked;
  [...$('#tabs').children].forEach((t, i) => t.setAttribute('aria-selected', i === cur));

  $('#who').innerHTML = '<div class="who"><h2>' + esc(ex.name) + '</h2>' +
    '<div class="d">' + esc(ex.headline) + '</div>' +
    '<span class="badge ' + (ex.state === 'complete' ? 'ok' : 'warn') + '">state: ' + esc(ex.state) + '</span>' +
    ex.truncated.map((t) => '<span class="badge warn">truncated: ' + esc(t) + '</span>').join('') +
    ex.unresolved.map((t) => '<span class="badge warn">unresolved: ' + esc(t) + '</span>').join('') + '</div>';

  let html = '', filled = 0, empty = 0, unavail = 0, none = 0, shown = 0;
  for (const g of D.groups) {
    const rows = [];
    for (const f of D.fields.filter((x) => x.group === g)) {
      const raw = ex.profile[f.key];
      const v = Array.isArray(raw)
        ? (raw.length ? raw.length + ' x ' + JSON.stringify(raw[0]).slice(0, 200) : '')
        : raw;
      const has = v !== null && v !== undefined && v !== '';
      // A count of 0 is a CONFIRMED zero -- "this person has none" -- which is different from
      // both a value and a missing one. Painting it green as "filled" was just noise.
      const zero = Array.isArray(raw) && raw.length === 0;
      const st = ENRICHMENT[f.key] ? (has ? 'filled' : 'unavail') : zero ? 'none' : has ? 'filled' : 'empty';
      if (st === 'filled') filled++; else if (st === 'unavail') unavail++;
      else if (st === 'none') none++; else empty++;
      if (q && ![f.key, f.label, String(v ?? '')].some((s) => s.toLowerCase().includes(q.toLowerCase()))) continue;
      if (hide && (st === 'empty' || st === 'none')) continue;
      shown++;
      rows.push('<tr><td class="k">' + hl(f.key, q) + '<small>' + esc(f.label) + '</small></td>' +
        '<td class="v' + (has && !zero ? '' : ' none') + '">' + (has ? hl(String(v), q) : '—') +
        (ENRICHMENT[f.key] ? '<div class="why">needs ?enrich=' + esc(ENRICHMENT[f.key]) + '</div>' : '') + '</td>' +
        '<td class="s ' + st + '">' + st + '</td></tr>');
    }
    if (rows.length) html += '<div class="grp"><h3>' + esc(g) + ' <span>' + rows.length + '</span></h3>' +
      '<table>' + rows.join('') + '</table></div>';
  }
  $('#out').innerHTML = html || '<div class="hint">nothing matches that filter.</div>';
  $('#tally').textContent = filled + ' filled · ' + none + ' confirmed zero · ' + empty + ' empty · ' + unavail + ' unavailable' +
    (q || hide ? '  (' + shown + ' shown)' : '');
}

$('#q').oninput = render; $('#hide').onchange = render;
addEventListener('keydown', (e) => {
  if (e.key === '/' && e.target.tagName !== 'INPUT') { e.preventDefault(); $('#q').focus(); return; }
  if (e.target.tagName === 'INPUT' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  if (e.key === 'ArrowRight') { cur = (cur + 1) % D.examples.length; render(); }
  if (e.key === 'ArrowLeft') { cur = (cur - 1 + D.examples.length) % D.examples.length; render(); }
});
render();
</script></body></html>`);
console.log(`field-explorer.html written — ${FIELDS.length} fields × ${examples.length} profiles`);
console.log('  ' + examples.map((e) => e.name).join(' · '));
