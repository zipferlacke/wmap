<?php
/**
 * Datenbank von WMap (SQLite) – gleicher Aufbau wie bei wuecash:
 * openDatabase() legt fehlende Tabellen an, execSql() gibt [0, Zeilen] oder
 * [1, Meldung] zurück. Zwei Dateien in data/ (per .htaccess gesperrt):
 *   wmap.sqlite    Konten, Anmeldungen, Touren, Bewertungen, Plugins, geteilte Links
 *   stats.sqlite   Statistik (Statistics, Counts) und Weiterleitung (ProxyCalls, ProxyState, RateLimit)
 */
class DB_Helper{
    private $pdo;
    /** Liegen in data/stats.sqlite (angehängt als „stat“), alles andere in data/wmap.sqlite */
    const STAT_TABLES = ["Statistics", "Counts", "ProxyCalls", "ProxyState", "RateLimit"];

    public function openDatabase(){
        try {
            if (!is_dir(__DIR__."/data")) mkdir(__DIR__."/data", 0775, true);
            // Ordner wird nicht mit hochgeladen – Schutz vor Direktabruf hier anlegen
            if (!file_exists(__DIR__."/data/.htaccess")) file_put_contents(__DIR__."/data/.htaccess", "Require all denied\n");
            $this->pdo = new PDO("sqlite:".__DIR__."/data/wmap.sqlite");
            $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
            $this->pdo->setAttribute(PDO::ATTR_STRINGIFY_FETCHES, false);
            $this->pdo->exec("PRAGMA foreign_keys = ON");
            // Statistik und Weiterleitung in einer eigenen Datei, angehängt als „stat“ – Tabellennamen ohne Vorsatz
            // finden sie dort, Abfragen über beide Dateien (stats.php: Konten) gehen wie in einer
            $this->pdo->exec("ATTACH DATABASE ".$this->pdo->quote(__DIR__."/data/stats.sqlite")." AS stat");
        } catch (PDOException $e) {
            return array(1, "Es gab einen Fehler bei der Verbindung zur Datenbank:".$e->getMessage());
        }

        $result = $this->createTables();
        if($result[0] == 1)                     {return($result);}
        return array(0);
    }

    private function createTables(){
        $tables = [
            // ===================================
            // Nutzer – verknüpft mit dem OpenStreetMap-Konto, Name wie dort
            // id - osm_id - name - time
            // (ältere Datenbanken haben noch „handle“ und die Tabellen
            //  Credentials/Challenges aus der Passkey-Zeit – ungenutzt)
            // ===================================
            "CREATE TABLE IF NOT EXISTS Users (
                id                  INTEGER     PRIMARY KEY AUTOINCREMENT,
                osm_id              INTEGER,
                name                TEXT,
                time                DATETIME    DEFAULT CURRENT_TIMESTAMP
            )",

            // ===================================
            // Anmeldungen (Token für den Kopf „Authorization: Bearer …“)
            // token - user_id - expires
            // ===================================
            "CREATE TABLE IF NOT EXISTS Sessions (
                token               TEXT        PRIMARY KEY,
                user_id             INTEGER     REFERENCES Users(id) ON DELETE CASCADE,
                expires             INTEGER
            )",

            // ===================================
            // Touren anderer – privat oder öffentlich
            // id - user_id - name - description - profile - shape (Polyline5) - length - ascent - bbox - status - time
            // ===================================
            "CREATE TABLE IF NOT EXISTS Tours (
                id                  INTEGER     PRIMARY KEY AUTOINCREMENT,
                user_id             INTEGER     REFERENCES Users(id) ON DELETE CASCADE,
                name                TEXT,
                description         TEXT,
                profile             TEXT,
                shape               TEXT,
                length              FLOAT,
                ascent              FLOAT,
                west                FLOAT,
                south               FLOAT,
                east                FLOAT,
                north               FLOAT,
                status              TEXT        DEFAULT 'private',
                time                DATETIME    DEFAULT CURRENT_TIMESTAMP,
                updated             DATETIME    DEFAULT CURRENT_TIMESTAMP
            )",

            // ===================================
            // Bewertungen – je Nutzer und Tour eine
            // tour_id - user_id - stars (1–5) - comment - time
            // ===================================
            "CREATE TABLE IF NOT EXISTS Ratings (
                tour_id             INTEGER     REFERENCES Tours(id) ON DELETE CASCADE,
                user_id             INTEGER     REFERENCES Users(id) ON DELETE CASCADE,
                stars               INTEGER,
                comment             TEXT,
                time                DATETIME    DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (tour_id, user_id)
            )",

            // ===================================
            // Plugins – Kartenebenen von Anbietern (Geologie, Messwerte …)
            // id - user_id - name - description - operator - contact - source_url - source_type - data (GeoJSON, nur bei „stored“) - attribution - data_date - status - time
            // ===================================
            "CREATE TABLE IF NOT EXISTS Plugins (
                id                  INTEGER     PRIMARY KEY AUTOINCREMENT,
                user_id             INTEGER     REFERENCES Users(id) ON DELETE CASCADE,
                name                TEXT,
                description         TEXT,
                operator            TEXT,
                contact             TEXT,
                source_url          TEXT,
                source_type         TEXT        DEFAULT 'geojson',
                data                TEXT,
                attribution         TEXT,
                data_date           TEXT,
                status              TEXT        DEFAULT 'private',
                time                DATETIME    DEFAULT CURRENT_TIMESTAMP,
                updated             DATETIME    DEFAULT CURRENT_TIMESTAMP
            )",
            // ===================================
            // Statistics – was über WMap passiert, eine Zeile je Ereignis, anonym:
            // kein Konto, kein Gerät, kein Ort, keine IP
            // time (UTC) - event - frage (1 Ja/Nein-Frage, 0 bewusst bearbeitet/eingetragen, sonst leer) - detail
            //   osm          Beitrag zu OpenStreetMap; detail: frage|bearbeitet|neu + karte|hinweis
            //   konto_neu / konto_geloescht
            //   tour_neu     detail: public|private
            //   plugin_neu   detail: public|private + Quelltyp
            //   bewertung    detail: Sterne
            // ===================================
            "CREATE TABLE IF NOT EXISTS stat.Statistics (
                id                  INTEGER     PRIMARY KEY AUTOINCREMENT,
                time                DATETIME    DEFAULT CURRENT_TIMESTAMP,
                event               TEXT,
                frage               INTEGER,
                detail              TEXT
            )",
            "CREATE INDEX IF NOT EXISTS stat.StatisticsEvent ON Statistics (event, time)",

            // ===================================
            // Shares – kurzer Link beim Teilen (api_share.php): der gepackte Inhalt des Links, 30 Tage
            // id (steht im Link) - kind (weg | tour) - code - created (Sekunden) - who (Fingerabdruck aus Adresse und Tag)
            // gemeinsam planen: token (Schlüssel zum Ändern, Hash) - rev (Stand) - editor (Name) - changed (Sekunden)
            // ===================================
            "CREATE TABLE IF NOT EXISTS Shares (
                id                  TEXT        PRIMARY KEY,
                kind                TEXT        NOT NULL,
                code                TEXT        NOT NULL,
                created             INTEGER     NOT NULL,
                who                 TEXT
            )",
            "CREATE INDEX IF NOT EXISTS SharesCreated ON Shares (created)",

            // ===================================
            // Counts – Zähler je Tag (UTC), anonym (api_stats.php count_up()):
            //   api:<teil>.<anfrage>   Aufrufe von api.php, z. B. api:tours.list
            //   proxy:<dienst>         Anfragen über proxy.php (Erfolg und Fehler stehen in ProxyCalls)
            //   client:<dienst>        Anfragen, die die App selbst stellt (Photon, Valhalla …) – kommt mit dem Ping
            //   ping:active|new|week|month   Geräte: heute aktiv, neu, erstmals diese Woche / diesen Monat
            //   ping:back_week|back_month    davon schon in der Vorwoche / im Vormonat da (verloren = aktiv davor − zurück)
            //   hit:page               Seitenaufrufe: Abrufe von appdata/messages.json (appdata/messages.php)
            //   test:<name>            dasselbe aus den Tests (Cookie wmap_test=1) – zählt nirgends sonst mit
            // day - name - n
            // ===================================
            "CREATE TABLE IF NOT EXISTS stat.Counts (
                day                 TEXT        NOT NULL,
                name                TEXT        NOT NULL,
                n                   INTEGER     NOT NULL DEFAULT 0,
                PRIMARY KEY (day, name)
            )",

            // ===================================
            // ProxyCalls – Weiterleitung (proxy.php) je Stunde und Server: wie erreichbar, wie schnell
            // hour (UTC, „2026-11-03 14“) - service - server - ok - fail - ms (Summe der Antwortzeiten der ok)
            // ===================================
            "CREATE TABLE IF NOT EXISTS stat.ProxyCalls (
                hour                TEXT        NOT NULL,
                service             TEXT        NOT NULL,
                server              TEXT        NOT NULL,
                ok                  INTEGER     NOT NULL DEFAULT 0,
                fail                INTEGER     NOT NULL DEFAULT 0,
                ms                  INTEGER     NOT NULL DEFAULT 0,
                PRIMARY KEY (hour, service, server)
            )",

            // ===================================
            // ProxyState – je Server: Pause nach Ausfall, zuletzt erreicht / ausgefallen (Sekunden), letzter Fehler
            // ===================================
            "CREATE TABLE IF NOT EXISTS stat.ProxyState (
                server              TEXT        PRIMARY KEY,
                until               INTEGER     DEFAULT 0,
                last_ok             INTEGER,
                last_fail           INTEGER,
                error               TEXT
            )",

            // ===================================
            // RateLimit – Anfragen je Minute und Absender (Hash aus Adresse und Tag, keine IP) – wird laufend geleert
            // ===================================
            "CREATE TABLE IF NOT EXISTS stat.RateLimit (
                minute              INTEGER     NOT NULL,
                who                 TEXT        NOT NULL,
                n                   INTEGER     NOT NULL DEFAULT 0,
                PRIMARY KEY (minute, who)
            )",
        ];
        foreach ($tables as $sql) {
            $result = $this->execSql($sql, [], "openDatabase");
            if($result[0] == 1)                     {return($result);}
        }
        $result = $this->moveStatTables();
        if($result[0] == 1)                     {return($result);}
        // Gemeinsam planen (api_share.php): Schlüssel zum Ändern, Stand, wer zuletzt und wann
        $cols = array_column($this->execSql("PRAGMA table_info(Shares)", [], "openDatabase")[1], "name");
        foreach (["token" => "TEXT", "rev" => "INTEGER DEFAULT 1", "editor" => "TEXT", "changed" => "INTEGER"] as $col => $type) {
            if (in_array($col, $cols, true)) continue;
            $result = $this->execSql("ALTER TABLE Shares ADD COLUMN $col $type", [], "openDatabase");
            if($result[0] == 1)                     {return($result);}
        }
        // Aus der Passkey-Zeit: Users ohne osm_id → Spalte nachrüsten
        $cols = array_column($this->execSql("PRAGMA table_info(Users)", [], "openDatabase")[1], "name");
        if (!in_array("osm_id", $cols, true)) {
            $result = $this->execSql("ALTER TABLE Users ADD COLUMN osm_id INTEGER", [], "openDatabase");
            if($result[0] == 1)                     {return($result);}
        }
        // Aktive Konten (stats.php): Tag der letzten Anfrage mit Anmeldung
        if (!in_array("last_seen", $cols, true)) {
            $result = $this->execSql("ALTER TABLE Users ADD COLUMN last_seen TEXT", [], "openDatabase");
            if($result[0] == 1)                     {return($result);}
        }
        return $this->execSql("CREATE UNIQUE INDEX IF NOT EXISTS UsersOsm ON Users (osm_id)", [], "openDatabase");
    }

    /**
     * Liegen die Tabellen der Statistik noch in wmap.sqlite (Stand vor 3.2): Zeilen nach stats.sqlite, dort löschen –
     * je Tabelle ganz oder gar nicht. Danach steht in wmap.sqlite nur noch, was zu Konten, Touren, Plugins und
     * geteilten Links gehört.
     */
    private function moveStatTables(){
        $old = array_column($this->execSql("SELECT name FROM main.sqlite_master WHERE type = 'table' AND name IN ('".implode("', '", self::STAT_TABLES)."')", [], "openDatabase")[1] ?? [], "name");
        foreach ($old as $table) {
            if (!in_array($table, self::STAT_TABLES, true)) continue;
            try {
                $this->pdo->exec("BEGIN IMMEDIATE");
                // Eine andere Anfrage war schneller: nichts mehr zu tun
                $there = $this->pdo->query("SELECT COUNT(*) FROM main.sqlite_master WHERE type = 'table' AND name = ".$this->pdo->quote($table))->fetchColumn();
                if ($there) {
                    $this->pdo->exec("INSERT OR IGNORE INTO stat.$table SELECT * FROM main.$table");
                    $this->pdo->exec("DROP TABLE main.$table");
                }
                $this->pdo->exec("COMMIT");
            } catch (PDOException $e) {
                try { $this->pdo->exec("ROLLBACK"); } catch (PDOException $e2) { /* keine offene Transaktion */ }
                return array(1, "Es gab einen Fehler beim Umzug der Statistik: ".$table);
            }
        }
        return array(0);
    }

    public function execSql($sql, $input, $action){
        try{
            $stmt = $this->pdo->prepare($sql);
            if($stmt->execute($input)){
                $result = $stmt->fetchAll(PDO::FETCH_ASSOC);
                if(count($result) == 0){return [0, []];}
                return array(0, $this->castData($result, $stmt));
            }
            return array(1, "Es gab einen Fehler während der Kommunikation mit der Datenbank: ".$action);
        } catch (PDOException $e) {
            return array(1, "Es gab einen Fehler während der Kommunikation mit der Datenbank: ".$action);
        }
    }

    /** Mehrere Schritte ganz oder gar nicht (Konto löschen) */
    public function begin(){    $this->pdo->beginTransaction(); }
    public function commit(){   $this->pdo->commit(); }
    public function rollback(){ if ($this->pdo->inTransaction()) $this->pdo->rollBack(); }

    public function lastId(){
        return (int)$this->pdo->lastInsertId();
    }

    /** Zahlen als Zahlen, JSON-Text als Array – wie bei wuecash */
    private function castData($dbData, $stmt){
        $out = [];
        foreach ($dbData as $row) {
            $new = [];
            $i = 0;
            foreach ($row as $name => $value){
                $meta = $stmt->getColumnMeta($i++);
                switch (strtolower($meta["native_type"] ?? "")) {
                    case 'integer': $value = $value === null ? null : (int)$value; break;
                    case 'double':  $value = $value === null ? null : (float)$value; break;
                }
                $new[$name] = $value;
            }
            $out[] = $new;
        }
        return $out;
    }
}
?>
