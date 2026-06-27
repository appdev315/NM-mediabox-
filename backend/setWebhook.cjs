const axios = require('axios');
require('dotenv').config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_URL = process.argv[2];

if (!BOT_TOKEN) {
  console.error("Ошибка: BOT_TOKEN не найден в .env файле");
  process.exit(1);
}

if (!WEBHOOK_URL) {
  console.error("Использование: node setWebhook.js <URL>");
  console.error("Пример: node setWebhook.js https://media-box.xyz/api/telegram/webhook");
  process.exit(1);
}

async function setWebhook() {
  try {
    const res = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
      url: WEBHOOK_URL,
      allowed_updates: ["message", "pre_checkout_query", "successful_payment"]
    });
    console.log("Успех:", res.data);
  } catch (e) {
    console.error("Ошибка:", e.response ? e.response.data : e.message);
  }
}

setWebhook();
