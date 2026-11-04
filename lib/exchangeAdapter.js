// lib/exchangeAdapter.js
const { BybitClient } = require('./bybit');

class ExchangeAdapter {
    constructor(exchangeName, credentials) {
        this.exchangeName = exchangeName ? exchangeName.toLowerCase() : 'bybit';
        
        if (this.exchangeName === 'bybit') {
            this.client = new BybitClient({
                apiKey: credentials.apiKey,
                apiSecret: credentials.apiSecret,
                testnet: false,
                demo: process.env.BYBIT_DEMO === 'true'
            });
        }
        // You can add Binance, BingX, etc. here later
    }

    async getPositionInfo(symbol) {
        if (this.exchangeName === 'bybit') {
            return await this.client.getPositionInfo({ symbol });
        }
    }

    async getInstrumentsInfo(symbol) {
        if (this.exchangeName === 'bybit') {
            return await this.client.getInstrumentsInfo(symbol);
        }
    }

    async placeOrder(params) {
        if (this.exchangeName === 'bybit') {
            return await this.client.placeOrder(params);
        }
    }

    async setTradingStop(params) {
        if (this.exchangeName === 'bybit') {
            return await this.client.setTradingStop(params);
        }
    }
}

module.exports = { ExchangeAdapter };
