"""Öffnungszeiten je Tag (osm/hours-editor.js): lesen, ändern, 24/7, dauerhaft geschlossen, Feiertage, zu Verschachteltes als Text."""
import sys
from common import Browser

SETUP = """
const { hoursField, mountHours } = await import('./js/osm/hours-editor.js');
window.mk = (v, o) => { document.querySelector('#ohtest')?.remove(); const f = document.createElement('form'); f.id = 'ohtest';
  f.innerHTML = hoursField(v, o); document.body.append(f); mountHours(f); f.querySelector('details').open = true; return f; };
window.val = () => document.querySelector('#ohtest [name=opening_hours]').value;
window.gone = () => document.querySelector('#ohtest [name=gone]').value;
window.sum = () => document.querySelector('#ohtest .oh-summary').textContent;
window.row = (d) => document.querySelector(`#ohtest .oh-day[data-day="${d}"]`);
window.setTime = (d, i, cls, v) => { const inp = row(d).querySelectorAll('.oh-span')[i].querySelector(cls); inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true })); };
return 1;
"""

with Browser(width=420, height=900) as b:
    b.open('settings.html', wait=2)
    b.d.execute_async_script('const done = arguments[0]; (async () => {' + SETUP + '})().then(done, (e) => done(String(e)))')
    v = 'Mo-Fr 08:00-18:00; Sa 09:00-13:00; PH off'
    print('1 unverändert:', b.js(f"mk('{v}'); return [val(), sum()]"))
    print('  Sa bis 14:00:', b.js("setTime(5, 0, '.oh-b', '14:00'); return val()"))
    print('2 Mo zweite Zeit:', b.js("row(0).querySelector('[data-oh=add]').click(); return val()"))
    print('  Mo zweite weg:', b.js("row(0).querySelectorAll('[data-oh=del]')[1].click(); return val()"))
    print('3 So Zeiten:', b.js("row(6).querySelector('[data-oh=add]').click(); return val()"))
    print('4 Feiertag keine Angabe:', b.js("row(7).querySelector('[data-oh=ph-off]').click(); return val()"))
    print('  Feiertag Zeiten:', b.js("row(7).querySelector('[data-oh=add]').click(); return val()"))
    print('5 24/7:', b.js("document.querySelector('#ohtest [data-oh=\"24/7\"]').click(); return [val(), sum()]"))
    print('  zurück:', b.js("document.querySelector('#ohtest [data-oh=week]').click(); return val()"))
    print('6 dauerhaft zu:', b.js("document.querySelector('#ohtest [data-oh=gone]').click(); return [val(), gone(), sum()]"))
    print('7 Verschachtelt:', b.js("mk('Jan-Mar Mo 10:00-12:00; Apr-Dec Mo-Fr 08:00-18:00'); return [!!document.querySelector('#ohtest .oh-raw'), val()]"))
    print('  Schulferien:', b.js("mk('Mo-Fr 08:00-18:00; SH Mo-Fr 10:00-12:00'); return !!document.querySelector('#ohtest .oh-raw')"))
    print('8 leer (neuer Ort):', b.js("mk('', { gone: false }); return [val(), sum(), !!document.querySelector('#ohtest [data-oh=gone]'), document.querySelectorAll('#ohtest .oh-day.closed').length]"))
    print('  Mo + übernehmen:', b.js("row(0).querySelector('[data-oh=add]').click(); document.querySelector('#ohtest [data-oh=copy-mo]').click(); return val()"))
    print('9 Als Text:', b.js("document.querySelector('#ohtest [data-oh=raw]').click(); const r = document.querySelector('#ohtest .oh-raw'); r.value = 'Mo-Su 06:00-22:00'; r.dispatchEvent(new Event('input', { bubbles: true })); return val()"))
    print('10 leer → Text → Tage:', b.js("mk(''); document.querySelector('#ohtest [data-oh=raw]').click(); document.querySelector('#ohtest [data-oh=week]').click(); return [val(), document.querySelectorAll('#ohtest .oh-span').length]"))
    print('11 Feiertag wie Sonntag:', b.js("mk('Mo-Fr 08:00-18:00; Su 10:00-12:00'); row(7).querySelector('[data-oh=ph-sunday]').click(); return val()"))
    # Aussehen: wie im Bearbeiten-Dialog
    b.js("""mk('Mo-Fr 08:00-12:00,14:00-18:00; Sa 09:00-13:00; PH off');
      const f = document.querySelector('#ohtest'); f.className = 'osm-form'; f.style.cssText = 'position:fixed;inset:0;z-index:999;background:var(--surface);padding:12px;overflow:auto'""")
    b.shot('oeffnungszeiten')
    sys.exit(b.report())
