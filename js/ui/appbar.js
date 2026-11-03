/**
 * Hauptnavigation: am Rechner eine Leiste links, am Handy unten – wie bei
 * einer App. Auf der Übersicht, den Plugins, den Einstellungen und der Karte
 * (dort dazu das Menü oben rechts, ui/appnav.js). Reihenfolge: Karte zuerst.
 */
import '../core/theme.js';
import { appNews } from './news.js';
import { t } from '../core/i18n.js';

const ITEMS = [
  { href: './index.html', icon: 'map', label: t('common.nav.map'), match: /\/(index\.html)?$/ },
  { href: './dashboard.html', icon: 'dashboard', label: t('common.nav.dashboard'), match: /dashboard\.html$/ },
  { href: './wege.html?tab=geplant', icon: 'route', label: t('common.nav.tours'), match: /wege\.html$/ },
  { href: './entdecken.html', icon: 'explore', label: t('common.nav.discover'), match: /entdecken\.html$/ },
  { href: './plugins.html', icon: 'extension', label: t('common.nav.plugins'), match: /plugins\.html$/ },
];

export function mountAppBar() {
  // Zu alte Version? Dann das Banner „Aktualisieren“ (ui/news.js)
  appNews();
  const nav = document.createElement('nav');
  nav.className = 'appbar';
  nav.setAttribute('aria-label', t('common.nav.main'));
  nav.innerHTML = ITEMS.map((i) => `<a href="${i.href}" ${i.match.test(location.pathname) ? 'aria-current="page"' : ''}>
      <span class="msr">${i.icon}</span><span>${i.label}</span></a>`).join('');
  document.body.prepend(nav);
  document.body.classList.add('has-appbar');
  return nav;
}
