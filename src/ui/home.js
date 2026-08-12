// Course map: what to do next, how far you got, and the handwriting setup.

import { UNITS } from '../data/lessons.js';
import { pick, t, toggleLanguage, lang } from '../i18n.js';
import { getState, handSize, unitProgress } from '../state.js';
import { h } from './dom.js';

export function homeScreen({ navigate }) {
  const state = getState();
  const root = h('div', { class: 'screen home' });

  const nextUnit = UNITS.find((unit) => !unitProgress(unit.id).finished) || UNITS[0];
  const taught = handSize();

  root.append(
    h(
      'header',
      { class: 'hero' },
      h(
        'div',
        { class: 'hero-top' },
        h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, '✎'), t('appName')),
        h('button', { class: 'lang', onClick: () => { toggleLanguage(); navigate('#/', true); } }, lang().toUpperCase()),
      ),
      h('p', { class: 'tagline' }, t('tagline')),
      h(
        'div',
        { class: 'stats' },
        h('div', { class: 'stat' }, h('b', {}, String(state.xp)), h('span', {}, t('xp'))),
        h('div', { class: 'stat' }, h('b', {}, String(state.streak.count)), h('span', {}, t('streak'))),
        h('div', { class: 'stat' }, h('b', {}, `${taught}/26`), h('span', {}, t('handLetters'))),
      ),
      h('button', { class: 'button hero-cta', onClick: () => navigate(`#/lesson/${nextUnit.id}`) },
        `${t('continue')} · ${pick(nextUnit.title)}`),
    ),
  );

  const handCard = h(
    'button',
    { class: 'card hand-card', onClick: () => navigate('#/handwriting') },
    h('div', { class: 'card-icon' }, '✍️'),
    h(
      'div',
      { class: 'card-body' },
      h('div', { class: 'card-title' }, taught ? t('handwritingDone', taught) : t('handwriting')),
      h('div', { class: 'card-sub' }, t('handwritingHint')),
    ),
    h('div', { class: 'card-chevron' }, '›'),
  );

  const list = h('section', { class: 'units' }, h('h2', { class: 'section-title' }, t('lessons')));
  for (const unit of UNITS) {
    const progress = unitProgress(unit.id);
    const total = unit.tasks.length;
    const done = progress.done.length;
    const share = Math.round((Math.min(done, total) / total) * 100);
    list.append(
      h(
        'button',
        { class: 'card unit-card', dataset: { finished: String(progress.finished) }, onClick: () => navigate(`#/lesson/${unit.id}`) },
        h('div', { class: 'ring', style: { '--share': `${share}%` } }, h('span', {}, progress.finished ? '✓' : `${share}%`)),
        h(
          'div',
          { class: 'card-body' },
          h('div', { class: 'card-title' }, pick(unit.title)),
          h('div', { class: 'card-sub' }, pick(unit.subtitle)),
        ),
        h('div', { class: 'card-chevron' }, '›'),
      ),
    );
  }

  root.append(h('main', { class: 'home-body' }, handCard, list, h('p', { class: 'footnote' }, `${t('offline')} · ${t('appName')}`)));
  return root;
}
