export function hiddenText(value, maximum = 200) {
  const text = String(value || '').trim();
  if (!text || Array.from(text).length > maximum) throw new Error(`Пришлите текст от 1 до ${maximum} символов`);
  return text;
}

export function hiddenButton(post) {
  const config = post.hiddenContinuation;
  if (post.buttonMode !== 'hidden' || !config?.id || !config.title || !config.subscriberText || !config.nonSubscriberText) return null;
  return { text: config.title, callback_data: `hidden:${config.id}` };
}

export function isSubscriber(member) {
  return ['creator', 'administrator', 'member'].includes(member?.status) || member?.status === 'restricted' && member.is_member === true;
}

// This is the only public callback; it never invokes editor/admin handlers.
export async function answerHiddenContinuation(callback, { campaigns, jobs, userSessions }, telegram) {
  const token = callback.data?.match(/^hidden:([a-f0-9]{32})$/)?.[1];
  const chatId = callback.message?.chat?.id;
  const userId = callback.from?.id;
  let text = 'Кнопка больше недоступна. Откройте актуальный пост в канале.';
  if (token && Number.isSafeInteger(userId) && userId > 0) {
    const draft = userSessions?.[String(userId)]?.draft;
    if (callback.message?.chat?.type === 'private' && Number(chatId) === userId && draft?.buttonMode === 'hidden' && draft.hiddenContinuation?.id === token) {
      text = draft.hiddenContinuation.subscriberText;
    } else {
      const campaign = campaigns.find(item => item.buttonMode === 'hidden' && item.hiddenContinuation?.id === token &&
        item.channelIds?.some(id => String(id) === String(chatId)) && jobs.some(job => job.campaignId === item.id &&
          String(job.chatId) === String(chatId) && job.messageId === callback.message?.message_id &&
          ['sent', 'published'].includes(job.status) && !(job.kind === 'post' && item.postRemoved)));
      if (campaign) {
        try {
          const member = await telegram('getChatMember', { chat_id: chatId, user_id: userId });
          text = isSubscriber(member) ? campaign.hiddenContinuation.subscriberText : campaign.hiddenContinuation.nonSubscriberText;
        } catch {
          text = 'Не удалось проверить подписку. Попробуйте нажать кнопку ещё раз чуть позже.';
        }
      }
    }
  }
  await telegram('answerCallbackQuery', { callback_query_id: callback.id, text, show_alert: true, cache_time: 0 });
}
