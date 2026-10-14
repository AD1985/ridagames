// Site-wide leaderboard client for /api/scores.php (SQLite on our own hosting).
(function () {
  const API = '/api/scores.php';
  const QUEUE_KEY = 'ridagames_pending_scores';

  // Scores not yet saved on the server survive reloads/offline: { "game|player": score }
  const readQueue = () => { try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || {}; } catch (e) { return {}; } };
  const writeQueue = (q) => {
    if (Object.keys(q).length) localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
    else localStorage.removeItem(QUEUE_KEY);
  };

  let flushing = null;
  let timer = null;

  function flush(keepalive) {
    clearTimeout(timer);
    if (flushing) return flushing;
    const q = readQueue();
    const ids = Object.keys(q).slice(0, 20);
    if (!ids.length) return Promise.resolve();
    const scores = ids.map((id) => {
      const sep = id.indexOf('|');
      return { game: id.slice(0, sep), player: id.slice(sep + 1), score: q[id] };
    });
    flushing = fetch(API, {
      method: 'POST',
      keepalive: !!keepalive,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scores })
    }).then((res) => {
      if (!res.ok) throw new Error('save failed: ' + res.status);
      const cur = readQueue();
      ids.forEach((id) => { if (cur[id] === q[id]) delete cur[id]; });
      writeQueue(cur);
    }).catch(() => {}) // stays queued; retried on the next flush
      .then(() => { flushing = null; });
    return flushing;
  }

  function submit(game, player, score) {
    score = Math.floor(Number(score) || 0);
    if (!player || score <= 0) return;
    const q = readQueue();
    const id = game + '|' + player;
    if ((q[id] || 0) >= score) return;
    q[id] = score;
    writeQueue(q);
    // Batch rapid updates (e.g. 2048 scores every move) into one request.
    clearTimeout(timer);
    timer = setTimeout(flush, 1500);
  }

  // Resolves to { gameKey: [{ player, score }, ...] } (highest first), or null if unavailable.
  function top(limit) {
    return flush()
      .then(() => fetch(API + '?limit=' + (limit || 1), { cache: 'no-store' }))
      .then((res) => { if (!res.ok) throw new Error('load failed: ' + res.status); return res.json(); })
      .then((rows) => {
        const byGame = {};
        rows.forEach((r) => { (byGame[r.game] || (byGame[r.game] = [])).push({ player: r.player, score: r.score }); });
        return byGame;
      })
      .catch(() => null);
  }

  window.addEventListener('pagehide', () => flush(true));
  flush();

  window.RidaLeaderboard = { submit, top, flush };
})();
