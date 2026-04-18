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
  // Write to GitHub repo so the Routine can read it
  const REPO = 'Spettacolo83/job-monitor';
  const FILE_PATH = 'data/application_queue.json';
  const cfg = config.get();
  const ghToken = cfg.github_token || process.env.GITHUB_TOKEN;

  if (!ghToken) {
    console.log('GitHub token not configured — saving queue locally only');
    const queue = cfg.application_queue || [];
    queue.push({ job_id: jobId, chat_id: chatId, message_text: messageText, requested_at: new Date().toISOString(), status: 'pending' });
    config.update({ application_queue: queue });
    return;
  }

  try {
    // Get current file from GitHub
    const getFile = await githubApi('GET', `/repos/${REPO}/contents/${FILE_PATH}?ref=main`, null, ghToken);
    const currentContent = JSON.parse(Buffer.from(getFile.content, 'base64').toString());
    const sha = getFile.sha;

    // Add new job to queue
    currentContent.queue.push({
      job_id: jobId,
      chat_id: String(chatId),
      message_text: messageText,
      requested_at: new Date().toISOString(),
      status: 'pending'
    });

    // Update file on GitHub
    const newContent = Buffer.from(JSON.stringify(currentContent, null, 2)).toString('base64');
    await githubApi('PUT', `/repos/${REPO}/contents/${FILE_PATH}`, {
      message: `chore: queue application for ${jobId}`,
      content: newContent,
      sha: sha,
      branch: 'main'
    }, ghToken);

    console.log(`Application queued on GitHub: ${jobId}`);
  } catch (e) {
    console.log(`Failed to queue on GitHub: ${e.message}. Saving locally.`);
    const queue = cfg.application_queue || [];
    queue.push({ job_id: jobId, chat_id: chatId, message_text: messageText, requested_at: new Date().toISOString(), status: 'pending' });
    config.update({ application_queue: queue });
  }
}

function githubApi(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const opts = {
      hostname: 'api.github.com',
      path: path,
      method: method,
      headers: {
        'Authorization': `token ${token}`,
        'User-Agent': 'scraper-proxy',
        'Accept': 'application/vnd.github.v3+json'
      }
    };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(data);
    }

    const req = https.request(opts, (res) => {
      let responseBody = '';
      res.on('data', chunk => responseBody += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseBody);
          if (res.statusCode >= 400) reject(new Error(`GitHub API ${res.statusCode}: ${parsed.message || responseBody}`));
          else resolve(parsed);
        } catch { reject(new Error(`GitHub API: invalid response`)); }
      });
    });
    req.on('error', reject);
    if (body) req.write(data);
    req.end();
  });
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
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'experimental-cc-routine-2026-04-01',
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
    console.log(`Polling getUpdates (offset: ${lastUpdateId + 1})...`);
    const result = await sendTelegramRequest('getUpdates', {
      offset: lastUpdateId + 1,
      timeout: 30,
      allowed_updates: ['callback_query', 'message']
    });

    if (!result) {
      console.log('Polling: null result');
    } else if (!result.ok) {
      console.log(`Polling: not ok: ${JSON.stringify(result)}`);
    } else if (result.result && result.result.length > 0) {
      console.log(`Polling: got ${result.result.length} updates`);
      for (const update of result.result) {
        lastUpdateId = update.update_id;
        try {
          await processUpdate(update);
        } catch (e) {
          console.log(`Error processing update ${update.update_id}: ${e.message}`);
        }
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
