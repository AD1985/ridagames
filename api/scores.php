<?php
// RidaGames leaderboard API, backed by a SQLite file outside the web root.
//
//   GET  /api/scores.php?limit=1   -> [{"game": "...", "player": "...", "score": 123}, ...]
//   POST /api/scores.php           <- {"scores": [{"game": "...", "player": "...", "score": 123}, ...]}
//                                  -> {"ok": true}
//
// Each player keeps only their best score per game.

declare(strict_types=1);

const GAMES = ['snakeBest', 'blockDropBest', 'brickBreakerBest', 'rocketDodgeBest', '2048Best'];
const MAX_SCORE = 10000000;
const MAX_PER_REQUEST = 20;
const MAX_POSTS_PER_MINUTE = 30; // per IP

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function respond(int $status, $body): void
{
    http_response_code($status);
    echo json_encode($body);
    exit;
}

function db(): PDO
{
    // On Namecheap/cPanel the document root is ~/public_html, so this is ~/ridagames-data.
    $dir = getenv('RIDAGAMES_DATA_DIR') ?: dirname(rtrim($_SERVER['DOCUMENT_ROOT'], '/')) . '/ridagames-data';
    if (!is_dir($dir) && !@mkdir($dir, 0700, true)) {
        respond(500, ['error' => 'storage unavailable']);
    }
    $pdo = new PDO('sqlite:' . $dir . '/scores.sqlite', null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_TIMEOUT => 5,
    ]);
    $pdo->exec('CREATE TABLE IF NOT EXISTS scores (
        game       TEXT    NOT NULL,
        player     TEXT    NOT NULL,
        score      INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (game, player)
    )');
    $pdo->exec('CREATE INDEX IF NOT EXISTS scores_game_score ON scores (game, score DESC)');
    $pdo->exec('CREATE TABLE IF NOT EXISTS hits (ip TEXT NOT NULL, ts INTEGER NOT NULL)');
    return $pdo;
}

// Same rules as clean() in js/player.js.
function clean_name($s): string
{
    $s = preg_replace('/[<>&"\']/', '', (string)$s);
    $s = trim(preg_replace('/\s+/u', ' ', $s));
    return mb_substr($s, 0, 16);
}

try {
    $method = $_SERVER['REQUEST_METHOD'];

    if ($method === 'GET') {
        $limit = max(1, min(10, (int)($_GET['limit'] ?? 1)));
        $pdo = db();
        $stmt = $pdo->prepare('SELECT player, score FROM scores WHERE game = ?
                               ORDER BY score DESC, updated_at ASC LIMIT ' . $limit);
        $rows = [];
        foreach (GAMES as $game) {
            $stmt->execute([$game]);
            foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
                $rows[] = ['game' => $game, 'player' => $r['player'], 'score' => (int)$r['score']];
            }
        }
        respond(200, $rows);
    }

    if ($method === 'POST') {
        $body = json_decode((string)file_get_contents('php://input'), true);
        $items = is_array($body) && isset($body['scores']) && is_array($body['scores']) ? $body['scores'] : null;
        if ($items === null || count($items) === 0 || count($items) > MAX_PER_REQUEST) {
            respond(400, ['error' => 'expected {"scores": [...]}']);
        }

        $pdo = db();
        $now = time();
        $ip = $_SERVER['REMOTE_ADDR'] ?? '';
        $pdo->prepare('DELETE FROM hits WHERE ts < ?')->execute([$now - 60]);
        $count = $pdo->prepare('SELECT COUNT(*) FROM hits WHERE ip = ?');
        $count->execute([$ip]);
        if ((int)$count->fetchColumn() >= MAX_POSTS_PER_MINUTE) {
            respond(429, ['error' => 'too many requests']);
        }
        $pdo->prepare('INSERT INTO hits (ip, ts) VALUES (?, ?)')->execute([$ip, $now]);

        $upsert = $pdo->prepare('INSERT INTO scores (game, player, score, updated_at) VALUES (?, ?, ?, ?)
            ON CONFLICT (game, player) DO UPDATE SET score = excluded.score, updated_at = excluded.updated_at
            WHERE excluded.score > scores.score');
        $pdo->beginTransaction();
        foreach ($items as $item) {
            $game = $item['game'] ?? null;
            $player = clean_name($item['player'] ?? '');
            $score = $item['score'] ?? null;
            if (!in_array($game, GAMES, true) || $player === '' || !is_int($score) || $score <= 0 || $score > MAX_SCORE) {
                continue; // skip invalid entries, keep the valid ones
            }
            $upsert->execute([$game, $player, $score, $now]);
        }
        $pdo->commit();
        respond(200, ['ok' => true]);
    }

    header('Allow: GET, POST');
    respond(405, ['error' => 'method not allowed']);
} catch (Throwable $e) {
    error_log('ridagames scores: ' . $e->getMessage());
    respond(500, ['error' => 'server error']);
}
