// Interface strings. The lessons are in English; the chrome around them speaks the
// learner's language.

import { getState, setSetting } from './state.js';

const STRINGS = {
  ru: {
    appName: 'Grammar Ink',
    tagline: 'Пиши ответ от руки — проверю сам',
    continue: 'Продолжить',
    lessons: 'Уроки',
    xp: 'очки',
    streak: 'дней подряд',
    handwriting: 'Настроить почерк',
    handLetters: 'букв почерка',
    handwritingDone: (n) => `Почерк настроен: ${n} из 26 букв`,
    handwritingHint: 'Напиши каждую букву один раз — приложение запомнит твой почерк и станет читать точнее.',
    handwritingSave: 'Запомнить',
    handwritingSkip: 'Пропустить',
    handwritingReset: 'Сбросить почерк',
    handwritingIntro: 'Это необязательно, но сильно помогает: своим буквам приложение доверяет больше, чем встроенным образцам.',
    writeWord: 'Напиши слово',
    check: 'Проверить',
    correct: 'Верно!',
    wrong: 'Не то',
    readAs: (text) => `Прочитал: «${text}»`,
    unsure: 'Не разобрал почерк',
    unsureHint: 'Пиши печатными буквами, крупнее и с промежутками.',
    showAnswer: 'Показать ответ',
    iWroteRight: 'Я написал правильно',
    learned: 'Запомнил, как ты пишешь эти буквы',
    answerIs: (text) => `Правильно: ${text}`,
    pencil: 'Карандаш',
    pen: 'Ручка',
    eraser: 'Ластик',
    undo: 'Отменить',
    clear: 'Стереть всё',
    keyboard: 'Клавиатура',
    ink: 'От руки',
    typeHere: 'Введи ответ',
    unitDone: 'Урок пройден',
    score: (right, total) => `${right} из ${total}`,
    again: 'Пройти заново',
    home: 'К урокам',
    back: 'Назад',
    offline: 'Работает без интернета',
    tapToOrder: 'Нажимай слова по порядку',
  },
  en: {
    appName: 'Grammar Ink',
    tagline: 'Write the answer by hand — it checks itself',
    continue: 'Continue',
    lessons: 'Lessons',
    xp: 'points',
    streak: 'day streak',
    handwriting: 'Teach your handwriting',
    handLetters: 'letters taught',
    handwritingDone: (n) => `Handwriting taught: ${n} of 26 letters`,
    handwritingHint: 'Write each letter once — the app will remember your hand and read you better.',
    handwritingSave: 'Remember',
    handwritingSkip: 'Skip',
    handwritingReset: 'Forget my handwriting',
    handwritingIntro: 'Optional, but it helps a lot: your own letterforms outrank the built-in ones.',
    writeWord: 'Write the word',
    check: 'Check',
    correct: 'Correct!',
    wrong: 'Not quite',
    readAs: (text) => `Read as “${text}”`,
    unsure: 'Could not read that',
    unsureHint: 'Print the letters, a bit bigger, with gaps between them.',
    showAnswer: 'Show the answer',
    iWroteRight: 'I wrote it correctly',
    learned: 'Noted how you write those letters',
    answerIs: (text) => `Answer: ${text}`,
    pencil: 'Pencil',
    pen: 'Pen',
    eraser: 'Eraser',
    undo: 'Undo',
    clear: 'Clear',
    keyboard: 'Keyboard',
    ink: 'Handwriting',
    typeHere: 'Type the answer',
    unitDone: 'Lesson complete',
    score: (right, total) => `${right} of ${total}`,
    again: 'Do it again',
    home: 'All lessons',
    back: 'Back',
    offline: 'Works offline',
    tapToOrder: 'Tap the words in order',
  },
};

export function lang() {
  return getState().settings.lang === 'en' ? 'en' : 'ru';
}

export function t(key, ...args) {
  const value = STRINGS[lang()][key] ?? STRINGS.ru[key] ?? key;
  return typeof value === 'function' ? value(...args) : value;
}

/** Pick the right side of a {en, ru} pair from the lesson data. */
export function pick(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return value[lang()] || value.en || value.ru || '';
}

export function toggleLanguage() {
  setSetting('lang', lang() === 'ru' ? 'en' : 'ru');
}
