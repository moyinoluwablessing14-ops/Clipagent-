const $ = s => document.querySelector(s), root = document.documentElement;
const LABEL = { tiktok: 'TikTok', instagram: 'Instagram', shorts: 'Shorts', x: 'X' };
let player = null, tick = 0, ytp = null;

// Theme: follows the device until the person picks one.
try { const t = localStorage.getItem('k-theme'); if (t) root.dataset.theme = t; } catch (e) {}
const dark = () => root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
const paint = () => { $('#theme').textContent = dark() ? 'Light' : 'Dark'; };
$('#theme').onclick = () => {
  const t = dark() ? 'light' : 'dark'; root.dataset.theme = t;
  try { localStorage.setItem('k-theme', t); } catch (e) {}
  paint();
};
paint();

// Small element builder. Text is always added as text, never as HTML.
const h = (t, a = {}, ...k) => {
  const e = document.createElement(t);
  for (const [n, v] of Object.entries(a)) n.startsWith('on') ? e[n] = v : e.setAttribute(n, v);
  k.flat().forEach(c => { if (c != null && c !== false) e.append(c); });
  return e;
};
const mm = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
const say = t => { $('#msg').textContent = t; };
const busy = b => { const g = $('#go'); g.disabled = b; g.textContent = b ? 'Working...' : 'Find clips'; };

function vid(u) {
  try {
    const x = new URL(u), host = x.hostname.replace('www.', '');
    if (host === 'youtu.be') return x.pathname.slice(1, 12);
    if (host.endsWith('youtube.com')) {
      if (x.searchParams.get('v')) return x.searchParams.get('v');
      const m = x.pathname.match(/\/(shorts|live|embed)\/([\w-]{11})/);
      if (m) return m[2];
    }
  } catch (e) {}
  return null;
}
function loadYT() {
  if (!ytp) ytp = new Promise(r => { window.onYouTubeIframeAPIReady = r; document.head.append(h('script', { src: 'https://www.youtube.com/iframe_api' })); });
  return ytp;
}
function copy(text, b) {
  const old = b.textContent;
  navigator.clipboard.writeText(text).then(
    () => { b.textContent = 'Copied'; setTimeout(() => b.textContent = old, 1200); },
    () => say('Copying was blocked by the browser. Try again after tapping the page.'));
}
function info(c) {
  const dead = c.cuts.reduce((a, x) => a + x.end - x.start, 0);
  return mm(c.start) + ' to ' + mm(c.end) + ', ' + Math.round(c.end - c.start) + ' seconds' +
    (dead >= 1 ? ', skips ' + Math.round(dead) + ' seconds of dead air' : '');
}
function nudge(c, k, d, meta) {
  const old = c[k]; c[k] = Math.max(0, old + d);
  if (c.end - c.start < 5) c[k] = old;
  meta.textContent = info(c);
  if (player && player.seekTo) player.seekTo(c.start, true);
}

// Runs every 150ms while a preview is open: loop the clip, jump over dead air, show the caption.
function step(c, cap) {
  if (!player || !player.getCurrentTime) return;
  const t = player.getCurrentTime();
  if (t >= c.end) { player.seekTo(c.start, true); return; }
  const cut = c.cuts.find(x => t >= x.start && t < x.end - 0.2);
  if (cut) { player.seekTo(cut.end, true); return; }
  const l = c.lines.find(x => t >= x.start && t < x.end);
  cap.replaceChildren(); cap.hidden = !l;
  if (!l) return;
  const w = l.text.split(/\s+/), i = Math.min(w.length - 1, Math.floor((t - l.start) / (l.end - l.start) * w.length));
  w.forEach((x, j) => cap.append(h('span', { class: (j <= i ? 'on ' : '') + (j === i ? 'cur' : '') }, x + ' ')));
}

async function preview(id, c, row) {
  clearInterval(tick);
  if (player) { try { player.destroy(); } catch (e) {} player = null; }
  document.querySelectorAll('.slot').forEach(s => s.replaceChildren());
  const cap = h('div', { class: 'cap h' }), host = h('div'), meta = row.querySelector('.meta');
  const tb = (label, f) => h('button', { onclick: f }, label);
  row.querySelector('.slot').append(
    h('div', { class: 'pl' }, host, cap),
    h('div', { class: 'trim' },
      tb('Start -1s', () => nudge(c, 'start', -1, meta)), tb('Start +1s', () => nudge(c, 'start', 1, meta)),
      tb('End -1s', () => nudge(c, 'end', -1, meta)), tb('End +1s', () => nudge(c, 'end', 1, meta)),
      tb('Caption style', () => { cap.classList.toggle('h'); cap.classList.toggle('k'); })));
  await loadYT();
  player = new YT.Player(host, {
    videoId: id,
    playerVars: { start: Math.floor(c.start), playsinline: 1, rel: 0, modestbranding: 1 },
    events: { onReady: e => { e.target.seekTo(c.start, true); e.target.playVideo(); } }
  });
  tick = setInterval(() => step(c, cap), 150);
}

function render(id, d) {
  const out = $('#out'); out.replaceChildren();
  if (!d.clips || !d.clips.length) return out.append(h('p', { class: 'empty' }, 'No strong moments found in that video. Try a longer one, or pick the video type yourself.'));
  out.append(h('p', { class: 'sum' }, 'Video type: ' + d.type + '. ' + d.clips.length + ' clips, best first.'));
  d.clips.forEach(c => {
    c.cuts = c.cuts || []; c.lines = c.lines || [];
    const row = h('article', { class: 'clip' },
      h('div', { class: 'top' },
        h('span', { class: 'score' }, String(c.score), h('small', {}, '/100')),
        h('div', {}, h('h2', {}, c.title), h('p', { class: 'why' }, c.reason))),
      h('p', { class: 'meta' }, info(c)),
      h('div', { class: 'acts' },
        h('button', { onclick: () => preview(id, c, row) }, 'Preview'),
        ...Object.keys(LABEL).map(p => h('button', { onclick: e => copy(c.captions[p] + '\n\n' + c.tags.join(' '), e.target) }, 'Copy ' + LABEL[p] + ' caption'))),
      h('div', { class: 'slot' }));
    out.append(row);
  });
}

$('#form').onsubmit = async e => {
  e.preventDefault();
  const url = $('#url').value.trim(), id = vid(url);
  if (!url) return say('Paste a YouTube link first.');
  if (!id) return say('That does not look like a YouTube link. Use a watch, youtu.be or shorts link.');
  say('Watching the video. This can take up to a minute.'); busy(true);
  $('#out').replaceChildren(...[0, 1, 2, 3].map(() => h('div', { class: 'sk' })));
  try {
    const r = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=' + id, type: $('#type').value }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Something went wrong. Try again.');
    say(''); render(id, d);
  } catch (err) {
    say('');
    $('#out').replaceChildren(h('div', { class: 'err' }, h('p', {}, err.message),
      h('button', { onclick: () => $('#form').requestSubmit() }, 'Try again')));
  } finally { busy(false); }
};
