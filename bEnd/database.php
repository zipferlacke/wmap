<?php
/**
 * Datenbank von WMap (SQLite) – gleicher Aufbau wie bei wuecash:
 * openDatabase() legt fehlende Tabellen an, execSql() gibt [0, Zeilen] oder
 * [1, Meldung] zurück. Die Datei liegt in data/ (per .htaccess gesperrt).
 */
class DB_Helper{
    private $pdo;

    public function openDatabase(){
        try {
            if (!is_dir(__DIR__."/data")) mkdir(__DIR__."/data", 0775, true);
            // Ordner wird nicht mit hochgeladen – Schutz vor Direktabruf hier anlegen
            if (!file_exists(__DIR__."/data/.htaccess")) file_put_contents(__DIR__."/data/.htaccess", "Require all denied\n");
            $this->pdo = new PDO("sqlite:".__DIR__."/data/wmap.sqlite");
            $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
            $this->pdo->setAttribute(PDO::ATTR_STRINGIFY_FETCHES, false);
            $this->pdo->exec("PRAGMA foreign_keys = ON");
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
            // Nutzer – nur ein Name, angemeldet wird per Passkey
            // id - name - time
            // ===================================
            "CREATE TABLE IF NOT EXISTS Users (
                id                  INTEGER     PRIMARY KEY AUTOINCREMENT,
                handle              TEXT        UNIQUE,
                name                TEXT,
                time                DATETIME    DEFAULT CURRENT_TIMESTAMP
            )",

            // ===================================
            // Passkeys (WebAuthn) – öffentlicher Schlüssel je Gerät
            // id (Credential-ID, base64url) - user_id - public_key (PEM) - sign_count - time
            // ===================================
            "CREATE TABLE IF NOT EXISTS Credentials (
                id                  TEXT        PRIMARY KEY,
                user_id             INTEGER     REFERENCES Users(id) ON DELETE CASCADE,
                public_key          TEXT,
                sign_count          INTEGER     DEFAULT 0,
                time                DATETIME    DEFAULT CURRENT_TIMESTAMP
            )",

            // ===================================
            // Einmal-Herausforderungen für Passkeys (5 Minuten gültig)
            // challenge - purpose - data (JSON) - time
            // ===================================
            "CREATE TABLE IF NOT EXISTS Challenges (
                challenge           TEXT        PRIMARY KEY,
                purpose             TEXT,
                data                TEXT,
                time                INTEGER
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
        ];
        foreach ($tables as $sql) {
            $result = $this->execSql($sql, [], "openDatabase");
            if($result[0] == 1)                     {return($result);}
        }
        return [0];
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
