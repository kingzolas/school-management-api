const invoiceCompensationService = require('./invoiceCompensation.service');

class BillingEligibilityService {
  constructor({ invoiceCompensationService: compensationService = invoiceCompensationService } = {}) {
    this.invoiceCompensationService = compensationService;
  }

  getEligibilityForDate(dueDate, referenceDate = new Date()) {
    if (!dueDate) {
      return { shouldSend: false, type: null };
    }

    const ref = new Date(referenceDate);
    const venc = new Date(dueDate);

    if (Number.isNaN(ref.getTime()) || Number.isNaN(venc.getTime())) {
      return { shouldSend: false, type: null };
    }

    ref.setHours(0, 0, 0, 0);
    venc.setHours(0, 0, 0, 0);

    const diffTime = venc - ref;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (ref.getDate() === 1 && diffDays > 0 && diffDays <= 31 && venc.getMonth() === ref.getMonth()) {
      return { shouldSend: true, type: 'new_invoice' };
    }

    if (diffDays === 3) return { shouldSend: true, type: 'reminder' };
    if (diffDays === 0) return { shouldSend: true, type: 'due_today' };
    if (diffDays < 0 && diffDays >= -60) return { shouldSend: true, type: 'overdue' };

    return { shouldSend: false, type: null };
  }

  isNotificationTypeEnabled(type, config) {
    if (!config) return true;

    const normalizedType = String(type || '').toLowerCase();

    if (normalizedType === 'new_invoice') {
      return config.enableNewInvoice !== false;
    }

    if (normalizedType === 'due_today') {
      return config.enableDueToday !== false;
    }

    if (normalizedType === 'overdue') {
      return config.enableOverdue !== false;
    }

    if (normalizedType === 'reminder') {
      return config.enableReminder !== false;
    }

    return true;
  }

  async isInvoiceOnHold(invoice) {
    try {
      if (!invoice?._id || !invoice?.school_id) return { onHold: false, compensation: null };

      const compensation = await this.invoiceCompensationService.getCompensationByInvoice({
        school_id: invoice.school_id,
        invoice_id: invoice._id,
      });

      return {
        onHold: Boolean(compensation),
        compensation: compensation || null,
      };
    } catch (error) {
      console.error('Erro ao checar HOLD de compensacao:', error?.message || error);
      return {
        onHold: false,
        compensation: null,
        error,
      };
    }
  }

  async evaluateInvoice({ invoice, config = null, referenceDate = new Date(), includeHold = true } = {}) {
    if (!invoice) {
      return {
        isEligible: false,
        type: null,
        reason: 'MISSING_INVOICE',
        onHold: false,
        compensation: null,
      };
    }

    if (invoice.status === 'paid') {
      return {
        isEligible: false,
        type: null,
        reason: 'INVOICE_ALREADY_PAID',
        onHold: false,
        compensation: null,
      };
    }

    if (invoice.status === 'canceled') {
      return {
        isEligible: false,
        type: null,
        reason: 'INVOICE_CANCELLED',
        onHold: false,
        compensation: null,
      };
    }

    const dateCheck = this.getEligibilityForDate(invoice.dueDate, referenceDate);
    if (!dateCheck.shouldSend) {
      return {
        isEligible: false,
        type: null,
        reason: 'OUTSIDE_NOTIFICATION_WINDOW',
        onHold: false,
        compensation: null,
      };
    }

    if (!this.isNotificationTypeEnabled(dateCheck.type, config)) {
      return {
        isEligible: false,
        type: dateCheck.type,
        reason: 'TYPE_DISABLED_BY_CONFIG',
        onHold: false,
        compensation: null,
      };
    }

    if (includeHold) {
      const holdState = await this.isInvoiceOnHold(invoice);

      if (holdState.onHold) {
        return {
          isEligible: false,
          type: dateCheck.type,
          reason: 'HOLD_ACTIVE',
          onHold: true,
          compensation: holdState.compensation,
        };
      }
    }

    return {
      isEligible: true,
      type: dateCheck.type,
      reason: 'ELIGIBLE',
      onHold: false,
      compensation: null,
    };
  }

  isEligibleForSending(dueDate, referenceDate = new Date()) {
    return this.getEligibilityForDate(dueDate, referenceDate).shouldSend;
  }
}

const service = new BillingEligibilityService();

module.exports = service;
module.exports.BillingEligibilityService = BillingEligibilityService;
