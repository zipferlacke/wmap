package de.wuefl.wmap.car

// Von tools/android-einbinden.py nach src-tauri/gen/android kopiert – hier ändern, nicht dort.

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.os.Handler
import android.os.Looper
import android.text.SpannableString
import android.text.Spanned
import android.util.Base64
import android.util.LruCache
import androidx.car.app.CarContext
import androidx.car.app.CarToast
import androidx.car.app.Screen
import androidx.car.app.constraints.ConstraintManager
import androidx.car.app.model.Action
import androidx.car.app.model.ActionStrip
import androidx.car.app.model.CarColor
import androidx.car.app.model.CarIcon
import androidx.car.app.model.DateTimeWithZone
import androidx.car.app.model.Distance
import androidx.car.app.model.DistanceSpan
import androidx.car.app.model.DurationSpan
import androidx.car.app.model.GridItem
import androidx.car.app.model.GridTemplate
import androidx.car.app.model.Header
import androidx.car.app.model.ItemList
import androidx.car.app.model.ListTemplate
import androidx.car.app.model.Pane
import androidx.car.app.model.PaneTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.SearchTemplate
import androidx.car.app.model.Template
import androidx.car.app.model.Toggle
import androidx.car.app.navigation.model.MapController
import androidx.car.app.navigation.model.MapWithContentTemplate
import androidx.car.app.navigation.model.Maneuver
import androidx.car.app.navigation.model.MessageInfo
import androidx.car.app.navigation.model.NavigationTemplate
import androidx.car.app.navigation.model.PlaceListNavigationTemplate
import androidx.car.app.navigation.model.RoutePreviewNavigationTemplate
import androidx.car.app.navigation.model.RoutingInfo
import androidx.car.app.navigation.model.Step
import androidx.car.app.navigation.model.TravelEstimate
import androidx.car.app.versioning.CarAppApiLevels
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.IconCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import de.wuefl.wmap.R
import org.json.JSONArray
import org.json.JSONObject
import java.util.TimeZone
import kotlin.math.roundToInt

/*
 * Die Seiten im Auto. Alles, was sie zeigen, kommt von der Seite
 * (js/car/car.js) über CarWeb.call – Symbole in Listen als Bild (png), weil
 * das Auto die Symbolschrift der Webversion nicht kennt.
 */

object CarIcons {
  private val cache = LruCache<String, CarIcon>(120)

  /** Bild aus der Seite (Base64-PNG) */
  fun png(b64: String): CarIcon = cache.get(b64) ?: run {
    val bytes = Base64.decode(b64, Base64.DEFAULT)
    val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
    CarIcon.Builder(IconCompat.createWithBitmap(bmp)).build().also { cache.put(b64, it) }
  }

  /**
   * Eigenes Symbol (res/drawable) – als fertiges Bild, nicht als Nummer:
   * Android Auto merkt sich Bilder zu Nummern, nach einem Update mit neuen
   * Symbolen zeigte es sonst die alten an falscher Stelle. `color`: Farbe
   * (z. B. Blau für die Suche), sonst weiß.
   */
  fun res(ctx: CarContext, id: Int, color: Int = 0xFFFFFFFF.toInt()): CarIcon = cache.get("r$id/$color") ?: run {
    val d = ContextCompat.getDrawable(ctx, id)!!.mutate()
    d.setTint(color)
    val bmp = Bitmap.createBitmap(96, 96, Bitmap.Config.ARGB_8888)
    d.setBounds(0, 0, 96, 96)
    d.draw(Canvas(bmp))
    CarIcon.Builder(IconCompat.createWithBitmap(bmp)).build().also { cache.put("r$id/$color", it) }
  }

  const val BLUE = 0xFF1A73E8.toInt()
}

private fun CarContext.api(level: Int) = carAppApiLevel >= level

private fun iconAction(ctx: CarContext, id: Int, run: () -> Unit) =
  Action.Builder().setIcon(CarIcons.res(ctx, id)).setOnClickListener(run).build()

/** Rechts auf der Karte: Zoomen, zum Standort, Verschieben (Drehknopf, Wischen) */
/**
 * Rechts auf der Karte, von oben: Übersicht (nur mit Route – ganze Route,
 * „Standort“ holt zurück) bzw. Verschieben (Drehknopf; bei Touch blendet das
 * Auto ihn aus), +, −, Standort. Höchstens vier.
 */
private fun mapStrip(ctx: CarContext, s: WMapSession): ActionStrip = ActionStrip.Builder()
  .addAction(if (s.nav.active) iconAction(ctx, R.drawable.wmap_car_overview) { s.web.call("overview") } else Action.PAN)
  .addAction(iconAction(ctx, R.drawable.wmap_car_zoom_in) { s.web.call("zoomBy", 1) })
  .addAction(iconAction(ctx, R.drawable.wmap_car_zoom_out) { s.web.call("zoomBy", -1) })
  // Wie in der Navigation am Handy: ◎ / Pfeil (geneigt) / Kompass (flach)
  .addAction(iconAction(ctx, when (s.recenterIcon) {
    "navigation" -> R.drawable.wmap_car_navigation
    "explore" -> R.drawable.wmap_car_explore
    else -> R.drawable.wmap_car_my_location
  }) { s.web.call("recenter") })
  .build()

/**
 * Kopf eines Unterbildschirms: Zurück, Titel und – ab dem zweiten Schritt – ein
 * ✕ ganz zurück zur Karte (sonst tippt man sich Bildschirm für Bildschirm
 * zurück). `extra`: weiteres Symbol davor (Merken). `close = false`: ohne ✕ –
 * in der Routenwahl verdrängt ein Symbol im Kopf den Knopf „Los“.
 */
private fun header(screen: Screen, title: String, extra: Action? = null, close: Boolean = true): Header {
  val b = Header.Builder().setTitle(title).setStartHeaderAction(Action.BACK)
  extra?.let { b.addEndHeaderAction(it) }
  if (close && screen.screenManager.stackSize > 2) {
    b.addEndHeaderAction(iconAction(screen.carContext, R.drawable.wmap_car_close) { screen.screenManager.popToRoot() })
  }
  return b.build()
}

private fun distance(m: Double): Distance = when {
  m < 100 -> Distance.create(((m / 10).roundToInt() * 10).toDouble(), Distance.UNIT_METERS)
  m < 1000 -> Distance.create(((m / 50).roundToInt() * 50).toDouble(), Distance.UNIT_METERS)
  m < 10000 -> Distance.create((m / 100).roundToInt() / 10.0, Distance.UNIT_KILOMETERS_P1)
  else -> Distance.create((m / 1000).roundToInt().toDouble(), Distance.UNIT_KILOMETERS)
}

private fun JSONArray?.objects(): List<JSONObject> = if (this == null) emptyList() else (0 until length()).map { getJSONObject(it) }

/**
 * Zeile einer Liste: Titel, Unterzeile, Symbol. Orte mit Entfernung (Pflicht
 * neben der Karte: als Entfernung des Autos), alles andere führt weiter.
 */
private fun row(o: JSONObject, click: () -> Unit): Row {
  val b = Row.Builder().setTitle(o.optString("title").ifEmpty { "Ort" })
  val sub = o.optString("sub")
  val dist = if (o.has("dist") && !o.isNull("dist")) o.optDouble("dist") else null
  if (dist != null && o.optString("kind") != "category") {
    val rest = if (sub.firstOrNull()?.isDigit() == true) sub.substringAfter(" · ", "") else sub
    val t = SpannableString(if (rest.isEmpty()) " " else "  · $rest")
    t.setSpan(DistanceSpan.create(distance(dist)), 0, 1, Spanned.SPAN_INCLUSIVE_INCLUSIVE)
    b.addText(t)
  } else {
    if (sub.isNotEmpty()) b.addText(sub)
    b.setBrowsable(true)
  }
  o.optString("png").takeIf { it.isNotEmpty() }?.let { b.setImage(CarIcons.png(it)) }
  return b.setOnClickListener(click).build()
}

/**
 * Wohin die Zeile führt: Kategorie → Liste, Zuhause/Arbeit/Lesezeichen/zuletzt
 * gefahren (oder alles, wenn über das Routen-Symbol gesucht) → gleich die
 * Route, sonst der Ort.
 */
private fun openItem(ctx: CarContext, s: WMapSession, screen: Screen, o: JSONObject, route: Boolean = false) {
  val sm = screen.screenManager
  when {
    o.optString("kind") == "category" -> sm.push(CategoryScreen(ctx, s, o.optString("id"), o.optString("title")))
    o.has("key") && (route || o.optString("kind") == "target") ->
      sm.push(RoutePreviewScreen(ctx, s) { d -> s.web.call("routeTo", o.optString("key"), done = d) })
    o.has("key") -> sm.push(PlaceScreen(ctx, s, null, o.optString("key")))
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Karte: oben Suche, Route, Touren, In der Nähe – beim Navigieren die Anweisung
   ══════════════════════════════════════════════════════════════════════════ */

class MapScreen(ctx: CarContext, private val s: WMapSession) : Screen(ctx) {
  init {
    // Zurück auf der Karte: Planung, Ort und Treffer weg (nicht während der Navigation)
    lifecycle.addObserver(object : DefaultLifecycleObserver {
      override fun onResume(owner: LifecycleOwner) { if (!s.nav.active && s.web.isReady) s.web.call("clear") }
    })
  }

  override fun onGetTemplate(): Template {
    // Ein Bildschirm, der einen anderen ersetzt (Suche → „In der Nähe“): erst diese
    // Karte an das Auto, gleich danach der neue – so zählt er nicht als weiterer Schritt
    s.afterHome?.let { next ->
      s.afterHome = null
      Handler(Looper.getMainLooper()).post { if (screenManager.top === this) next() }
    }
    val b = NavigationTemplate.Builder()
    val n = s.nav
    if (n.active) {
      val g = n.guide
      when {
        g == null -> b.setNavigationInfo(RoutingInfo.Builder().setLoading(true).build())
        g.optBoolean("arrived") -> {
          b.setNavigationInfo(
            MessageInfo.Builder("Ziel erreicht").apply {
              g.optString("street").takeIf { it.isNotEmpty() }?.let { setText(it) }
              g.optString("icon").takeIf { it.isNotEmpty() }?.let { setImage(CarIcons.png(it)) }
            }.build(),
          )
          // Die Ankunftskarte bleibt stehen (0 min · 0 m): an ihr hängt das ✕ zum Beenden, das
          // immer sichtbar ist – die Knopfleiste blendet das Auto nach ein paar Sekunden aus
          b.setDestinationTravelEstimate(
            TravelEstimate.Builder(distance(0.0), DateTimeWithZone.create(System.currentTimeMillis(), TimeZone.getDefault()))
              .setRemainingTimeSeconds(0).build(),
          )
        }
        else -> {
          b.setNavigationInfo(routing(g))
          val secs = g.optDouble("secs", 0.0)
          b.setDestinationTravelEstimate(
            TravelEstimate.Builder(
              distance(g.optDouble("left", 0.0)),
              DateTimeWithZone.create(System.currentTimeMillis() + (secs * 1000).toLong(), TimeZone.getDefault()),
            ).setRemainingTimeSeconds(secs.toLong().coerceAtLeast(0)).build(),
          )
        }
      }
      b.setActionStrip(
        ActionStrip.Builder()
          // Beenden: das ✕ neben der Ankunftszeit (von Android Auto) – hier nicht doppelt.
          // Am Ziel gibt es keine Ankunftszeit mehr und damit kein ✕: dann hier
          // (die Navigation endet sonst nach 30 s von selbst – js/car/car.js)
          .apply { if (g?.optBoolean("arrived") == true) addAction(iconAction(carContext, R.drawable.wmap_car_close) { s.web.call("stop") }) }
          .addAction(iconAction(carContext, R.drawable.wmap_car_nearby) { screenManager.push(NearbyScreen(carContext, s)) })
          .addAction(iconAction(carContext, if (n.muted) R.drawable.wmap_car_volume_off else R.drawable.wmap_car_volume_up) {
            s.web.call("mute") { v, _ -> n.muted = v == true; invalidate() }
          })
          .build(),
      )
    } else {
      // Ohne Route: links eine feste Karte (bleibt stehen, die Leiste blendet das Auto aus)
      if (carContext.api(CarAppApiLevels.LEVEL_7)) return home()
      b.setActionStrip(
        ActionStrip.Builder()
          .addAction(
            Action.Builder().setTitle("Suchen").setIcon(CarIcons.res(carContext, R.drawable.wmap_car_search))
              .setFlags(Action.FLAG_PRIMARY).setBackgroundColor(CarColor.BLUE)
              .setOnClickListener { screenManager.push(SearchScreen(carContext, s)) }.build(),
          )
          .addAction(iconAction(carContext, R.drawable.wmap_car_directions) { screenManager.push(SearchScreen(carContext, s, route = true)) })
          .build(),
      )
    }
    if (carContext.api(CarAppApiLevels.LEVEL_2)) {
      b.setMapActionStrip(mapStrip(carContext, s))
      b.setPanModeListener { }
    }
    return b.build()
  }

  /**
   * Start ohne Route: links nur eine Such-„Leiste“ – „Suchen“ (öffnet die
   * Suche mit Orten und Meinen Touren) und daneben das Routen-Symbol (Ziel
   * wählen → gleich die Route). Sie bleibt stehen; die Leisten des Autos
   * blendet Android Auto nach ein paar Sekunden aus.
   */
  private fun home(): Template {
    val bar = Row.Builder()
      .setTitle("Suchen")
      .setImage(CarIcons.res(carContext, R.drawable.wmap_car_search, CarIcons.BLUE))
      .setOnClickListener { screenManager.push(SearchScreen(carContext, s)) }
    if (carContext.api(CarAppApiLevels.LEVEL_6)) {
      bar.addAction(
        Action.Builder()
          .setIcon(CarIcons.res(carContext, R.drawable.wmap_car_directions, CarIcons.BLUE))
          .setOnClickListener { screenManager.push(SearchScreen(carContext, s, route = true)) }.build(),
      )
    }
    val content = ListTemplate.Builder()
      .setSingleList(ItemList.Builder().addItem(bar.build()).build())
      .build()
    return MapWithContentTemplate.Builder()
      .setContentTemplate(content)
      .setMapController(MapController.Builder().setMapActionStrip(mapStrip(carContext, s)).setPanModeListener { }.build())
      .build()
  }

  private fun routing(g: JSONObject): RoutingInfo {
    val m = Maneuver.Builder(maneuverType(g))
    val exit = g.optInt("exit", 0)
    if (needsExit(g) && exit > 0) m.setRoundaboutExitNumber(exit)
    g.optString("icon").takeIf { it.isNotEmpty() }?.let { m.setIcon(CarIcons.png(it)) }
    val cue = listOf(g.optString("street"), g.optString("toward")).filter { it.isNotEmpty() && it != "null" }.joinToString(" · ")
    val step = Step.Builder(cue.ifEmpty { "Der Route folgen" }).setManeuver(m.build()).build()
    return RoutingInfo.Builder().setCurrentStep(step, distance(g.optDouble("dist", 0.0))).build()
  }

  private fun needsExit(g: JSONObject) = g.optInt("type", -1) == 26 && g.optInt("exit", 0) > 0

  /** Valhalla-Manöver → Manöver des Autos (Rechtsverkehr: Kreisel gegen den Uhrzeigersinn) */
  private fun maneuverType(g: JSONObject): Int {
    if (g.optString("type") == "via") return Maneuver.TYPE_DESTINATION
    return when (g.optInt("type", -1)) {
      1, 2, 3 -> Maneuver.TYPE_DEPART
      4 -> Maneuver.TYPE_DESTINATION
      5 -> Maneuver.TYPE_DESTINATION_RIGHT
      6 -> Maneuver.TYPE_DESTINATION_LEFT
      7 -> Maneuver.TYPE_NAME_CHANGE
      8, 22, 17 -> Maneuver.TYPE_STRAIGHT
      9 -> Maneuver.TYPE_TURN_SLIGHT_RIGHT
      10 -> Maneuver.TYPE_TURN_NORMAL_RIGHT
      11 -> Maneuver.TYPE_TURN_SHARP_RIGHT
      12 -> Maneuver.TYPE_U_TURN_RIGHT
      13 -> Maneuver.TYPE_U_TURN_LEFT
      14 -> Maneuver.TYPE_TURN_SHARP_LEFT
      15 -> Maneuver.TYPE_TURN_NORMAL_LEFT
      16 -> Maneuver.TYPE_TURN_SLIGHT_LEFT
      18 -> Maneuver.TYPE_ON_RAMP_NORMAL_RIGHT
      19 -> Maneuver.TYPE_ON_RAMP_NORMAL_LEFT
      20 -> Maneuver.TYPE_OFF_RAMP_NORMAL_RIGHT
      21 -> Maneuver.TYPE_OFF_RAMP_NORMAL_LEFT
      23 -> Maneuver.TYPE_KEEP_RIGHT
      24 -> Maneuver.TYPE_KEEP_LEFT
      25 -> Maneuver.TYPE_MERGE_SIDE_UNSPECIFIED
      37 -> Maneuver.TYPE_MERGE_RIGHT
      38 -> Maneuver.TYPE_MERGE_LEFT
      26 -> if (needsExit(g)) Maneuver.TYPE_ROUNDABOUT_ENTER_AND_EXIT_CCW else Maneuver.TYPE_ROUNDABOUT_ENTER_CCW
      27 -> Maneuver.TYPE_ROUNDABOUT_EXIT_CCW
      28 -> Maneuver.TYPE_FERRY_BOAT
      29 -> Maneuver.TYPE_STRAIGHT
      else -> Maneuver.TYPE_UNKNOWN
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Listen mit Karte daneben
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Liste neben der Karte. `load(fertig)` fragt die Seite; die Antwort ist
 * { items: [...] } (oder eine Liste). Tippen öffnet, was `pick` sagt.
 */
open class ListScreen(
  ctx: CarContext,
  protected val s: WMapSession,
  private val title: String,
  private val empty: String,
  private val extra: List<Row> = emptyList(),
) : Screen(ctx) {
  protected var items: List<JSONObject>? = null
  protected var error: String? = null

  open fun load(done: (Any?, String?) -> Unit) {}
  open fun pick(o: JSONObject) = openItem(carContext, s, this, o)

  init {
    lifecycle.addObserver(object : DefaultLifecycleObserver {
      override fun onCreate(owner: LifecycleOwner) { reload() }
    })
  }

  protected fun reload() {
    load { v, err ->
      items = when (v) {
        is JSONObject -> v.optJSONArray("items").objects()
        is JSONArray -> v.objects()
        else -> emptyList()
      }
      error = err
      invalidate()
    }
  }

  override fun onGetTemplate(): Template {
    val b = PlaceListNavigationTemplate.Builder().setHeader(header(this, title))
    val list = items
    if (list == null && extra.isEmpty()) b.setLoading(true)
    else {
      val il = ItemList.Builder()
      extra.forEach { il.addItem(it) }
      (list ?: emptyList()).forEach { o -> il.addItem(row(o) { pick(o) }) }
      il.setNoItemsMessage(error ?: empty)
      b.setItemList(il.build())
    }
    if (carContext.api(CarAppApiLevels.LEVEL_4)) {
      b.setMapActionStrip(mapStrip(carContext, s))
      b.setPanModeListener { }
    }
    return b.build()
  }
}

/** In der Nähe: Parkplätze, Tankstellen, Ladesäulen … als Raster aus Symbolen */
class NearbyScreen(ctx: CarContext, private val s: WMapSession) : Screen(ctx) {
  private var items: List<JSONObject>? = null

  init {
    lifecycle.addObserver(object : DefaultLifecycleObserver {
      override fun onCreate(owner: LifecycleOwner) {
        s.web.call("categories") { v, _ -> items = (v as? JSONArray).objects(); invalidate() }
      }
    })
  }

  override fun onGetTemplate(): Template {
    val b = GridTemplate.Builder()
    if (carContext.api(CarAppApiLevels.LEVEL_7)) b.setHeader(header(this, "In der Nähe"))
    else {
      @Suppress("DEPRECATION") b.setTitle("In der Nähe")
      @Suppress("DEPRECATION") b.setHeaderAction(Action.BACK)
    }
    val list = items
    if (list == null) return b.setLoading(true).build()
    val il = ItemList.Builder()
    list.forEach { o ->
      il.addItem(GridItem.Builder().setTitle(o.optString("title"))
        .setImage(CarIcons.png(o.optString("png")))
        .setOnClickListener { screenManager.push(CategoryScreen(carContext, s, o.optString("id"), o.optString("title"))) }
        .build())
    }
    return b.setSingleList(il.build()).build()
  }
}

/**
 * Lesezeichen als Raster: Zuhause, Arbeit, Gemerktes (js/car/car.js bookmarks).
 * Ein Tipp führt gleich zur Routenwahl – es sind die Orte, zu denen man will.
 */
class BookmarksScreen(ctx: CarContext, private val s: WMapSession) : Screen(ctx) {
  private var items: List<JSONObject>? = null

  init {
    lifecycle.addObserver(object : DefaultLifecycleObserver {
      override fun onCreate(owner: LifecycleOwner) {
        s.web.call("bookmarks") { v, _ -> items = (v as? JSONObject)?.optJSONArray("items").objects(); invalidate() }
      }
    })
  }

  override fun onGetTemplate(): Template {
    val b = GridTemplate.Builder()
    if (carContext.api(CarAppApiLevels.LEVEL_7)) b.setHeader(header(this, "Lesezeichen"))
    else {
      @Suppress("DEPRECATION") b.setTitle("Lesezeichen")
      @Suppress("DEPRECATION") b.setHeaderAction(Action.BACK)
    }
    val list = items
    if (list == null) return b.setLoading(true).build()
    // So viele Kacheln, wie das Auto erlaubt
    val limit = if (carContext.api(CarAppApiLevels.LEVEL_2)) {
      carContext.getCarService(ConstraintManager::class.java).getContentLimit(ConstraintManager.CONTENT_LIMIT_TYPE_GRID)
    } else 6
    val il = ItemList.Builder()
    list.take(limit).forEach { o ->
      val item = GridItem.Builder().setTitle(o.optString("title").ifEmpty { "Ort" })
        .setImage(CarIcons.png(o.optString("png")))
        .setOnClickListener { screenManager.push(RoutePreviewScreen(carContext, s) { d -> s.web.call("routeTo", o.optString("key"), done = d) }) }
      // Darunter die Entfernung; ohne Standort der Ort
      o.optString("sub").substringBefore(" · ").takeIf { it.isNotEmpty() }?.let { item.setText(it) }
      il.addItem(item.build())
    }
    il.setNoItemsMessage("Noch nichts gemerkt – am Handy einen Ort öffnen und „Merken“ antippen")
    return b.setSingleList(il.build()).build()
  }
}

/**
 * Treffer einer Kategorie – erst aus den Kartenkacheln, dann vollständig. Ein
 * Treffer führt gleich zur Routenwahl mit „Los“ (Entfernung und geöffnet/zu
 * stehen schon in der Zeile): Android Auto erlaubt nur fünf Bildschirme
 * hintereinander, mit dem Ort dazwischen blieb die Routenwahl leer.
 */
class CategoryScreen(ctx: CarContext, s: WMapSession, private val id: String, title: String) :
  ListScreen(ctx, s, title, "Nichts in der Nähe gefunden") {
  private var token = -1

  override fun pick(o: JSONObject) {
    if (o.has("key")) screenManager.push(RoutePreviewScreen(carContext, s) { d -> s.web.call("routeTo", o.optString("key"), done = d) })
  }
  private val update: (JSONObject) -> Unit = { o ->
    if (o.optInt("token") == token) {
      items = o.optJSONArray("items").objects()
      error = o.optString("error").takeIf { it.isNotEmpty() && it != "null" }
      invalidate()
    }
  }

  init {
    lifecycle.addObserver(object : DefaultLifecycleObserver {
      override fun onCreate(owner: LifecycleOwner) { s.listListeners.add(update) }
      override fun onDestroy(owner: LifecycleOwner) { s.listListeners.remove(update) }
    })
  }

  override fun load(done: (Any?, String?) -> Unit) = s.web.call("category", id) { v, err ->
    token = (v as? JSONObject)?.optInt("token") ?: -1
    done(v, err)
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Suche
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Suche: oben das Suchfeld, rechts der Umschalter „Meine Touren“ / „Orte“
 * (wie zwei Reiter – echte Reiter erlaubt Android Auto nur auf der
 * Startseite). Orte leer: „In der Nähe“ (Parkplatz, Tanken als Knöpfe),
 * dann Zuhause, Arbeit, Lesezeichen, zuletzt gefahren. „In der Nähe“ öffnet
 * das Raster mit den großen Symbolen anstelle der Suche, nicht über ihr
 * (replace) – sonst wäre es bis zur Routenwahl ein Bildschirm zu viel
 * (höchstens fünf hintereinander).
 * Meine Touren: die fürs Auto geplanten, das Suchfeld filtert.
 * `route`: über das Routen-Symbol – ein Ort führt gleich zur Route.
 */
class SearchScreen(ctx: CarContext, private val s: WMapSession, initial: String = "", private val route: Boolean = false) : Screen(ctx) {
  private var text = initial
  private var tours = false
  private var items: List<JSONObject>? = null
  private var nearby: List<JSONObject> = emptyList()
  private var saved: List<JSONObject> = emptyList()
  private var seq = 0
  private val main = Handler(Looper.getMainLooper())
  private val later = Runnable { query() }

  init {
    lifecycle.addObserver(object : DefaultLifecycleObserver {
      override fun onCreate(owner: LifecycleOwner) {
        query()
        s.web.call("categories") { v, _ -> nearby = (v as? JSONArray).objects(); invalidate() }
        s.web.call("bookmarks") { v, _ -> saved = (v as? JSONObject)?.optJSONArray("items").objects(); invalidate() }
      }
      override fun onDestroy(owner: LifecycleOwner) { main.removeCallbacks(later) }
    })
  }

  private fun query() {
    val mine = ++seq
    s.web.call(if (tours) "tours" else "search", text) { v, err ->
      if (mine != seq) return@call
      items = (v as? JSONObject)?.optJSONArray("items").objects()
      if (err != null) CarToast.makeText(carContext, err, CarToast.LENGTH_SHORT).show()
      invalidate()
    }
  }

  /**
   * Diesen Bildschirm durch einen anderen ersetzen: erst zurück zur Karte, die
   * öffnet ihn dann (MapScreen, WMapSession.afterHome). Android Auto zählt so
   * einen Schritt weniger als bei „darüberlegen“.
   */
  private fun replace(next: () -> Screen) {
    s.afterHome = { screenManager.push(next()) }
    screenManager.popToRoot()
  }

  /** „In der Nähe“ mit Parkplatz und Tanken als Knöpfe (zwei je Zeile gehen ab Car API 8) */
  private fun nearbyRow(): Row {
    val b = Row.Builder().setTitle("In der Nähe").addText("Parkplätze, Tanken, Laden, Pause …")
      .setImage(CarIcons.res(carContext, R.drawable.wmap_car_nearby, CarIcons.BLUE))
      .setOnClickListener { replace { NearbyScreen(carContext, s) } }
    if (carContext.api(CarAppApiLevels.LEVEL_8)) {
      nearby.filter { it.optString("id") in listOf("parking", "fuel") }.forEach { c ->
        b.addAction(Action.Builder().setIcon(CarIcons.png(c.optString("png")))
          .setOnClickListener { replace { CategoryScreen(carContext, s, c.optString("id"), c.optString("title")) } }.build())
      }
    }
    return try { b.build() } catch (_: Exception) {
      Row.Builder().setTitle("In der Nähe").addText("Parkplätze, Tanken, Laden, Pause …").setBrowsable(true)
        .setOnClickListener { replace { NearbyScreen(carContext, s) } }.build()
    }
  }

  /** „Lesezeichen“ wie „In der Nähe“: die Zeile öffnet die Kacheln, Zuhause und Arbeit gehen als Knöpfe gleich zur Route */
  private fun bookmarksRow(): Row {
    val names = saved.take(3).joinToString(", ") { it.optString("title") } + if (saved.size > 3) " …" else ""
    val plain = {
      Row.Builder().setTitle("Lesezeichen").addText(names)
        .setImage(CarIcons.res(carContext, R.drawable.wmap_car_star, CarIcons.BLUE))
        .setOnClickListener { replace { BookmarksScreen(carContext, s) } }
    }
    val b = plain()
    if (carContext.api(CarAppApiLevels.LEVEL_8)) {
      saved.filter { it.optString("place") in listOf("home", "work") }.take(2).forEach { o ->
        b.addAction(Action.Builder().setIcon(CarIcons.png(o.optString("png")))
          .setOnClickListener { screenManager.push(RoutePreviewScreen(carContext, s) { d -> s.web.call("routeTo", o.optString("key"), done = d) }) }.build())
      }
    }
    return try { b.build() } catch (_: Exception) { plain().setBrowsable(true).build() }
  }

  override fun onGetTemplate(): Template {
    val b = SearchTemplate.Builder(object : SearchTemplate.SearchCallback {
      override fun onSearchTextChanged(searchText: String) {
        text = searchText
        main.removeCallbacks(later)
        main.postDelayed(later, 450)
      }

      override fun onSearchSubmitted(searchText: String) {
        text = searchText
        main.removeCallbacks(later)
        query()
      }
    })
      .setHeaderAction(Action.BACK)
      .setSearchHint(if (tours) "Tour suchen …" else if (route) "Wohin?" else "Ort, Adresse, Parkplatz …")
      .setShowKeyboardByDefault(false)
      .setActionStrip(ActionStrip.Builder().addAction(
        Action.Builder().setTitle(if (tours) "Orte" else "Meine Touren")
          .setIcon(CarIcons.res(carContext, if (tours) R.drawable.wmap_car_search else R.drawable.wmap_car_tours))
          .setOnClickListener { tours = !tours; items = null; query(); invalidate() }.build(),
      ).build())
    if (text.isNotEmpty()) b.setInitialSearchText(text)
    val list = items
    if (list == null) b.setLoading(true)
    else {
      val il = ItemList.Builder()
      if (!tours && text.length < 2) {
        il.addItem(nearbyRow())
        if (saved.isNotEmpty()) il.addItem(bookmarksRow())
      }
      list.forEach { o ->
        il.addItem(row(o) {
          if (tours) screenManager.push(RoutePreviewScreen(carContext, s) { d -> s.web.call("tour", o.optString("id"), done = d) })
          else openItem(carContext, s, this, o, route)
        })
      }
      il.setNoItemsMessage(if (tours) "Keine Touren fürs Auto geplant" else "Nichts gefunden")
      b.setItemList(il.build())
    }
    return b.build()
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Ort: wie der Dialog in der App – Art, Entfernung, Adresse, Öffnungszeiten
   ══════════════════════════════════════════════════════════════════════════ */

class PlaceScreen(ctx: CarContext, private val s: WMapSession, place: JSONObject?, private val key: String? = null) : Screen(ctx) {
  private var place: JSONObject? = place

  init {
    if (place == null && key != null) {
      lifecycle.addObserver(object : DefaultLifecycleObserver {
        override fun onCreate(owner: LifecycleOwner) {
          s.web.call("place", key) { v, err ->
            if (v is JSONObject) { this@PlaceScreen.place = v; invalidate() }
            else { CarToast.makeText(carContext, err ?: "Ort nicht gefunden", CarToast.LENGTH_SHORT).show(); screenManager.pop() }
          }
        }
      })
    }
  }

  override fun onGetTemplate(): Template {
    val p = place
    val pane = Pane.Builder()
    if (p == null) pane.setLoading(true)
    else {
      val first = listOf(p.optString("type"), p.optString("distText")).filter { it.isNotEmpty() }.joinToString(" · ")
      pane.addRow(Row.Builder().setTitle(first.ifEmpty { "Ort" }).apply {
        p.optString("address").takeIf { it.isNotEmpty() }?.let { addText(it) }
        p.optString("png").takeIf { it.isNotEmpty() }?.let { setImage(CarIcons.png(it)) }
      }.build())
      p.optString("status").takeIf { it.isNotEmpty() }?.let { st ->
        pane.addRow(Row.Builder().setTitle(st).build())
      }
      p.optJSONArray("facts").objects().take(2).forEach { f ->
        pane.addRow(Row.Builder().setTitle(f.optString("label")).addText(f.optString("value")).build())
      }
      val placeKey = p.optString("key")
      pane.addAction(
        Action.Builder().setTitle("Route").setIcon(CarIcons.res(carContext, R.drawable.wmap_car_directions))
          .setBackgroundColor(CarColor.BLUE).setFlags(Action.FLAG_PRIMARY)
          .setOnClickListener {
            screenManager.push(RoutePreviewScreen(carContext, s) { d -> s.web.call("routeTo", placeKey, done = d) })
          }.build(),
      )
      pane.addAction(Action.Builder().setTitle("Abbrechen").setOnClickListener { screenManager.pop() }.build())
    }
    val title = p?.optString("title")?.ifEmpty { "Ort" } ?: "Ort"
    // Merken als Stern oben rechts
    val star = if (p != null && !p.optBoolean("saved")) Action.Builder().setIcon(CarIcons.res(carContext, R.drawable.wmap_car_star))
      .setOnClickListener {
        s.web.call("save", p.optString("key")) { v, _ ->
          if (v == true) { p.put("saved", true); CarToast.makeText(carContext, "Gemerkt", CarToast.LENGTH_SHORT).show(); invalidate() }
        }
      }.build() else null
    val content = PaneTemplate.Builder(pane.build()).apply {
      if (carContext.api(CarAppApiLevels.LEVEL_7)) setHeader(header(this@PlaceScreen, title, star))
      else {
        @Suppress("DEPRECATION") setTitle(title)
        @Suppress("DEPRECATION") setHeaderAction(Action.BACK)
      }
    }.build()
    // Mit Karte daneben, wo das Auto es kann
    if (carContext.api(CarAppApiLevels.LEVEL_7)) {
      return MapWithContentTemplate.Builder()
        .setContentTemplate(content)
        .setMapController(MapController.Builder().setMapActionStrip(mapStrip(carContext, s)).setPanModeListener { }.build())
        .build()
    }
    return content
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Routenwahl: Varianten mit Dauer und Länge, „Los“ startet die Navigation
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Routenwahl. Gebaut wie der Ort (Karte mit Feld daneben): je Route eine Zeile,
 * darunter die Knöpfe „Los“ und „Andere Route“ (wechselt die gewählte, die
 * Karte zeigt sie). Googles eigene Vorlage für die Routenwahl
 * (RoutePreviewNavigationTemplate) bleibt in aktuellen Android-Auto-Fassungen
 * leer, wenn der Bildschirm davor schon eine Karte zeigte (Ort, Trefferliste) –
 * sie kommt nur noch in älteren Autos ohne die Karten-Vorlage zum Einsatz.
 */
class RoutePreviewScreen(ctx: CarContext, private val s: WMapSession, private val load: (done: (Any?, String?) -> Unit) -> Unit) : Screen(ctx) {
  private var result: JSONObject? = null
  private var selected = 0
  private var starting = false

  private fun loaded(v: Any?, err: String?) {
    if (v is JSONObject && (v.optJSONArray("routes")?.length() ?: 0) > 0) { result = v; selected = 0; invalidate() }
    else { CarToast.makeText(carContext, err ?: "Keine Route gefunden", CarToast.LENGTH_LONG).show(); screenManager.pop() }
  }

  init {
    lifecycle.addObserver(object : DefaultLifecycleObserver {
      override fun onCreate(owner: LifecycleOwner) { load(::loaded) }

      // Zurück vom Filter (Autobahn, Maut, Fähren): dieselbe Strecke neu rechnen
      override fun onResume(owner: LifecycleOwner) {
        if (!s.prefsChanged) return
        s.prefsChanged = false
        result = null
        invalidate()
        s.web.call("routesAgain", done = ::loaded)
      }
    })
  }

  /** Auf der Karte wurde eine andere Route angetippt (js/car/car.js click) */
  fun selectedOnMap(id: Int) {
    val i = result?.optJSONArray("routes").objects().indexOfFirst { it.optInt("id") == id }
    if (i >= 0 && i != selected) { selected = i; invalidate() }
  }

  private fun start() {
    if (starting) return
    starting = true
    s.web.call("start") { _, err ->
      starting = false
      if (err != null) CarToast.makeText(carContext, err, CarToast.LENGTH_LONG).show()
      else screenManager.popToRoot()
    }
  }

  private fun select(routes: List<JSONObject>, i: Int) {
    selected = i
    s.web.call("selectRoute", routes[i].optInt("id"))
  }

  private val go get() = Action.Builder().setTitle("Los").setIcon(CarIcons.res(carContext, R.drawable.wmap_car_navigation))

  override fun onGetTemplate(): Template {
    val r = result
    val title = r?.optString("title")?.ifEmpty { "Route" } ?: "Route"
    val routes = r?.optJSONArray("routes").objects()
    if (!carContext.api(CarAppApiLevels.LEVEL_7)) return classic(title, r, routes)

    val pane = Pane.Builder()
    if (r == null) pane.setLoading(true)
    else {
      val at = selected.coerceIn(0, maxOf(0, routes.size - 1))
      // Jede Route eine Zeile, immer in derselben Reihenfolge: die gewählte mit Pfeil, jede andere mit
      // einem Knopf zum Wählen (Zeilen selbst lassen sich in diesem Feld nicht antippen). Auch ein Tipp
      // auf die Route in der Karte wählt sie.
      routes.indices.take(4).forEach { i ->
        val o = routes[i]
        val sub = listOf(if (routes.size > 1) (if (i == at) "Gewählt" else "Alternative") else "", o.optString("sub")).filter { it.isNotEmpty() }.joinToString(" · ")
        pane.addRow(Row.Builder().setTitle(o.optString("title")).apply {
          if (sub.isNotEmpty()) addText(sub)
          if (i == at) setImage(CarIcons.res(carContext, R.drawable.wmap_car_navigation, CarIcons.BLUE))
          else addAction(iconAction(carContext, R.drawable.wmap_car_check) { select(routes, i); invalidate() })
        }.build())
      }
      pane.addAction(go.setBackgroundColor(CarColor.BLUE).setFlags(Action.FLAG_PRIMARY).setOnClickListener { start() }.build())
      // Filter: Autobahnen, Maut, Fähren vermeiden – dieselben Einstellungen wie in der App
      pane.addAction(
        Action.Builder().setTitle("Filter").setIcon(CarIcons.res(carContext, R.drawable.wmap_car_tune))
          .setOnClickListener { screenManager.push(RoutePrefsScreen(carContext, s)) }.build(),
      )
    }
    val content = PaneTemplate.Builder(pane.build()).setHeader(header(this, title)).build()
    return MapWithContentTemplate.Builder()
      .setContentTemplate(content)
      .setMapController(MapController.Builder().setMapActionStrip(mapStrip(carContext, s)).setPanModeListener { }.build())
      .build()
  }

  /** Ältere Autos (vor Car API 7): Googles Vorlage für die Routenwahl */
  private fun classic(title: String, r: JSONObject?, routes: List<JSONObject>): Template {
    val b = RoutePreviewNavigationTemplate.Builder().setHeader(header(this, title, close = false))
    if (r == null) b.setLoading(true)
    else {
      val il = ItemList.Builder()
      routes.forEach { o ->
        // Dauer als Zeitangabe des Autos (Pflicht in dieser Vorlage), Länge dahinter
        val t = SpannableString("  · ${o.optString("title").substringAfter(" · ", "")}")
        t.setSpan(DurationSpan.create(o.optDouble("time", 0.0).toLong()), 0, 1, Spanned.SPAN_INCLUSIVE_INCLUSIVE)
        il.addItem(Row.Builder().setTitle(t).apply { o.optString("sub").takeIf { it.isNotEmpty() }?.let { addText(it) } }.build())
      }
      il.setSelectedIndex(selected.coerceIn(0, maxOf(0, routes.size - 1)))
      il.setOnSelectedListener { i -> select(routes, i) }
      b.setItemList(il.build())
      b.setNavigateAction(go.setOnClickListener { start() }.build())
    }
    if (carContext.api(CarAppApiLevels.LEVEL_2)) {
      b.setMapActionStrip(mapStrip(carContext, s))
      b.setPanModeListener { }
    }
    return b.build()
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Filter der Routenplanung
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Was die Route meiden soll – dieselben Einstellungen wie hinter dem
 * Filter-Knopf der App (wmap.routePrefs, js/ui/route-prefs.js). Zurück in der
 * Routenwahl wird neu gerechnet (WMapSession.prefsChanged).
 */
class RoutePrefsScreen(ctx: CarContext, private val s: WMapSession) : Screen(ctx) {
  private var avoid: JSONObject? = null

  init {
    lifecycle.addObserver(object : DefaultLifecycleObserver {
      override fun onCreate(owner: LifecycleOwner) {
        s.web.call("routePrefs") { v, _ -> avoid = v as? JSONObject ?: JSONObject(); invalidate() }
      }
    })
  }

  override fun onGetTemplate(): Template {
    val list = ListTemplate.Builder().setHeader(header(this, "Filter", close = false))
    val a = avoid
    if (a == null) list.setLoading(true)
    else {
      val items = ItemList.Builder()
      listOf("highways" to "Autobahnen vermeiden", "tolls" to "Mautstraßen vermeiden", "ferries" to "Fähren vermeiden").forEach { (key, label) ->
        items.addItem(
          Row.Builder().setTitle(label).setToggle(
            Toggle.Builder { on ->
              a.put(key, on)
              s.prefsChanged = true
              s.web.call("setRoutePref", key, on)
            }.setChecked(a.optBoolean(key)).build(),
          ).build(),
        )
      }
      list.setSingleList(items.build())
    }
    return MapWithContentTemplate.Builder()
      .setContentTemplate(list.build())
      .setMapController(MapController.Builder().setMapActionStrip(mapStrip(carContext, s)).setPanModeListener { }.build())
      .build()
  }
}
