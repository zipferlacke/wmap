<?php
/**
 * Kurzer Link beim Teilen: Der gepackte Inhalt eines Links (Aufzeichnung, Tour) liegt für 30 Tage hier, der
 * Link trägt nur die Kennung (wege.html#k=… bzw. tour.html#k=…). Ohne Anmeldung. Neue Links verschlüsselt die App
 * selbst – der Schlüssel steht nur im Link hinter #, hier liegt allein der verschlüsselte Inhalt.
 *   put {kind, code, edit?}  → { id, days, token? }   kind: weg | tour, code: Inhalt (verschlüsselt oder wie hinter #t=)
 *                              edit: gemeinsam planen – wer den Schlüssel (token) hat, darf den Inhalt ändern
 *   get {id}                 → { kind, code, rev, editor, changed, edit, expires }   expires: Unix-Zeit, dann ist er weg
 *   update {id, token, code, rev, editor}  → { ok: true, rev, expires } oder, hat inzwischen jemand anders geändert,
 *                              { ok: false, rev, code, editor } (der neuere Stand – die App fragt, welcher bleibt)
 * Älteres wird bei jedem Aufruf gelöscht. Gegen Missbrauch: höchstens SHARE_PER_DAY Links je Herkunft und Tag –
 * gemerkt wird dafür nur ein Fingerabdruck aus Adresse und Datum (who), nicht die Adresse selbst.
 */

const SHARE_KINDS = ['weg', 'tour'];
const SHARE_DAYS = 30;
const SHARE_PER_DAY = 40;
const MAX_SHARE = 1500000;   // Zeichen – eine lange Aufzeichnung mit Puls und Frequenz bleibt weit darunter

function share($requestArray, $data){
    global $db_helper;
    $request = array_shift($requestArray);
    // Zum Ansehen: 30 Tage ab Anlegen; gemeinsam geplant: 30 Tage ab der letzten Änderung – solange geplant wird, bleibt sie
    $old = time() - SHARE_DAYS * 86400;
    // CAST: PDO übergibt die Zahl als Text; der Vergleich braucht eine Zahl, da SQLite Zahl < Text immer als wahr wertet
    $db_helper->execSql("DELETE FROM Shares WHERE (token IS NULL AND created < CAST(? AS INTEGER)) OR (token IS NOT NULL AND COALESCE(changed, created) < CAST(? AS INTEGER))", [$old, $old], "share");

    switch ($request) {
        case 'put':
            $kind = $data["kind"] ?? "";
            $code = (string)($data["code"] ?? "");
            $edit = !empty($data["edit"]) && $kind === "tour";
            if (!in_array($kind, SHARE_KINDS, true)) return [1, "Unbekannte Art"];
            if ($code === "" || !preg_match('/^[A-Za-z0-9_-]+$/', $code)) return [1, "Der Inhalt passt nicht"];
            if (strlen($code) > MAX_SHARE) return [1, "Die Tour ist zu groß für einen kurzen Link"];
            $who = hash('sha256', ($_SERVER["REMOTE_ADDR"] ?? "").date("Y-m-d"));
            $n = $db_helper->execSql("SELECT COUNT(*) AS n FROM Shares WHERE who = ?", [$who], $request);
            if ($n[0] == 0 && (int)($n[1][0]["n"] ?? 0) >= SHARE_PER_DAY) return [1, "Heute sind schon sehr viele kurze Links entstanden – bitte den langen Link nehmen"];
            $abc = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
            for ($try = 0; $try < 5; $try++) {
                $id = "";
                for ($i = 0; $i < 10; $i++) $id .= $abc[random_int(0, strlen($abc) - 1)];
                $token = $edit ? bin2hex(random_bytes(12)) : null;
                $r = $db_helper->execSql("INSERT INTO Shares (id, kind, code, created, who, token, rev, changed) VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
                    [$id, $kind, $code, time(), $who, $token ? hash('sha256', $token) : null, time()], $request);
                if ($r[0] == 0) return [0, array_merge(["id" => $id, "days" => SHARE_DAYS], $token ? ["token" => $token] : [])];
            }
            return [1, "Der kurze Link ließ sich nicht anlegen"];

        case 'get':
            $id = (string)($data["id"] ?? "");
            if (!preg_match('/^[A-Za-z0-9]{6,20}$/', $id)) return [1, "Der Link ist nicht vollständig"];
            $r = $db_helper->execSql("SELECT kind, code, rev, editor, created, changed, token FROM Shares WHERE id = ?", [$id], $request);
            if ($r[0] != 0 || !count($r[1])) return [1, "Diesen Link gibt es nicht mehr – geteilte Touren löscht der Server nach ".SHARE_DAYS." Tagen"];
            $s = $r[1][0];
            return [0, ["kind" => $s["kind"], "code" => $s["code"], "rev" => (int)($s["rev"] ?? 1), "editor" => $s["editor"] ?? null,
                "changed" => (int)($s["changed"] ?? 0), "edit" => !empty($s["token"]),
                "expires" => (int)(!empty($s["token"]) ? ($s["changed"] ?? $s["created"]) : $s["created"]) + SHARE_DAYS * 86400]];

        case 'update':
            $id = (string)($data["id"] ?? "");
            $code = (string)($data["code"] ?? "");
            if (!preg_match('/^[A-Za-z0-9]{6,20}$/', $id)) return [1, "Der Link ist nicht vollständig"];
            if ($code === "" || !preg_match('/^[A-Za-z0-9_-]+$/', $code)) return [1, "Der Inhalt passt nicht"];
            if (strlen($code) > MAX_SHARE) return [1, "Die Tour ist zu groß"];
            $r = $db_helper->execSql("SELECT code, rev, editor, token FROM Shares WHERE id = ?", [$id], $request);
            if ($r[0] != 0 || !count($r[1])) return [1, "Diese gemeinsame Tour gibt es nicht mehr – sie lag ".SHARE_DAYS." Tage auf dem Server"];
            $s = $r[1][0];
            if (empty($s["token"]) || !hash_equals($s["token"], hash('sha256', (string)($data["token"] ?? "")))) return [1, "Diese Tour darfst du nur ansehen"];
            $rev = (int)($s["rev"] ?? 1);
            // Inzwischen hat jemand anders geändert: den neueren Stand zurück
            if ((int)($data["rev"] ?? 0) !== $rev) return [0, ["ok" => false, "rev" => $rev, "code" => $s["code"], "editor" => $s["editor"]]];
            $editor = clean($data["editor"] ?? "", 40);
            $u = $db_helper->execSql("UPDATE Shares SET code = ?, rev = ?, editor = ?, changed = ? WHERE id = ? AND rev = ?", [$code, $rev + 1, $editor, time(), $id, $rev], $request);
            if ($u[0] != 0) return [1, "Die Änderung ließ sich nicht speichern"];
            return [0, ["ok" => true, "rev" => $rev + 1, "expires" => time() + SHARE_DAYS * 86400]];

        default:
            return [1, "nix gefunden... Anfrage falsch"];
    }
}
?>
