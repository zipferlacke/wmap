<?php
/**
 * Liefert messages.json und zählt dabei den Zugriff (Tabelle Counts, hit:page): Jede Seite von WMap holt die
 * Neuigkeiten beim Start hier (js/ui/news.js) – so viele Seitenaufrufe gab es, auch von Geräten ohne Nutzungsstatistik. Gezählt wird nur die Zahl je
 * Tag, nichts über das Gerät. Scheitert das Zählen, kommt die Datei trotzdem.
 */
try {
    require_once(__DIR__."/../bEnd/database.php");
    require_once(__DIR__."/../bEnd/api_stats.php");
    $db_helper = new DB_Helper();
    if ($db_helper->openDatabase()[0] == 0) count_up("hit:page");
} catch (Throwable $e) { /* ohne Zähler weiter */ }

header("Content-Type: application/json");
header("Cache-Control: no-cache");
readfile(__DIR__."/messages.json");
