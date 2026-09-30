package de.wuefl.wmap

// Von tools/android-einbinden.py nach src-tauri/gen/android kopiert – hier ändern, nicht dort.

import android.app.PictureInPictureParams
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.Locale
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.util.Rational
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/**
 * Bild in Bild: Während einer Navigation geht WMap beim Verlassen (Home,
 * Rauswischen) von selbst ins Mini-Fenster – die ganze App, von der Seite auf
 * Karte und Anweisung reduziert (html.pip-mode). Die Seite schaltet das über
 * window.WMapAndroid (js/nav/pip.js). Karte und GPS laufen dort weiter,
 * obwohl die Activity pausiert ist (keepAwake).
 *
 * Ansagen: Das WebView kennt keine Web-Sprachausgabe (speechSynthesis) –
 * darum spricht Android selbst (TextToSpeech, WMapAndroid.speak/stopSpeaking,
 * genutzt von js/nav/navigation.js); Musik wird dabei leiser (Audio-Fokus).
 *
 * Ränder: Die App zeichnet bis unter Statusleiste und Gestenleiste
 * (edge-to-edge). Das WebView meldet dafür kein env(safe-area-inset-*) –
 * darum gehen die echten Maße an die Seite (WMapAndroid.insets() und
 * window.wmapInsets, ausgewertet in js/core/theme.js).
 *
 * Android Auto: Die Karte im Auto ist ein eigenes WebView – läuft sie unter
 * einer anderen Adresse als die App (Debug-Fassung), hat sie einen anderen
 * Browser-Speicher. Touren, Lesezeichen und Ziele liegen darum zusätzlich in
 * SharedPreferences „wmap_shared“ (WMapAndroid.shareGet/shareSet, dieselben
 * Namen in car/CarWeb.kt) – js/data/car-share.js gleicht beide Seiten ab.
 */
class MainActivity : TauriActivity() {
  private var web: WebView? = null
  // Ansagen der Navigation: Das WebView kennt keine Web-Sprachausgabe
  private var tts: TextToSpeech? = null
  @Volatile private var ttsReady = false
  private val speechAttrs = AudioAttributes.Builder()
    .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
    .build()
  // Musik währenddessen leiser, danach wieder laut
  private val focus by lazy {
    AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK).setAudioAttributes(speechAttrs).build()
  }
  private val audio by lazy { getSystemService(AudioManager::class.java) }
  @Volatile private var pipWanted = false
  // Im Bild in Bild die Plugins nach der Pause gleich wieder fortgesetzt (GPS)
  private var keptAwake = false
  @Volatile private var insetsJson = "null"

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    tts = TextToSpeech(this) { status ->
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

  override fun onDestroy() {
    tts?.shutdown()
    tts = null
    super.onDestroy()
  }

  override fun onWebViewCreate(webView: WebView) {
    web = webView
    webView.addJavascriptInterface(Bridge(), "WMapAndroid")
    // Nicht verbrauchen – Tauri und das WebView sehen die Ränder weiter
    ViewCompat.setOnApplyWindowInsetsListener(window.decorView) { view, insets ->
      val b = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val d = resources.displayMetrics.density
      insetsJson = "{\"top\":${b.top / d},\"bottom\":${b.bottom / d},\"left\":${b.left / d},\"right\":${b.right / d}}"
      web?.post { web?.evaluateJavascript("window.wmapInsets && window.wmapInsets($insetsJson)", null) }
      ViewCompat.onApplyWindowInsets(view, insets)
    }
    ViewCompat.requestApplyInsets(window.decorView)
  }

  // Gemeinsamer Speicher mit der Karte im Auto (car/CarWeb.kt) – js/data/car-share.js
  private val shared by lazy { getSharedPreferences("wmap_shared", MODE_PRIVATE) }

  inner class Bridge {
    /** Geteilt mit Android Auto: Touren, Lesezeichen, Ziele (JSON-Text; leer, wenn es nichts gibt) */
    @JavascriptInterface fun shareGet(key: String): String = shared.getString(key, "") ?: ""

    @JavascriptInterface fun shareSet(key: String, value: String) {
      shared.edit().putString(key, value).apply()
    }

    /** Ränder in CSS-Pixeln: {top, bottom, left, right} – oder null, solange unbekannt */
    @JavascriptInterface fun insets(): String = insetsJson

    /** Navigation läuft: beim Verlassen ins Bild in Bild */
    @JavascriptInterface fun setPip(on: Boolean) {
      pipWanted = on
      runOnUiThread { updateParams() }
    }

    /** Knopf in der Navigation: jetzt gleich */
    @JavascriptInterface fun enterPip() {
      runOnUiThread { enterPipNow() }
    }

    /** Ansage sprechen (die vorige bricht ab) → false, solange die Sprachausgabe nicht bereit ist */
    @JavascriptInterface fun speak(text: String): Boolean {
      val t = tts ?: return false
      if (!ttsReady) return false
      t.speak(text, TextToSpeech.QUEUE_FLUSH, null, "wmap")
      return true
    }

    @JavascriptInterface fun stopSpeaking() {
      tts?.stop()
      audio.abandonAudioFocusRequest(focus)
    }
  }

  private fun params(): PictureInPictureParams? {
    if (Build.VERSION.SDK_INT < 26) return null
    val b = PictureInPictureParams.Builder().setAspectRatio(Rational(3, 4))
    // Ab Android 12 übernimmt das System das Umschalten beim Verlassen
    if (Build.VERSION.SDK_INT >= 31) b.setAutoEnterEnabled(pipWanted).setSeamlessResizeEnabled(true)
    return b.build()
  }

  private fun updateParams() {
    if (Build.VERSION.SDK_INT >= 26) params()?.let { setPictureInPictureParams(it) }
  }

  private fun enterPipNow() {
    if (Build.VERSION.SDK_INT >= 26) params()?.let { enterPictureInPictureMode(it) }
  }

  // Android 8 bis 11: kein automatisches Bild in Bild – beim Verlassen selbst hinein
  override fun onUserLeaveHint() {
    super.onUserLeaveHint()
    if (pipWanted && Build.VERSION.SDK_INT in 26..30) enterPipNow()
  }

  // Tauri hält beim Pausieren die WebView an und die Plugins – das Standort-
  // Plugin beendet dann die Abfrage. Im Bild in Bild soll die Navigation aber
  // weiterlaufen: Karte und GPS gleich wieder an.
  override fun onPause() {
    super.onPause()
    if (Build.VERSION.SDK_INT >= 24 && isInPictureInPictureMode) keepAwake()
  }

  private fun keepAwake() {
    web?.onResume()
    if (keptAwake) return
    getPluginManager().onResume(this)
    keptAwake = true
  }

  override fun onResume() {
    super.onResume()
    keptAwake = false
  }

  // Mini-Fenster weggewischt: jetzt doch ruhen – kein GPS im Hintergrund
  override fun onStop() {
    if (keptAwake) {
      getPluginManager().onPause(this)
      keptAwake = false
    }
    super.onStop()
  }

  override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
    super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
    // Manche Android-Versionen melden das Bild in Bild erst nach onPause
    if (isInPictureInPictureMode && !lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED)) keepAwake()
    else if (isInPictureInPictureMode) web?.onResume()
    web?.evaluateJavascript(
      "document.documentElement.classList.toggle('pip-mode', $isInPictureInPictureMode); dispatchEvent(new Event('resize'));",
      null,
    )
  }
}
