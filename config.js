// config.js — single source of truth for all settings + feature flags
module.exports = {
  // ─── Environment ───
  testnet: process.env.BYBIT_TESTNET !== 'false',
  paperTrading: process.env.PAPER_TRADING === 'true',

  // ─── Symbols (v1) ───
  symbols: ['BTCUSDT', 'ETHUSDT'],

  // ─── Timeframes (Bybit interval strings) ───
  timeframe: '15',        // M15
  htfTimeframe: '240',    // H4
  klinesLimit: 300,

  // ─── Timing ───
  tickIntervalMs: 3000,
  slowLoopIntervalMs: 300_000,

  // ─── Risk ───
  riskPerTradePercent: 0.5,
  riskHardShieldUSD: 500,
  maxRiskAbsoluteMultiplier: 1.5,
  minDollarRiskPerTrade: 5,
  maxAggregateRiskPercent: 3,
  maxLotCap: 0,

  // ─── Position limits ───
  maxOpenTradesPerSymbol: 5,
  maxTotalOpenPositions: 8,

  // ─── SL / TP ───
  atrPeriod: 14,
  riskRatio: 1.5,
  profitRatio: 4.5,
  minSlPercentOfPrice: 0.2,
  slAdaptiveMinMult: 0.75,
  slAdaptiveMaxMult: 1.50,

  // ─── Break-even ───
  enableBreakEven: true,
  breakEvenPercent: 50,

  // ─── Trailing ───
  enableAtrTrailing: true,
  atrTrailMultiplier: 1.5,
  trailingStartPercent: 75,

  // ─── Partial close (OFF matches your MQL5 default) ───
  enablePartialClose: false,
  tp1RRRatio: 1.5,
  tp2RRRatio: 3.0,

  // ─── Stealth SL ───
  enableStealthSl: true,
  stealthEmergencyMultiplier: 2.5,

  // ─── Safety ───
  floatingDdLimitPercent: 3.0,
  dailyLossLimitPercent: 5.0,
  symbolCooldownMinutes: 30,
  hardBlockCooldownMinutes: 60,
  hardBlockCooldownMultiplier: 2,
  consecutiveLossGovernor: { 2: 0.70, 3: 0.40, 4: 0.0 },
  maxSpreadPoints: 40,

  // ─── Strategy ───
  minConfidenceScore: 65,
  enableSmcStrategies: true,
  enableHtfBiasFilter: true,
  enableAiTrendSensor: true,
  enableTrendStack: true,
  trendStackMinScore: 2,

  // ─── Sessions (always allowed per your choice; modifiers still apply) ───
  enableSessionFilter: false,
  sessionRiskModifiers: {
    ASIAN: 0.75,
    LONDON: 0.95,
    NEW_YORK: 1.05,
    OVERLAP: 1.20,
    CLOSED: 1.00,
  },

  // ─── Feature flags ───
  features: {
    claudeAi: false,
    hedgeSystem: false,
    propFirmMode: false,
    newsFilter: false,
    dnaLearning: true,
    multiPairScanner: true,
    cloudReporting: true,
    telegramAlerts: true,
    postgresWrites: true,
  },

  // ─── Cloud ───
  railwayUrl: process.env.RAILWAY_URL || '',

  // ─── Tier (live only) ───
  enableTierCheck: false,
};
