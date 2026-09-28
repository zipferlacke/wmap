<?php
/**
 * Anmelden per Passkey (WebAuthn) – kein Passwort, keine E-Mail.
 *   register_options {name}  → Optionen für navigator.credentials.create
 *   register {challenge, id, clientDataJSON, attestationObject} → {token, user}
 *   login_options {}         → Optionen für navigator.credentials.get
 *   login {challenge, id, clientDataJSON, authenticatorData, signature} → {token, user}
 *   me / logout
 *   summary {}               → was zum angemeldeten Konto gehört (Touren, Plugins, Bewertungen)
 *   delete_options {}        → wie login_options, nur zum Löschen
 *   delete {challenge, id, clientDataJSON, authenticatorData, signature}
 *                            → Konto mit allem löschen, was dazugehört; bestätigt
 *                              mit dem Passkey selbst, nicht nur mit dem Token
 * Binärdaten reisen als base64url.
 */

function auth($requestArray, $data){
    global $db_helper;
    $request = array_shift($requestArray);
    [$origin, $rpId] = relying_party();

    // Alte Herausforderungen und Sitzungen aufräumen
    $db_helper->execSql("DELETE FROM Challenges WHERE time < ?", [time() - 300], "cleanup");
    $db_helper->execSql("DELETE FROM Sessions WHERE expires < ?", [time()], "cleanup");

    switch ($request) {
        case 'register_options':
            $name = clean($data["name"] ?? "", 40);
            if ($name === "")                           return [1, "Bitte einen Namen angeben"];
            $challenge = b64url_encode(random_bytes(32));
            $handle = b64url_encode(random_bytes(16));
            $db_helper->execSql("INSERT INTO Challenges (challenge, purpose, data, time) VALUES (?, 'register', ?, ?)", [$challenge, json_encode(["handle" => $handle, "name" => $name]), time()], $request);
            return [0, [
                "challenge" => $challenge,
                "rp" => ["name" => "WMap", "id" => $rpId],
                "user" => ["id" => $handle, "name" => $name, "displayName" => $name],
                "pubKeyCredParams" => [["type" => "public-key", "alg" => -7], ["type" => "public-key", "alg" => -257]],
                "authenticatorSelection" => ["residentKey" => "required", "userVerification" => "preferred"],
                "attestation" => "none",
                "timeout" => 120000,
            ]];

        case 'register':
            $c = take_challenge($data["challenge"] ?? "", "register");
            if (!$c)                                    return [1, "Die Anfrage ist abgelaufen – bitte noch einmal"];
            $r = webauthn_register(b64url_decode($data["clientDataJSON"] ?? ""), b64url_decode($data["attestationObject"] ?? ""), $c["challenge"], $origin, $rpId);
            if ($r[0] != 0)                             return $r;
            $d = json_decode($c["data"], true);
            $db_helper->execSql("INSERT INTO Users (handle, name) VALUES (?, ?)", [$d["handle"], $d["name"]], $request);
            $userId = $db_helper->lastId();
            $db_helper->execSql("INSERT INTO Credentials (id, user_id, public_key, sign_count) VALUES (?, ?, ?, ?)", [$r[1]["id"], $userId, $r[1]["public_key"], $r[1]["sign_count"]], $request);
            log_event("konto_neu");
            return [0, new_session($userId)];

        case 'login_options':
            $challenge = b64url_encode(random_bytes(32));
            $db_helper->execSql("INSERT INTO Challenges (challenge, purpose, data, time) VALUES (?, 'login', '', ?)", [$challenge, time()], $request);
            return [0, ["challenge" => $challenge, "rpId" => $rpId, "userVerification" => "preferred", "timeout" => 120000]];

        case 'login':
            $c = take_challenge($data["challenge"] ?? "", "login");
            if (!$c)                                    return [1, "Die Anfrage ist abgelaufen – bitte noch einmal"];
            $cred = $db_helper->execSql("SELECT id, user_id, public_key, sign_count FROM Credentials WHERE id = ?", [clean($data["id"] ?? "", 400)], $request)[1][0] ?? null;
            if (!$cred)                                 return [1, "Diesen Passkey kennt WMap nicht – erst registrieren"];
            $r = webauthn_login(b64url_decode($data["clientDataJSON"] ?? ""), b64url_decode($data["authenticatorData"] ?? ""), b64url_decode($data["signature"] ?? ""), $c["challenge"], $origin, $rpId, $cred["public_key"], $cred["sign_count"]);
            if ($r[0] != 0)                             return $r;
            $db_helper->execSql("UPDATE Credentials SET sign_count = ? WHERE id = ?", [$r[1], $cred["id"]], $request);
            return [0, new_session($cred["user_id"])];

        case 'me':
            $u = current_user();
            return [0, $u];

        case 'summary':
            $u = need_user();
            return [0, ["user" => $u] + owned($u["id"])];

        case 'delete_options':
            $challenge = b64url_encode(random_bytes(32));
            $db_helper->execSql("INSERT INTO Challenges (challenge, purpose, data, time) VALUES (?, 'delete', '', ?)", [$challenge, time()], $request);
            return [0, ["challenge" => $challenge, "rpId" => $rpId, "userVerification" => "required", "timeout" => 120000]];

        case 'delete':
            $c = take_challenge($data["challenge"] ?? "", "delete");
            if (!$c)                                    return [1, "Die Anfrage ist abgelaufen – bitte noch einmal"];
            $cred = $db_helper->execSql("SELECT id, user_id, public_key, sign_count FROM Credentials WHERE id = ?", [clean($data["id"] ?? "", 400)], $request)[1][0] ?? null;
            if (!$cred)                                 return [1, "Zu diesem Passkey gibt es kein WMap-Konto (mehr)"];
            $r = webauthn_login(b64url_decode($data["clientDataJSON"] ?? ""), b64url_decode($data["authenticatorData"] ?? ""), b64url_decode($data["signature"] ?? ""), $c["challenge"], $origin, $rpId, $cred["public_key"], $cred["sign_count"]);
            if ($r[0] != 0)                             return $r;
            $uid = $cred["user_id"];
            $user = $db_helper->execSql("SELECT id, name FROM Users WHERE id = ?", [$uid], $request)[1][0] ?? null;
            $gone = owned($uid);
            // Alles in einem Rutsch – bricht etwas ab, bleibt das Konto ganz
            $db_helper->begin();
            foreach ([
                "DELETE FROM Ratings WHERE user_id = ?",
                "DELETE FROM Ratings WHERE tour_id IN (SELECT id FROM Tours WHERE user_id = ?)",
                "DELETE FROM Tours WHERE user_id = ?",
                "DELETE FROM Plugins WHERE user_id = ?",
                "DELETE FROM Sessions WHERE user_id = ?",
                "DELETE FROM Credentials WHERE user_id = ?",
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
        "passkeys" => $n("SELECT COUNT(*) AS n FROM Credentials WHERE user_id = ?"),
    ];
}

/** Herkunft und Domain für WebAuthn – nur aus der erlaubten Liste */
function relying_party(){
    $origin = $_SERVER["HTTP_ORIGIN"] ?? "";
    if (!in_array($origin, ORIGINS, true)) {
        // Anfrage ohne Origin (gleiche Seite, alte Browser): aus dem Host bauen
        $scheme = (!empty($_SERVER["HTTPS"]) && $_SERVER["HTTPS"] !== "off") ? "https" : "http";
        $guess = $scheme."://".($_SERVER["HTTP_HOST"] ?? "");
        $origin = in_array($guess, ORIGINS, true) ? $guess : ORIGINS[0];
    }
    return [$origin, parse_url($origin, PHP_URL_HOST)];
}

/** Herausforderung einmalig einlösen */
function take_challenge($challenge, $purpose){
    global $db_helper;
    $r = $db_helper->execSql("SELECT challenge, data FROM Challenges WHERE challenge = ? AND purpose = ? AND time > ?", [$challenge, $purpose, time() - 300], "challenge");
    if ($r[0] != 0 || !count($r[1])) return null;
    $db_helper->execSql("DELETE FROM Challenges WHERE challenge = ?", [$challenge], "challenge");
    return $r[1][0];
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
