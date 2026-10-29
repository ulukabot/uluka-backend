// lib/bybit.js
const crypto = require('crypto');

class BybitClient {
  constructor({ apiKey, apiSecret, testnet = false, demo = false, recvWindow = 5000 }) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.testnet = testnet;
    this.demo = demo;
    this.recvWindow = recvWindow;

    if (this.testnet) {
      this.baseUrl = 'https://api-testnet.bybit.com';
    } else if (this.demo) {
      this.baseUrl = 'https://api-demo.bybit.com'; 
    } else {
      this.baseUrl = 'https://api.bytick.com'; 
    }
  }

  _sign(timestamp, paramStr) {
    const toSign = timestamp + this.apiKey + this.recvWindow + paramStr;
    return crypto.createHmac('sha256', this.apiSecret).update(toSign).digest('hex');
  }

  async _request(method, path, params = {}) {
    const timestamp = Date.now().toString();
    let url = this.baseUrl + path;
    let body = null;
    let signStr;

    if (method === 'GET') {
      const qs = Object.keys(params)
        .filter(k => params[k] !== undefined && params[k] !== null)
        .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
        .join('&');
      if (qs) url += '?' + qs;
      signStr = qs;
    } else {
      body = JSON.stringify(params);
      signStr = body;
    }

    const headers = {
      'X-BAPI-API-KEY': this.apiKey,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': this.recvWindow.toString(),
      'X-BAPI-SIGN': this._sign(timestamp, signStr),
    };
    if (method !== 'GET') headers['Content-Type'] = 'application/json';

    const res = await fetch(url, { method, headers, body });
    const text = await res.text();
    
    try {
      const json = JSON.parse(text);
      if (json.retCode !== 0) throw new Error(`Bybit ${path}: ${json.retMsg}`);
      return json.result;
    } catch (e) {
      throw new Error(`Invalid JSON from Bybit: ${text.substring(0, 50)}`);
    }
  }

  async _publicGet(path) {
    const url = this.baseUrl + path;
    const res = await fetch(url, { method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0' } });
    const text = await res.text();

    try {
      const json = JSON.parse(text);
      if (json.retCode !== 0) throw new Error(`Bybit public ${path}: ${json.retMsg}`);
      return json.result;
    } catch (parseError) {
      console.error(`❌ [Bybit API Error] Raw Response:`, text.substring(0, 100));
      throw new Error(`Invalid JSON response from Bybit.`);
    }
  }

  async getServerTime()      { return this._publicGet('/v5/market/time'); }
  async getTicker(symbol)    { return (await this._publicGet(`/v5/market/tickers?category=linear&symbol=${symbol}`)).list[0]; }
  async getInstrumentsInfo(symbol) { return (await this._publicGet(`/v5/market/instruments-info?category=linear&symbol=${symbol}`)).list[0]; }
  async getKlines({ symbol, interval, limit = 200 }) {
    const r = await this._publicGet(`/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${limit}`);
    return r.list;
  }

  async getBalance()                    { return this._request('GET', '/v5/account/wallet-balance', { accountType: 'UNIFIED' }); }
  async getPositions(symbol)            { const p = { category: 'linear' }; if (symbol) p.symbol = symbol; return this._request('GET', '/v5/position/list', p); }
  async getClosedPnl({ symbol, orderId }) { return this._request('GET', '/v5/position/closed-pnl', { category: 'linear', symbol, orderId }); }

  async placeOrder({ symbol, side, orderType = 'Market', qty, price, stopLoss, takeProfit, reduceOnly = false, positionIdx = 0 }) {
    const params = { category: 'linear', symbol, side, orderType, qty: qty.toString(), positionIdx };
    if (orderType === 'Limit' && price) params.price = price.toString();
    if (stopLoss)    params.stopLoss    = stopLoss.toString();
    if (takeProfit)  params.takeProfit  = takeProfit.toString();
    if (reduceOnly)  params.reduceOnly  = true;
    return this._request('POST', '/v5/order/create', params);
  }

  async setTradingStop({ symbol, positionIdx = 0, stopLoss, takeProfit, trailingStop }) {
    const params = { category: 'linear', symbol, positionIdx, tpslMode: 'Full', slTriggerBy: 'MarkPrice' };
    if (stopLoss     !== undefined) params.stopLoss     = stopLoss     === 0 ? '0' : stopLoss.toString();
    if (takeProfit   !== undefined) params.takeProfit   = takeProfit   === 0 ? '0' : takeProfit.toString();
    if (trailingStop !== undefined) params.trailingStop = trailingStop === 0 ? '0' : trailingStop.toString();
    return this._request('POST', '/v5/position/trading-stop', params);
  }

  async closePosition({ symbol, positionSide, qty }) {
    const closeSide = positionSide === 'Buy' ? 'Sell' : 'Buy';
    return this.placeOrder({ symbol, side: closeSide, qty, orderType: 'Market', reduceOnly: true });
  }
}

module.exports = BybitClient;