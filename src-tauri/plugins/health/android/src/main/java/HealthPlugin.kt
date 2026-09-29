package de.wuefl.wmap.health

import android.app.Activity
import androidx.activity.result.ActivityResult
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.contracts.ExerciseRouteRequestContract
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ExerciseRoute
import androidx.health.connect.client.records.ExerciseRouteResult
import androidx.health.connect.client.records.ExerciseSessionRecord
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

@InvokeArg
class SessionsArgs {
    var days: Int = 3650
}

@InvokeArg
class RouteArgs {
    var id: String = ""
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
