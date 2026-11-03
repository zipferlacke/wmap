<?php
/**
 * Statistik: was über WMap passiert – eine Zeile je Ereignis in der Tabelle
 * Statistics, anonym (kein Konto, kein Gerät, kein Ort, keine IP).
 *   count {kind, via, n}  Beitrag zu OpenStreetMap, von der App gemeldet:
 *                         kind frage (Ja/Nein-Frage unterwegs) · bearbeitet · neu
 *                         via  karte (direkt in OSM) · hinweis (OSM-Hinweis)
 *   summary {}            → { osm: {kind: {via: n}}, events: {event: n}, months: [{month, event, frage, n}] }
 *   ping {new, week, month, services: {dienst: n}}   einmal am Tag je Gerät → Tabelle Counts (ping:*, client:*)
 * Konten, Touren, Plugins und Bewertungen trägt der Server selbst ein (log_event()).
 */

const STAT_KINDS = ['frage', 'bearbeitet', 'neu'];
const STAT_VIA = ['karte', 'hinweis'];

/** Ereignis festhalten – Fehler hier dürfen nichts anderes aufhalten */
function log_event($event, $frage = null, $detail = null){
    global $db_helper;
    $db_helper->execSql("INSERT INTO Statistics (event, frage, detail) VALUES (?, ?, ?)", [$event, $frage, $detail], "stat");
}

/** Zähler des Tages (Tabelle Counts) hochzählen – Fehler sind egal */
function count_up($name, $n = 1){
    global $db_helper;
    $db_helper->execSql("INSERT INTO Counts (day, name, n) VALUES (?, ?, ?) ON CONFLICT(day, name) DO UPDATE SET n = n + excluded.n",
        [gmdate("Y-m-d"), $name, $n], "count");
}

function stats($requestArray, $data){
    global $db_helper;
    $request = array_shift($requestArray);

    switch ($request) {
        case 'count':
            $kind = $data["kind"] ?? "";
            $via = $data["via"] ?? "";
            if (!in_array($kind, STAT_KINDS, true) || !in_array($via, STAT_VIA, true)) return [1, "Unbekannte Art"];
            $n = max(1, min(50, (int)($data["n"] ?? 1)));   // ein Upload hat selten mehr
            for ($i = 0; $i < $n; $i++) log_event("osm", $kind === "frage" ? 1 : 0, "$kind $via");
            return [0, true];

        case 'ping':
            // Einmal am Tag je Gerät (services/ping.js) – ohne Kennung: nur Ja/Nein und was die App angefragt hat
            count_up("ping:active");
            foreach (["new", "week", "month"] as $k) if (!empty($data[$k])) count_up("ping:$k");
            $services = is_array($data["services"] ?? null) ? array_slice($data["services"], 0, 30, true) : [];
            foreach ($services as $name => $n) {
                if (!preg_match('/^[a-z][a-z0-9_]{0,19}$/', (string)$name)) continue;
                $n = (int)$n;
                if ($n > 0) count_up("client:$name", min($n, 100000));
            }
            return [0, true];

        case 'summary':
            $osm = [];
            foreach (STAT_KINDS as $k) foreach (STAT_VIA as $v) $osm[$k][$v] = 0;
            foreach ($db_helper->execSql("SELECT detail, COUNT(*) AS n FROM Statistics WHERE event = 'osm' GROUP BY detail", [], $request)[1] ?? [] as $r) {
                [$k, $v] = array_pad(explode(" ", (string)$r["detail"]), 2, "");
                if (isset($osm[$k][$v])) $osm[$k][$v] = (int)$r["n"];
            }
            $events = [];
            foreach ($db_helper->execSql("SELECT event, COUNT(*) AS n FROM Statistics GROUP BY event", [], $request)[1] ?? [] as $r) $events[$r["event"]] = (int)$r["n"];
            $months = $db_helper->execSql("SELECT substr(time, 1, 7) AS month, event, frage, COUNT(*) AS n FROM Statistics
                WHERE time >= ? GROUP BY month, event, frage ORDER BY month", [gmdate("Y-m-01", strtotime("-11 months"))], $request)[1] ?? [];
            return [0, ["osm" => $osm, "events" => $events, "months" => $months]];

        default:
            return [1, "nix gefunden... Anfrage falsch"];
    }
}
?>
