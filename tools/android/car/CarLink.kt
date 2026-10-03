package de.wuefl.wmap.car

// Von tools/android-einbinden.py nach src-tauri/gen/android kopiert – hier ändern, nicht dort.

import android.os.Handler
import android.os.Looper

/**
 * „Ans Auto senden“: Die App am Handy (MainActivity, WMapAndroid.carSend) übergibt einen Ort, eine Route oder
 * eine geplante Tour an WMap im Auto – beide laufen in derselben App. Läuft WMap im Auto schon, öffnet sich dort
 * gleich die Routenübersicht; sonst wartet das Gesendete, bis WMap im Auto geöffnet wird (höchstens 15 Minuten).
 */
object CarLink {
  private const val KEEP_MS = 15 * 60 * 1000L
  private val main = Handler(Looper.getMainLooper())
  private var pending: String? = null
  private var pendingAt = 0L

  @Volatile var session: WMapSession? = null

  /** → true, wenn WMap im Auto läuft und es gleich übernimmt */
  fun send(json: String): Boolean {
    synchronized(this) { pending = json; pendingAt = System.currentTimeMillis() }
    val s = session ?: return false
    main.post { s.takeShared() }
    return true
  }

  fun take(): String? = synchronized(this) {
    val p = pending
    pending = null
    if (p != null && System.currentTimeMillis() - pendingAt < KEEP_MS) p else null
  }
}
