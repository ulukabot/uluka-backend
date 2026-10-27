// lib/bybit.js
const crypto = require('crypto');

class BybitClient {
  constructor({ apiKey, apiSecret, testnet = true, recvWindow = 5000 }) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.testnet = testnet;
    this.baseUrl = testnet ? 'https://api-testnet.bybit.com' : 'https://api.bybit.com';
    this.recvWindow = recvWindow;
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
    const json = await res.json();

    if (json.retCode !== 0) {
      const err = new Error(`Bybit ${path} [${json.retCode}]: ${json.retMsg}`);
      err.retCode = json.retCode;
      err.retMsg = json.retMsg;
      err.response = json;
      throw err;
    }
    return json.result;
  }

  async _publicGet(path) {
    const res = await fetch(this.baseUrl + path);
    const json = await res.json();
    if (json.retCode !== 0) throw new Error(`Bybit public ${path}: ${json.retMsg}`);
    return json.result;
  }

  // ─── Market data (public) ───
  async getServerTime()      { return this._publicGet('/v5/market/time'); }
  async getTicker(symbol)    { return (await this._publicGet(`/v5/market/tickers?category=linear&symbol=${symbol}`)).list[0]; }
  async getInstrumentsInfo(symbol) { return (await this._publicGet(`/v5/market/instruments-info?category=linear&symbol=${symbol}`)).list[0]; }
  async getKlines({ symbol, interval, limit = 200 }) {
    const r = await this._publicGet(`/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${limit}`);
    // Bybit returns newest-first: [startTime, open, high, low, close, volume, turnover]
    return r.list;
  }

  // ─── Account (auth) ───
  async getBalance()                    { return this._request('GET', '/v5/account/wallet-balance', { accountType: 'UNIFIED' }); }
  async getPositions(symbol)            { const p = { category: 'linear' }; if (symbol) p.symbol = symbol; return this._request('GET', '/v5/position/list', p); }
  async getOpenOrders(symbol)           { const p = { category: 'linear' }; if (symbol) p.symbol = symbol; return this._request('GET', '/v5/order/realtime', p); }

  // ─── Trading (auth) ───
  async placeOrder({ symbol, side, orderType = 'Market', qty, price, stopLoss, takeProfit, reduceOnly = false, positionIdx = 0 }) {
    const params = {
      category: 'linear',
      symbol,
      side,
      orderType,
      qty: qty.toString(),
      positionIdx,
    };
    if (orderType === 'Limit' && price) params.price = price.toString();
    if (stopLoss)    params.stopLoss    = stopLoss.toString();
    if (takeProfit)  params.takeProfit  = takeProfit.toString();
    if (reduceOnly)  params.reduceOnly  = true;
    return this._request('POST', '/v5/order/create', params);
  }

  async setTradingStop({ symbol, positionIdx = 0, stopLoss, takeProfit, trailingStop }) {
    const params = { category: 'linear', symbol, positionIdx };
    if (stopLoss     !== undefined) params.stopLoss     = stopLoss     === 0 ? '0' : stopLoss.toString();
    if (takeProfit   !== undefined) params.takeProfit   = takeProfit   === 0 ? '0' : takeProfit.toString();
    if (trailingStop !== undefined) params.trailingStop = trailingStop === 0 ? '0' : trailingStop.toString();
    return this._request('POST', '/v5/position/trading-stop', params);
  }

  // Close a position. `positionSide` is the side of the OPEN position.
  // Internally we send the OPPOSITE side with reduceOnly.
  async closePosition({ symbol, positionSide, qty }) {
    const closeSide = positionSide === 'Buy' ? 'Sell' : 'Buy';
    return this.placeOrder({ symbol, side: closeSide, qty, orderType: 'Market', reduceOnly: true });
  }

  async cancelAllOrders(symbol) {
    return this._request('POST', '/v5/order/cancel-all', { category: 'linear', symbol });
  }
}

module.exports = BybitClient;
