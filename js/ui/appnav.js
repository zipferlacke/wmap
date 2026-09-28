/**
 * Menü oben rechts – auf jeder Seite gleich: Übersicht (Dashboard) und die
 * Schnellwege zu den wichtigsten Ansichten. Seitenspezifische Einträge hängt
 * die Seite selbst an (`addItem`), abgesetzt durch einen Strich.
 * Nebenbei: Ist die App zu alt (messages.json → minVersion), kommt hier wie
 * überall das Banner „Aktualisieren“ (ui/news.js).
 */
import { appNews } from './news.js';

const PAGES = [
  { href: './dashboard.html', icon: 'dashboard', label: 'Übersicht', match: /dashboard\.html$/ },
  { href: './index.html', icon: 'map', label: 'Karte', match: /\/(index\.html)?$/ },
  { href: './wege.html?tab=geplant', icon: 'route', label: 'Meine Touren', match: /wege\.html$/ },
  { href: './tour.html', icon: 'add_road', label: 'Tour planen', match: /tour\.html$/ },
  { href: './entdecken.html', icon: 'explore', label: 'Entdecken', match: /entdecken\.html$/ },
  { href: './plugins.html', icon: 'extension', label: 'Plugins', match: /plugins\.html$/ },
  { href: './index.html?action=fly', icon: 'flight', label: 'Fliegen', match: null },
];

export function mountAppNav() {
  appNews();
  const nav = document.createElement('nav');
  nav.className = 'appnav';
  nav.innerHTML = `
    <button type="button" class="button appnav-btn" aria-haspopup="menu" aria-expanded="false" title="Menü">
      <span class="msr">apps</span>
    </button>
    <div class="appnav-menu" role="menu" hidden>
      ${PAGES.map((p) => `<a role="menuitem" href="${p.href}"
        ${p.match?.test(location.pathname) && !(p.href.includes('tour.html') && new URLSearchParams(location.search).has('id')) ? 'aria-current="page"' : ''}>
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
      if (!menu.querySelector('hr')) menu.append(document.createElement('hr'));
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
