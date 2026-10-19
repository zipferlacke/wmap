"""Eigene Änderungen an MapLibre (libs/maplibre-gl/maplibre-gl.js) – nach jedem Holen einer neuen Fassung
(tools/libs-holen.sh) laufen lassen. Mehrfach laufen schadet nicht; passt ein Muster nicht mehr, bricht es ab.

Namen und Symbole in der geneigten Karte nie größer als eingestellt
  MapLibre zeichnet Namen und Symbole je nach Abstand zur Kamera mit dem Faktor 0,5 + 0,5 · (Abstand der
  Bildmitte / Abstand des Symbols), bis zum Vierfachen. Steil geneigt sind Namen vorn dann doppelt bis dreifach
  so groß – unscharf und sie verdecken alles. Hier zählt nur noch das Kleinerwerden nach hinten: der Faktor
  liegt zwischen 0,5 und 1. Das gilt überall, wo MapLibre ihn rechnet – beim Zeichnen (Shader), beim Legen der
  Buchstaben entlang der Straße und bei der Kollision –, sonst stünden die Buchstaben auseinander oder die
  Namen hielten mehr Platz frei als sie brauchen.

    python3 tools/maplibre-anpassen.py
"""
from pathlib import Path

FILE = Path(__file__).resolve().parent.parent / 'libs/maplibre-gl/maplibre-gl.js'
MARK = '/*wmap:perspektive*/'

# (alt, neu, Anzahl) – „k“ ist der Faktor, der den Bildschirmfaktor f auf höchstens 1 bringt: min(1, 1/f)
PATCHES = [
    # Shader: Text, Symbole, SDF-Symbole. f = 0,5 + 0,5 · (Mitte / Anker) – geneigt wie aufrecht derselbe auf dem Bild
    ('highp float perspective_ratio=clamp(0.5+0.5*distance_ratio,0.0,4.0);',
     'highp float perspective_ratio=clamp(0.5+0.5*distance_ratio,0.0,4.0)'
     '*min(1.0,1.0/(0.5+0.5*u_camera_to_center_distance/camera_to_anchor_distance));' + MARK, 3),
    # Buchstaben entlang der Linie (Schriftgröße für die Lage der Buchstaben)
    ('E=o?T*n.getPitchedTextCorrection(r.anchorX,r.anchorY,l)/w:T*w,',
     'E=(o?T*n.getPitchedTextCorrection(r.anchorX,r.anchorY,l)/w:T*w)*Math.min(1,1/w)' + MARK + ',', 1),
    # Kollision entlang der Linie
    ('v=(c?i*this.transform.getPitchedTextCorrection(t.anchorX,t.anchorY,a)/_:i*_)/24,',
     'v=(c?i*this.transform.getPitchedTextCorrection(t.anchorX,t.anchorY,a)/_:i*_)*Math.min(1,1/_)/24' + MARK + ',', 1),
    # Kollisionskasten an einem Punkt
    ('_=n*g.perspectiveRatio,v;',
     '_=n*g.perspectiveRatio*Math.min(1,1/g.perspectiveRatio)' + MARK + ',v;', 1),
    # … geneigt (Kasten in der Ebene der Karte)
    ('let e=F(.5+.5*(s.signedDistanceFromCamera/this.transform.cameraToCenterDistance),0,4);S*=e}',
     'let e=F(.5+.5*(s.signedDistanceFromCamera/this.transform.cameraToCenterDistance),0,4);'
     'S*=e*Math.min(1,1/(.5+.5*(this.transform.cameraToCenterDistance/s.signedDistanceFromCamera)))' + MARK + '}', 1),
    # Verschiebung bei wechselndem Anker (text-variable-anchor)
    ('y=hD(i.cameraToCenterDistance,g.signedDistanceFromCamera),x=hv(e.textSizeData,s,v)*y/24;',
     'y=hD(i.cameraToCenterDistance,g.signedDistanceFromCamera),x=hv(e.textSizeData,s,v)*Math.min(y,1)/24;' + MARK, 1),
]


def main():
    s = FILE.read_text(encoding='utf-8')
    if MARK in s:
        print('schon angepasst:', s.count(MARK), 'Stellen')
        return
    for old, new, n in PATCHES:
        found = s.count(old)
        if found != n:
            raise SystemExit(f'Muster {found}× statt {n}× gefunden – MapLibre hat sich geändert:\n  {old}')
        s = s.replace(old, new)
    FILE.write_text(s, encoding='utf-8')
    print('angepasst:', s.count(MARK), 'Stellen')


main()
