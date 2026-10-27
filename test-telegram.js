require('dotenv').config();
const tg = require('./lib/telegram');

async function test() {
  console.log('Sending test message to Telegram...');
  await tg.sendMessage('🤖 <b>Test Message:</b> The Uluka Crypto Bot is online and connected!');
  console.log('Test finished. Check your phone!');
}

test();