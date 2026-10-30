// lib/telegram.js

// Helper for fetching with timeout and retries
async function fetchWithRetry(url, options, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10-second timeout

      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          ...(options.headers || {})
        }
      });
      
      clearTimeout(timeoutId);
      return res;
    } catch (err) {
      console.log(`⚠️ Network request failed (Attempt ${i + 1}/${retries}): ${err.message}`);
      if (i === retries - 1) throw err; // Throw on last attempt
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s before retry
    }
  }
}

async function sendMessage(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  
  try {
    const res = await fetchWithRetry(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'HTML' })
    });
    
    if (!res.ok) {
      const errText = await res.text();
      console.error(`❌ Telegram API Error (${res.status}): ${errText}`);
    }
  } catch (err) {
    console.error('❌ Telegram Error: Failed after 3 attempts:', err.message);
  }
}

async function sendWebhook(payload) {
  const backendUrl = process.env.RAILWAY_URL || 'https://uluka-backend-production.up.railway.app';
  try {
    const res = await fetchWithRetry(backendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.text();
    console.log(`📡 Webhook response: ${data}`);
  } catch (err) {
    console.error('❌ Webhook failed after 3 attempts:', err.message);
  }
}

module.exports = { sendMessage, sendWebhook };
