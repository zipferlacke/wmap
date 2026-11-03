<?php
/**
 * Weiterleitung für Dienste, die die App nicht selbst fragen kann – weil der Server den Abruf aus dem Browser nicht
 * erlaubt (kein CORS) oder weil er einen Schlüssel braucht, der nicht in die App gehört:
 *   GET proxy.php/<dienst>/<pfad>?<anfrage>      z. B. proxy.php/photon/api?q=Göttingen&limit=5
 * Die App fragt hierher erst, wenn ihre eigenen Server ausfallen (js/services/servers.js, Eintrag „wmap:<dienst>“).
 *
 *   Server        je Dienst eine Liste (PROXY); gemischt, ausgefallene haben 10 Minuten Pause (Tabelle ProxyState)
 *   Ausfall       Netzfehler, Zeitlimit, 429 und 5xx – dann der nächste; andere Antworten (404 …) gehen unverändert zurück
 *   Gezählt       je Stunde und Server Erfolg, Fehler und Antwortzeit (ProxyCalls), je Tag die Anfragen (Counts) –
 *                 ohne Inhalt der Anfrage und ohne Adresse
 *   Begrenzt      PROXY_PER_MINUTE Anfragen je Absender und Minute (Hash aus Adresse und Tag, Tabelle RateLimit)
 *   Schlüssel     `key` am Dienst: { name, param } – der Wert steht in bEnd/keys.php
 *                 (config.php wmap_keys())
 */
require_once(__DIR__."/config.php");

$origin = $_SERVER["HTTP_ORIGIN"] ?? "";
header("Access-Control-Allow-Origin: ".($origin !== "" ? $origin : "*"));
header("Vary: Origin");
header("Access-Control-Allow-Methods: GET, OPTIONS");
if (($_SERVER["REQUEST_METHOD"] ?? "") === "OPTIONS") exit;

require_once(__DIR__."/database.php");
require_once(__DIR__."/api_stats.php");

const PROXY = [
    // Photon: Suche und Rückwärtssuche. Öffentliche Server von Freiwilligen (Liste bei Dawarich) – ohne CORS, darum hier
    'photon' => [
        'paths' => ['api', 'reverse'],
        'servers' => [
            'https://photon.komoot.io',
            'https://photon.koalasec.org',
            'https://photon.donsomhong.net',
            'https://photon.marsmathis.com',
            'https://photon.vanoosterhout.cloud',
            'https://photon.kllswitch.com',
        ],
    ],
    // Beispiel mit Schlüssel (noch nicht freigeschaltet):
    // 'tankerkoenig' => ['paths' => ['json/list.php'], 'servers' => ['https://creativecommons.tankerkoenig.de'],
    //                    'key' => ['name' => 'tankerkoenig', 'param' => 'apikey']],
];
const PROXY_PAUSE = 600;
const PROXY_TIMEOUT = 6;
const PROXY_PER_MINUTE = 60;

function proxy_fail($status, $message){
    http_response_code($status);
    header("Content-Type: application/json; charset=utf-8");
    die(json_encode([1, $message]));
}

$db_helper = new DB_Helper();
if ($db_helper->openDatabase()[0] == 1) proxy_fail(500, "Datenbank nicht erreichbar");

[$service, $path] = array_pad(explode("/", trim($_SERVER["PATH_INFO"] ?? "", "/"), 2), 2, "");
$conf = PROXY[$service] ?? null;
if (!$conf || !in_array($path, $conf["paths"], true)) proxy_fail(404, "nix gefunden... Anfrage falsch");
$query = $_SERVER["QUERY_STRING"] ?? "";
if (strlen($query) > 2000) proxy_fail(414, "Anfrage zu lang");

// Je Absender und Minute – die Freiwilligen hinter den Servern bitten ausdrücklich darum
$minute = intdiv(time(), 60);
$who = substr(hash("sha256", ($_SERVER["REMOTE_ADDR"] ?? "")."|".gmdate("Y-m-d")), 0, 16);
$db_helper->execSql("INSERT INTO RateLimit (minute, who, n) VALUES (?, ?, 1) ON CONFLICT(minute, who) DO UPDATE SET n = n + 1", [$minute, $who], "rate");
$n = $db_helper->execSql("SELECT n FROM RateLimit WHERE minute = ? AND who = ?", [$minute, $who], "rate")[1][0]["n"] ?? 0;
if (random_int(1, 50) === 1) $db_helper->execSql("DELETE FROM RateLimit WHERE minute < ?", [$minute - 2], "rate");
if ($n > PROXY_PER_MINUTE) proxy_fail(429, "Zu viele Anfragen – bitte kurz warten");

if (isset($conf["key"])) {
    $value = (string)(wmap_keys()[$conf["key"]["name"]] ?? "");
    if ($value === "") proxy_fail(503, "Dienst nicht eingerichtet");
    $query .= ($query === "" ? "" : "&").rawurlencode($conf["key"]["param"])."=".rawurlencode($value);
}

// Reihenfolge: gemischt, die in Pause ans Ende (sind alle in Pause, wird trotzdem gefragt)
$now = time();
$state = [];
foreach ($db_helper->execSql("SELECT server, until FROM ProxyState", [], "state")[1] ?? [] as $r) $state[$r["server"]] = (int)$r["until"];
$servers = $conf["servers"];
shuffle($servers);
usort($servers, fn($a, $b) => (($state[$a] ?? 0) > $now) <=> (($state[$b] ?? 0) > $now));

$hour = gmdate("Y-m-d H");
$record = function ($server, $ok, $ms, $error = null) use ($db_helper, $service, $hour, $now) {
    $db_helper->execSql("INSERT INTO ProxyCalls (hour, service, server, ok, fail, ms) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(hour, service, server) DO UPDATE SET ok = ok + excluded.ok, fail = fail + excluded.fail, ms = ms + excluded.ms",
        [$hour, $service, $server, $ok ? 1 : 0, $ok ? 0 : 1, $ok ? $ms : 0], "proxy");
    if ($ok) $db_helper->execSql("INSERT INTO ProxyState (server, until, last_ok) VALUES (?, 0, ?)
        ON CONFLICT(server) DO UPDATE SET until = 0, last_ok = excluded.last_ok", [$server, $now], "proxy");
    else $db_helper->execSql("INSERT INTO ProxyState (server, until, last_fail, error) VALUES (?, ?, ?, ?)
        ON CONFLICT(server) DO UPDATE SET until = excluded.until, last_fail = excluded.last_fail, error = excluded.error",
        [$server, $now + PROXY_PAUSE, $now, mb_substr((string)$error, 0, 200)], "proxy");
};

count_up("proxy:$service");
$ctx = stream_context_create(["http" => [
    "timeout" => PROXY_TIMEOUT, "ignore_errors" => true,
    "header" => "User-Agent: WMap (https://app.wuefl.de/wmap/)\r\nAccept: application/json\r\n",
]]);
foreach ($servers as $server) {
    $t = microtime(true);
    $http_response_header = [];
    $body = @file_get_contents("$server/$path".($query === "" ? "" : "?$query"), false, $ctx);
    $ms = (int)round((microtime(true) - $t) * 1000);
    $status = preg_match('#^HTTP/\S+\s+(\d{3})#', $http_response_header[0] ?? "", $m) ? (int)$m[1] : 0;
    if ($body === false || $status === 0 || $status === 429 || $status >= 500) {
        // Nur die Ursache – die Meldung von PHP enthält die Adresse samt Suchbegriff
        $why = preg_replace('/^.*:\s*/', '', (string)(error_get_last()["message"] ?? "")) ?: "keine Antwort";
        $record($server, false, $ms, $status ? "HTTP $status" : $why);
        continue;
    }
    $record($server, true, $ms);
    $type = "application/json";
    foreach ($http_response_header as $h) if (stripos($h, "Content-Type:") === 0) $type = trim(substr($h, 13));
    http_response_code($status);
    header("Content-Type: $type");
    header("Cache-Control: private, max-age=600");
    echo $body;
    exit;
}
proxy_fail(502, "Kein Server erreichbar");
?>
