// Serverless function: sends a public YouTube link to Gemini and returns cleaned-up clip suggestions.
const TYPES = {
  stream: 'a stream or streamer video: pick funny reactions, hype, rants, big surprises and moments that stop a viewer from scrolling',
  movie: 'a movie or show: pick iconic lines, high-emotion scenes, twists and memorable exchanges',
  podcast: 'a podcast or interview: pick hot takes, self-contained stories and quotable opinions',
  tutorial: 'a tutorial: pick the clearest tip or the moment something clicks'
};
const n = x => Number.isFinite(+x) ? +x : 0;
const rng = a => (Array.isArray(a) ? a : []).map(x => ({ start: n(x.start), end: n(x.end), text: x.text == null ? '' : String(x.text) })).filter(x => x.end > x.start);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: 'The server has no API key set. Add GEMINI_API_KEY in Vercel.' });
  const { url, type } = req.body || {};
  if (!/^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/.test(url || '')) return res.status(400).json({ error: 'Send a public YouTube link.' });

  const strategy = TYPES[type]
    ? 'This video is ' + TYPES[type] + '.'
    : 'First decide if the video is a stream, movie, podcast or tutorial, then pick moments that fit that kind. Stream: ' + TYPES.stream + '. Movie: ' + TYPES.movie + '. Podcast: ' + TYPES.podcast + '. Tutorial: ' + TYPES.tutorial + '.';
  const prompt = strategy + '\nFind up to 10 short clips that would work on TikTok, Instagram, YouTube Shorts and X. Rules: each clip is 20 to 60 seconds; it starts at the beginning of a sentence with a strong hook and ends on a clean sentence; clips do not overlap; each one must reflect what the video is actually about. All times are seconds from the start of the video.\n' +
    'Return only JSON shaped like {"type":"stream|movie|podcast|tutorial","clips":[{"start":0,"end":0,"score":0,"title":"","reason":"one sentence","hook":"","tags":["#a","#b","#c","#d","#e"],"captions":{"tiktok":"","instagram":"","shorts":"","x":""},"lines":[{"start":0,"end":0,"text":"3 to 7 spoken words"}],"cuts":[{"start":0,"end":0}]}]}. ' +
    'score is 0 to 100 for how likely the clip is to spread. lines are the spoken words of the clip, in order. cuts are silences over 0.8 seconds or filler words inside the clip that a viewer would not miss.';

  let j;
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + (process.env.GEMINI_MODEL || 'gemini-2.5-flash') + ':generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ parts: [{ file_data: { file_uri: url } }, { text: prompt }] }], generationConfig: { temperature: 0.4, responseMimeType: 'application/json' } })
    });
    j = await r.json();
    if (!r.ok) return res.status(502).json({ error: (j.error && j.error.message) || 'The analysis service returned an error.' });
  } catch (e) { return res.status(502).json({ error: 'Could not reach the analysis service.' }); }

  let d;
  try {
    const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
    d = JSON.parse(parts.map(p => p.text || '').join('').replace(/```json|```/g, ''));
  } catch (e) { return res.status(502).json({ error: 'The result could not be read. Try again.' }); }

  const clips = (d.clips || []).map(c => {
    const cap = c.captions || {}, start = n(c.start), end = n(c.end);
    return {
      start, end, score: Math.max(0, Math.min(100, Math.round(n(c.score)))),
      title: String(c.title || 'Untitled moment'), reason: String(c.reason || ''), hook: String(c.hook || ''),
      tags: (Array.isArray(c.tags) ? c.tags : []).slice(0, 5).map(String),
      captions: { tiktok: String(cap.tiktok || c.title || ''), instagram: String(cap.instagram || c.title || ''), shorts: String(cap.shorts || c.title || ''), x: String(cap.x || c.title || '') },
      lines: rng(c.lines).filter(x => x.text), cuts: rng(c.cuts).map(({ start, end }) => ({ start, end }))
    };
  }).filter(c => c.end - c.start >= 10 && c.end - c.start <= 120).sort((a, b) => b.score - a.score);

  const kept = [];
  for (const c of clips) {
    if (kept.every(k => c.end <= k.start || c.start >= k.end)) kept.push(c);
    if (kept.length === 10) break;
  }
  res.status(200).json({ type: ['stream', 'movie', 'podcast', 'tutorial'].includes(d.type) ? d.type : 'video', clips: kept });
};
