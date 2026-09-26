/**
 * Menü oben rechts – auf jeder Seite gleich: Karte, Touren, neue Tour.
 * Seitenspezifische Einträge hängt die Seite selbst an (`addItem`).
 */
const PAGES = [
  { href: './index.html', icon: 'map', label: 'Karte', match: /\/(index\.html)?$/ },
  { href: './tours.html', icon: 'route', label: 'Meine Touren', match: /tours\.html$/ },
  { href: './tour.html', icon: 'add_road', label: 'Neue Tour planen', match: /tour\.html$/ },
];

export function mountAppNav() {
  const nav = document.createElement('nav');
  nav.className = 'appnav';
  nav.innerHTML = `
    <button type="button" class="button appnav-btn" data-shape="round" aria-haspopup="menu" aria-expanded="false" title="Menü">
      <span class="msr">apps</span>
    </button>
    <div class="appnav-menu" role="menu" hidden>
      ${PAGES.map((p) => `<a role="menuitem" href="${p.href}"
        ${p.match.test(location.pathname) && !(p.href.includes('tour.html') && new URLSearchParams(location.search).has('id')) ? 'aria-current="page"' : ''}>
        <span class="msr">${p.icon}</span>${p.label}</a>`).join('')}
    </div>`;
  document.body.append(nav);

  const btn = nav.querySelector('.appnav-btn');
  const menu = nav.querySelector('.appnav-menu');
  const set = (open) => { menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); };
  btn.addEventListener('click', (e) => { e.stopPropagation(); set(menu.hidden); });
  document.addEventListener('click', (e) => { if (!nav.contains(e.target)) set(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') set(false); });
  menu.addEventListener('click', (e) => { if (e.target.closest('button')) set(false); });

  return {
    el: nav,
    addItem(icon, label, onClick) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.innerHTML = `<span class="msr">${icon}</span>${label}`;
      b.addEventListener('click', onClick);
      menu.append(b);
      return b;
    },
  };
}
