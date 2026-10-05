<?php
/**
 * Kurzer Link beim Teilen: Der gepackte Inhalt eines Links (Aufzeichnung, Tour) liegt für 30 Tage hier, der
 * Link trägt nur die Kennung (wege.html#k=… bzw. tour.html#k=…). Ohne Anmeldung; unverschlüsselt.
 *   put {kind, code}  → { id, days }   kind: weg | tour, code: der Teil hinter #weg= bzw. #t=
 *   get {id}          → { kind, code }
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
    $db_helper->execSql("DELETE FROM Shares WHERE created < ?", [time() - SHARE_DAYS * 86400], "share");

    switch ($request) {
        case 'put':
            $kind = $data["kind"] ?? "";
            $code = (string)($data["code"] ?? "");
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
                $r = $db_helper->execSql("INSERT INTO Shares (id, kind, code, created, who) VALUES (?, ?, ?, ?, ?)", [$id, $kind, $code, time(), $who], $request);
                if ($r[0] == 0) return [0, ["id" => $id, "days" => SHARE_DAYS]];
            }
            return [1, "Der kurze Link ließ sich nicht anlegen"];

        case 'get':
            $id = (string)($data["id"] ?? "");
            if (!preg_match('/^[A-Za-z0-9]{6,20}$/', $id)) return [1, "Der Link ist nicht vollständig"];
            $r = $db_helper->execSql("SELECT kind, code FROM Shares WHERE id = ?", [$id], $request);
            if ($r[0] != 0 || !count($r[1])) return [1, "Diesen Link gibt es nicht mehr – geteilte Touren löscht der Server nach ".SHARE_DAYS." Tagen"];
            return [0, ["kind" => $r[1][0]["kind"], "code" => $r[1][0]["code"]]];

        default:
            return [1, "nix gefunden... Anfrage falsch"];
    }
}
?>
