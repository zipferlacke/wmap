package de.wuefl.wmap

// Von tools/android-einbinden.py nach src-tauri/gen/android kopiert – hier ändern, nicht dort.

import android.app.PictureInPictureParams
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.util.Rational
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge

/**
 * Bild in Bild: Während einer Navigation geht WMap beim Verlassen (Home,
 * Rauswischen) von selbst ins Mini-Fenster – die ganze App, also Karte und
 * Anweisung. Die Seite schaltet das über window.WMapAndroid (js/pip.js).
 */
class MainActivity : TauriActivity() {
  private var web: WebView? = null
  @Volatile private var pipWanted = false

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    web = webView
    webView.addJavascriptInterface(Bridge(), "WMapAndroid")
  }

  inner class Bridge {
    /** Navigation läuft: beim Verlassen ins Bild in Bild */
    @JavascriptInterface fun setPip(on: Boolean) {
      pipWanted = on
      runOnUiThread { updateParams() }
    }

    /** Knopf in der Navigation: jetzt gleich */
    @JavascriptInterface fun enterPip() {
      runOnUiThread { enterPipNow() }
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

  // Tauri hält die WebView beim Pausieren an – im Bild in Bild soll die Karte aber weiterlaufen
  override fun onPause() {
    super.onPause()
    if (Build.VERSION.SDK_INT >= 24 && isInPictureInPictureMode) web?.onResume()
  }

  override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
    super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
    if (isInPictureInPictureMode) web?.onResume()
    web?.evaluateJavascript(
      "document.documentElement.classList.toggle('pip-mode', $isInPictureInPictureMode); dispatchEvent(new Event('resize'));",
      null,
    )
  }
}
