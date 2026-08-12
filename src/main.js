// Wiring: one recognizer for the whole session, a hash router, three screens.

import { deslant, estimateSlant } from './ink/geometry.js';
import { Recognizer } from './ink/recognizer.js';
import { getState } from './state.js';
import { calibrateScreen } from './ui/calibrate.js';
import { homeScreen } from './ui/home.js';
import { lessonScreen } from './ui/lesson.js';
import { clear } from './ui/dom.js';

const app = document.getElementById('app');
const recognizer = new Recognizer();

/**
 * Load the learner's own letterforms. They are straightened with one slant measured
 * across everything they wrote, because that is what the reader does to their ink too.
 */
function reloadHand() {
  const hand = getState().hand;
  recognizer.clearUserTemplates();
  const everything = Object.values(hand).flat().flat();
  if (!everything.length) return;
  const slant = estimateSlant(everything);
  for (const [letter, strokeSets] of Object.entries(hand)) {
    recognizer.setUserTemplates(letter, strokeSets.map((strokes) => deslant(strokes, slant)));
  }
}

function navigate(hash, replace = false) {
  if (replace && location.hash === hash) render();
  if (replace) history.replaceState(null, '', hash);
  else location.hash = hash;
  if (replace) render();
}

function render() {
  const route = location.hash || '#/';
  const context = { recognizer, navigate, reloadHand };
  clear(app);

  const lesson = route.match(/^#\/lesson\/([\w-]+)$/);
  if (lesson) app.append(lessonScreen(lesson[1], context));
  else if (route.startsWith('#/handwriting')) app.append(calibrateScreen(context));
  else app.append(homeScreen(context));

  document.body.dataset.route = route;
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', render);

reloadHand();
render();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Offline support is a bonus; the app runs fine without it.
    });
  });
}
