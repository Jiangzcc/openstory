import { basename } from 'node:path';

const QUOTES = new Set(['"', "'"]);
const SEPARATORS = new Set([';', '\n', '&', '|']);

function finishWord(state) {
  if (state.hasWord) state.words.push(state.word);
  state.word = '';
  state.hasWord = false;
}

function finishCommand(state) {
  finishWord(state);
  if (state.words.length) state.commands.push(state.words);
  state.words = [];
}

function escaped(state, character, next) {
  if (state.quote === "'") return false;
  if (character === '\u0060') return next !== undefined;
  return character === '\\' && /[\s"'\\]/.test(next ?? '');
}

function quotedCharacter(state, character, next) {
  if (character !== state.quote) {
    state.word += character;
    return 0;
  }
  if (character === "'" && next === "'") {
    state.word += character;
    return 1;
  }
  state.quote = null;
  return 0;
}

function controlCharacter(state, character, next) {
  if (SEPARATORS.has(character)) {
    finishCommand(state);
    return 0;
  }
  if (/\s/.test(character)) {
    finishWord(state);
    return 0;
  }
  if (character === '>' || character === '<') {
    finishWord(state);
    state.words.push(character === next ? character + next : character);
    return character === next ? 1 : 0;
  }
  return undefined;
}

function consumeCharacter(state, character, next) {
  if (state.comment) {
    if (character === '\n') state.comment = false;
    return 0;
  }
  if (escaped(state, character, next)) {
    if (next !== '\n') state.word += next;
    state.hasWord = true;
    return 1;
  }
  if (state.quote) return quotedCharacter(state, character, next);
  if (QUOTES.has(character)) {
    state.quote = character;
    state.hasWord = true;
    return 0;
  }
  if (character === '#' && !state.hasWord) {
    finishCommand(state);
    state.comment = true;
    return 0;
  }
  const consumed = controlCharacter(state, character, next);
  if (consumed !== undefined) return consumed;
  state.word += character;
  state.hasWord = true;
  return 0;
}

export function shellCommands(command) {
  const state = {
    commands: [],
    words: [],
    word: '',
    hasWord: false,
    quote: null,
    comment: false,
  };
  for (let index = 0; index < command.length; index++) {
    index += consumeCharacter(state, command[index], command[index + 1]);
  }
  finishCommand(state);
  return state.commands;
}

export function commandName(executable = '') {
  return basename(executable.replaceAll('\\', '/'))
    .replace(/\.(?:exe|cmd|ps1)$/i, '')
    .replace(/@[^/]+$/, '')
    .toLowerCase();
}
