package de.wuefl.wmap.car

// Von tools/android-einbinden.py nach src-tauri/gen/android kopiert – hier ändern, nicht dort.

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ApplicationInfo
import android.content.res.Configuration
import android.net.Uri
import androidx.car.app.AppManager
import androidx.car.app.CarAppService
import androidx.car.app.CarContext
import androidx.car.app.CarToast
import androidx.car.app.Screen
import androidx.car.app.ScreenManager
import androidx.car.app.Session
import androidx.car.app.model.Action
import androidx.car.app.model.Alert
import androidx.car.app.model.AlertCallback
import androidx.car.app.model.CarText
import androidx.car.app.navigation.NavigationManager
import androidx.car.app.navigation.NavigationManagerCallback
import androidx.car.app.validation.HostValidator
import androidx.car.app.versioning.CarAppApiLevels
import androidx.core.content.ContextCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import de.wuefl.wmap.R
import org.json.JSONObject

/**
 * Android Auto: WMap auf dem Bildschirm des Autos.
 *
 * Das Auto zeigt Googles Vorlagen (CarScreens.kt): oben Suche, Route, Meine
 * Touren und In der Nähe; tippt man auf die Karte, kommt der Ort mit Route
 * und Merken; beim Navigieren die Anweisung mit Pfeil, Entfernung und
 * Ankunftszeit. Die Karte darunter ist die Webversion (CarWeb.kt) – mit
 * allem, was die App kann: Suche, Orte aus OpenStreetMap, Routen, Navigation
 * mit Ansagen, kurze Fragen zum Mitmachen (als Hinweis des Autos mit Ja/Nein).
 */
class WMapCarService : CarAppService() {
  override fun createHostValidator(): HostValidator =
    if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) HostValidator.ALLOW_ALL_HOSTS_VALIDATOR
    else HostValidator.Builder(applicationContext)
      .addAllowedHosts(androidx.car.app.R.array.hosts_allowlist_sample)
      .build()

  @Deprecated("Deprecated in Java")
  override fun onCreateSession(): Session = WMapSession()
}

/** Stand der Navigation, wie ihn die Seite meldet */
class NavState {
  var active = false
  var destination = ""
  var guide: JSONObject? = null
  var muted = false
}

class WMapSession : Session() {
  lateinit var web: CarWeb
    private set
  val nav = NavState()
  /** Symbol des Standort-Knopfs (js/car/drive.js recenterIcon) */
  var recenterIcon = "my_location"
  private var mapScreen: MapScreen? = null
  private var alertId = 0
  private val alerts = HashMap<Int, Int>()
  private var pendingIntent: Intent? = null
  /** Was die Startkarte öffnet, sobald sie wieder oben liegt (ein Bildschirm ersetzt einen anderen, CarScreens.kt) */
  var afterHome: (() -> Unit)? = null
  /** Filter der Route geändert (RoutePrefsScreen) – die Routenwahl rechnet beim Zurückkommen neu */
  var prefsChanged = false
  /** Listen, die auf Nachschub warten (Kategorie: erst Kacheln, dann Overpass) */
  val listListeners = ArrayList<(JSONObject) -> Unit>()

  private val screens get() = carContext.getCarService(ScreenManager::class.java)
  private val navigation get() = carContext.getCarService(NavigationManager::class.java)

  override fun onCreateScreen(intent: Intent): Screen {
    web = CarWeb(carContext, ::onEvent)
    carContext.getCarService(AppManager::class.java).setSurfaceCallback(web)
    navigation.setNavigationManagerCallback(object : NavigationManagerCallback {
      // Das Auto beendet die Navigation (z. B. eine andere App navigiert jetzt)
      override fun onStopNavigation() { web.call("stop") }
    })
    lifecycle.addObserver(object : DefaultLifecycleObserver {
      override fun onDestroy(owner: LifecycleOwner) {
        if (nav.active) navigation.navigationEnded()
        web.destroy()
      }
    })
    pendingIntent = intent
    // Ohne Standort-Freigabe (z. B. App noch nie am Handy geöffnet): am Handy fragen
    if (ContextCompat.checkSelfPermission(carContext, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
      carContext.requestPermissions(listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)) { granted, _ ->
        if (granted.isNotEmpty()) { web.startLocation(); web.call("locate") }
      }
    }
    return MapScreen(carContext, this).also { mapScreen = it }
  }

  override fun onNewIntent(intent: Intent) {
    pendingIntent = intent
    if (web.isReady) handleIntent()
  }

  override fun onCarConfigurationChanged(newConfiguration: Configuration) {
    web.call("dark", carContext.isDarkMode)
  }

  /** „Navigiere zu …“ (Sprachbefehl, andere App): geo:lat,lon oder geo:0,0?q=Adresse */
  private fun handleIntent() {
    val intent = pendingIntent ?: return
    pendingIntent = null
    if (intent.action != CarContext.ACTION_NAVIGATE) return
    val uri = intent.data ?: return
    val ssp = Uri.decode(uri.encodedSchemeSpecificPart ?: return)
    val q = ssp.substringAfter("q=", "").substringBefore('&').trim()
    val coords = Regex("""^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)""").find(ssp.substringBefore('?'))
    val lat = coords?.groupValues?.get(1)?.toDoubleOrNull()
    val lon = coords?.groupValues?.get(2)?.toDoubleOrNull()
    screens.popToRoot()
    when {
      lat != null && lon != null && (lat != 0.0 || lon != 0.0) ->
        screens.push(RoutePreviewScreen(carContext, this) { done -> web.call("routeToPoint", listOf(lon, lat), q.ifEmpty { "Ziel" }, done = done) })
      q.isNotEmpty() -> screens.push(SearchScreen(carContext, this, q))
    }
  }

  private fun onEvent(type: String, data: Any?) {
    val o = data as? JSONObject
    when (type) {
      "ready" -> {
        web.call("init", mapOf("dark" to carContext.isDarkMode)) { v, _ ->
          if ((v as? JSONObject)?.optBoolean("navigating") == true) setNav(true, "")
        }
        handleIntent()
      }
      "guidance" -> {
        nav.guide = o
        mapScreen?.invalidate()
      }
      "navStart" -> setNav(true, o?.optString("destination") ?: "")
      "navEnd" -> setNav(false, "")
      "recenter" -> {
        recenterIcon = o?.optString("icon") ?: "my_location"
        screens.top.invalidate()
      }
      "list" -> if (o != null) listListeners.toList().forEach { it(o) }
      "place" -> if (o != null) screens.push(PlaceScreen(carContext, this, o))
      "routeSelected" -> if (o != null) (screens.top as? RouteChoice)?.selectedOnMap(o.optInt("id"))
      "toast" -> o?.optString("text")?.takeIf { it.isNotEmpty() }?.let { CarToast.makeText(carContext, it, CarToast.LENGTH_SHORT).show() }
      "ask" -> if (o != null) ask(o)
      "askEnd" -> alerts.remove(o?.optInt("id"))?.let { dismissAlert(it) }
    }
  }

  private fun setNav(on: Boolean, destination: String) {
    if (on == nav.active) return
    nav.active = on
    nav.destination = destination
    nav.guide = null
    if (on) navigation.navigationStarted() else navigation.navigationEnded()
    mapScreen?.invalidate()
  }

  /** Kurze Frage (Pille, „Immer noch Stau?“) als Hinweis des Autos */
  private fun ask(o: JSONObject) {
    val id = o.optInt("id")
    if (carContext.carAppApiLevel < CarAppApiLevels.LEVEL_5) { web.call("answer", id, null); return }
    val alert = ++alertId
    alerts[id] = alert
    val options = o.optJSONArray("options")
    val b = Alert.Builder(alert, CarText.create(o.optString("title")), o.optLong("timeout", 12000))
    if (o.optString("sub").isNotEmpty()) b.setSubtitle(CarText.create(o.optString("sub")))
    o.optString("icon").takeIf { it.isNotEmpty() }?.let { b.setIcon(CarIcons.png(it)) }
    for (i in 0 until minOf(2, options?.length() ?: 0)) {
      val opt = options!!.getJSONObject(i)
      val a = Action.Builder().setOnClickListener {
        alerts.remove(id)
        dismissAlert(alert)
        web.call("answer", id, if (opt.isNull("value")) null else opt.optString("value"))
      }
      // Schließen als ✕ – wie an der Pille am Handy
      if (opt.optBoolean("close")) a.setIcon(CarIcons.res(carContext, R.drawable.wmap_car_close)) else a.setTitle(opt.optString("label"))
      b.addAction(a.build())
    }
    b.setCallback(object : AlertCallback {
      override fun onCancel(reason: Int) { if (alerts.remove(id) != null) web.call("answer", id, null) }
      override fun onDismiss() {}
    })
    carContext.getCarService(AppManager::class.java).showAlert(b.build())
  }

  private fun dismissAlert(alert: Int) {
    if (carContext.carAppApiLevel >= CarAppApiLevels.LEVEL_5) carContext.getCarService(AppManager::class.java).dismissAlert(alert)
  }
}
