<?php
/**
 * Plugins: Kartenebenen von Anbietern – z. B. geologische Karten, Messnetze.
 * Meist wird nur die Beschreibung gespeichert und woher die Ebene kommt – die
 * Daten liegen beim Anbieter. Eigene Messdaten (bis 2 MB) können hier liegen.
 *   list {}      öffentliche + eigene
 *   save {id?, name, description, operator, contact, source_url, source_type, attribution, data_date, publish}
 *   delete {id}
 *   data {id}    GeoJSON eines hochgeladenen Plugins
 * source_type: geojson (Link) · raster (Kacheln {z}/{x}/{y} oder WMS) · stored
 * (GeoJSON liegt hier, bis 2 MB – für eigene Messdaten, privat oder öffentlich)
 * · script (Erweiterung: ES-Modul per https, läuft erst nach Zustimmung im Browser)
 */

function plugins($requestArray, $data){
    global $db_helper;
    $request = array_shift($requestArray);
    $user = current_user();
    $uid = $user["id"] ?? -1;

    switch ($request) {
        case 'list':
            return $db_helper->execSql("SELECT p.id, p.name, p.description, p.operator, p.contact, p.source_url, p.source_type, p.attribution, p.data_date, p.status, p.updated, u.name AS author, p.user_id = ? AS mine
                FROM Plugins p JOIN Users u ON u.id = p.user_id WHERE p.status = 'public' OR p.user_id = ? ORDER BY p.name LIMIT 300", [$uid, $uid], $request);

        case 'save':
            $user = need_user();
            $name = clean($data["name"] ?? "", 120);
            $url = trim((string)($data["source_url"] ?? ""));
            $geo = isset($data["data"]) ? (string)$data["data"] : null;
            if ($name === "")                           return [1, "Das Plugin braucht einen Namen"];
            $type = in_array($data["source_type"] ?? "", ["geojson", "raster", "stored", "script"], true) ? $data["source_type"] : "geojson";
            if ($type === "stored") {
                if ($geo === null || strlen($geo) > MAX_PLUGIN_DATA) return [1, "Die Daten fehlen oder sind größer als 2 MB"];
                $parsed = json_decode($geo, true);
                if (($parsed["type"] ?? "") !== "FeatureCollection") return [1, "Erwartet wird eine GeoJSON-FeatureCollection"];
                $url = "";
            } else {
                $geo = null;
                if (!preg_match('#^https://[^\s"<>]+$#', $url) || strlen($url) > 1000) return [1, "Die Quelle muss ein https-Link sein"];
                if ($type === "raster" && !str_contains($url, "{z}") && !str_contains($url, "{bbox-epsg-3857}")) return [1, "Kachel-Links brauchen {z}/{x}/{y} – WMS-Links {bbox-epsg-3857}"];
                if ($type === "script" && !preg_match('#\.m?js(\?.*)?$#', $url)) return [1, "Eine Erweiterung ist eine JavaScript-Datei (.js oder .mjs)"];
            }
            $status = !empty($data["publish"]) ? "public" : "private";
            $vals = [$name, clean($data["description"] ?? "", 2000), clean($data["operator"] ?? "", 120), clean($data["contact"] ?? "", 200), $url, $type, $geo, clean($data["attribution"] ?? "", 300), clean($data["data_date"] ?? "", 30), $status];
            if (!empty($data["id"])) {
                $own = $db_helper->execSql("SELECT id FROM Plugins WHERE id = ? AND user_id = ?", [(int)$data["id"], $user["id"]], $request)[1];
                if (!count($own))                       return [1, "Das ist nicht dein Plugin"];
                $db_helper->execSql("UPDATE Plugins SET name=?, description=?, operator=?, contact=?, source_url=?, source_type=?, data=?, attribution=?, data_date=?, status=?, updated=CURRENT_TIMESTAMP WHERE id=?", [...$vals, (int)$data["id"]], $request);
                return [0, ["id" => (int)$data["id"], "status" => $status]];
            }
            $db_helper->execSql("INSERT INTO Plugins (name, description, operator, contact, source_url, source_type, data, attribution, data_date, status, user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [...$vals, $user["id"]], $request);
            return [0, ["id" => $db_helper->lastId(), "status" => $status]];

        case 'data':
            $r = $db_helper->execSql("SELECT data FROM Plugins WHERE id = ? AND source_type = 'stored' AND (status = 'public' OR user_id = ?)", [(int)($data["id"] ?? 0), $uid], $request);
            if ($r[0] != 0 || !count($r[1]))            return [1, "Plugin nicht gefunden oder privat"];
            return [0, json_decode($r[1][0]["data"], true)];

        case 'delete':
            $user = need_user();
            $db_helper->execSql("DELETE FROM Plugins WHERE id = ? AND user_id = ?", [(int)($data["id"] ?? 0), $user["id"]], $request);
            return [0, true];

        default:
            return [1, "nix gefunden... Anfrage falsch"];
    }
}
?>
