package de.wuefl.wmap.car

// Von tools/android-einbinden.py nach src-tauri/gen/android kopiert – hier ändern, nicht dort.

import android.Manifest
import android.annotation.SuppressLint
import android.app.Presentation
import android.content.pm.PackageManager
import android.graphics.Rect
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.location.Location
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.car.app.CarContext
import androidx.car.app.SurfaceCallback
import androidx.car.app.SurfaceContainer
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import de.wuefl.wmap.BuildConfig
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.util.Locale

/**
 * Die Karte im Auto: die Webversion (index.html?car, js/car/car.js) in einem
 * eigenen WebView, das auf die Kartenfläche des Autos zeichnet – über ein
 * virtuelles Display, das die Fläche des Autos als Ziel hat, und eine
 * Presentation darauf. Gesten des Autos (Verschieben, Zoomen, Tippen) gehen
 * an die Seite, Anfragen der Vorlagen als wmapCar.call(…), Antworten und
 * Ereignisse kommen über window.WMapCar.post(typ, json) zurück.
 *
 * Adresse: die Webversion (app.wuefl.de). Die Debug-Fassung nimmt den Rechner
 * (`adb reverse tcp:8080 tcp:8080`), sonst ebenfalls die Webversion.
 *
 * Speicher: Läuft die App unter derselben Adresse (fertige App: beide von
 * app.wuefl.de), teilen die WebViews den Browser-Speicher – dieselben Touren
 * und Lesezeichen. Sonst nicht (Debug-Fassung unter tauri.localhost, App ohne
 * Netz in ihrer eingepackten Kopie): Dann kommen geplante Touren, Lesezeichen
 * und Ziele über SharedPreferences „wmap_shared“ (WMapAndroid.shareGet/
 * shareSet hier und in der MainActivity, js/data/car-share.js).
 *
 * Standort: vom Standortdienst des Handys (Fused Location, wie die App über
 * das Standort-Plugin) jede Sekunde an window.__carFix (index.html) – der
 * Standort des WebViews selbst mischt GPS und WLAN und springt im Stand.
 *
 * Ansagen: Das WebView kennt keine Web-Sprachausgabe – wie in der
 * MainActivity spricht Android selbst (window.WMapAndroid.speak), als
 * Navigationsansage auf den Lautsprechern des Autos.
 */
class CarWeb(private val ctx: CarContext, private val onEvent: (String, Any?) -> Unit) : SurfaceCallback {
  private val main = Handler(Looper.getMainLooper())
  private var display: VirtualDisplay? = null
  private var presentation: Presentation? = null
  private var web: WebView? = null
  private var width = 0
  private var height = 0
  private var density = 1f
  private var visible: Rect? = null
  private var ready = false
  private val queue = ArrayList<String>()
  private val pending = HashMap<Int, (Any?, String?) -> Unit>()
  private var nextId = 0

  private var tts: TextToSpeech? = null
  @Volatile private var ttsReady = false
  private val speechAttrs = AudioAttributes.Builder()
    .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
    .build()
  private val focus by lazy {
    AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK).setAudioAttributes(speechAttrs).build()
  }
  private val audio by lazy { ctx.getSystemService(AudioManager::class.java) }

  private var fused: FusedLocationProviderClient? = null
  private val onLocation = object : LocationCallback() {
    override fun onLocationResult(result: LocationResult) { result.lastLocation?.let { push(it) } }
  }

  /** Standort abfragen – sobald die Freigabe da ist (sonst nach ihr erneut) */
  fun startLocation() {
    if (fused != null || !located()) return
    val f = LocationServices.getFusedLocationProviderClient(ctx)
    val req = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 1000).setMinUpdateIntervalMillis(500).build()
    try {
      f.requestLocationUpdates(req, onLocation, Looper.getMainLooper())
      fused = f
    } catch (e: SecurityException) {
      Log.w(TAG, "Standort nicht erlaubt", e)
    }
  }

  private fun push(l: Location) {
    val c = JSONObject()
      .put("latitude", l.latitude).put("longitude", l.longitude)
      .put("accuracy", if (l.hasAccuracy()) l.accuracy.toDouble() else 50.0)
      .put("speed", if (l.hasSpeed()) l.speed.toDouble() else JSONObject.NULL)
      .put("heading", if (l.hasBearing()) l.bearing.toDouble() else JSONObject.NULL)
      .put("altitude", if (l.hasAltitude()) l.altitude else JSONObject.NULL)
    val pos = JSONObject().put("coords", c).put("timestamp", l.time)
    web?.evaluateJavascript("window.__carFix&&__carFix($pos)", null)
  }

  /** Die Seite ist geladen und nimmt Anfragen an */
  val isReady get() = ready

  /**
   * Anfrage an die Seite (js/car/car.js). Argumente: Zahlen, Text, Wahrheitswerte,
   * Map/List (werden JSON). `done(wert, fehler)` kommt auf dem Haupt-Thread.
   */
  fun call(method: String, vararg args: Any?, done: ((Any?, String?) -> Unit)? = null) {
    val id = ++nextId
    if (done != null) pending[id] = done
    val a = JSONArray()
    args.forEach { a.put(JSONObject.wrap(it) ?: JSONObject.NULL) }
    val js = "window.wmapCar&&wmapCar.call($id,${JSONObject.quote(method)},$a)"
    if (ready) web?.evaluateJavascript(js, null) else queue.add(js)
  }

  /* ── Fläche des Autos ─────────────────────────────────────────────────── */

  override fun onSurfaceAvailable(container: SurfaceContainer) {
    val surface = container.surface ?: return
    width = container.width
    height = container.height
    density = container.dpi / 160f
    val d = display
    if (d == null) {
      val dm = ctx.getSystemService(DisplayManager::class.java)
      display = dm.createVirtualDisplay(
        "WMap im Auto", width, height, container.dpi, surface,
        DisplayManager.VIRTUAL_DISPLAY_FLAG_OWN_CONTENT_ONLY,
      )
      show()
    } else {
      d.resize(width, height, container.dpi)
      d.surface = surface
    }
    web?.onResume()
    web?.resumeTimers()
    sendInsets()
  }

  /*
   * Die Fläche geht auch weg, wenn das Auto eine Vorlage ohne Karte zeigt
   * (Suche, Listen). Die Seite muss dann weiter antworten – Suchen, „Meine
   * Touren“, Ziele kommen von ihr. Darum hier NICHT web.onPause(): Das hielt
   * Timer und Netz der Seite an (gemessen: setTimeout und fetch kamen nicht
   * mehr zurück), „Meine Touren“ blieb leer und die Suche ohne Treffer.
   * Gezeichnet wird ohne Fläche ohnehin nicht.
   */
  override fun onSurfaceDestroyed(container: SurfaceContainer) {
    display?.surface = null
  }

  /** Was die Vorlagen frei lassen – dorthin passt die Seite Route und Standort ein */
  override fun onVisibleAreaChanged(visibleArea: Rect) {
    visible = Rect(visibleArea)
    sendInsets()
  }

  private fun sendInsets() {
    val r = visible ?: return
    if (width == 0 || r.isEmpty) return
    call("insets", mapOf(
      "top" to r.top / density, "left" to r.left / density,
      "right" to (width - r.right) / density, "bottom" to (height - r.bottom) / density,
    ))
  }

  override fun onScroll(distanceX: Float, distanceY: Float) {
    call("pan", distanceX / density, distanceY / density)
  }

  override fun onFling(velocityX: Float, velocityY: Float) {
    call("fling", -velocityX / density, -velocityY / density)
  }

  override fun onScale(focusX: Float, focusY: Float, scaleFactor: Float) {
    if (focusX < 0 || focusY < 0) call("zoom", scaleFactor)
    else call("zoom", scaleFactor, focusX / density, focusY / density)
  }

  override fun onClick(x: Float, y: Float) {
    call("click", x / density, y / density) { v, _ -> if (v is JSONObject) onEvent("place", v) }
  }

  /* ── Seite ─────────────────────────────────────────────────────────────── */

  private fun located() = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) ==
    PackageManager.PERMISSION_GRANTED

  @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
  private fun show() {
    val d = display ?: return
    val p = Presentation(ctx, d.display)
    val w = WebView(p.context)
    w.settings.apply {
      javaScriptEnabled = true
      domStorageEnabled = true
      @Suppress("DEPRECATION")
      databaseEnabled = true
      setGeolocationEnabled(true)
      mediaPlaybackRequiresUserGesture = false
      userAgentString = "$userAgentString WMapCar/${BuildConfig.VERSION_NAME}"
    }
    // Auch ohne sichtbare Fläche (Suche, Listen im Auto) wichtig bleiben – sonst
    // stuft Android den Prozess der Seite herab und sie antwortet nicht mehr
    w.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)
    w.addJavascriptInterface(Bridge(), "WMapCar")
    w.addJavascriptInterface(Speech(), "WMapAndroid")
    w.webChromeClient = object : WebChromeClient() {
      override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
        callback.invoke(origin, located(), false)
      }

      override fun onConsoleMessage(m: ConsoleMessage): Boolean {
        Log.i(TAG, "${m.message()} (${m.sourceId()}:${m.lineNumber()})")
        return true
      }
    }
    w.webViewClient = object : WebViewClient() {
      override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
        // Rechner nicht erreichbar (Debug ohne adb reverse): dann die Webversion
        if (request.isForMainFrame && view.url?.startsWith(REMOTE) != true) {
          Log.i(TAG, "${request.url} ging nicht (${error.description}) – nehme $REMOTE")
          ready = false
          view.loadUrl(REMOTE)
        }
      }
    }
    if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)
    p.setContentView(w)
    p.show()
    presentation = p
    web = w
    startSpeech()
    startLocation()
    w.loadUrl(if (BuildConfig.DEBUG) LOCAL else REMOTE)
  }

  fun destroy() {
    fused?.removeLocationUpdates(onLocation)
    fused = null
    pending.clear()
    web?.destroy()
    web = null
    presentation?.dismiss()
    presentation = null
    display?.release()
    display = null
    tts?.shutdown()
    tts = null
  }

  private fun receive(type: String, json: String) {
    val data = try { JSONTokener(json).nextValue() } catch (_: Exception) { null }
    when (type) {
      "ready" -> {
        ready = true
        queue.forEach { web?.evaluateJavascript(it, null) }
        queue.clear()
        sendInsets()
        onEvent(type, data)
      }
      "reply" -> {
        val o = data as? JSONObject ?: return
        val done = pending.remove(o.optInt("id")) ?: return
        if (o.optBoolean("ok")) done(o.opt("value").takeUnless { it == JSONObject.NULL }, null)
        else done(null, o.optString("error"))
      }
      else -> onEvent(type, data.takeUnless { it == JSONObject.NULL })
    }
  }

  inner class Bridge {
    @JavascriptInterface fun post(type: String, json: String) {
      main.post { receive(type, json) }
    }
  }

  /* ── Ansagen ───────────────────────────────────────────────────────────── */

  private fun startSpeech() {
    tts = TextToSpeech(ctx) { status ->
      val t = tts ?: return@TextToSpeech
      if (status != TextToSpeech.SUCCESS) return@TextToSpeech
      t.language = Locale.GERMANY
      t.setAudioAttributes(speechAttrs)
      t.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
        override fun onStart(id: String?) { audio.requestAudioFocus(focus) }
        override fun onDone(id: String?) { if (!t.isSpeaking) audio.abandonAudioFocusRequest(focus) }
        @Deprecated("Deprecated in Java")
        override fun onError(id: String?) { audio.abandonAudioFocusRequest(focus) }
      })
      ttsReady = true
    }
  }

  // Gemeinsamer Speicher mit der App (MainActivity.kt) – js/data/car-share.js
  private val shared by lazy { ctx.getSharedPreferences("wmap_shared", android.content.Context.MODE_PRIVATE) }

  inner class Speech {
    /** Geteilt mit der App: Touren, Lesezeichen, Ziele (JSON-Text; leer, wenn es nichts gibt) */
    @JavascriptInterface fun shareGet(key: String): String = shared.getString(key, "") ?: ""

    @JavascriptInterface fun shareSet(key: String, value: String) {
      shared.edit().putString(key, value).apply()
    }

    @JavascriptInterface fun speak(text: String): Boolean {
      val t = tts ?: return false
      if (!ttsReady) return false
      t.speak(text, TextToSpeech.QUEUE_FLUSH, null, "wmap-car")
      return true
    }

    @JavascriptInterface fun stopSpeaking() {
      tts?.stop()
      audio.abandonAudioFocusRequest(focus)
    }
  }

  companion object {
    const val TAG = "WMapCar"
    const val REMOTE = "https://app.wuefl.de/wmap/index.html?car"
    const val LOCAL = "http://localhost:8080/web/wuefl_products/wmap/index.html?car"
  }
}
