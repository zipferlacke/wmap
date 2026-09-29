<?php
/**
 * Anmelden mit dem OpenStreetMap-Konto – WMap hat keine eigenen Passwörter.
 *   osm {id_token}   → {token, user}; beim ersten Mal wird das Konto angelegt
 *                      (Name = OSM-Name, verknüpft über die OSM-Nutzer-ID) –
 *                      oder ein noch angemeldetes Konto aus der Passkey-Zeit
 *                      damit verknüpft
 *   me / logout
 *   summary {}       → was zum angemeldeten Konto gehört (Touren, Plugins, Bewertungen)
 *   delete {}        → Konto mit allem löschen, was dazugehört (angemeldet)
 * Das id_token prüft osm_login.php.
 */

function auth($requestArray, $data){
    global $db_helper;
    $request = array_shift($requestArray);

    // Abgelaufene Sitzungen aufräumen
    $db_helper->execSql("DELETE FROM Sessions WHERE expires < ?", [time()], "cleanup");

    switch ($request) {
        case 'osm':
            $r = osm_id_token($data["id_token"] ?? "");
            if ($r[0] != 0)                             return $r;
            $osmId = (int)$r[1]["sub"];
            $name = clean($r[1]["preferred_username"] ?? $data["name"] ?? "", 80);
            if ($name === "") $name = "OSM ".$osmId;
            $user = $db_helper->execSql("SELECT id FROM Users WHERE osm_id = ?", [$osmId], $request)[1][0] ?? null;
            if ($user) {
                // Umbenannt bei OSM? Dann hier auch
                $db_helper->execSql("UPDATE Users SET name = ? WHERE id = ?", [$name, $user["id"]], $request);
                return [0, new_session($user["id"])];
            }
            // Noch mit einem Konto aus der Passkey-Zeit angemeldet? Das übernimmt
            // die OSM-Anmeldung – mit allen Touren, Plugins und Bewertungen
            $old = current_user();
            if ($old && $old["osm_id"] === null) {
                $db_helper->execSql("UPDATE Users SET osm_id = ?, name = ? WHERE id = ?", [$osmId, $name, $old["id"]], $request);
                return [0, new_session($old["id"])];
            }
            $r = $db_helper->execSql("INSERT INTO Users (osm_id, name) VALUES (?, ?)", [$osmId, $name], $request);
            if ($r[0] != 0)                             return $r;
            $uid = $db_helper->lastId();                // vor log_event – das legt selbst eine Zeile an
            log_event("konto_neu");
            return [0, new_session($uid)];

        case 'me':
            $u = current_user();
            return [0, $u];

        case 'summary':
            $u = need_user();
            return [0, ["user" => $u] + owned($u["id"])];

        case 'delete':
            $user = need_user();
            $uid = $user["id"];
            $gone = owned($uid);
            // Alles in einem Rutsch – bricht etwas ab, bleibt das Konto ganz
            $db_helper->begin();
            foreach ([
                "DELETE FROM Ratings WHERE user_id = ?",
                "DELETE FROM Ratings WHERE tour_id IN (SELECT id FROM Tours WHERE user_id = ?)",
                "DELETE FROM Tours WHERE user_id = ?",
                "DELETE FROM Plugins WHERE user_id = ?",
                "DELETE FROM Sessions WHERE user_id = ?",
                "DELETE FROM Users WHERE id = ?",
            ] as $sql) {
                if ($db_helper->execSql($sql, [$uid], $request)[0] != 0) {
                    $db_helper->rollback();
                    return [1, "Löschen ging nicht – es wurde nichts gelöscht. Bitte später noch einmal."];
                }
            }
            $db_helper->commit();
            log_event("konto_geloescht");
            return [0, ["name" => $user["name"] ?? ""] + $gone];

        case 'logout':
            $h = auth_header();
            if (preg_match('/^Bearer\s+(\S+)$/', $h, $m)) $db_helper->execSql("DELETE FROM Sessions WHERE token = ?", [hash('sha256', $m[1])], $request);
            return [0, true];

        default:
            return [1, "nix gefunden... Anfrage falsch"];
    }
}

/** Was einem Konto gehört – zum Anzeigen vor und nach dem Löschen */
function owned($uid){
    global $db_helper;
    $n = fn($sql) => (int)($db_helper->execSql($sql, [$uid], "owned")[1][0]["n"] ?? 0);
    return [
        "tours" => $n("SELECT COUNT(*) AS n FROM Tours WHERE user_id = ?"),
        "public_tours" => $n("SELECT COUNT(*) AS n FROM Tours WHERE user_id = ? AND status = 'public'"),
        "plugins" => $n("SELECT COUNT(*) AS n FROM Plugins WHERE user_id = ?"),
        "public_plugins" => $n("SELECT COUNT(*) AS n FROM Plugins WHERE user_id = ? AND status = 'public'"),
        "ratings" => $n("SELECT COUNT(*) AS n FROM Ratings WHERE user_id = ?"),
    ];
}

/** Neues Token – gespeichert wird nur sein Hash */
function new_session($userId){
    global $db_helper;
    $token = b64url_encode(random_bytes(32));
    $db_helper->execSql("INSERT INTO Sessions (token, user_id, expires) VALUES (?, ?, ?)", [hash('sha256', $token), $userId, time() + SESSION_DAYS * 86400], "session");
    $u = $db_helper->execSql("SELECT id, name FROM Users WHERE id = ?", [$userId], "session")[1][0];
    return ["token" => $token, "user" => $u];
}
?>
