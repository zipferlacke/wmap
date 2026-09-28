/**
 * Hauptnavigation: am Rechner eine Leiste links, am Handy unten – wie bei
 * einer App. Auf der Übersicht, den Plugins, den Einstellungen und der Karte
 * (dort dazu das Menü oben rechts, appnav.js). Reihenfolge: Karte zuerst.
 */
import './theme.js';

const ITEMS = [
  { href: './index.html', icon: 'map', label: 'Karte', match: /\/(index\.html)?$/ },
  { href: './dashboard.html', icon: 'dashboard', label: 'Übersicht', match: /dashboard\.html$/ },
  { href: './wege.html?tab=geplant', icon: 'route', label: 'Touren', match: /wege\.html$/ },
  { href: './entdecken.html', icon: 'explore', label: 'Entdecken', match: /entdecken\.html$/ },
  { href: './plugins.html', icon: 'extension', label: 'Plugins', match: /plugins\.html$/ },
];

export function mountAppBar() {
  const nav = document.createElement('nav');
  nav.className = 'appbar';
  nav.setAttribute('aria-label', 'Hauptnavigation');
  nav.innerHTML = ITEMS.map((i) => `<a href="${i.href}" ${i.match.test(location.pathname) ? 'aria-current="page"' : ''}>
      <span class="msr">${i.icon}</span><span>${i.label}</span></a>`).join('');
  document.body.prepend(nav);
  document.body.classList.add('has-appbar');
  return nav;
}
