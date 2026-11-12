package de.wuefl.wmap.car

// Von tools/android-einbinden.py nach src-tauri/gen/android kopiert – hier ändern, nicht dort.

import android.content.Context
import org.json.JSONObject

/**
 * Texte der Vorlagen im Auto in der Sprache der App. Gewählt wird die Sprache nur am Handy (Begrüßung, Einstellungen);
 * die Seite im Auto schickt beim Start ihre Texte („texts“, js/car/car.js – appdata/lang/<Sprache>.json unter
 * car.native). Sie bleiben im gemeinsamen Speicher „wmap_shared“ gemerkt und gelten beim nächsten Start von Anfang an.
 * Was fehlt, steht auf Deutsch da.
 */
object CarTexts {
  private const val KEY = "car.texts"
  private val german = mapOf(
    "route" to "Route",
    "place" to "Ort",
    "search" to "Suchen",
    "arrived" to "Ziel erreicht",
    "follow" to "Der Route folgen",
    "nearby" to "In der Nähe",
    "bookmarks" to "Lesezeichen",
    "bookmarks_empty" to "Noch nichts gemerkt – einen Ort öffnen und den Stern antippen",
    "bookmarks_hint" to "Zuhause, Arbeit, gemerkte Orte",
    "nearby_empty" to "Nichts in der Nähe gefunden",
    "nearby_hint" to "Parkplätze, Tanken, Laden, Pause …",
    "search_tours" to "Tour suchen …",
    "search_where" to "Wohin?",
    "search_hint" to "Ort, Adresse, Parkplatz …",
    "places" to "Orte",
    "my_tours" to "Meine Touren",
    "tours_empty" to "Keine Touren fürs Auto geplant",
    "nothing" to "Nichts gefunden",
    "no_route" to "Keine Route gefunden",
    "place_missing" to "Ort nicht gefunden",
    "route_one" to "Route",
    "route_many" to "Routen",
    "tap_map" to "Karte antippen",
    "go" to "Los",
    "computing" to "Die Route wird noch berechnet …",
    "filter" to "Filter",
    "cancel" to "Abbrechen",
    "saved" to "Gemerkt",
    "chosen" to "Gewählt",
    "alternative" to "Alternative",
    "avoid_highways" to "Autobahnen vermeiden",
    "avoid_tolls" to "Mautstraßen vermeiden",
    "avoid_ferries" to "Fähren vermeiden",
  )
  private var now: Map<String, String> = emptyMap()

  operator fun get(key: String): String = now[key] ?: german[key] ?: key

  /** Die zuletzt geschickten Texte aus dem Speicher holen */
  fun load(ctx: Context) {
    val text = ctx.getSharedPreferences("wmap_shared", Context.MODE_PRIVATE).getString(KEY, "") ?: ""
    if (text.isNotEmpty()) runCatching { now = read(JSONObject(text)) }
  }

  /** Texte von der Seite übernehmen und merken → true, wenn sich etwas geändert hat */
  fun set(ctx: Context, o: JSONObject): Boolean {
    val next = read(o)
    if (next == now) return false
    now = next
    ctx.getSharedPreferences("wmap_shared", Context.MODE_PRIVATE).edit().putString(KEY, o.toString()).apply()
    return true
  }

  private fun read(o: JSONObject): Map<String, String> =
    o.keys().asSequence().filter { o.optString(it).isNotEmpty() }.associateWith { o.optString(it) }
}
