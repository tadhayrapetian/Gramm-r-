// Teaching the app your handwriting.
//
// Built-in letterforms are one person's idea of what a letter looks like; a `k` or a
// `t` drawn a different way scores badly against them. Writing each letter once here
// stores your own version, which the reader then prefers.

import { ALPHABET } from '../ink/alphabet.js';
import { InkLine } from '../ink/surface.js';
import { t } from '../i18n.js';
import { clearHand, getState, saveHand } from '../state.js';
import { clear, h } from './dom.js';

const LETTERS = ALPHABET.filter((letter) => /[a-z]/.test(letter));

export function calibrateScreen({ navigate, reloadHand }) {
  const root = h('div', { class: 'screen calibrate' });
  const stage = h('div', { class: 'calibrate-stage' });
  const counter = h('div', { class: 'calibrate-counter' });
  let index = 0;
  let line = null;

  root.append(
    h(
      'header',
      { class: 'topbar' },
      h('button', { class: 'icon-button', onClick: () => navigate('#/'), title: t('back') }, '←'),
      h('div', { class: 'topbar-main' }, h('div', { class: 'topbar-title' }, t('handwriting')), counter),
      h('button', {
        class: 'text-button',
        onClick: () => {
          clearHand();
          reloadHand();
          index = 0;
          render();
        },
      }, t('handwritingReset')),
    ),
    h('main', { class: 'paper' }, h('div', { class: 'paper-inner' }, h('p', { class: 'calibrate-intro' }, t('handwritingIntro')), stage)),
  );

  function render() {
    const letter = LETTERS[index];
    const stored = getState().hand[letter];
    counter.textContent = `${index + 1} / ${LETTERS.length}`;
    clear(stage);

    line?.destroy();
    line = new InkLine({ height: 150, tool: getState().settings.tool });

    const move = (step) => {
      index = (index + step + LETTERS.length) % LETTERS.length;
      render();
    };

    stage.append(
      h(
        'div',
        { class: 'calibrate-card' },
        h('div', { class: 'calibrate-letter', dataset: { taught: String(Boolean(stored)) } }, letter),
        h('div', { class: 'writing' }, line.el),
        h(
          'div',
          { class: 'calibrate-actions' },
          h('button', { class: 'button ghost', onClick: () => line.clear() }, t('clear')),
          h('button', { class: 'button ghost', onClick: () => move(1) }, t('handwritingSkip')),
          h('button', {
            class: 'button',
            onClick: () => {
              if (!line.isEmpty()) {
                saveHand(letter, [line.templateStrokes()]);
                reloadHand();
              }
              move(1);
            },
          }, t('handwritingSave')),
        ),
      ),
      h(
        'div',
        { class: 'letter-strip' },
        ...LETTERS.map((item, i) =>
          h('button', {
            class: 'letter-chip',
            dataset: { taught: String(Boolean(getState().hand[item])), current: String(i === index) },
            onClick: () => {
              index = i;
              render();
            },
          }, item),
        ),
      ),
    );
  }

  render();
  return root;
}
