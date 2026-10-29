require('dotenv').config();
const tg = require('./lib/telegram');

async function testWebhook() {
  console.log('Sending test CRYPTO signal to Forex backend...');
  
  await tg.sendWebhook({
    type: 'TRADE_SIGNAL',
    source: 'MASTER',
    asset_class: 'CRYPTO', // Tells the backend it's crypto
    action: 'BUY',
    symbol: 'BTCUSDT',
    strategy: 'Order Block',
    session: 'Asian',
    confidence: 75,
    entry: 81000.50,
    sl: 80500.00,
    tp1: 82000.00, rr1: '1.5',
    tp2: 83000.00, rr2: '3.0',
    tp3: 84000.00, rr3: '4.5',
    lot: 0.05,
    risk: 0.5,
    ticket: 'TEST-123',
    time: new Date().toISOString().slice(0,16).replace('T',' ')
  });
  
  console.log('Done! Check your Premium and Free Telegram channels.');
}

testWebhook();