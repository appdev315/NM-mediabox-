const axios = require('axios');
require('dotenv').config();

const BOT_TOKEN = process.env.BOT_TOKEN;

async function test() {
  const invoiceData = {
    title: 'VIP Subscription (1 Month)',
    description: 'Watch movies without ads, directly from our servers.',
    payload: `vip_1month_12345_${Date.now()}`,
    provider_token: '',
    currency: 'XTR',
    prices: [{ label: '1 Month VIP', amount: 75 }]
  };

  try {
    const response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/createInvoiceLink`, invoiceData);
    console.log(response.data);
  } catch(e) {
    console.error(e.response ? e.response.data : e.message);
  }
}
test();
