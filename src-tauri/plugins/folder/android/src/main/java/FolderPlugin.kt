package de.wuefl.wmap.folder

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.DocumentsContract.Document
import android.provider.OpenableColumns
import android.webkit.WebView
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import kotlin.concurrent.thread

@InvokeArg
class SlotArgs {
    var slot: String = ""
}

@InvokeArg
class PathArgs {
    var slot: String = ""
    var path: String = ""
}

@InvokeArg
class SaveArgs {
    var name: String = "wmap"
    var data: String = ""
    var mime: String = "application/octet-stream"
}

@InvokeArg
class OpenedArgs {
    var peek: Boolean = false
}

@InvokeArg
class WriteArgs {
    var slot: String = ""
    var path: String = ""
    var text: String = ""
}

/**
 * Ordner verbinden (js/data/folder.js) – über den Speicherzugriff des
 * Systems (ACTION_OPEN_DOCUMENT_TREE): geht mit lokalen Ordnern ebenso wie
 * mit Nextcloud, Google Drive, Proton Drive … Die Freigabe bleibt über
 * Neustarts (takePersistableUriPermission), gemerkt wird nur der Ordner.
 *
 *   pick, info, list, read { path }, write { path, text }, remove { path },
 *   disconnect – Pfade relativ zum Ordner, mit „/“.
 *   save { name, data, mime } – eine Datei (Base64) über die Dokumentauswahl
 *   des Systems ablegen (ACTION_CREATE_DOCUMENT), z. B. den ZIP-Export.
 *   opened { peek } – GPX-Dateien aus „Öffnen mit“ (ACTION_VIEW) und „Teilen“
 *   (ACTION_SEND): beim Start und während die App läuft (dann gleich zur
 *   Seite import.html); `peek` zählt nur.
 *
 * `slot` (optional, alle Befehle): welcher Ordner – leer ist der für
 * Sicherung & Synchronisation, „layers“ der für eigene Ebenen (Plugins).
 */
@TauriPlugin
class FolderPlugin(private val activity: Activity) : Plugin(activity) {
    private val prefs = activity.getSharedPreferences("wmap_folder", Context.MODE_PRIVATE)
    private val resolver get() = activity.contentResolver
    private val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
    // Ordner + Pfad → Dokument-ID aus dem letzten Durchgang (spart Abfragen)
    private val ids = HashMap<String, String>()
    // Mit WMap geöffnete Dateien, bis die Seite sie abholt
    private val opened = ArrayList<JSObject>()
    private var web: WebView? = null

    override fun load(webView: WebView) {
        super.load(webView)
        web = webView
        take(activity.intent)
    }

    // Läuft die App schon: Datei merken und zur Seite zum Öffnen
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (take(intent)) web?.post {
            web?.evaluateJavascript("location.assign(new URL('import.html', location.href))", null)
        }
    }

    /** GPX aus dem Intent lesen (höchstens 50 MB) → true, wenn etwas dazukam */
    @Suppress("DEPRECATION")
    private fun take(intent: Intent?): Boolean {
        if (intent == null || intent.getBooleanExtra("wmap.taken", false)) return false
        val uris: List<Uri> = when (intent.action) {
            Intent.ACTION_VIEW -> listOfNotNull(intent.data)
            Intent.ACTION_SEND -> listOfNotNull(intent.getParcelableExtra(Intent.EXTRA_STREAM) as? Uri)
            Intent.ACTION_SEND_MULTIPLE -> intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM) ?: emptyList()
            else -> emptyList()
        }.filter { it.scheme == "content" || it.scheme == "file" }
        if (uris.isEmpty()) return false
        intent.putExtra("wmap.taken", true)   // nicht noch einmal nach dem Drehen
        var added = false
        for (uri in uris) {
            try {
                var name: String? = null
                var size = 0L
                resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use {
                    if (it.moveToFirst()) {
                        name = it.getString(0)
                        if (!it.isNull(1)) size = it.getLong(1)
                    }
                }
                if (size > 50L * 1024 * 1024) continue
                val text = resolver.openInputStream(uri)?.use { it.readBytes().toString(Charsets.UTF_8) } ?: continue
                // Nur GPX – „Öffnen mit“ kommt je nach Dateimanager auch als octet-stream
                if (!text.contains("<gpx", ignoreCase = true)) continue
                opened.add(JSObject().put("name", name ?: uri.lastPathSegment ?: "Datei.gpx").put("text", text))
                added = true
            } catch (e: Exception) { /* nicht lesbar – übergehen */ }
        }
        return added
    }

    @Command
    fun opened(invoke: Invoke) {
        val peek = invoke.parseArgs(OpenedArgs::class.java).peek
        val files = JSArray()
        if (!peek) { opened.forEach { files.put(it) } }
        val count = opened.size
        if (!peek) opened.clear()
        invoke.resolve(JSObject().put("count", count).put("files", files))
    }

    private fun key(slot: String): String {
        require(slot.matches(Regex("[a-z0-9_-]{0,20}"))) { "Ungültiger Ordner: $slot" }
        return if (slot.isEmpty()) "tree" else "tree.$slot"
    }
    private fun forget(slot: String) = ids.keys.removeAll { it.startsWith("$slot\u0000") }

    private fun tree(slot: String): Uri? {
        val uri = prefs.getString(key(slot), null)?.let(Uri::parse) ?: return null
        // Freigabe im System zurückgenommen? Dann gilt der Ordner als getrennt
        return if (resolver.persistedUriPermissions.any { it.uri == uri && it.isWritePermission }) uri else null
    }

    private fun info(slot: String): JSObject {
        val t = tree(slot)
        val out = JSObject()
        out.put("connected", t != null)
        out.put("name", t?.let { nameOf(it, DocumentsContract.getTreeDocumentId(it)) })
        return out
    }

    private fun nameOf(tree: Uri, id: String): String? =
        resolver.query(DocumentsContract.buildDocumentUriUsingTree(tree, id), arrayOf(Document.COLUMN_DISPLAY_NAME), null, null, null)
            ?.use { if (it.moveToFirst()) it.getString(0) else null }

    /** Kinder eines Ordners: Name → (ID, Ordner?, geändert) */
    private data class Child(val id: String, val dir: Boolean, val modified: Long)

    private fun children(tree: Uri, parent: String): Map<String, Child> {
        val out = HashMap<String, Child>()
        val cols = arrayOf(Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME, Document.COLUMN_MIME_TYPE, Document.COLUMN_LAST_MODIFIED)
        resolver.query(DocumentsContract.buildChildDocumentsUriUsingTree(tree, parent), cols, null, null, null)?.use { c ->
            while (c.moveToNext()) {
                val name = c.getString(1) ?: continue
                out[name] = Child(c.getString(0), c.getString(2) == Document.MIME_TYPE_DIR, if (c.isNull(3)) 0 else c.getLong(3))
            }
        }
        return out
    }

    private fun parts(path: String): List<String> {
        val p = path.split('/')
        require(path.isNotEmpty() && p.none { it.isEmpty() || it == "." || it == ".." }) { "Ungültiger Pfad: $path" }
        return p
    }

    /** Dokument-ID zu einem Pfad; `create`: fehlende Ordner (und die Datei) anlegen */
    private fun resolve(slot: String, tree: Uri, path: String, create: Boolean, mime: String = "application/octet-stream"): String? {
        ids["$slot\u0000$path"]?.let { return it }
        var id = DocumentsContract.getTreeDocumentId(tree)
        val p = parts(path)
        for ((i, name) in p.withIndex()) {
            val last = i == p.size - 1
            val found = children(tree, id)[name]
            id = found?.id ?: if (!create) return null else {
                val uri = DocumentsContract.createDocument(resolver, DocumentsContract.buildDocumentUriUsingTree(tree, id), if (last) mime else Document.MIME_TYPE_DIR, name)
                    ?: throw IllegalStateException("Anlegen ging nicht: $name")
                DocumentsContract.getDocumentId(uri)
            }
        }
        ids["$slot\u0000$path"] = id
        return id
    }

    private fun work(invoke: Invoke, slot: String, block: (Uri) -> Unit) {
        val t = tree(slot) ?: return invoke.reject("Kein Ordner verbunden", "none")
        thread {
            try { block(t) } catch (e: Exception) { invoke.reject(e.message ?: e.toString(), e) }
        }
    }

    @Command
    fun pick(invoke: Invoke) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(flags or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        startActivityForResult(invoke, intent, "picked")
    }

    /** Freigabe nur zurückgeben, wenn kein anderer Ordner-Platz sie noch nutzt */
    private fun release(slot: String) {
        val old = prefs.getString(key(slot), null) ?: return
        val shared = prefs.all.any { (k, v) -> k != key(slot) && k.startsWith("tree") && v == old }
        if (!shared) runCatching { resolver.releasePersistableUriPermission(Uri.parse(old), flags) }
    }

    @ActivityCallback
    fun picked(invoke: Invoke, result: ActivityResult) {
        val uri = result.data?.data ?: return invoke.reject("abgebrochen", "cancel")
        try {
            val slot = invoke.parseArgs(SlotArgs::class.java).slot
            // Alten Ordner freigeben, den neuen dauerhaft behalten
            if (prefs.getString(key(slot), null) != uri.toString()) release(slot)
            resolver.takePersistableUriPermission(uri, flags)
            prefs.edit().putString(key(slot), uri.toString()).apply()
            forget(slot)
            invoke.resolve(info(slot))
        } catch (e: Exception) {
            invoke.reject(e.message ?: e.toString(), e)
        }
    }

    @Command
    fun info(invoke: Invoke) = invoke.resolve(info(invoke.parseArgs(SlotArgs::class.java).slot))

    @Command
    fun list(invoke: Invoke) {
      val slot = invoke.parseArgs(SlotArgs::class.java).slot
      work(invoke, slot) { t ->
        val out = JSArray()
        fun walk(id: String, prefix: String, depth: Int) {
            for ((name, c) in children(t, id)) {
                if (name.startsWith(".")) continue
                val path = prefix + name
                if (c.dir) {
                    if (depth < 5) walk(c.id, "$path/", depth + 1)
                } else if (name.endsWith(".gpx", true) || name.endsWith(".json", true) || name.endsWith(".geojson", true) || name.endsWith(".js", true) || name.endsWith(".mjs", true)) {
                    ids["$slot\u0000$path"] = c.id
                    out.put(JSObject().put("path", path).put("modified", c.modified))
                }
            }
        }
        forget(slot)
        walk(DocumentsContract.getTreeDocumentId(t), "", 0)
        invoke.resolve(JSObject().put("files", out))
      }
    }

    @Command
    fun read(invoke: Invoke) {
        val args = invoke.parseArgs(PathArgs::class.java)
        work(invoke, args.slot) { t ->
            val id = resolve(args.slot, t, args.path, false) ?: return@work invoke.reject("Nicht gefunden: ${args.path}", "missing")
            val text = resolver.openInputStream(DocumentsContract.buildDocumentUriUsingTree(t, id))!!.use { it.readBytes().toString(Charsets.UTF_8) }
            invoke.resolve(JSObject().put("text", text))
        }
    }

    @Command
    fun write(invoke: Invoke) {
        val args = invoke.parseArgs(WriteArgs::class.java)
        work(invoke, args.slot) { t ->
            val mime = if (args.path.endsWith(".json", true)) "application/json" else "application/gpx+xml"
            fun open(): Uri {
                val uri = DocumentsContract.buildDocumentUriUsingTree(t, resolve(args.slot, t, args.path, true, mime)!!)
                resolver.openOutputStream(uri, "wt")!!.use { it.write(args.text.toByteArray(Charsets.UTF_8)) }
                return uri
            }
            // Gemerkte ID veraltet (Datei woanders gelöscht)? Neu suchen bzw. anlegen
            val uri = try { open() } catch (e: Exception) { ids.remove("${args.slot}\u0000${args.path}"); open() }
            val modified = resolver.query(uri, arrayOf(Document.COLUMN_LAST_MODIFIED), null, null, null)
                ?.use { if (it.moveToFirst() && !it.isNull(0)) it.getLong(0) else 0L } ?: 0L
            invoke.resolve(JSObject().put("modified", modified))
        }
    }

    @Command
    fun remove(invoke: Invoke) {
        val args = invoke.parseArgs(PathArgs::class.java)
        work(invoke, args.slot) { t ->
            resolve(args.slot, t, args.path, false)?.let { DocumentsContract.deleteDocument(resolver, DocumentsContract.buildDocumentUriUsingTree(t, it)) }
            ids.remove("${args.slot}\u0000${args.path}")
            invoke.resolve()
        }
    }

    @Command
    fun save(invoke: Invoke) {
        val a = invoke.parseArgs(SaveArgs::class.java)
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(a.mime)
            .putExtra(Intent.EXTRA_TITLE, a.name)
        startActivityForResult(invoke, intent, "saved")
    }

    @ActivityCallback
    fun saved(invoke: Invoke, result: ActivityResult) {
        val uri = result.data?.data ?: return invoke.reject("abgebrochen", "cancel")
        thread {
            try {
                val a = invoke.parseArgs(SaveArgs::class.java)
                val bytes = android.util.Base64.decode(a.data, android.util.Base64.DEFAULT)
                resolver.openOutputStream(uri, "wt")!!.use { it.write(bytes) }
                val name = resolver.query(uri, arrayOf(Document.COLUMN_DISPLAY_NAME), null, null, null)
                    ?.use { if (it.moveToFirst()) it.getString(0) else null }
                invoke.resolve(JSObject().put("name", name))
            } catch (e: Exception) {
                invoke.reject(e.message ?: e.toString(), e)
            }
        }
    }

    @Command
    fun disconnect(invoke: Invoke) {
        val slot = invoke.parseArgs(SlotArgs::class.java).slot
        release(slot)
        prefs.edit().remove(key(slot)).apply()
        forget(slot)
        invoke.resolve()
    }
}
