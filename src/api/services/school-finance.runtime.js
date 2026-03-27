const DEFAULT_CACHE_TTLS_MS = {
  invoiceList: Number(process.env.FINANCE_INVOICE_LIST_CACHE_TTL_MS || 45_000),
  invoiceById: Number(process.env.FINANCE_INVOICE_BY_ID_CACHE_TTL_MS || 30_000),
  invoiceByStudent: Number(process.env.FINANCE_INVOICE_BY_STUDENT_CACHE_TTL_MS || 30_000),
  dashboard: Number(process.env.FINANCE_DASHBOARD_CACHE_TTL_MS || 60_000),
};

const SYNC_MIN_INTERVAL_MS = Number(process.env.FINANCE_SYNC_MIN_INTERVAL_MS || 5 * 60_000);

function normalizeForKey(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeForKey(item));
  }

  if (typeof value === 'object') {
    const normalized = {};
    for (const key of Object.keys(value).sort()) {
      const nextValue = normalizeForKey(value[key]);
      if (nextValue !== null && nextValue !== undefined && nextValue !== '') {
        normalized[key] = nextValue;
      }
    }
    return normalized;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }

  return value;
}

class SchoolFinanceRuntime {
  constructor() {
    this.cache = new Map();
    this.cacheKeysBySchool = new Map();
    this.syncStateBySchool = new Map();
  }

  _schoolKey(schoolId) {
    return String(schoolId || '').trim();
  }

  _cacheKey(scope, schoolId, payload = {}) {
    const schoolKey = this._schoolKey(schoolId);
    const normalizedPayload = normalizeForKey(payload) || {};
    return `${scope}::${schoolKey}::${JSON.stringify(normalizedPayload)}`;
  }

  _defaultTtlForScope(scope) {
    switch (scope) {
      case 'invoice:list':
        return DEFAULT_CACHE_TTLS_MS.invoiceList;
      case 'invoice:by-id':
        return DEFAULT_CACHE_TTLS_MS.invoiceById;
      case 'invoice:by-student':
        return DEFAULT_CACHE_TTLS_MS.invoiceByStudent;
      case 'dashboard:financial':
        return DEFAULT_CACHE_TTLS_MS.dashboard;
      default:
        return DEFAULT_CACHE_TTLS_MS.invoiceList;
    }
  }

  getCache(scope, schoolId, payload = {}) {
    const key = this._cacheKey(scope, schoolId, payload);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    return {
      ...entry,
      stale: Date.now() > entry.expiresAt,
    };
  }

  setCache(scope, schoolId, payload = {}, value, ttlMs) {
    const key = this._cacheKey(scope, schoolId, payload);
    const schoolKey = this._schoolKey(schoolId);
    const ttl = Number(ttlMs || this._defaultTtlForScope(scope));
    const storedAt = Date.now();

    const entry = {
      scope,
      schoolId: schoolKey,
      payload: normalizeForKey(payload) || {},
      value,
      storedAt,
      expiresAt: storedAt + ttl,
      ttlMs: ttl,
    };

    this.cache.set(key, entry);

    if (!this.cacheKeysBySchool.has(schoolKey)) {
      this.cacheKeysBySchool.set(schoolKey, new Set());
    }

    this.cacheKeysBySchool.get(schoolKey).add(key);

    return entry;
  }

  invalidateSchool(schoolId, scopePrefix = null) {
    const schoolKey = this._schoolKey(schoolId);
    const keys = this.cacheKeysBySchool.get(schoolKey);

    if (!keys || keys.size === 0) {
      return 0;
    }

    let removed = 0;
    for (const key of [...keys]) {
      const shouldRemove = !scopePrefix || key.startsWith(`${scopePrefix}::${schoolKey}::`);
      if (!shouldRemove) continue;

      this.cache.delete(key);
      keys.delete(key);
      removed++;
    }

    if (keys.size === 0) {
      this.cacheKeysBySchool.delete(schoolKey);
    }

    return removed;
  }

  _stateForSchool(schoolId) {
    const schoolKey = this._schoolKey(schoolId);

    if (!this.syncStateBySchool.has(schoolKey)) {
      this.syncStateBySchool.set(schoolKey, {
        inFlight: false,
        lastAttemptAt: null,
        lastSuccessfulAt: null,
        lastFailedAt: null,
        lastReason: null,
        lastError: null,
        lastUpdatedCount: 0,
        lastDurationMs: null,
        lastStatus: 'idle',
      });
    }

    return this.syncStateBySchool.get(schoolKey);
  }

  getSyncState(schoolId) {
    const schoolKey = this._schoolKey(schoolId);
    const state = this._stateForSchool(schoolKey);

    return {
      schoolId: schoolKey,
      inFlight: state.inFlight,
      lastAttemptAt: state.lastAttemptAt,
      lastSuccessfulAt: state.lastSuccessfulAt,
      lastFailedAt: state.lastFailedAt,
      lastReason: state.lastReason,
      lastError: state.lastError,
      lastUpdatedCount: state.lastUpdatedCount,
      lastDurationMs: state.lastDurationMs,
      lastStatus: state.lastStatus,
      syncMinIntervalMs: SYNC_MIN_INTERVAL_MS,
    };
  }

  shouldAllowSync(schoolId, { force = false } = {}) {
    const state = this._stateForSchool(schoolId);

    if (state.inFlight) {
      return { allowed: false, reason: 'in_flight', state: this.getSyncState(schoolId) };
    }

    if (!force && state.lastAttemptAt) {
      const elapsed = Date.now() - new Date(state.lastAttemptAt).getTime();
      if (elapsed < SYNC_MIN_INTERVAL_MS) {
        return { allowed: false, reason: 'cooldown', state: this.getSyncState(schoolId) };
      }
    }

    return { allowed: true, reason: null, state: this.getSyncState(schoolId) };
  }

  tryStartSync(schoolId, { force = false, reason = 'finance_sync' } = {}) {
    const gate = this.shouldAllowSync(schoolId, { force });

    if (!gate.allowed) {
      return {
        started: false,
        reason: gate.reason,
        state: gate.state,
      };
    }

    const state = this._stateForSchool(schoolId);
    const now = new Date();

    state.inFlight = true;
    state.lastAttemptAt = now;
    state.lastReason = reason;
    state.lastStatus = 'running';
    state.lastError = null;

    return {
      started: true,
      state: this.getSyncState(schoolId),
    };
  }

  finishSync(schoolId, { success = true, error = null, updatedCount = 0, durationMs = null } = {}) {
    const state = this._stateForSchool(schoolId);

    state.inFlight = false;
    state.lastDurationMs = durationMs;
    state.lastUpdatedCount = updatedCount;

    if (success) {
      state.lastSuccessfulAt = new Date();
      state.lastFailedAt = null;
      state.lastError = null;
      state.lastStatus = 'success';
    } else {
      state.lastFailedAt = new Date();
      state.lastError = error ? (error.message || String(error)) : 'unknown';
      state.lastStatus = 'failed';
    }

    return this.getSyncState(schoolId);
  }
}

module.exports = new SchoolFinanceRuntime();
