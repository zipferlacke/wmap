"""Teilen-Dialog (Text mit Link / nur Link) und Toast – hell und dunkel."""
import sys
import time
from common import Browser

with Browser(420, 860) as b:
    for mode in ['light', 'dark']:
        b.open('settings.html', 1)
        b.theme(mode)
        b.open('index.html?ort=9.9338,51.5374&name=Test', 5)
        b.js("[...document.querySelectorAll('[data-view=place] .actions button')].find(x => x.textContent.includes('Teilen')).click()")
        time.sleep(1)
        b.shot(f'share-{mode}')
        print(mode, [x.text.split('\n')[-1] for x in b.d.find_elements('css selector', 'dialog[open] .confirm-actions button')])
        b.css('dialog[open] button[value=link]').click()
        time.sleep(.5)
        b.shot(f'toast-{mode}')
        print('  Toast:', b.js("const t = document.getElementById('toast'); return t && [t.textContent, getComputedStyle(t).backgroundColor]"))
    sys.exit(b.report())
