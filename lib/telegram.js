// lib/telegram.js
async function sendMessage(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'HTML' })
    });
  } catch (err) {
    console.error('Telegram Error:', err.message);
  }
}

async function sendWebhook(payload) {
  const backendUrl = process.env.RAILWAY_URL || 'https://uluka-backend-production.up.railway.app';
  try {
    const res = await fetch(backendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.text();
    console.log(`📡 Webhook response: ${data}`);
  } catch (err) {
    console.error('❌ Webhook failed:', err.message);
  }
}

module.exports = { sendMessage, sendWebhook };