<?php
/**
 * WMap-API – Aufbau wie bei wuecash: POST mit
 *   request  JSON-Pfad, z. B. ["tours","list"]
 *   data     JSON-Objekt mit den Werten
 * Antwort: [0, Ergebnis] oder [1, Meldung].
 * Angemeldet wird mit dem OpenStreetMap-Konto; das Token kommt im Kopf „Authorization: Bearer …“.
 */
require_once(__DIR__."/config.php");

// Herkunft: erlaubte Seiten und die App (tauri://) dürfen fragen – ohne Cookies
$origin = $_SERVER["HTTP_ORIGIN"] ?? "";
header("Access-Control-Allow-Origin: ".($origin !== "" ? $origin : "*"));
header("Vary: Origin");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Authorization, Content-Type");
header("Content-Type: application/json; charset=utf-8");
if (($_SERVER["REQUEST_METHOD"] ?? "") === "OPTIONS") exit;

require_once(__DIR__."/database.php");
require_once(__DIR__."/osm_login.php");
require_once(__DIR__."/api_auth.php");
require_once(__DIR__."/api_tours.php");
require_once(__DIR__."/api_plugins.php");
require_once(__DIR__."/api_stats.php");

$db_helper = new DB_Helper();
$result = $db_helper->openDatabase();
if($result[0] == 1)                     die(json_encode([1, $result[1]]));

$requestArray = json_decode($_POST["request"] ?? "[]", true) ?: [];
$data = json_decode($_POST["data"] ?? "{}", true) ?: [];

$request = array_shift($requestArray);
switch ($request) {
    case 'auth':    echo json_encode(auth($requestArray, $data)); break;
    case 'tours':   echo json_encode(tours($requestArray, $data)); break;
    case 'plugins': echo json_encode(plugins($requestArray, $data)); break;
    case 'stats':   echo json_encode(stats($requestArray, $data)); break;
    default:        die(json_encode([1, "nix gefunden... Anfrage falsch"]));
}

/* ── Hilfen für alle Teile ────────────────────────────────────────────────── */

/** Kopf „Authorization“ – Apache reicht ihn nicht immer an PHP weiter */
function auth_header(){
    $h = $_SERVER["HTTP_AUTHORIZATION"] ?? $_SERVER["REDIRECT_HTTP_AUTHORIZATION"] ?? "";
    if ($h === "" && function_exists("getallheaders")) {
        foreach (getallheaders() as $k => $v) if (strcasecmp($k, "Authorization") === 0) $h = $v;
    }
    return $h;
}

/** Angemeldeter Nutzer aus dem Token – oder null */
function current_user(){
    global $db_helper;
    $h = auth_header();
    if (!preg_match('/^Bearer\s+([A-Za-z0-9_-]{20,})$/', $h, $m)) return null;
    $r = $db_helper->execSql("SELECT u.id, u.name, u.osm_id FROM Sessions s JOIN Users u ON u.id = s.user_id WHERE s.token = ? AND s.expires > ?", [hash('sha256', $m[1]), time()], "user");
    return ($r[0] == 0 && count($r[1])) ? $r[1][0] : null;
}

function need_user(){
    $u = current_user();
    if (!$u) die(json_encode([1, "Bitte erst anmelden"]));
    return $u;
}

/** Text säubern und kürzen */
function clean($v, $max = 200){
    return mb_substr(trim(strip_tags((string)($v ?? ""))), 0, $max);
}
?>
