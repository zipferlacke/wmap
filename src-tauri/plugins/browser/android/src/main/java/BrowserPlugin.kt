package de.wuefl.wmap.browser

import android.app.Activity
import android.app.PendingIntent
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.net.Uri
import android.util.Base64
import androidx.core.content.FileProvider
import java.io.File
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.graphics.PathParser
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@InvokeArg
class ShareArgs {
    var title: String = ""
    var text: String = ""
}

@InvokeArg
class ShareFileArgs {
    var title: String = ""
    /** Dateiname, z. B. „Rudern.fit“ */
    var name: String = ""
    /** Inhalt, Base64 */
    var data: String = ""
    var mime: String = "application/octet-stream"
}

@InvokeArg
class OpenArgs {
    var url: String = ""
    var external: Boolean = false
}

/**
 * Weblinks (js/core/links.js) im Custom Tab des Systems: der Browser legt
 * sich über WMap, oben ✕ zum Schließen (zurück in die App) und rechts
 * „Im Browser öffnen“. `external`: gleich im Standardbrowser.
 *
 * Dazu, weil das WebView es nicht kann: `share { title, text }` öffnet das
 * Teilen-Menü von Android, `shareFile { title, name, data, mime }` gibt eine Datei dorthin,
 * `copy { text }` legt Text in die Zwischenablage.
 */
@TauriPlugin
class BrowserPlugin(private val activity: Activity) : Plugin(activity) {

    @Command
    fun open(invoke: Invoke) {
        val args = invoke.parseArgs(OpenArgs::class.java)
        val uri = Uri.parse(args.url)
        if (uri.scheme != "http" && uri.scheme != "https") return invoke.reject("Nur http- und https-Links")
        activity.runOnUiThread {
            try {
                if (args.external) inBrowser(uri) else customTab(uri)
                invoke.resolve()
            } catch (e: Exception) {
                // Kein Browser mit Custom Tabs: dann eben so
                try { inBrowser(uri); invoke.resolve() } catch (e2: Exception) { invoke.reject(e2.message ?: e2.toString()) }
            }
        }
    }

    @Command
    fun share(invoke: Invoke) {
        val args = invoke.parseArgs(ShareArgs::class.java)
        activity.runOnUiThread {
            try {
                val send = Intent(Intent.ACTION_SEND).setType("text/plain")
                    .putExtra(Intent.EXTRA_TEXT, args.text)
                    .putExtra(Intent.EXTRA_SUBJECT, args.title)
                activity.startActivity(Intent.createChooser(send, args.title.ifEmpty { "Teilen" }))
                invoke.resolve()
            } catch (e: Exception) {
                invoke.reject(e.message ?: e.toString())
            }
        }
    }

    /**
     * Eine Datei über das Teilen-Menü von Android weitergeben (GPX, FIT – js/ui/share.js shareFile): Sie wird in
     * den Cache der App geschrieben und über den FileProvider der App (…fileprovider, cache-path) freigegeben.
     * Im Menü steht auch „Speichern“ bzw. die Dateien-App.
     */
    @Command
    fun shareFile(invoke: Invoke) {
        val args = invoke.parseArgs(ShareFileArgs::class.java)
        try {
            val name = args.name.replace(Regex("[/\\\\]"), "-").ifEmpty { "datei" }
            val dir = File(activity.cacheDir, "share").apply { mkdirs() }
            // Altes aufräumen – geteilt ist es längst
            dir.listFiles()?.forEach { if (System.currentTimeMillis() - it.lastModified() > 3600_000) it.delete() }
            val file = File(dir, name)
            file.writeBytes(Base64.decode(args.data, Base64.DEFAULT))
            val uri = FileProvider.getUriForFile(activity, activity.packageName + ".fileprovider", file)
            activity.runOnUiThread {
                try {
                    val send = Intent(Intent.ACTION_SEND).setType(args.mime)
                        .putExtra(Intent.EXTRA_STREAM, uri)
                        .putExtra(Intent.EXTRA_SUBJECT, args.title)
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    send.clipData = ClipData.newUri(activity.contentResolver, name, uri)
                    activity.startActivity(Intent.createChooser(send, args.title.ifEmpty { "Teilen" }))
                    invoke.resolve()
                } catch (e: Exception) {
                    invoke.reject(e.message ?: e.toString())
                }
            }
        } catch (e: Exception) {
            invoke.reject(e.message ?: e.toString())
        }
    }

    @Command
    fun copy(invoke: Invoke) {
        val args = invoke.parseArgs(ShareArgs::class.java)
        activity.runOnUiThread {
            val clip = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            clip.setPrimaryClip(ClipData.newPlainText(args.title.ifEmpty { "WMap" }, args.text))
            invoke.resolve()
        }
    }

    private fun inBrowser(uri: Uri) {
        activity.startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    private fun customTab(uri: Uri) {
        val open = PendingIntent.getActivity(
            activity, 0,
            Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val tab = CustomTabsIntent.Builder()
            .setShowTitle(true)
            .setShareState(CustomTabsIntent.SHARE_STATE_OFF)
            .setDefaultColorSchemeParams(CustomTabColorSchemeParams.Builder().setToolbarColor(Color.parseColor("#1a73e8")).build())
            .setActionButton(openInNewIcon(), "Im Browser öffnen", open, true)
            .build()
        tab.launchUrl(activity, uri)
    }

    /** Symbol „open_in_new“ (Material) als Bild für die Leiste */
    private fun openInNewIcon(): Bitmap {
        val size = (24 * activity.resources.displayMetrics.density).toInt()
        val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val path = PathParser.createPathFromPathData(
            "M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"
        )
        path.transform(Matrix().apply { setScale(size / 24f, size / 24f) })
        Canvas(bmp).drawPath(path, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE })
        return bmp
    }
}
