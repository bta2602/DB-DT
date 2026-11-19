const patronymicEnding = /(?:ович|евич|ич|овна|евна|ична|ұлы|қызы)$/iu;
const familyEnding = /(?:ов|ова|ев|ева|ёв|ёва|ин|ина|ский|ская|цкий|цкая|енко|ян|дзе|швили)$/iu;
const ambiguousFamilyEnding = /(?:ин|ина)$/iu;

export function cleanNamePart(value) {
  return typeof value === 'string' ? value.normalize('NFC').trim().replace(/\s+/gu, ' ') : '';
}

/** The old fixtures stored given name first, with a patronymic before the surname. */
export function splitLegacyName(value) {
  const parts = cleanNamePart(value).split(' ').filter(Boolean);
  if (parts.length < 2) return { givenName: parts[0] || null, familyName: null, patronymic: null };
  const middlePatronymic = parts.length >= 3 && patronymicEnding.test(parts[1]);
  const lastPatronymic = parts.length >= 3 && patronymicEnding.test(parts.at(-1));
  if (middlePatronymic) {
    return { givenName: parts[0], familyName: parts.slice(2).join(' '), patronymic: parts[1] };
  }
  const patronymic = lastPatronymic ? parts.pop() : null;
  const first = parts[0];
  const last = parts.at(-1);
  if (
    familyEnding.test(first) &&
    (!familyEnding.test(last) ||
      (!ambiguousFamilyEnding.test(first) && ambiguousFamilyEnding.test(last)))
  ) {
    return { familyName: parts[0], givenName: parts.slice(1).join(' '), patronymic };
  }
  return { givenName: parts[0], familyName: parts.slice(1).join(' '), patronymic };
}

export function joinUserName({ familyName, givenName, patronymic }) {
  return [familyName, givenName, patronymic].filter(Boolean).join(' ');
}

export const userNameFields = ['familyName', 'givenName', 'patronymic'];
