// The lesson screen: a sheet of ruled paper that fills up as you answer.
//
// Answers written by hand are checked on their own, shortly after the pen stops —
// no button to press, which is the whole point. When the reading is not confident
// enough to judge, the app says so instead of guessing at the learner's expense.

import { buildLexicon, readInk } from '../ink/decode.js';
import { InkLine } from '../ink/surface.js';
import { answerWords, findUnit } from '../data/lessons.js';
import { COMMON_WORDS } from '../data/lexicon.js';
import { iconMarkup } from '../data/icons.js';
import { pick, t } from '../i18n.js';
import { getState, setSetting, taskDone, unitFinished, unitProgress, resetUnit } from '../state.js';
import { clear, h, sentence } from './dom.js';

const IDLE_BEFORE_CHECK = 1200; // ms after the pen stops — people pause between letters
const BASE_LEXICON = [...new Set([...answerWords(), ...COMMON_WORDS])];

const normalise = (text) =>
  String(text).toLowerCase().replace(/[’]/g, "'").replace(/[^a-z' ]/g, '').replace(/\s+/g, ' ').trim();

function accepts(task, text) {
  const wanted = [task.answer, ...(task.accept || [])].map(normalise);
  return wanted.includes(normalise(text));
}

export function lessonScreen(unitId, { recognizer, navigate }) {
  const unit = findUnit(unitId);
  if (!unit) {
    navigate('#/');
    return h('div');
  }

  const progress = unitProgress(unitId);
  const state = { index: 0, right: 0, answered: [] };
  const root = h('div', { class: 'screen lesson' });
  const rows = h('ol', { class: 'rows' });
  const bar = h('div', { class: 'progress-fill' });
  const dock = h('div', { class: 'dock' });

  const xpChip = h('div', { class: 'xp-chip' }, `${getState().xp} ${t('xp')}`);
  const paper = h('main', { class: 'paper' }, h('div', { class: 'paper-inner' }, rows));

  root.append(
    h(
      'header',
      { class: 'topbar' },
      h('button', { class: 'icon-button', onClick: () => navigate('#/'), title: t('back') }, '←'),
      h(
        'div',
        { class: 'topbar-main' },
        h('div', { class: 'topbar-title' }, pick(unit.title)),
        h('div', { class: 'progress' }, bar),
      ),
      xpChip,
    ),
    paper,
    dock,
  );

  function updateProgress() {
    bar.style.width = `${(state.index / unit.tasks.length) * 100}%`;
  }

  function advance() {
    state.index++;
    if (state.index >= unit.tasks.length) {
      unitFinished(unitId);
      showResult();
      return;
    }
    updateProgress();
    renderRow(unit.tasks[state.index]);
  }

  function showResult() {
    updateProgress();
    clear(dock);
    const perfect = state.right === unit.tasks.length;
    rows.append(
      h(
        'li',
        { class: 'row result' },
        h('div', { class: 'result-card' },
          h('div', { class: 'result-mark' }, perfect ? '★' : '✓'),
          h('h2', {}, t('unitDone')),
          h('p', { class: 'result-score' }, t('score', state.right, unit.tasks.length)),
          h('div', { class: 'result-actions' },
            h('button', { class: 'button ghost', onClick: () => { resetUnit(unitId); navigate(`#/lesson/${unitId}`, true); } }, t('again')),
            h('button', { class: 'button', onClick: () => navigate('#/') }, t('home')),
          ),
        ),
      ),
    );
    paper.scrollTo({ top: paper.scrollHeight, behavior: 'smooth' });
  }

  /** Freeze the row that was just answered and move on. */
  function completeRow(row, task, wasRight) {
    row.el.dataset.state = wasRight ? 'right' : 'wrong';
    row.line?.lock();
    row.controls?.remove();
    row.tick.textContent = wasRight ? '✓' : '✗';
    row.tick.dataset.state = wasRight ? 'right' : 'wrong';
    if (wasRight) {
      state.right++;
      taskDone(unitId, task.id);
      xpChip.textContent = `${getState().xp} ${t('xp')}`;
    }
    state.answered.push({ task, wasRight });
    setTimeout(advance, wasRight ? 700 : 1400);
  }

  function renderRow(task) {
    const number = state.index + 1;
    const tick = h('span', { class: 'tick' }, '');
    const status = h('div', { class: 'status' });
    const body = h('div', { class: 'row-body' });
    const el = h(
      'li',
      { class: 'row active', dataset: { type: task.type } },
      h('div', { class: 'row-mark' }, tick, h('span', { class: 'num' }, `${number})`)),
      body,
    );
    rows.append(el);
    const row = { el, tick, status, task };

    if (task.type === 'choice') renderChoice(row, body, status);
    else if (task.type === 'order') renderOrder(row, body, status);
    else renderWriting(row, body, status);

    paper.scrollTo({ top: paper.scrollHeight, behavior: 'smooth' });
  }

  // — tap-based tasks ————————————————————————————————————————

  function renderChoice(row, body, status) {
    const task = row.task;
    body.append(h('p', { class: 'prompt' }, ...sentence(task.prompt, '?')), translation(task));
    const options = h('div', { class: 'options' });
    for (const option of task.options) {
      options.append(
        h('button', {
          class: 'option',
          onClick: (event) => {
            const right = normalise(option) === normalise(task.answer);
            event.currentTarget.dataset.state = right ? 'right' : 'wrong';
            options.querySelectorAll('button').forEach((b) => (b.disabled = true));
            status.append(feedback(right, task, right ? null : task.answer));
            completeRow(row, task, right);
          },
        }, option),
      );
    }
    row.controls = options;
    body.append(options, status);
    clear(dock);
  }

  function renderOrder(row, body, status) {
    const task = row.task;
    const chosen = [];
    const answerBox = h('div', { class: 'assembled' });
    const pool = h('div', { class: 'options' });

    const refresh = () => {
      clear(answerBox);
      chosen.forEach((word, i) =>
        answerBox.append(
          h('button', {
            class: 'chip',
            onClick: () => {
              chosen.splice(i, 1);
              refresh();
            },
          }, word),
        ),
      );
      if (!chosen.length) answerBox.append(h('span', { class: 'placeholder' }, t('tapToOrder')));
      checkButton.disabled = chosen.length !== task.words.length;
    };

    for (const word of task.words) {
      pool.append(
        h('button', {
          class: 'option',
          onClick: (event) => {
            chosen.push(word);
            event.currentTarget.disabled = true;
            refresh();
          },
        }, word),
      );
    }

    const checkButton = h('button', {
      class: 'button',
      disabled: true,
      onClick: () => {
        const right = accepts(task, chosen.join(' '));
        pool.querySelectorAll('button').forEach((b) => (b.disabled = true));
        status.append(feedback(right, task, right ? null : task.answer));
        completeRow(row, task, right);
      },
    }, t('check'));

    body.append(h('p', { class: 'prompt' }, pick({ en: 'Make a sentence', ru: 'Собери предложение' })), translation(task), answerBox, pool, status);
    row.controls = pool;
    refresh();
    clear(dock);
    dock.append(h('div', { class: 'dock-inner' }, checkButton));
  }

  // — handwriting tasks ——————————————————————————————————————

  function renderWriting(row, body, status) {
    const task = row.task;
    const settings = getState().settings;

    if (task.type === 'write') {
      body.append(
        h('div', { class: 'picture', html: iconMarkup(task.icon) }),
        h('p', { class: 'prompt' }, t('writeWord')),
        translation(task),
      );
    } else {
      body.append(h('p', { class: 'prompt' }, ...sentence(task.prompt, task.cue ? `(${task.cue})` : '')), translation(task));
    }

    const line = new InkLine({
      height: 104,
      tool: settings.tool,
      onChange: () => scheduleCheck(),
    });
    line.setTool(settings.tool);
    row.line = line;

    const typed = h('input', {
      class: 'typed',
      type: 'text',
      autocomplete: 'off',
      autocapitalize: 'off',
      autocorrect: 'off',
      spellcheck: false,
      placeholder: t('typeHere'),
      onKeyDown: (event) => {
        if (event.key === 'Enter') check({ manual: true });
      },
    });

    const inkWrap = h('div', { class: 'writing' }, line.el);
    body.append(inkWrap, typed, status);
    body.dataset.input = settings.input;

    let timer = null;
    let attempts = 0;
    let settled = false;

    function scheduleCheck() {
      clearTimeout(timer);
      // Writing again withdraws the previous reading.
      delete row.el.dataset.state;
      status.dataset.state = 'thinking';
      timer = setTimeout(() => check({ manual: false }), IDLE_BEFORE_CHECK);
    }

    function check({ manual }) {
      if (settled) return;
      clearTimeout(timer);

      if (getState().settings.input === 'type') {
        if (!typed.value.trim()) return;
        const right = accepts(task, typed.value);
        settled = true;
        clear(status).append(feedback(right, task, right ? null : task.answer));
        completeRow(row, task, right);
        return;
      }

      if (line.isEmpty()) return;
      const lexicon = buildLexicon(task, BASE_LEXICON);
      const reading = readInk(line.templateStrokes(), recognizer, lexicon, task.answer);
      attempts++;

      if (reading.verdict === 'correct') {
        settled = true;
        clear(status).append(feedback(true, task, null));
        completeRow(row, task, true);
        return;
      }

      if (reading.verdict === 'wrong') {
        if (manual) {
          settled = true;
          clear(status).append(feedback(false, task, task.answer, reading.read));
          completeRow(row, task, false);
          return;
        }
        // Auto-checks fire while the learner may still be writing, so a wrong reading
        // is shown but not recorded: keep writing and it will be read again.
        row.el.dataset.state = 'wrong';
        clear(status).append(feedback(false, task, null, reading.read));
        status.append(
          h('button', {
            class: 'text-button inline',
            onClick: () => {
              settled = true;
              clear(status).append(feedback(false, task, task.answer, reading.read));
              completeRow(row, task, false);
            },
          }, t('showAnswer')),
        );
        return;
      }

      // Not confident enough to judge — say so rather than mark anything.
      clear(status);
      status.dataset.state = 'unsure';
      if (manual || attempts > 1) {
        status.append(
          h('span', { class: 'status-text' }, `⋯ ${t('unsure')}`),
          h('span', { class: 'status-hint' }, t('unsureHint')),
        );
      } else {
        status.append(h('span', { class: 'status-text' }, '⋯'));
      }
    }

    // Tools live in the dock so they stay reachable with a thumb.
    clear(dock);
    const toolButton = (name, label, glyph) =>
      h('button', {
        class: 'tool',
        dataset: { tool: name, active: String(getState().settings.tool === name && getState().settings.input === 'ink') },
        title: label,
        onClick: () => {
          if (getState().settings.input !== 'ink') switchInput('ink');
          setSetting('tool', name);
          line.setTool(name);
          dock.querySelectorAll('.tool').forEach((b) => (b.dataset.active = String(b.dataset.tool === name)));
        },
      }, glyph);

    function switchInput(mode) {
      setSetting('input', mode);
      body.dataset.input = mode;
      inputToggle.textContent = mode === 'ink' ? '⌨' : '✎';
      inputToggle.title = mode === 'ink' ? t('keyboard') : t('ink');
      if (mode === 'type') setTimeout(() => typed.focus(), 50);
    }

    const inputToggle = h('button', {
      class: 'tool wide',
      title: settings.input === 'ink' ? t('keyboard') : t('ink'),
      onClick: () => switchInput(getState().settings.input === 'ink' ? 'type' : 'ink'),
    }, settings.input === 'ink' ? '⌨' : '✎');

    dock.append(
      h(
        'div',
        { class: 'dock-inner' },
        h('div', { class: 'tools' },
          toolButton('pencil', t('pencil'), '✏️'),
          toolButton('pen', t('pen'), '🖋'),
          toolButton('eraser', t('eraser'), '◻'),
          h('button', { class: 'tool', title: t('undo'), onClick: () => line.undo() }, '↺'),
          inputToggle,
        ),
        h('button', { class: 'button', onClick: () => check({ manual: true }) }, t('check')),
      ),
    );
  }

  function feedback(right, task, answer, read) {
    const node = h('div', { class: 'feedback', dataset: { state: right ? 'right' : 'wrong' } });
    node.append(h('span', { class: 'status-text' }, right ? `✓ ${t('correct')}` : `✗ ${t('wrong')}`));
    if (!right && read) node.append(h('span', { class: 'status-hint' }, t('readAs', read)));
    if (!right && answer) node.append(h('span', { class: 'status-answer' }, t('answerIs', answer)));
    const hint = pick(task.hint);
    if (!right && hint) node.append(h('span', { class: 'status-hint' }, hint));
    return node;
  }

  function translation(task) {
    return task.ru ? h('p', { class: 'translation' }, task.ru) : null;
  }

  // Already-finished units start again from the top.
  if (progress.finished) resetUnit(unitId);
  updateProgress();
  renderRow(unit.tasks[0]);
  return root;
}
