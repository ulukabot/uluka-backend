-- ============================================================
-- ULUKA CRYPTO BOT — Postgres schema
-- Safe to run: uses IF NOT EXISTS on every object.
-- ============================================================

CREATE TABLE IF NOT EXISTS crypto_trades (
  id             BIGSERIAL PRIMARY KEY,
  exchange       TEXT NOT NULL DEFAULT 'bybit',
  account_id     TEXT,
  symbol         TEXT NOT NULL,
  side           TEXT NOT NULL CHECK (side IN ('BUY','SELL')),
  qty            NUMERIC(20,8) NOT NULL,
  entry_price    NUMERIC(20,8) NOT NULL,
  sl_price       NUMERIC(20,8),
  tp_price       NUMERIC(20,8),
  close_price    NUMERIC(20,8),
  pnl_usd        NUMERIC(14,4),
  pnl_percent    NUMERIC(10,4),
  strategy       TEXT,
  combo_name     TEXT,
  confidence     INTEGER,
  votes          INTEGER,
  session        TEXT,
  regime         TEXT,
  htf_bias       TEXT,
  order_id       TEXT,
  position_id    TEXT,
  status         TEXT NOT NULL DEFAULT 'OPEN'
                   CHECK (status IN ('OPEN','CLOSED','CANCELLED','ERROR')),
  close_reason   TEXT,
  opened_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at      TIMESTAMPTZ,
  meta           JSONB
);

CREATE INDEX IF NOT EXISTS idx_crypto_trades_symbol     ON crypto_trades(symbol);
CREATE INDEX IF NOT EXISTS idx_crypto_trades_status     ON crypto_trades(status);
CREATE INDEX IF NOT EXISTS idx_crypto_trades_opened_at  ON crypto_trades(opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_crypto_trades_account    ON crypto_trades(account_id);

-- Virtual (stealth) SL/TP — survives bot restart
CREATE TABLE IF NOT EXISTS crypto_stealth (
  position_id TEXT PRIMARY KEY,
  symbol      TEXT NOT NULL,
  side        TEXT NOT NULL,
  virtual_sl  NUMERIC(20,8),
  virtual_tp  NUMERIC(20,8),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- DNA learning aggregation (per symbol per dimension)
CREATE TABLE IF NOT EXISTS crypto_dna (
  id             BIGSERIAL PRIMARY KEY,
  symbol         TEXT NOT NULL,
  dimension      TEXT NOT NULL,           -- 'session' | 'regime' | 'strategy' | 'hour' | 'combo'
  key_value      TEXT NOT NULL,
  wins           INTEGER NOT NULL DEFAULT 0,
  losses         INTEGER NOT NULL DEFAULT 0,
  total_profit   NUMERIC(14,4) NOT NULL DEFAULT 0,
  total_loss     NUMERIC(14,4) NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(symbol, dimension, key_value)
);

CREATE INDEX IF NOT EXISTS idx_crypto_dna_lookup ON crypto_dna(symbol, dimension);
