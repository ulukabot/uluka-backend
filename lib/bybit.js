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

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Bybit ${method} ${path}: non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }
    if (json.retCode !== 0) {
      const err = new Error(`Bybit ${method} ${path} [retCode ${json.retCode}]: ${json.retMsg}`);
      err.retCode = json.retCode;
      err.retMsg  = json.retMsg;
      err.bybit   = json;
      throw err;
    }
    return json.result;
  }

  async _publicGet(path) {
    const url = this.baseUrl + path;
    const res = await fetch(url, { method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0' } });
    const text = await res.text();

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      console.error('❌ [Bybit public] Raw:', text.substring(0, 100));
      throw new Error(`Bybit public ${path}: non-JSON (HTTP ${res.status})`);
    }
    if (json.retCode !== 0) {
      const err = new Error(`Bybit public ${path} [retCode ${json.retCode}]: ${json.retMsg}`);
      err.retCode = json.retCode;
      err.retMsg  = json.retMsg;
      throw err;
    }
    return json.result;
  }

  async getTicker(symbol) {
    const r = await this._publicGet(`/v5/market/tickers?category=linear&symbol=${symbol}`);
    if (!r?.list || !Array.isArray(r.list) || r.list.length === 0) return null;
    return r.list[0];
  }

  async getInstrumentsInfo(symbol) { 
    const r = await this._publicGet(`/v5/market/instruments-info?category=linear&symbol=${symbol}`);
    if (!r?.list || !Array.isArray(r.list) || r.list.length === 0) return null;
    return r.list[0]; 
  }

  async getKlines({ symbol, interval, limit = 200 }) {
    const r = await this._publicGet(`/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${limit}`);
    if (!r?.list || !Array.isArray(r.list)) return [];
    return r.list;
  }

    async getBalance() {
    try {
      const res = await this._request('GET', '/v5/account/wallet-balance', { accountType: 'UNIFIED' });
      
      // Bybit v5 structure: res.result.list[0].coin[]
      const coinList = res?.result?.list?.[0]?.coin || [];
      const usdt = coinList.find(c => c.coin === 'USDT');

      return {
        totalEquity: parseFloat(usdt?.equity || 0),
        availableMargin: parseFloat(usdt?.availableToWithdraw || 0), // This is the Free Margin!
        usedMargin: parseFloat(usdt?.totalPositionIM || 0)
      };
    } catch (err) {
      console.error('❌ Failed to fetch wallet balance:', err.message);
      return { totalEquity: 0, availableMargin: 0, usedMargin: 0 };
    }
  }

        async getPositionInfo({ symbol, settleCoin } = {}) { 
    const params = { category: 'linear' };
    if (symbol) params.symbol = symbol;
    if (settleCoin) params.settleCoin = settleCoin;
    return this._request('GET', '/v5/position/list', params); 
  }
  async getClosedPnl({ symbol, orderId }) { 
    return this._request('GET', '/v5/position/closed-pnl', { category: 'linear', symbol, orderId }); 
  }

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
  
  async setLeverage({ symbol, buyLeverage, sellLeverage }) {
    return this._request('POST', '/v5/position/set-leverage', {
      category: 'linear', symbol,
      buyLeverage: buyLeverage.toString(),
      sellLeverage: sellLeverage.toString()
    });
  }
}

module.exports = BybitClient;
