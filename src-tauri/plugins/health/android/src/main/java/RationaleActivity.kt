package de.wuefl.wmap.health

import android.app.Activity
import android.os.Bundle
import android.widget.TextView

/** Wofür WMap Health Connect liest – zeigt Health Connect beim Freigeben an. */
class RationaleActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        title = "WMap und Health Connect"
        val pad = (20 * resources.displayMetrics.density).toInt()
        setContentView(TextView(this).apply {
            setPadding(pad, pad, pad, pad)
            textSize = 16f
            text = "WMap liest aus Health Connect nur deine Trainings, ihre Routen und die " +
                "Messwerte dazu (Puls, Tempo, Schritt- und Trittfrequenz, Leistung), um sie " +
                "unter „Meine Touren“ als Wege mit Diagrammen und Runden zu zeigen.\n\n" +
                "Die Daten bleiben auf diesem Gerät – WMap lädt nichts hoch und schreibt " +
                "nichts in Health Connect zurück. Nur wenn du selbst einen Ordner verbindest " +
                "(z. B. Nextcloud), legt WMap die Wege dort als GPX-Dateien ab.\n\n" +
                "Die Freigabe lässt sich jederzeit in Health Connect zurücknehmen."
        })
    }
}
