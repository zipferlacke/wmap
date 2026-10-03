// WMap: Aufzeichnen bei ausgeschaltetem Bildschirm (nicht Teil des Tauri-Plugins, siehe WMAP.md)

package app.tauri.geolocation

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Location
import android.os.Build
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import app.tauri.Logger
import app.tauri.plugin.JSArray
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority

/**
 * Vordergrund-Dienst mit Benachrichtigung: Solange aufgezeichnet wird, hält er die App am Leben und holt den
 * Standort selbst. Gesammelt wird nur, während die App nicht zu sehen ist (`hidden`) – sonst nimmt die Seite
 * die Punkte wie immer über `watchPosition`. Kommt die App zurück, holt die Seite das Gesammelte ab (`take`).
 *
 * Die Benachrichtigung zeigt Zeit (läuft von selbst) und Strecke; aufgeklappt hat sie „Pause“/„Weiter“ und
 * „Beenden“. Den Stand (Start, Pausen, Strecke) gibt die Seite vor, solange sie zu sehen ist (`State`);
 * ist sie es nicht, zählt der Dienst die Strecke mit denselben Regeln weiter (data/tracks.js: genauer als
 * 35 m, mindestens 4 m weiter). „Pause“ wirkt hier sofort, die Seite übernimmt es beim nächsten Abgleich.
 * „Beenden“ holt die App nach vorn – gespeichert wird dort (Name, Verwerfen).
 */
class RecordService : Service() {
    private var client: FusedLocationProviderClient? = null
    private var callback: LocationCallback? = null
    private var wake: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_PAUSE -> pause(true)
            ACTION_RESUME -> pause(false)
        }
        val note = notification(this)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTE_ID, note, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
            } else {
                startForeground(NOTE_ID, note)
            }
        } catch (e: Exception) {
            // z. B. Standort-Freigabe inzwischen entzogen – dann bleibt es beim Aufzeichnen mit Bildschirm an
            Logger.error("RecordService: " + e.message)
            running = false
            stopSelf()
            return START_NOT_STICKY
        }
        running = true
        listen()
        return START_STICKY
    }

    @SuppressLint("MissingPermission", "WakelockTimeout")
    private fun listen() {
        if (callback != null) return
        // Der Standort weckt das Gerät ohnehin – die Sperre hält es nur zwischen zwei Meldungen wach
        wake = (getSystemService(Context.POWER_SERVICE) as PowerManager)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "wmap:aufzeichnung").apply { acquire() }
        val request = LocationRequest.Builder(INTERVAL_MS)
            .setMinUpdateIntervalMillis(INTERVAL_MS)
            .setMaxUpdateDelayMillis(INTERVAL_MS)
            .setPriority(Priority.PRIORITY_HIGH_ACCURACY)
            .build()
        callback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                if (!hidden || paused) return
                val before = text()
                synchronized(points) {
                    for (l in result.locations) {
                        if (points.size >= MAX_POINTS) break
                        points.add(doubleArrayOf(l.longitude, l.latitude, l.accuracy.toDouble(), l.time.toDouble()))
                        if (l.accuracy > MAX_ACCURACY_M) continue
                        val from = last
                        if (from == null) { last = doubleArrayOf(l.longitude, l.latitude); continue }
                        val out = FloatArray(1)
                        Location.distanceBetween(from[1], from[0], l.latitude, l.longitude, out)
                        if (out[0] < MIN_STEP_M) continue
                        distance += out[0]
                        last = doubleArrayOf(l.longitude, l.latitude)
                    }
                }
                if (text() != before) refresh(this@RecordService)
            }
        }
        try {
            client = LocationServices.getFusedLocationProviderClient(this)
            client?.requestLocationUpdates(request, callback!!, Looper.getMainLooper())
        } catch (e: Exception) {
            Logger.error("RecordService: " + e.message)
        }
    }

    override fun onDestroy() {
        callback?.let { client?.removeLocationUpdates(it) }
        callback = null
        wake?.let { if (it.isHeld) it.release() }
        wake = null
        running = false
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL = "wmap-aufzeichnung"
        private const val NOTE_ID = 4711
        private const val INTERVAL_MS = 2000L
        // gut 16 Stunden bei einer Meldung alle zwei Sekunden
        private const val MAX_POINTS = 30000
        private const val MAX_ACCURACY_M = 35f
        private const val MIN_STEP_M = 4f
        private const val ACTION_PAUSE = "de.wuefl.wmap.record.PAUSE"
        private const val ACTION_RESUME = "de.wuefl.wmap.record.RESUME"
        /** Am Start-Intent der App: „Beenden“ in der Benachrichtigung wurde angetippt */
        const val EXTRA_STOP = "wmap.record.stop"

        // Stand der Aufzeichnung – von der Seite vorgegeben (State), hier weitergeführt
        @Volatile var started = 0L
        @Volatile var paused = false
        @Volatile var pausedAt = 0L
        @Volatile var pausedMs = 0L
        @Volatile var distance = 0.0
        @Volatile var last: DoubleArray? = null
        /** „Beenden“ angetippt – die Seite fragt nach Namen bzw. Verwerfen */
        @Volatile var stopRequested = false

        fun pause(on: Boolean) {
            if (on == paused) return
            val now = System.currentTimeMillis()
            if (on) pausedAt = now else if (pausedAt > 0) pausedMs += now - pausedAt
            paused = on
        }

        private fun elapsed(): Long =
            if (started == 0L) 0 else (if (paused) pausedAt else System.currentTimeMillis()) - started - pausedMs

        private fun text(): String {
            val km = if (distance < 1000) String.format(java.util.Locale.GERMANY, "%.0f m", distance)
                else String.format(java.util.Locale.GERMANY, "%.2f km", distance / 1000)
            if (!paused) return km
            val s = elapsed() / 1000
            val time = if (s >= 3600) String.format("%d:%02d:%02d", s / 3600, s % 3600 / 60, s % 60) else String.format("%d:%02d", s / 60, s % 60)
            return "$time · $km"
        }

        fun refresh(context: Context) {
            if (!running) return
            (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(NOTE_ID, notification(context))
        }

        private fun notification(context: Context): Notification {
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL) == null) {
                manager.createNotificationChannel(NotificationChannel(CHANNEL, "Aufzeichnung", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Läuft, solange WMap eine Tour aufzeichnet"
                    setShowBadge(false)
                })
            }
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            val launch = { stop: Boolean ->
                context.packageManager.getLaunchIntentForPackage(context.packageName)?.let {
                    if (stop) it.putExtra(EXTRA_STOP, true)
                    PendingIntent.getActivity(context, if (stop) 2 else 0, it, flags)
                }
            }
            val toggle = PendingIntent.getService(context, 1,
                Intent(context, RecordService::class.java).setAction(if (paused) ACTION_RESUME else ACTION_PAUSE), flags)
            val b = NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(context.applicationInfo.icon)
                .setContentTitle(if (paused) "Aufzeichnung pausiert" else "WMap zeichnet auf")
                .setContentText(text())
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
                .setContentIntent(launch(false))
                // Die Knöpfe stehen nur in der aufgeklappten Benachrichtigung
                .addAction(0, if (paused) "Weiter" else "Pause", toggle)
                .addAction(0, "Beenden", launch(true))
            // Die Zeit läuft in der Kopfzeile von selbst mit – ohne dass die Benachrichtigung neu gesetzt wird
            if (!paused && started > 0) b.setUsesChronometer(true).setShowWhen(true).setWhen(System.currentTimeMillis() - elapsed())
            else b.setShowWhen(false)
            return b.build()
        }

        private val points = ArrayList<DoubleArray>()

        /** Die App ist nicht zu sehen (Bildschirm aus, andere App) – nur dann wird gesammelt */
        @Volatile var hidden = false
        @Volatile var running = false

        fun start(context: Context) {
            ContextCompat.startForegroundService(context, Intent(context, RecordService::class.java))
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, RecordService::class.java))
            synchronized(points) { points.clear() }
            started = 0; paused = false; pausedAt = 0; pausedMs = 0; distance = 0.0; last = null; stopRequested = false
        }

        /** Das Gesammelte abholen und leeren: [[lon, lat, Genauigkeit in m, Zeit in ms], …] */
        fun take(): JSArray {
            val out = JSArray()
            synchronized(points) {
                for (p in points) out.put(JSArray().apply { put(p[0]); put(p[1]); put(p[2]); put(p[3].toLong()) })
                points.clear()
            }
            return out
        }
    }
}
