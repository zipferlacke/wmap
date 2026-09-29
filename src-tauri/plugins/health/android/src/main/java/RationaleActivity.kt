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
            text = "WMap liest aus Health Connect nur deine Trainings und ihre Routen, " +
                "um sie unter „Meine Touren“ als Wege auf der Karte zu zeigen.\n\n" +
                "Die Daten bleiben auf diesem Gerät – WMap lädt nichts hoch und " +
                "schreibt nichts in Health Connect zurück.\n\n" +
                "Die Freigabe lässt sich jederzeit in Health Connect zurücknehmen."
        })
    }
}
