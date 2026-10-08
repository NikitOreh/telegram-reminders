export const TIMER_CHOICES = [
  { text: '15 мин', minutes: 15 },
  { text: '30 мин', minutes: 30 },
  { text: '1 час', minutes: 60 },
  { text: '1 час 30 мин', minutes: 90 },
  { text: '2 часа', minutes: 120 },
  { text: '6 часов', minutes: 360 },
  { text: '10 часов', minutes: 600 }
];

export function timerKeyboard(prefix, back) {
  const choices = TIMER_CHOICES.map(({ text, minutes }) => ({ text, callback_data: `${prefix}:${minutes}` }));
  return { inline_keyboard: [
    choices.slice(0, 2),
    choices.slice(2, 4),
    choices.slice(4, 6),
    choices.slice(6),
    [{ text: 'Не удалять', callback_data: `${prefix}:none` }, { text: 'Другое время', callback_data: `${prefix}:custom` }],
    [{ text: '← Назад', callback_data: back }]
  ] };
}
