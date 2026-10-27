// test-bybit.js
require('dotenv').config();
const BybitClient = require('./lib/bybit');

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log(' ULUKA CRYPTO BOT — Bybit Connectivity Test');
  console.log('═══════════════════════════════════════════════\n');

  const apiKey    = process.env.BYBIT_API_KEY;
  const apiSecret = process.env.BYBIT_API_SECRET;
  const testnet   = process.env.BYBIT_TESTNET !== 'false';

  if (!apiKey || !apiSecret) {
    console.error('❌ Missing BYBIT_API_KEY or BYBIT_API_SECRET in .env');
    console.error('   Public endpoints will still be tested below.');
    console.error('   (Balance check will be skipped.)\n');
  } else {
    console.log(`Environment: ${testnet ? 'TESTNET' : '⚠️  LIVE'}`);
    console.log(`API Key: ${apiKey.slice(0, 6)}…${apiKey.slice(-4)}\n`);
  }

  const bybit = new BybitClient({ apiKey, apiSecret, testnet });

  // 1. Server time + clock skew
  try {
    const t = await bybit.getServerTime();
    const serverMs = parseInt(t.timeNano) / 1e6;
    const skew = Math.abs(Date.now() - serverMs);
    console.log(`✅ Server time OK | skew: ${skew.toFixed(0)}ms`);
    if (skew > 1000) console.warn('⚠️  Clock skew > 1s — signatures may fail. Sync your clock.');
  } catch (e) {
    console.error('❌ Server time failed:', e.message);
    process.exit(1);
  }

  // 2. Balance (auth-required)
  if (apiKey && apiSecret) {
    try {
      const bal = await bybit.getBalance();
      const wallet = bal.list[0];
      const usdt = wallet?.coin?.find(c => c.coin === 'USDT');
      console.log(`✅ Balance OK | USDT equity: $${usdt?.walletBalance ?? '0'}`);
    } catch (e) {
      console.error('❌ Balance failed:', e.message);
      if (e.retCode) console.error(`   retCode=${e.retCode} retMsg=${e.retMsg}`);
    }
  } else {
    console.log('⏭️  Balance skipped (no API key)');
  }

  // 3. Ticker
  try {
    const t = await bybit.getTicker('BTCUSDT');
    console.log(`✅ Ticker OK | BTC last: $${parseFloat(t.lastPrice).toFixed(2)}`);
  } catch (e) {
    console.error('❌ Ticker failed:', e.message);
  }

  // 4. Klines
  try {
    const kl = await bybit.getKlines({ symbol: 'BTCUSDT', interval: '15', limit: 3 });
    console.log(`✅ Klines OK | last 3 M15 candles:`);
    kl.slice(0, 3).forEach(k => {
      console.log(`   ${new Date(parseInt(k[0])).toISOString()}  O:${k[1]}  H:${k[2]}  L:${k[3]}  C:${k[4]}`);
    });
  } catch (e) {
    console.error('❌ Klines failed:', e.message);
  }

  // 5. Instrument info
  try {
    const info = await bybit.getInstrumentsInfo('BTCUSDT');
    console.log(`✅ Instrument OK | BTCUSDT | tickSize:${info.priceFilter.tickSize} | qtyStep:${info.lotSizeFilter.qtyStep} | minQty:${info.lotSizeFilter.minOrderQty}`);
  } catch (e) {
    console.error('❌ Instrument failed:', e.message);
  }

  // 6. ETH ticker
  try {
    const t = await bybit.getTicker('ETHUSDT');
    console.log(`✅ ETH ticker OK | last: $${parseFloat(t.lastPrice).toFixed(2)}`);
  } catch (e) {
    console.error('❌ ETH ticker failed:', e.message);
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log(' All checks complete.');
  console.log('═══════════════════════════════════════════════');
}

main().catch(e => {
  console.error('\n💥 Fatal error:', e.message);
  process.exit(1);
});
