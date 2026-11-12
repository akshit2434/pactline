// Small, dependency-free limiters for the public demo. Pure logic with an injectable clock so they can be unit-tested.
import fs from 'node:fs';
import path from 'node:path';

/**
 * Sliding-window limiter: at most `limit` hits per key in any `windowMs` span.
 * hit(key) records a hit only when allowed and returns { ok, remaining, retryAfterMs }.
 */
export class RateLimiter {
  constructor({ limit, windowMs, now = () => Date.now(), maxKeys = 50_000 }) {
    if (!(limit > 0) || !(windowMs > 0)) throw new Error('limit and windowMs must be positive');
    Object.assign(this, { limit, windowMs, now, maxKeys }); this.hits = new Map();
  }
  _live(key, t) {
    const arr = (this.hits.get(key) || []).filter((x) => x > t - this.windowMs);
    if (arr.length) this.hits.set(key, arr); else this.hits.delete(key);
    return arr;
  }
  peek(key) { const t = this.now(); const arr = this._live(key, t); return this._result(arr, t, arr.length < this.limit); }
  hit(key) {
    const t = this.now(); const arr = this._live(key, t);
    if (arr.length >= this.limit) return this._result(arr, t, false);
    arr.push(t); this.hits.set(key, arr);
    if (this.hits.size > this.maxKeys) this.sweep();
    return this._result(arr, t, true);
  }
  _result(arr, t, ok) {
    return { ok, limit: this.limit, remaining: Math.max(0, this.limit - arr.length), retryAfterMs: ok ? 0 : Math.max(1, arr[0] + this.windowMs - t) };
  }
  sweep() { const t = this.now(); for (const k of [...this.hits.keys()]) this._live(k, t); }
}

/**
 * Global per-day budget (UTC day), persisted to a small JSON file so a restart does not reset it.
 * tryConsume() returns true and counts one unit while under the cap, false once the cap is reached.
 */
export class DailyCap {
  constructor({ cap, file = null, now = () => Date.now() }) {
    Object.assign(this, { cap, file, now }); this.day = ''; this.count = 0;
    if (file) { try { const s = JSON.parse(fs.readFileSync(file, 'utf8')); this.day = s.day || ''; this.count = Number(s.count) || 0; } catch { /* first run */ } }
  }
  _today() { return new Date(this.now()).toISOString().slice(0, 10); }
  _roll() { const d = this._today(); if (d !== this.day) { this.day = d; this.count = 0; } }
  used() { this._roll(); return this.count; }
  remaining() { this._roll(); return Math.max(0, this.cap - this.count); }
  tryConsume() {
    this._roll();
    if (this.count >= this.cap) return false;
    this.count += 1; this._save(); return true;
  }
  _save() {
    if (!this.file) return;
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify({ day: this.day, count: this.count })); } catch { /* best effort */ }
  }
}

/**
 * Claude budget: a per-IP hourly limit plus the global daily cap. check(ip) decides one call.
 * Returns { ok: true } or { ok: false, reason: 'ip' | 'daily' }.
 * The per-IP hit is only recorded when the daily cap also allows the call.
 */
export function createClaudeBudget({ perHour, perDay, file, now = () => Date.now() }) {
  const ipLimiter = new RateLimiter({ limit: perHour, windowMs: 3_600_000, now });
  const daily = new DailyCap({ cap: perDay, file, now });
  return {
    check(ip = 'unknown') {
      if (!ipLimiter.peek(ip).ok) return { ok: false, reason: 'ip' };
      if (!daily.tryConsume()) return { ok: false, reason: 'daily' };
      ipLimiter.hit(ip); return { ok: true };
    },
    status: () => ({ daily_cap: perDay, daily_used: daily.used(), per_ip_hour: perHour }),
    ipLimiter, daily,
  };
}

/** Client IP: Cloudflare's header when the request came through the local tunnel connector, else the socket. */
export function clientIp(req) {
  const sock = req.socket?.remoteAddress || '';
  const local = sock === '127.0.0.1' || sock === '::1' || sock === '::ffff:127.0.0.1';
  const cf = req.headers['cf-connecting-ip'];
  if (local && typeof cf === 'string' && cf.length < 64) return cf.trim();
  return sock || 'unknown';
}
