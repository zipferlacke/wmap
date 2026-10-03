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
 */
class RecordService : Service() {
    private var client: FusedLocationProviderClient? = null
    private var callback: LocationCallback? = null
    private var wake: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val note = notification()
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
                if (!hidden) return
                synchronized(points) {
                    for (l in result.locations) {
                        if (points.size >= MAX_POINTS) break
                        points.add(doubleArrayOf(l.longitude, l.latitude, l.accuracy.toDouble(), l.time.toDouble()))
                    }
                }
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

    private fun notification(): Notification {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL) == null) {
            manager.createNotificationChannel(NotificationChannel(CHANNEL, "Aufzeichnung", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Läuft, solange WMap eine Tour aufzeichnet"
                setShowBadge(false)
            })
        }
        val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
            PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(applicationInfo.icon)
            .setContentTitle("WMap zeichnet auf")
            .setContentText("Die Tour läuft weiter, auch wenn der Bildschirm aus ist.")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setContentIntent(open)
            .build()
    }

    companion object {
        private const val CHANNEL = "wmap-aufzeichnung"
        private const val NOTE_ID = 4711
        private const val INTERVAL_MS = 2000L
        // gut 16 Stunden bei einer Meldung alle zwei Sekunden
        private const val MAX_POINTS = 30000

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
