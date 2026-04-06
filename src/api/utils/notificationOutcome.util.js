const { normalizeString } = require('./contact.util');

const OUTCOME_CATALOG = Object.freeze({
  NOTIFICATION_QUEUED: {
    category: 'success',
    title: 'Cobranca na fila',
    user_message: 'A cobranca foi adicionada a fila de envio.',
    retryable: false,
    defaultStatus: 'queued',
    httpStatus: 200,
  },
  NOTIFICATION_SENT: {
    category: 'success',
    title: 'Cobranca enviada',
    user_message: 'A cobranca foi enviada com sucesso.',
    retryable: false,
    defaultStatus: 'sent',
    httpStatus: 200,
  },
  NOTIFICATION_PAUSED: {
    category: 'temporary_error',
    title: 'Fila pausada',
    user_message: 'O envio foi pausado temporariamente para evitar novas tentativas indevidas.',
    retryable: true,
    defaultStatus: 'paused',
    httpStatus: 200,
  },
  QUEUE_CLEAR_CANCELLED: {
    category: 'success',
    title: 'Item removido da fila',
    user_message: 'Este item pendente foi removido da fila operacional.',
    retryable: false,
    defaultStatus: 'cancelled',
    httpStatus: 200,
  },
  QUEUE_CLEAR_ALREADY_PROCESSED: {
    category: 'success',
    title: 'Item ja processado',
    user_message: 'Este item ja tinha evidencia de processamento e foi preservado no historico.',
    retryable: false,
    defaultStatus: 'sent',
    httpStatus: 200,
  },
  QUEUE_CLEAR_ACTIVE_PROCESSING_UNTOUCHED: {
    category: 'business_rule',
    title: 'Processamento ativo preservado',
    user_message: 'Este item ainda estava em processamento ativo e nao foi cancelado automaticamente.',
    retryable: false,
    defaultStatus: 'processing',
    httpStatus: 200,
  },
  ALREADY_QUEUED_OR_SENT_TODAY: {
    category: 'business_rule',
    title: 'Cobranca ja registrada hoje',
    user_message: 'Esta cobranca ja foi registrada hoje e nao sera duplicada.',
    retryable: false,
    defaultStatus: 'skipped',
    httpStatus: 200,
  },
  NOTIFICATION_ALREADY_SENT_SUCCESSFULLY: {
    category: 'business_rule',
    title: 'Cobranca ja enviada com sucesso',
    user_message: 'Esta cobranca ja foi enviada com sucesso anteriormente e nao sera duplicada.',
    retryable: false,
    defaultStatus: 'skipped',
    httpStatus: 200,
  },
  INVOICE_ALREADY_PAID: {
    category: 'business_rule',
    title: 'Fatura ja paga',
    user_message: 'Esta cobranca ja foi paga e nao sera enviada novamente.',
    retryable: false,
    defaultStatus: 'skipped',
    httpStatus: 200,
  },
  INVOICE_CANCELLED: {
    category: 'business_rule',
    title: 'Fatura cancelada',
    user_message: 'Esta cobranca foi cancelada e nao pode ser enviada.',
    retryable: false,
    defaultStatus: 'skipped',
    httpStatus: 200,
  },
  HOLD_ACTIVE: {
    category: 'business_rule',
    title: 'Cobranca em excecao',
    user_message: 'Esta cobranca esta temporariamente bloqueada e nao sera enviada agora.',
    retryable: false,
    defaultStatus: 'skipped',
    httpStatus: 200,
  },
  OUTSIDE_NOTIFICATION_WINDOW: {
    category: 'business_rule',
    title: 'Fora da janela de envio',
    user_message: 'Esta cobranca nao esta na janela de envio configurada.',
    retryable: false,
    defaultStatus: 'skipped',
    httpStatus: 200,
  },
  TYPE_DISABLED_BY_CONFIG: {
    category: 'configuration_error',
    title: 'Tipo de envio desabilitado',
    user_message: 'Esse tipo de cobranca esta desabilitado na configuracao da escola.',
    retryable: false,
    defaultStatus: 'skipped',
    httpStatus: 200,
  },
  RECIPIENT_UNRESOLVED: {
    category: 'recipient_error',
    title: 'Responsavel nao encontrado',
    user_message: 'Nao foi possivel identificar um destinatario valido para esta cobranca.',
    retryable: false,
    defaultStatus: 'skipped',
    httpStatus: 200,
  },
  RECIPIENT_EMAIL_MISSING: {
    category: 'recipient_error',
    title: 'Responsavel sem e-mail',
    user_message: 'O responsavel financeiro nao possui e-mail cadastrado para receber a cobranca.',
    retryable: false,
    defaultStatus: 'skipped',
    httpStatus: 200,
    field: 'email',
  },
  RECIPIENT_EMAIL_INVALID: {
    category: 'recipient_error',
    title: 'E-mail invalido',
    user_message: 'O e-mail cadastrado do responsavel e invalido. Revise o cadastro antes de enviar.',
    retryable: false,
    defaultStatus: 'skipped',
    httpStatus: 200,
    field: 'email',
  },
  RECIPIENT_PHONE_MISSING: {
    category: 'recipient_error',
    title: 'Responsavel sem telefone',
    user_message: 'O responsavel financeiro nao possui telefone valido cadastrado para este canal.',
    retryable: false,
    defaultStatus: 'skipped',
    httpStatus: 200,
    field: 'phone',
  },
  MISSING_EMAIL_TARGET: {
    category: 'recipient_error',
    title: 'Responsavel sem e-mail',
    user_message: 'O responsavel financeiro nao possui e-mail cadastrado para receber a cobranca.',
    retryable: false,
    defaultStatus: 'failed',
    httpStatus: 422,
    field: 'email',
  },
  EMAIL_CHANNEL_DISABLED: {
    category: 'configuration_error',
    title: 'Canal de e-mail desabilitado',
    user_message: 'O canal de e-mail esta desabilitado na configuracao da escola.',
    retryable: false,
    defaultStatus: 'skipped',
    httpStatus: 200,
  },
  EMAIL_CHANNEL_PAUSED: {
    category: 'temporary_error',
    title: 'Canal de e-mail pausado',
    user_message: 'O canal de e-mail esta pausado temporariamente por limite ou bloqueio do provedor.',
    retryable: true,
    defaultStatus: 'paused',
    httpStatus: 200,
  },
  WHATSAPP_CHANNEL_DISABLED: {
    category: 'configuration_error',
    title: 'Canal de WhatsApp desabilitado',
    user_message: 'O canal de WhatsApp esta desabilitado na configuracao da escola.',
    retryable: false,
    defaultStatus: 'skipped',
    httpStatus: 200,
  },
  BOLETO_UNAVAILABLE: {
    category: 'business_rule',
    title: 'Cobranca sem dados de pagamento',
    user_message: 'Esta cobranca nao possui boleto, link ou PIX disponivel para envio.',
    retryable: false,
    defaultStatus: 'skipped',
    httpStatus: 200,
  },
  NO_CHANNEL_AVAILABLE: {
    category: 'recipient_error',
    title: 'Sem canal disponivel',
    user_message: 'Nao ha canal de envio disponivel para este responsavel.',
    retryable: false,
    defaultStatus: 'skipped',
    httpStatus: 200,
  },
  EMAIL_PROVIDER_CONFIG_ERROR: {
    category: 'configuration_error',
    title: 'Configuracao do e-mail incompleta',
    user_message: 'O envio por e-mail nao esta configurado corretamente no momento.',
    retryable: false,
    defaultStatus: 'failed',
    httpStatus: 500,
  },
  EMAIL_PROVIDER_AUTH_FAILED: {
    category: 'provider_error',
    title: 'Falha de autenticacao do e-mail',
    user_message: 'Nao foi possivel autenticar o canal de e-mail no momento. Tente novamente mais tarde.',
    retryable: true,
    defaultStatus: 'failed',
    httpStatus: 503,
  },
  EMAIL_PROVIDER_DAILY_LIMIT_REACHED: {
    category: 'temporary_error',
    title: 'Limite diario do provedor atingido',
    user_message: 'O limite diario de envio do e-mail foi atingido. A fila foi pausada temporariamente para evitar novas tentativas.',
    retryable: true,
    defaultStatus: 'failed',
    httpStatus: 503,
  },
  EMAIL_ADDRESS_NOT_FOUND: {
    category: 'recipient_error',
    title: 'Endereco de e-mail inexistente',
    user_message: 'O provedor informou que o endereco de e-mail do destinatario nao existe.',
    retryable: false,
    defaultStatus: 'failed',
    httpStatus: 422,
    field: 'email',
  },
  EMAIL_MESSAGE_REJECTED: {
    category: 'provider_error',
    title: 'Mensagem rejeitada pelo provedor',
    user_message: 'O provedor rejeitou a mensagem de e-mail e a cobranca nao foi concluida.',
    retryable: false,
    defaultStatus: 'failed',
    httpStatus: 422,
  },
  EMAIL_DELIVERY_INCOMPLETE: {
    category: 'temporary_error',
    title: 'Entrega incompleta do e-mail',
    user_message: 'O provedor aceitou a mensagem, mas informou uma falha temporaria de entrega.',
    retryable: true,
    defaultStatus: 'failed',
    httpStatus: 503,
  },
  EMAIL_BOUNCE_DETECTED: {
    category: 'provider_error',
    title: 'Falha de entrega confirmada',
    user_message: 'O provedor retornou uma falha de entrega para este e-mail.',
    retryable: false,
    defaultStatus: 'failed',
    httpStatus: 422,
  },
  PROVIDER_TEMPORARY_FAILURE: {
    category: 'temporary_error',
    title: 'Falha temporaria no provedor',
    user_message: 'O provedor de envio esta temporariamente indisponivel. Tente novamente em instantes.',
    retryable: true,
    defaultStatus: 'failed',
    httpStatus: 503,
  },
  WHATSAPP_DISCONNECTED: {
    category: 'configuration_error',
    title: 'WhatsApp desconectado',
    user_message: 'A instancia do WhatsApp esta desconectada no momento.',
    retryable: true,
    defaultStatus: 'failed',
    httpStatus: 503,
  },
  TRANSPORT_NOT_CONFIGURED: {
    category: 'configuration_error',
    title: 'Transporte indisponivel',
    user_message: 'O canal selecionado nao esta disponivel para envio no momento.',
    retryable: false,
    defaultStatus: 'failed',
    httpStatus: 500,
  },
  INVOICE_NOT_FOUND: {
    category: 'business_rule',
    title: 'Fatura nao encontrada',
    user_message: 'Nao foi possivel localizar a cobranca solicitada.',
    retryable: false,
    defaultStatus: 'failed',
    httpStatus: 404,
  },
  INVOICE_ID_REQUIRED: {
    category: 'validation_error',
    title: 'Fatura nao informada',
    user_message: 'Selecione a cobranca que deseja enviar.',
    retryable: false,
    defaultStatus: 'failed',
    httpStatus: 400,
    field: 'invoiceId',
  },
  INTERNAL_ERROR: {
    category: 'internal_error',
    title: 'Erro interno',
    user_message: 'Ocorreu um erro inesperado ao processar a cobranca.',
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
  const rawPayload = errorOrCode?.response?.data || errorOrCode?.transportAttempt?.raw_last_error || null;
  const rawText = JSON.stringify(rawPayload || {}).toLowerCase();
  const messageText = String(errorOrCode?.message || '').toLowerCase();
  const combinedText = `${messageText} ${rawText}`;

  if (['GMAIL_ENV_MISSING', 'GOOGLEAPIS_NOT_INSTALLED'].includes(rawCode)) {
    return 'EMAIL_PROVIDER_CONFIG_ERROR';
  }

  if (['GMAIL_ACCESS_TOKEN_UNAVAILABLE', 'invalid_grant', 'invalid_client', 'AUTH_ERROR'].includes(rawCode)) {
    return 'EMAIL_PROVIDER_AUTH_FAILED';
  }

  if ([
    'EMAIL_PROVIDER_AUTH_FAILED',
    'EMAIL_PROVIDER_CONFIG_ERROR',
    'PROVIDER_TEMPORARY_FAILURE',
    'EMAIL_PROVIDER_DAILY_LIMIT_REACHED',
    'EMAIL_ADDRESS_NOT_FOUND',
    'EMAIL_MESSAGE_REJECTED',
    'EMAIL_DELIVERY_INCOMPLETE',
    'EMAIL_BOUNCE_DETECTED',
  ].includes(rawCode)) {
    return rawCode;
  }

  if (rawCode === 'MISSING_EMAIL_TARGET') return 'RECIPIENT_EMAIL_MISSING';
  if (rawCode === 'MISSING_WHATSAPP_TARGET') return 'RECIPIENT_PHONE_MISSING';
  if (rawCode === 'NO_CHANNEL_AVAILABLE') return 'NO_CHANNEL_AVAILABLE';
  if (rawCode === 'WHATSAPP_DISCONNECTED') return 'WHATSAPP_DISCONNECTED';
  if (rawCode === 'TRANSPORT_NOT_CONFIGURED') return 'TRANSPORT_NOT_CONFIGURED';

  if (channel === 'email') {
    const isDailyLimit =
      combinedText.includes('daily user sending quota exceeded') ||
      combinedText.includes('daily sending quota') ||
      combinedText.includes('userratelimitexceeded') ||
      combinedText.includes('dailylimitexceeded') ||
      combinedText.includes('quota exceeded') ||
      combinedText.includes('sending limit exceeded');

    if (isDailyLimit) {
      return 'EMAIL_PROVIDER_DAILY_LIMIT_REACHED';
    }

    if (
      combinedText.includes('address not found') ||
      combinedText.includes('user unknown') ||
      combinedText.includes('recipient address rejected') ||
      combinedText.includes('550 5.1.1') ||
      combinedText.includes('status: 5.1.1')
    ) {
      return 'EMAIL_ADDRESS_NOT_FOUND';
    }

    if (
      combinedText.includes('message rejected') ||
      combinedText.includes('blocked') ||
      combinedText.includes('policy') ||
      combinedText.includes('not accepted')
    ) {
      return 'EMAIL_MESSAGE_REJECTED';
    }
  }

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
  const finalSuccess = success !== null ? success : !['failed'].includes(finalStatus);

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
    total_paused: 0,
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
  } else if (item?.status === 'paused') {
    accumulator.total_paused += 1;
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
