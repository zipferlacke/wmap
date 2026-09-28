<?php
/**
 * Touren, die andere teilen – mit Bewertungen.
 *   list {bbox?:[w,s,e,n], q?, mine?}  öffentliche (+ eigene) Touren, mit Sternen
 *   get {id}                            eine Tour samt Kommentaren
 *   save {id?, name, description, profile, shape, length, ascent, bbox, publish}
 *   delete {id}                         nur eigene
 *   rate {id, stars, comment}           je Nutzer eine Bewertung
 *
 * Status: private (nur für dich) · public (sofort für alle, wie bei Komoot)
 */

const PROFILES_OK = ['hike', 'walk', 'road', 'tour', 'gravel', 'mtb', 'drive', 'foot', 'bike', 'car'];

function tours($requestArray, $data){
    global $db_helper;
    $request = array_shift($requestArray);
    $user = current_user();
    $uid = $user["id"] ?? -1;
    $avg = "(SELECT ROUND(AVG(stars), 1) FROM Ratings r WHERE r.tour_id = t.id) AS stars, (SELECT COUNT(*) FROM Ratings r WHERE r.tour_id = t.id) AS votes";

    switch ($request) {
        case 'list':
            $where = ["(t.status = 'public' OR t.user_id = ?)"];
            $args = [$uid];
            if (!empty($data["mine"])) { $where = ["t.user_id = ?"]; $args = [$uid]; }
            if (isset($data["bbox"]) && is_array($data["bbox"]) && count($data["bbox"]) == 4) {
                [$w, $s, $e, $n] = array_map('floatval', $data["bbox"]);
                $where[] = "t.east >= ? AND t.west <= ? AND t.north >= ? AND t.south <= ?";
                array_push($args, $w, $e, $s, $n);
            }
            $q = clean($data["q"] ?? "", 80);
            if ($q !== "") { $where[] = "(t.name LIKE ? OR t.description LIKE ?)"; array_push($args, "%$q%", "%$q%"); }
            $sql = "SELECT t.id, t.name, t.description, t.profile, t.shape, t.length, t.ascent, t.status, t.time, u.name AS author, t.user_id = ? AS mine, $avg
                    FROM Tours t JOIN Users u ON u.id = t.user_id WHERE ".implode(" AND ", $where)." ORDER BY stars DESC NULLS LAST, t.time DESC LIMIT 150";
            return $db_helper->execSql($sql, array_merge([$uid], $args), $request);

        case 'get':
            $r = $db_helper->execSql("SELECT t.*, u.name AS author, t.user_id = ? AS mine, $avg FROM Tours t JOIN Users u ON u.id = t.user_id WHERE t.id = ? AND (t.status = 'public' OR t.user_id = ?)", [$uid, (int)($data["id"] ?? 0), $uid], $request);
            if ($r[0] != 0 || !count($r[1]))            return [1, "Tour nicht gefunden"];
            $tour = $r[1][0];
            unset($tour["user_id"]);
            $tour["ratings"] = $db_helper->execSql("SELECT r.stars, r.comment, r.time, u.name AS author FROM Ratings r JOIN Users u ON u.id = r.user_id WHERE r.tour_id = ? ORDER BY r.time DESC LIMIT 50", [$tour["id"]], $request)[1];
            return [0, $tour];

        case 'save':
            $user = need_user();
            $name = clean($data["name"] ?? "", 120);
            $shape = (string)($data["shape"] ?? "");
            $bbox = $data["bbox"] ?? null;
            if ($name === "")                           return [1, "Die Tour braucht einen Namen"];
            if ($shape === "" || strlen($shape) > MAX_SHAPE || !preg_match('/^[\x3f-\x7e]+$/', $shape)) return [1, "Der Verlauf fehlt oder ist zu lang"];
            if (!is_array($bbox) || count($bbox) != 4)  return [1, "Lage der Tour fehlt"];
            $profile = in_array($data["profile"] ?? "", PROFILES_OK, true) ? $data["profile"] : "hike";
            $status = !empty($data["publish"]) ? "public" : "private";
            $vals = [$name, clean($data["description"] ?? "", 2000), $profile, $shape, (float)($data["length"] ?? 0), (float)($data["ascent"] ?? 0), ...array_map('floatval', $bbox), $status];
            if (!empty($data["id"])) {
                $own = $db_helper->execSql("SELECT id FROM Tours WHERE id = ? AND user_id = ?", [(int)$data["id"], $user["id"]], $request)[1];
                if (!count($own))                       return [1, "Das ist nicht deine Tour"];
                $db_helper->execSql("UPDATE Tours SET name=?, description=?, profile=?, shape=?, length=?, ascent=?, west=?, south=?, east=?, north=?, status=?, updated=CURRENT_TIMESTAMP WHERE id=?", [...$vals, (int)$data["id"]], $request);
                return [0, ["id" => (int)$data["id"], "status" => $status]];
            }
            $db_helper->execSql("INSERT INTO Tours (name, description, profile, shape, length, ascent, west, south, east, north, status, user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", [...$vals, $user["id"]], $request);
            $id = $db_helper->lastId();
            log_event("tour_neu", null, "$status $profile");
            return [0, ["id" => $id, "status" => $status]];

        case 'delete':
            $user = need_user();
            $db_helper->execSql("DELETE FROM Tours WHERE id = ? AND user_id = ?", [(int)($data["id"] ?? 0), $user["id"]], $request);
            return [0, true];

        case 'rate':
            $user = need_user();
            $stars = max(1, min(5, (int)($data["stars"] ?? 0)));
            $id = (int)($data["id"] ?? 0);
            $ok = $db_helper->execSql("SELECT id FROM Tours WHERE id = ? AND status = 'public'", [$id], $request)[1];
            if (!count($ok))                            return [1, "Diese Tour kann man nicht bewerten"];
            $db_helper->execSql("INSERT INTO Ratings (tour_id, user_id, stars, comment) VALUES (?, ?, ?, ?) ON CONFLICT(tour_id, user_id) DO UPDATE SET stars = excluded.stars, comment = excluded.comment, time = CURRENT_TIMESTAMP", [$id, $user["id"], $stars, clean($data["comment"] ?? "", 1000)], $request);
            log_event("bewertung", null, (string)$stars);
            return [0, true];

        default:
            return [1, "nix gefunden... Anfrage falsch"];
    }
}
?>
