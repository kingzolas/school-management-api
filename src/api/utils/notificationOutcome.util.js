const { normalizeString } = require('./contact.util');

const OUTCOME_CATALOG = Object.freeze({
  NOTIFICATION_QUEUED: {
    category: 'success',
    title: 'Cobrança na fila',
    user_message: 'A cobrança foi adicionada à fila de envio.',
    retryable: false,
    defaultStatus: 'queued',
    httpStatus: 200,
  },
  NOTIFICATION_SENT: {
    category: 'success',
    title: 'Cobrança enviada',
    user_message: 'A cobrança foi enviada com sucesso.',
    retryable: false,
    defaultStatus: 'sent',
    httpStatus: 200,
  },
  ALREADY_QUEUED_OR_SENT_TODAY: {
    category: 'business_rule',
    title: 'Cobrança já registrada hoje',
    user_message: 'Esta cobrança já foi registrada hoje e não será duplicada.',
    retryable: false,
    defaultStatus: 'skipped',
    httpStatus: 200,
  },
  INVOICE_ALREADY_PAID: {
    category: 'business_rule',
    title: 'Fatura já paga',
    user_message: 'Esta cobrança já foi paga e não será enviada novamente.',
    retryable: false,
    defaultStatus: 'skipped',
    httpStatus: 200,
  },
  INVOICE_CANCELLED: {
    category: 'business_rule',
    title: 'Fatura cancelada',
    user_message: 'Esta cobrança foi cancelada e não pode ser enviada.',
    retryable: false,
    defaultStatus: 'skipped',
    httpStatus: 200,
  },
  HOLD_ACTIVE: {
    category: 'business_rule',
    title: 'Cobrança em exceção',
    user_message: 'Esta cobrança está temporariamente bloqueada e não será enviada agora.',
    retryable: false,
    defaultStatus: 'skipped',
    httpStatus: 200,
  },
  OUTSIDE_NOTIFICATION_WINDOW: {
    category: 'business_rule',
    title: 'Fora da janela de envio',
    user_message: 'Esta cobrança não está na janela de envio configurada.',
    retryable: false,
    defaultStatus: 'skipped',
    httpStatus: 200,
  },
  TYPE_DISABLED_BY_CONFIG: {
    category: 'configuration_error',
    title: 'Tipo de envio desabilitado',
    user_message: 'Esse tipo de cobrança está desabilitado na configuração da escola.',
    retryable: false,
    defaultStatus: 'skipped',
    httpStatus: 200,
  },
  RECIPIENT_UNRESOLVED: {
    category: 'recipient_error',
    title: 'Responsável não encontrado',
    user_message: 'Não foi possível identificar um destinatário válido para esta cobrança.',
    retryable: false,
    defaultStatus: 'skipped',
    httpStatus: 200,
  },
  RECIPIENT_EMAIL_MISSING: {
    category: 'recipient_error',
    title: 'Responsável sem e-mail',
    user_message: 'O responsável financeiro não possui e-mail cadastrado para receber a cobrança.',
    retryable: false,
    defaultStatus: 'skipped',
    httpStatus: 200,
    field: 'email',
  },
  RECIPIENT_EMAIL_INVALID: {
    category: 'recipient_error',
    title: 'E-mail inválido',
    user_message: 'O e-mail cadastrado do responsável é inválido. Revise o cadastro antes de enviar.',
    retryable: false,
    defaultStatus: 'skipped',
    httpStatus: 200,
    field: 'email',
  },
  RECIPIENT_PHONE_MISSING: {
    category: 'recipient_error',
    title: 'Responsável sem telefone',
    user_message: 'O responsável financeiro não possui telefone válido cadastrado para este canal.',
    retryable: false,
    defaultStatus: 'skipped',
    httpStatus: 200,
    field: 'phone',
  },
  MISSING_EMAIL_TARGET: {
    category: 'recipient_error',
    title: 'Responsável sem e-mail',
    user_message: 'O responsável financeiro não possui e-mail cadastrado para receber a cobrança.',
    retryable: false,
    defaultStatus: 'failed',
    httpStatus: 422,
    field: 'email',
  },
  EMAIL_CHANNEL_DISABLED: {
    category: 'configuration_error',
    title: 'Canal de e-mail desabilitado',
    user_message: 'O canal de e-mail está desabilitado na configuração da escola.',
    retryable: false,
    defaultStatus: 'skipped',
    httpStatus: 200,
  },
  WHATSAPP_CHANNEL_DISABLED: {
    category: 'configuration_error',
    title: 'Canal de WhatsApp desabilitado',
    user_message: 'O canal de WhatsApp está desabilitado na configuração da escola.',
    retryable: false,
    defaultStatus: 'skipped',
    httpStatus: 200,
  },
  BOLETO_UNAVAILABLE: {
    category: 'business_rule',
    title: 'Cobrança sem dados de pagamento',
    user_message: 'Esta cobrança não possui boleto, link ou PIX disponível para envio.',
    retryable: false,
    defaultStatus: 'skipped',
    httpStatus: 200,
  },
  NO_CHANNEL_AVAILABLE: {
    category: 'recipient_error',
    title: 'Sem canal disponível',
    user_message: 'Não há canal de envio disponível para este responsável.',
    retryable: false,
    defaultStatus: 'skipped',
    httpStatus: 200,
  },
  EMAIL_PROVIDER_CONFIG_ERROR: {
    category: 'configuration_error',
    title: 'Configuração do e-mail incompleta',
    user_message: 'O envio por e-mail não está configurado corretamente no momento.',
    retryable: false,
    defaultStatus: 'failed',
    httpStatus: 500,
  },
  EMAIL_PROVIDER_AUTH_FAILED: {
    category: 'provider_error',
    title: 'Falha de autenticação do e-mail',
    user_message: 'Não foi possível autenticar o canal de e-mail no momento. Tente novamente mais tarde.',
    retryable: true,
    defaultStatus: 'failed',
    httpStatus: 503,
  },
  PROVIDER_TEMPORARY_FAILURE: {
    category: 'temporary_error',
    title: 'Falha temporária no provedor',
    user_message: 'O provedor de envio está temporariamente indisponível. Tente novamente em instantes.',
    retryable: true,
    defaultStatus: 'failed',
    httpStatus: 503,
  },
  WHATSAPP_DISCONNECTED: {
    category: 'configuration_error',
    title: 'WhatsApp desconectado',
    user_message: 'A instância do WhatsApp está desconectada no momento.',
    retryable: true,
    defaultStatus: 'failed',
    httpStatus: 503,
  },
  TRANSPORT_NOT_CONFIGURED: {
    category: 'configuration_error',
    title: 'Transporte indisponível',
    user_message: 'O canal selecionado não está disponível para envio no momento.',
    retryable: false,
    defaultStatus: 'failed',
    httpStatus: 500,
  },
  INVOICE_NOT_FOUND: {
    category: 'business_rule',
    title: 'Fatura não encontrada',
    user_message: 'Não foi possível localizar a cobrança solicitada.',
    retryable: false,
    defaultStatus: 'failed',
    httpStatus: 404,
  },
  INVOICE_ID_REQUIRED: {
    category: 'validation_error',
    title: 'Fatura não informada',
    user_message: 'Selecione a cobrança que deseja enviar.',
    retryable: false,
    defaultStatus: 'failed',
    httpStatus: 400,
    field: 'invoiceId',
  },
  INTERNAL_ERROR: {
    category: 'internal_error',
    title: 'Erro interno',
    user_message: 'Ocorreu um erro inesperado ao processar a cobrança.',
    retryable: true,
    defaultStatus: 'failed',
    httpStatus: 500,
  },
});

function getOutcomeDescriptor(code = 'INTERNAL_ERROR') {
  const normalizedCode = normalizeString(code) || 'INTERNAL_ERROR';
  return {
    code: normalizedCode,
    ...(OUTCOME_CATALOG[normalizedCode] || OUTCOME_CATALOG.INTERNAL_ERROR),
  };
}

function mapLegacyReasonCode(code, fallbackCode = 'INTERNAL_ERROR') {
  const normalized = normalizeString(code);
  if (!normalized) return fallbackCode;

  const map = {
    INVOICE_NOT_OPEN: 'INVOICE_ALREADY_PAID',
    MISSING_EMAIL_TARGET: 'RECIPIENT_EMAIL_MISSING',
    PRIMARY_CHANNEL_DISABLED: 'EMAIL_CHANNEL_DISABLED',
    PRIMARY_CHANNEL_UNAVAILABLE: 'NO_CHANNEL_AVAILABLE',
  };

  return map[normalized] || normalized;
}

function mapDispatchErrorCode(errorOrCode, channel = null) {
  const httpStatus = Number(errorOrCode?.response?.status || errorOrCode?.status || 0);
  const rawCode = typeof errorOrCode === 'string'
    ? errorOrCode
    : normalizeString(errorOrCode?.code) || null;

  if (['GMAIL_ENV_MISSING', 'GOOGLEAPIS_NOT_INSTALLED'].includes(rawCode)) {
    return 'EMAIL_PROVIDER_CONFIG_ERROR';
  }

  if (['GMAIL_ACCESS_TOKEN_UNAVAILABLE', 'invalid_grant', 'invalid_client', 'AUTH_ERROR'].includes(rawCode)) {
    return 'EMAIL_PROVIDER_AUTH_FAILED';
  }

  if (['EMAIL_PROVIDER_AUTH_FAILED', 'EMAIL_PROVIDER_CONFIG_ERROR', 'PROVIDER_TEMPORARY_FAILURE'].includes(rawCode)) {
    return rawCode;
  }

  if (rawCode === 'MISSING_EMAIL_TARGET') return 'RECIPIENT_EMAIL_MISSING';
  if (rawCode === 'MISSING_WHATSAPP_TARGET') return 'RECIPIENT_PHONE_MISSING';
  if (rawCode === 'NO_CHANNEL_AVAILABLE') return 'NO_CHANNEL_AVAILABLE';
  if (rawCode === 'WHATSAPP_DISCONNECTED') return 'WHATSAPP_DISCONNECTED';
  if (rawCode === 'TRANSPORT_NOT_CONFIGURED') return 'TRANSPORT_NOT_CONFIGURED';

  if (channel === 'email') {
    if ([408, 425, 429, 500, 502, 503, 504].includes(httpStatus)) {
      return 'PROVIDER_TEMPORARY_FAILURE';
    }

    if ([401, 403].includes(httpStatus)) {
      return 'EMAIL_PROVIDER_AUTH_FAILED';
    }
  }

  if (!rawCode) return 'INTERNAL_ERROR';

  return rawCode;
}

function buildOutcomePayload({
  code,
  status = null,
  success = null,
  technicalMessage = null,
  field = null,
  invoiceId = null,
  itemId = null,
  logId = null,
  retryable = null,
  extra = {},
} = {}) {
  const descriptor = getOutcomeDescriptor(code);
  const finalStatus = status || descriptor.defaultStatus;
  const finalSuccess = success !== null ? success : finalStatus !== 'failed';

  return {
    success: finalSuccess,
    status: finalStatus,
    code: descriptor.code,
    category: descriptor.category,
    title: descriptor.title,
    user_message: descriptor.user_message,
    technical_message: technicalMessage || null,
    retryable: retryable !== null ? retryable : descriptor.retryable,
    field: field || descriptor.field || null,
    item_id: itemId || null,
    invoice_id: invoiceId || null,
    log_id: logId || null,
    ...extra,
  };
}

function createBatchAccumulator() {
  return {
    total_analisado: 0,
    total_elegivel: 0,
    total_queued: 0,
    total_skipped: 0,
    total_failed: 0,
    breakdown: {},
    items: [],
  };
}

function pushBatchItem(accumulator, item) {
  accumulator.total_analisado += 1;

  if (item?.is_eligible) {
    accumulator.total_elegivel += 1;
  }

  if (item?.status === 'queued') {
    accumulator.total_queued += 1;
  } else if (item?.status === 'skipped') {
    accumulator.total_skipped += 1;
  } else if (item?.status === 'failed') {
    accumulator.total_failed += 1;
  }

  const reasonCode = normalizeString(item?.reason_code || item?.code) || 'UNKNOWN_REASON';
  accumulator.breakdown[reasonCode] = (accumulator.breakdown[reasonCode] || 0) + 1;
  accumulator.items.push(item);

  return accumulator;
}

function buildBatchResponse(accumulator, extra = {}) {
  return {
    success: true,
    has_failures: accumulator.total_failed > 0,
    ...accumulator,
    ...extra,
  };
}

module.exports = {
  OUTCOME_CATALOG,
  getOutcomeDescriptor,
  mapLegacyReasonCode,
  mapDispatchErrorCode,
  buildOutcomePayload,
  createBatchAccumulator,
  pushBatchItem,
  buildBatchResponse,
};
