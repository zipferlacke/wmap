package de.wuefl.wmap.car

// Von tools/android-einbinden.py nach src-tauri/gen/android kopiert – hier ändern, nicht dort.

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.provider.MediaStore
import android.util.Log
import de.wuefl.wmap.BuildConfig
import java.io.BufferedWriter
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/**
 * Fahrt-Protokoll für Android Auto – für die Suche nach Hängern und Verzögerungen auf dem Autobildschirm.
 * Eingeschaltet in den Einstellungen der App („Android Auto: Fahrt protokollieren“ → SharedPreferences
 * „wmap_shared“, Schlüssel „carlog“ = "1"); gilt ab dem nächsten Start von WMap im Auto.
 *
 * Wohin: während der Fahrt nach Android/data/<Paket>/files/car-log/wmap-auto-<Datum>.log (jede Sekunde
 * gesichert). Am Ende der Fahrt – und beim nächsten Start für alles, was liegen blieb – wandert die Datei nach
 * Download/WMap/ (ab Android 10), dort findet sie die Dateien-App.
 *
 * Was (eine Zeile je Ereignis, vorn die Uhrzeit):
 *   start     Gerät, Android, App, Fläche des Autos
 *   fix       Standort vom Handy: Alter der Messung (ms), Abstand zur vorigen, Genauigkeit, Tempo
 *   js        je Sekunde von der Seite (js/car/carlog.js): Bilder, längste Pause, lange Aufgaben, Verzug des
 *             Standorts bis zur Seite, Rechenzeit je Standort, Zustand der Karte
 *   call      Anfrage an die Seite, die länger als 300 ms brauchte
 *   mainlag   der Haupt-Thread der App hing (über 150 ms)
 *   sys       alle 10 s: Wärme (Stufe, Akku-Temperatur), Bildschirm des Handys an?, Zähler (Hinweise,
 *             Neuzeichnen der Vorlagen)
 *   thermal   Wärmestufe geändert (0 keine … 3 stark gedrosselt)
 *   surface   Fläche des Autos kam, ging, änderte sich
 *   page      Warnungen und Fehler der Seite
 */
object CarLog {
  @Volatile var on = false
    private set
  private val exec = Executors.newSingleThreadExecutor()
  private val main = Handler(Looper.getMainLooper())
  private var out: BufferedWriter? = null
  private val stamp = SimpleDateFormat("HH:mm:ss.SSS", Locale.ROOT)
  private val counters = ConcurrentHashMap<String, AtomicInteger>()
  private var app: Context? = null
  private var thermal: PowerManager.OnThermalStatusChangedListener? = null

  private fun dir(ctx: Context) = File(ctx.getExternalFilesDir(null) ?: ctx.filesDir, "car-log")

  fun start(ctx: Context, info: String) {
    val c = ctx.applicationContext
    val want = c.getSharedPreferences("wmap_shared", Context.MODE_PRIVATE).getString("carlog", "") == "1"
    if (!want || on) return
    app = c
    on = true
    exec.execute {
      try {
        export(c)
        val d = dir(c).apply { mkdirs() }
        val name = "wmap-auto-" + SimpleDateFormat("yyyy-MM-dd_HH-mm-ss", Locale.ROOT).format(Date()) + ".log"
        out = File(d, name).bufferedWriter()
      } catch (e: Exception) {
        Log.w(TAG, "Protokoll geht nicht", e)
      }
    }
    line("start", "${Build.MANUFACTURER} ${Build.MODEL} · Android ${Build.VERSION.RELEASE} · WMap ${BuildConfig.VERSION_NAME}${if (BuildConfig.DEBUG) " debug" else ""} · $info")
    main.postDelayed(tick, TICK_MS)
    main.postDelayed(system, 1000)
    if (Build.VERSION.SDK_INT >= 29) {
      val l = PowerManager.OnThermalStatusChangedListener { s -> line("thermal", "Stufe $s") }
      c.getSystemService(PowerManager::class.java).addThermalStatusListener(l)
      thermal = l
    }
  }

  fun line(what: String, text: String) {
    if (!on) return
    val t = System.currentTimeMillis()
    exec.execute {
      try { out?.apply { write("${stamp.format(Date(t))} $what $text\n") } } catch (_: Exception) { }
    }
  }

  /** Zählen statt einzeln schreiben – steht in der nächsten „sys“-Zeile */
  fun count(what: String) {
    if (on) counters.getOrPut(what) { AtomicInteger() }.incrementAndGet()
  }

  fun stop() {
    if (!on) return
    line("ende", "")
    on = false
    main.removeCallbacks(tick)
    main.removeCallbacks(system)
    val c = app ?: return
    if (Build.VERSION.SDK_INT >= 29) thermal?.let { c.getSystemService(PowerManager::class.java).removeThermalStatusListener(it) }
    thermal = null
    exec.execute {
      try { out?.close() } catch (_: Exception) { }
      out = null
      export(c)
    }
  }

  // Hängt der Haupt-Thread? Er trägt das WebView der Karte, die Vorlagen und die Standortmeldungen
  private var due = 0L
  private val tick = object : Runnable {
    override fun run() {
      val now = SystemClock.uptimeMillis()
      if (due != 0L && now - due > 150) line("mainlag", "${now - due} ms")
      due = now + TICK_MS
      main.postDelayed(this, TICK_MS)
    }
  }

  private val system = object : Runnable {
    override fun run() {
      val c = app ?: return
      val pm = c.getSystemService(PowerManager::class.java)
      val bat = c.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
      val temp = (bat?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0) ?: 0) / 10.0
      val status = if (Build.VERSION.SDK_INT >= 29) pm.currentThermalStatus else -1
      val head = if (Build.VERSION.SDK_INT >= 30) pm.getThermalHeadroom(10) else Float.NaN
      val rt = Runtime.getRuntime()
      val counts = counters.entries.sortedBy { it.key }.joinToString(" ") { "${it.key}=${it.value.getAndSet(0)}" }
      line("sys", "waerme=$status akku=${temp}C luft=${"%.2f".format(Locale.ROOT, head)} handybild=${if (pm.isInteractive) 1 else 0} sparen=${if (pm.isPowerSaveMode) 1 else 0} speicher=${(rt.totalMemory() - rt.freeMemory()) / 1048576}MB $counts")
      exec.execute { try { out?.flush() } catch (_: Exception) { } }
      main.postDelayed(this, 10000)
    }
  }

  /** Jede Sekunde sichern (die Seite meldet im selben Takt) */
  fun flush() {
    if (on) exec.execute { try { out?.flush() } catch (_: Exception) { } }
  }

  /** Fertige Protokolle nach Download/WMap/ – dort findet sie die Dateien-App */
  private fun export(ctx: Context) {
    if (Build.VERSION.SDK_INT < 29) return
    for (f in dir(ctx).listFiles { x -> x.name.endsWith(".log") } ?: return) {
      try {
        if (f.length() == 0L) { f.delete(); continue }
        val values = ContentValues().apply {
          put(MediaStore.Downloads.DISPLAY_NAME, f.name)
          put(MediaStore.Downloads.MIME_TYPE, "text/plain")
          put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/WMap")
        }
        val uri = ctx.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: continue
        ctx.contentResolver.openOutputStream(uri)?.use { o -> f.inputStream().use { it.copyTo(o) } }
        f.delete()
      } catch (e: Exception) {
        Log.w(TAG, "Protokoll ${f.name} bleibt in ${f.parent}", e)
      }
    }
  }

  private const val TAG = "WMapCar"
  private const val TICK_MS = 250L
}
