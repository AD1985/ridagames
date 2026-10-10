// Shared player-name prompt + per-game leaderboard records (localStorage).
(function () {
  const NAME_KEY = 'ridagames_player_name';
  const BEST_KEYS = ['snakeBest', 'blockDropBest', 'brickBreakerBest', 'rocketDodgeBest', '2048Best'];

  const clean = (s) => String(s || '').replace(/[<>&"']/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  const getName = () => clean(localStorage.getItem(NAME_KEY));

  // Per-player best scores: ridagames_scores = { bestKey: { playerName: score } }
  const SCORES_KEY = 'ridagames_scores';
  const SESSION_KEY = 'ridagames_session_name';
  const readScores = () => { try { return JSON.parse(localStorage.getItem(SCORES_KEY)) || {}; } catch (e) { return {}; } };
  const origSetItem = Storage.prototype.setItem;

  // Record the current player's score whenever a game saves a new best.
  Storage.prototype.setItem = function (key, value) {
    origSetItem.call(this, key, value);
    if (this === window.localStorage && BEST_KEYS.indexOf(key) !== -1) {
      const all = readScores();
      const name = getName() || 'Player';
      const game = all[key] || (all[key] = {});
      game[name] = Math.max(game[name] || 0, Number(value) || 0);
      origSetItem.call(this, SCORES_KEY, JSON.stringify(all));
    }
  };

  // Make each game's own "best" reflect the active player.
  function applyPlayerBests() {
    const all = readScores();
    const name = getName();
    BEST_KEYS.forEach((k) => {
      const v = (all[k] && all[k][name]) || 0;
      if (v) origSetItem.call(localStorage, k, String(v));
      else localStorage.removeItem(k);
    });
  }

  // Block game hotkeys while the name dialog is open.
  let overlay = null;
  window.addEventListener('keydown', (e) => {
    if (overlay) {
      e.stopImmediatePropagation();
      if ((e.key === ' ' || e.key.startsWith('Arrow')) && e.target.tagName !== 'INPUT') e.preventDefault();
    }
  }, true);
  window.addEventListener('keyup', (e) => { if (overlay) e.stopImmediatePropagation(); }, true);

  function ask() {
    overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(5,8,20,.88);font-family:system-ui,sans-serif;';
    overlay.innerHTML =
      '<form style="background:#141a33;color:#fff;padding:28px 32px;border-radius:16px;border:1px solid #3b4a8f;text-align:center;max-width:340px;width:90%">' +
      '<h2 style="margin:0 0 8px">Who\'s playing?</h2>' +
      '<p style="margin:0 0 16px;opacity:.8;font-size:14px">Your name appears on the RidaGames leaderboard.</p>' +
      '<input maxlength="16" required placeholder="Your game name" style="width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #556;font-size:16px;text-align:center">' +
      '<button style="margin-top:14px;padding:10px 24px;border:0;border-radius:8px;background:#ffb703;color:#111;font-weight:700;font-size:16px;cursor:pointer">Play</button></form>';
    const input = overlay.querySelector('input');
    input.value = getName();
    overlay.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const n = clean(input.value);
      if (!n) return;
      localStorage.setItem(NAME_KEY, n);
      sessionStorage.setItem(SESSION_KEY, '1');
      applyPlayerBests();
      overlay.remove();
      overlay = null;
      if (document.activeElement) document.activeElement.blur();
    });
    document.body.appendChild(overlay);
    input.focus();
    input.select();
  }

  if (sessionStorage.getItem(SESSION_KEY) && getName()) {
    applyPlayerBests();
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ask);
  } else {
    ask();
  }
})();
