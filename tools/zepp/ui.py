"""Handy über adb bedienen: Bildschirm als Text lesen (uiautomator), nach Text tippen."""
import os, re, subprocess, sys, time
import xml.etree.ElementTree as ET
SERIAL = os.environ.get('ANDROID_SERIAL', '56040DLAQ0063D')
def adb(*a, text=True):
    return subprocess.run(['adb', '-s', SERIAL, *a], capture_output=True, text=text, timeout=60).stdout
def dump():
    # in einem Aufruf lesen (nicht erst in eine Datei schreiben und die holen)
    for _ in range(3):
        x = adb('exec-out', 'uiautomator', 'dump', '/dev/tty')
        x = x[:x.rfind('</hierarchy>') + 12] if '</hierarchy>' in x else ''
        if x.startswith('<?xml'): break
        time.sleep(0.3)
    out = []
    for n in ET.fromstring(x).iter('node'):
        b = [int(v) for v in re.findall(r'\d+', n.get('bounds'))]
        out.append({'text': n.get('text') or '', 'desc': n.get('content-desc') or '', 'id': (n.get('resource-id') or '').split('/')[-1],
                    'cls': n.get('class').split('.')[-1], 'click': n.get('clickable') == 'true', 'pkg': n.get('package'),
                    'x': (b[0] + b[2]) // 2, 'y': (b[1] + b[3]) // 2, 'b': b})
    return out
def show(nodes=None):
    for n in nodes or dump():
        if n['text'] or n['desc'] or (n['click'] and n['id']):
            print(f"{n['x']:5d},{n['y']:5d} {'*' if n['click'] else ' '} {n['cls'][:14]:14s} {n['id'][:28]:28s} {n['text'][:60]!r} {n['desc'][:40]!r}")
def tap(x, y): adb('shell', 'input', 'tap', str(x), str(y))
def find(pat, nodes=None):
    r = re.compile(pat)
    return [n for n in (nodes or dump()) if r.search(n['text']) or r.search(n['desc'])]
def tap_text(pat, nodes=None):
    f = find(pat, nodes)
    if not f: return False
    tap(f[0]['x'], f[0]['y']); return True
if __name__ == '__main__':
    c = sys.argv[1] if len(sys.argv) > 1 else 'show'
    if c == 'show': show()
    elif c == 'tap': tap(int(sys.argv[2]), int(sys.argv[3])); time.sleep(float(sys.argv[4]) if len(sys.argv) > 4 else 1.5); show()
    elif c == 'text': print(tap_text(sys.argv[2])); time.sleep(1.5); show()
    elif c == 'back': adb('shell', 'input', 'keyevent', '4'); time.sleep(1.2); show()
    elif c == 'swipe': adb('shell', 'input', 'swipe', *sys.argv[2:6], '400'); time.sleep(1.2); show()
