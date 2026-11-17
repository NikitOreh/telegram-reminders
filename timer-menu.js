export const TIMER_CHOICES = [
  { text: '15 мин', minutes: 15 },
  { text: '20 мин', minutes: 20 },
  { text: '30 мин', minutes: 30 },
  { text: '1 час', minutes: 60 },
  { text: '1 час 30 мин', minutes: 90 },
  { text: '2 часа', minutes: 120 },
  { text: '3 часа', minutes: 180 },
  { text: '5 часов', minutes: 300 },
  { text: '6 часов', minutes: 360 },
  { text: '10 часов', minutes: 600 }
];

export function timerKeyboard(prefix, back) {
  const choices = TIMER_CHOICES.map(({ text, minutes }) => ({ text, callback_data: `${prefix}:${minutes}` }));
  const rows = [];
  for (let i = 0; i < choices.length; i += 2) rows.push(choices.slice(i, i + 2));
  return { inline_keyboard: [
    ...rows,
    [{ text: 'Не удалять', callback_data: `${prefix}:none` }, { text: 'Другое время', callback_data: `${prefix}:custom` }],
    [{ text: '← Назад', callback_data: back }]
  ] };
}
