package de.wuefl.wmap.health

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.activity.result.ActivityResult
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.contracts.ExerciseRouteRequestContract
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ExerciseRoute
import androidx.health.connect.client.records.ExerciseRouteResult
import androidx.health.connect.client.records.CyclingPedalingCadenceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.PowerRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.StepsCadenceRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.time.Instant
import java.time.temporal.ChronoUnit
import kotlin.reflect.KClass

@InvokeArg
class SessionsArgs {
    var days: Int = 3650
}

@InvokeArg
class RouteArgs {
    var id: String = ""
}

@InvokeArg
class SamplesArgs {
    var start: Long = 0
    var end: Long = 0
}

@InvokeArg
class SettingsArgs {
    var target: String = "health"
}

/**
 * Health Connect lesen – für js/services/health.js:
 *
 *   status              { available, sdkStatus, granted: [...] }
 *   request_access      Freigabe-Dialog von Health Connect → { granted }
 *   sessions { days }   Trainings: id, Titel, Art, Start/Ende, App, Route
 *                       ("data" mit Punktzahl, "consent" oder "none")
 *   route { id }        Punkte [lon, lat, höhe|null, zeit] – fragt bei
 *                       fremden Routen einzeln nach, wenn es keine
 *                       Dauerfreigabe gibt
 *   samples { start, end }
 *                       Messwerte in der Zeit (ms): hr, steps
 *                       (Schritte/min), pedal (U/min), power (W) – je Liste
 *                       [zeit, wert]; ohne Freigabe für eine Art bleibt sie leer
 *   open_settings { target }
 *                       "health": Health Connect (die Seite einer App direkt
 *                       – MANAGE_HEALTH_PERMISSIONS – dürfen nur System-Apps
 *                       öffnen; dort WMap antippen);
 *                       "app": App-Info von WMap (Standort …);
 *                       "location": Standort des Geräts an/aus
 */
@TauriPlugin
class HealthPlugin(private val activity: Activity) : Plugin(activity) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val permissionContract = PermissionController.createRequestPermissionResultContract()
    private val routeContract = ExerciseRouteRequestContract()

    private val wanted = setOf(
        HealthPermission.getReadPermission(ExerciseSessionRecord::class),
        // Routen anderer Apps ohne Nachfrage je Training (ab Android 15)
        "android.permission.health.READ_EXERCISE_ROUTES",
        // Auch Daten von vor der Freigabe (sonst nur die letzten 30 Tage)
        HealthPermission.PERMISSION_READ_HEALTH_DATA_HISTORY,
        // Messwerte zum Training: Diagramme und Runden
        HealthPermission.getReadPermission(HeartRateRecord::class),
        HealthPermission.getReadPermission(StepsCadenceRecord::class),
        HealthPermission.getReadPermission(CyclingPedalingCadenceRecord::class),
        HealthPermission.getReadPermission(PowerRecord::class),
    )

    private fun client(invoke: Invoke): HealthConnectClient? {
        val status = HealthConnectClient.getSdkStatus(activity)
        if (status == HealthConnectClient.SDK_AVAILABLE) return HealthConnectClient.getOrCreate(activity)
        invoke.reject(
            if (status == HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) "Health Connect muss aktualisiert werden"
            else "Health Connect gibt es auf diesem Gerät nicht",
            "unavailable",
        )
        return null
    }

    @Command
    fun status(invoke: Invoke) {
        val status = HealthConnectClient.getSdkStatus(activity)
        val out = JSObject()
        out.put("available", status == HealthConnectClient.SDK_AVAILABLE)
        out.put("sdkStatus", status)
        if (status != HealthConnectClient.SDK_AVAILABLE) {
            invoke.resolve(out)
            return
        }
        scope.launch {
            try {
                val granted = HealthConnectClient.getOrCreate(activity).permissionController.getGrantedPermissions()
                out.put("granted", JSArray(granted.toList()))
                invoke.resolve(out)
            } catch (e: Exception) {
                invoke.reject(e.message ?: e.toString(), e)
            }
        }
    }

    @Command
    fun requestAccess(invoke: Invoke) {
        client(invoke) ?: return
        startActivityForResult(invoke, permissionContract.createIntent(activity, wanted), "permissionsResult")
    }

    @ActivityCallback
    fun permissionsResult(invoke: Invoke, result: ActivityResult) {
        val granted = permissionContract.parseResult(result.resultCode, result.data)
        invoke.resolve(JSObject().put("granted", JSArray(granted.toList())))
    }

    @Command
    fun sessions(invoke: Invoke) {
        val args = invoke.parseArgs(SessionsArgs::class.java)
        val c = client(invoke) ?: return
        scope.launch {
            try {
                val list = JSArray()
                val range = TimeRangeFilter.after(Instant.now().minus(args.days.toLong(), ChronoUnit.DAYS))
                var token: String? = null
                do {
                    val res = c.readRecords(ReadRecordsRequest(ExerciseSessionRecord::class, range, pageToken = token))
                    for (s in res.records) list.put(describe(s))
                    token = res.pageToken
                } while (token != null)
                invoke.resolve(JSObject().put("sessions", list))
            } catch (e: SecurityException) {
                invoke.reject("Keine Freigabe für Trainings in Health Connect", "permission")
            } catch (e: Exception) {
                invoke.reject(e.message ?: e.toString(), e)
            }
        }
    }

    private fun describe(s: ExerciseSessionRecord): JSObject {
        val o = JSObject()
        o.put("id", s.metadata.id)
        o.put("title", s.title ?: "")
        o.put("type", ExerciseSessionRecord.EXERCISE_TYPE_INT_TO_STRING_MAP[s.exerciseType] ?: s.exerciseType.toString())
        o.put("start", s.startTime.toEpochMilli())
        o.put("end", s.endTime.toEpochMilli())
        o.put("app", s.metadata.dataOrigin.packageName)
        when (val r = s.exerciseRouteResult) {
            is ExerciseRouteResult.Data -> {
                o.put("route", "data")
                o.put("points", r.exerciseRoute.route.size)
            }
            is ExerciseRouteResult.ConsentRequired -> o.put("route", "consent")
            else -> o.put("route", "none")
        }
        // Abschnitte und Runden: manche Apps legen hier Wiederholungen ab (Ruderschläge, Bahnen) –
        // [Start, Ende, Art, Wiederholungen] bzw. [Start, Ende, Meter]
        val segments = JSArray()
        for (g in s.segments) segments.put(JSArray().put(g.startTime.toEpochMilli()).put(g.endTime.toEpochMilli()).put(g.segmentType).put(g.repetitions))
        o.put("segments", segments)
        val laps = JSArray()
        for (l in s.laps) laps.put(JSArray().put(l.startTime.toEpochMilli()).put(l.endTime.toEpochMilli()).put(l.length?.inMeters ?: 0.0))
        o.put("laps", laps)
        s.notes?.let { o.put("notes", it) }
        return o
    }

    @Command
    fun route(invoke: Invoke) {
        val args = invoke.parseArgs(RouteArgs::class.java)
        val c = client(invoke) ?: return
        scope.launch {
            try {
                val s = c.readRecord(ExerciseSessionRecord::class, args.id).record
                when (val r = s.exerciseRouteResult) {
                    is ExerciseRouteResult.Data -> invoke.resolve(JSObject().put("points", points(r.exerciseRoute)))
                    // Fremde Route ohne Dauerfreigabe: Health Connect fragt für dieses Training
                    is ExerciseRouteResult.ConsentRequired ->
                        startActivityForResult(invoke, routeContract.createIntent(activity, args.id), "routeResult")
                    else -> invoke.resolve(JSObject().put("points", JSArray()))
                }
            } catch (e: SecurityException) {
                invoke.reject("Keine Freigabe für Trainings in Health Connect", "permission")
            } catch (e: Exception) {
                invoke.reject(e.message ?: e.toString(), e)
            }
        }
    }

    @ActivityCallback
    fun routeResult(invoke: Invoke, result: ActivityResult) {
        val route = routeContract.parseResult(result.resultCode, result.data)
        if (route == null) invoke.reject("Route nicht freigegeben", "denied")
        else invoke.resolve(JSObject().put("points", points(route)))
    }

    @Command
    fun samples(invoke: Invoke) {
        val args = invoke.parseArgs(SamplesArgs::class.java)
        val c = client(invoke) ?: return
        val from = Instant.ofEpochMilli(args.start)
        val to = Instant.ofEpochMilli(args.end)
        scope.launch {
            try {
                val range = TimeRangeFilter.between(from, to)
                val out = JSObject()
                out.put("hr", series(c, HeartRateRecord::class, range, from, to) { r -> r.samples.map { it.time to it.beatsPerMinute.toDouble() } })
                out.put("steps", series(c, StepsCadenceRecord::class, range, from, to) { r -> r.samples.map { it.time to it.rate } })
                out.put("pedal", series(c, CyclingPedalingCadenceRecord::class, range, from, to) { r -> r.samples.map { it.time to it.revolutionsPerMinute } })
                out.put("power", series(c, PowerRecord::class, range, from, to) { r -> r.samples.map { it.time to it.power.inWatts } })
                invoke.resolve(out)
            } catch (e: Exception) {
                invoke.reject(e.message ?: e.toString(), e)
            }
        }
    }

    /** Alle Messwerte einer Art in der Zeit – ohne Freigabe dafür leer */
    private suspend fun <T : Record> series(
        c: HealthConnectClient, type: KClass<T>, range: TimeRangeFilter, from: Instant, to: Instant,
        pick: (T) -> List<Pair<Instant, Double>>,
    ): JSArray {
        val all = JSArray()
        try {
            var token: String? = null
            do {
                val res = c.readRecords(ReadRecordsRequest(type, range, pageToken = token))
                for (r in res.records) for ((t, v) in pick(r)) {
                    if (t.isBefore(from) || t.isAfter(to)) continue
                    all.put(JSArray().put(t.toEpochMilli()).put(v))
                }
                token = res.pageToken
            } while (token != null)
        } catch (e: SecurityException) { /* nicht freigegeben */ }
        return all
    }

    @Command
    fun openSettings(invoke: Invoke) {
        val args = invoke.parseArgs(SettingsArgs::class.java)
        val pkg = activity.packageName
        val tries = when (args.target) {
            "app" -> listOf(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", pkg, null)))
            "location" -> listOf(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
            else -> listOf(
                Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS),
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", pkg, null)),
            )
        }
        for (intent in tries) {
            try {
                activity.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                invoke.resolve()
                return
            } catch (e: Exception) { /* nächste Möglichkeit */ }
        }
        invoke.reject("Einstellungen lassen sich nicht öffnen")
    }

    private fun points(r: ExerciseRoute): JSArray {
        val all = JSArray()
        for (l in r.route) {
            val p = JSArray()
            p.put(l.longitude)
            p.put(l.latitude)
            p.put(l.altitude?.inMeters ?: JSONObject.NULL)
            p.put(l.time.toEpochMilli())
            all.put(p)
        }
        return all
    }
}
