const https = require('https');
const config = require('./config');

function sendTelegramRequest(method, body) {
  const cfg = config.get();
  const token = cfg.telegram_bot_token || process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log('Telegram bot token not configured');
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${token}/` + method,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      let responseBody = '';
      res.on('data', chunk => responseBody += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(responseBody)); } catch { resolve(null); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function handleWebhook(req, res) {
  const update = req.body;

  if (update.callback_query) {
    const callbackData = update.callback_query.data;
    const chatId = update.callback_query.message.chat.id;
    const messageId = update.callback_query.message.message_id;

    console.log(`Telegram callback: ${callbackData} from chat ${chatId}`);

    if (callbackData.startsWith('apply_')) {
      const jobId = callbackData.replace('apply_', '');

      await sendTelegramRequest('answerCallbackQuery', {
        callback_query_id: update.callback_query.id,
        text: 'Candidatura in coda!'
      });

      await sendTelegramRequest('editMessageReplyMarkup', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [[{ text: '📝 In coda...', callback_data: 'noop' }]] }
      });

      await queueApplication(jobId, chatId, update.callback_query.message.text);

    } else if (callbackData.startsWith('ignore_')) {
      await sendTelegramRequest('answerCallbackQuery', {
        callback_query_id: update.callback_query.id,
        text: 'Ignorato'
      });
      await sendTelegramRequest('editMessageReplyMarkup', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [[{ text: '❌ Ignorato', callback_data: 'noop' }]] }
      });

    } else if (callbackData === 'noop') {
      await sendTelegramRequest('answerCallbackQuery', {
        callback_query_id: update.callback_query.id
      });
    }
  }

  if (update.message && update.message.text && update.message.reply_to_message) {
    const chatId = update.message.chat.id;
    const responseText = update.message.text;
    const originalMessage = update.message.reply_to_message.text || '';

    console.log(`Telegram response: "${responseText}" to question`);

    await storeUserResponse(chatId, responseText, originalMessage);

    await sendTelegramRequest('sendMessage', {
      chat_id: chatId,
      text: '✅ Risposta salvata! La candidatura riprenderà a breve.',
      reply_to_message_id: update.message.message_id
    });
  }

  res.json({ ok: true });
}

async function queueApplication(jobId, chatId, messageText) {
  const cfg = config.get();
  const queue = cfg.application_queue || [];

  queue.push({
    job_id: jobId,
    chat_id: chatId,
    message_text: messageText,
    requested_at: new Date().toISOString(),
    status: 'pending'
  });

  config.update({ application_queue: queue });
  console.log(`Application queued: ${jobId}`);
}

async function storeUserResponse(chatId, response, originalQuestion) {
  const cfg = config.get();
  const pendingResponses = cfg.pending_responses || [];

  pendingResponses.push({
    chat_id: chatId,
    response,
    original_question: originalQuestion,
    timestamp: new Date().toISOString()
  });

  config.update({ pending_responses: pendingResponses });
}

async function registerWebhook(webhookUrl) {
  const result = await sendTelegramRequest('setWebhook', {
    url: webhookUrl,
    allowed_updates: ['callback_query', 'message']
  });
  console.log('Webhook registration:', result);
  return result;
}

module.exports = { handleWebhook, registerWebhook, sendTelegramRequest };
