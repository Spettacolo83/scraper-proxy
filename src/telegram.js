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
      await triggerApplicationRoutine(jobId);

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

async function triggerApplicationRoutine(jobId) {
  const cfg = config.get();
  const token = cfg.application_routine_token;
  if (!token) {
    console.log('Application Routine token not configured — skipping trigger');
    return;
  }

  const routineUrl = 'https://api.anthropic.com/v1/claude_code/routines/trig_016xFVeG4ReLFTrZdubpMsuB/fire';

  return new Promise((resolve) => {
    const data = JSON.stringify({});

    const req = https.request(routineUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        console.log(`Application Routine triggered for ${jobId}: ${res.statusCode} ${body.substring(0, 200)}`);
        resolve(true);
      });
    });
    req.on('error', (e) => {
      console.log(`Failed to trigger Application Routine: ${e.message}`);
      resolve(false);
    });
    req.write(data);
    req.end();
  });
}

async function registerWebhook(webhookUrl) {
  const result = await sendTelegramRequest('setWebhook', {
    url: webhookUrl,
    allowed_updates: ['callback_query', 'message']
  });
  console.log('Webhook registration:', result);
  return result;
}

// Long polling fallback — polls Telegram for updates every 2 seconds
// Used when webhook registration fails (e.g., HTTPS issues)
let pollingActive = false;
let lastUpdateId = 0;

async function startPolling() {
  if (pollingActive) return;
  pollingActive = true;

  // Delete any existing webhook first
  await sendTelegramRequest('deleteWebhook', {});
  console.log('Telegram: started long polling');

  pollLoop();
}

async function pollLoop() {
  if (!pollingActive) return;

  try {
    const result = await sendTelegramRequest('getUpdates', {
      offset: lastUpdateId + 1,
      timeout: 30,
      allowed_updates: ['callback_query', 'message']
    });

    if (result && result.ok && result.result && result.result.length > 0) {
      for (const update of result.result) {
        lastUpdateId = update.update_id;
        // Process using the same handler logic
        await processUpdate(update);
      }
    }
  } catch (e) {
    console.log(`Telegram polling error: ${e.message}`);
  }

  // Poll again after a short delay
  setTimeout(pollLoop, 1000);
}

async function processUpdate(update) {
  // Reuse the same logic as handleWebhook but without req/res
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
      await triggerApplicationRoutine(jobId);

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
}

function stopPolling() {
  pollingActive = false;
}

module.exports = { handleWebhook, registerWebhook, sendTelegramRequest, startPolling, stopPolling };
