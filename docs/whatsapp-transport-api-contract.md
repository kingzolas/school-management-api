# WhatsApp Transport API Contract

Contrato tecnico de consumo para o frontend Flutter do Academy Hub.

Este documento descreve apenas o que o backend expõe hoje para leitura no painel e como interpretar os dados relacionados ao envio de WhatsApp. A modelagem interna do ledger de transporte esta documentada em [whatsapp-transport-handoff.md](whatsapp-transport-handoff.md).

## 1. Resumo executivo

O backend passou a separar:

- estado operacional do job;
- estado de transporte real da mensagem;
- evidencias brutas do provider;
- status canonicos internos com timestamps.

O ponto mais importante para o frontend e este:

- `NotificationLog.sent` nao e prova de entrega;
- `accepted_by_evolution` nao e entregue;
- `server_ack` nao e lida;
- `delivered` nao e lida;
- `read` pode nunca acontecer mesmo com entrega bem-sucedida.

Hoje o frontend consegue ler:

- logs operacionais de notificacao;
- estatisticas diarias;
- previsao de faturas elegiveis;
- status de conexao do WhatsApp;
- configuracao de notificacoes.

Hoje o frontend nao consegue ler diretamente o novo `WhatsappTransportLog`, porque ainda nao existe endpoint exposto para esse ledger.

## 2. Endpoints disponiveis hoje

### 2.1 WhatsApp / conexao

| Metodo | Endpoint | Auth | Finalidade | Observacao |
| --- | --- | --- | --- | --- |
| `GET` | `/api/whatsapp/connect` | Sim | Inicia conexao e retorna QR code quando necessario | Endpoint de setup/conexao |
| `GET` | `/api/whatsapp/status` | Sim | Consulta estado atual da instancia Evolution | Retorna tambem `persistedStatus` |
| `GET` | `/api/whatsapp/sync-status` | Sim | Revalida a conexao e sincroniza estado local | Uso operacional |
| `DELETE` | `/api/whatsapp/disconnect` | Sim | Desconecta a instancia | Uso operacional |

### 2.2 Notificacoes / cobranca

| Metodo | Endpoint | Auth | Finalidade | Observacao |
| --- | --- | --- | --- | --- |
| `GET` | `/api/notifications/logs` | Sim | Lista logs operacionais de envio | Nao e o ledger de transporte |
| `POST` | `/api/notifications/retry-all` | Sim | Reenfileira falhas do dia | Uso operacional |
| `POST` | `/api/notifications/trigger` | Sim | Dispara varredura/processamento manual | Uso operacional |
| `POST` | `/api/notifications/trigger-month` | Sim | Dispara liberacao manual de faturas do mes | Uso operacional |
| `GET` | `/api/notifications/stats` | Sim | Retorna resumo diario de filas/envios | Usa `NotificationLog` |
| `GET` | `/api/notifications/forecast` | Sim | Retorna previsao de mensagens elegiveis | Usa `Invoice` |
| `GET` | `/api/notifications/config` | Sim | Le configuracao de notificacoes | Configuracao operacional |
| `POST` | `/api/notifications/config` | Sim | Salva configuracao de notificacoes | Configuracao operacional |
| `POST` | `/api/notifications/enqueue` | Sim | Reenfileira uma fatura manualmente | Uso operacional |

### 2.3 Webhook interno

| Metodo | Endpoint | Auth | Finalidade | Observacao |
| --- | --- | --- | --- | --- |
| `POST` | `/api/webhook/whatsapp` | Nao | Recebe eventos da Evolution | Nao e endpoint de consumo do frontend |

## 3. Shape das respostas

### 3.1 `GET /api/whatsapp/connect`

Resposta:

```json
{
  "status": "connected",
  "instanceName": "school_66b7f7b1d7d6e6b8d1a10001",
  "qrcode": null
}
```

Possiveis valores de `status`:

- `connected`
- `qr_pending`
- `connecting`

Uso no frontend:

- tela de conexao da instancia;
- exibir QR code quando existir;
- exibir estado de setup.

### 3.2 `GET /api/whatsapp/status`

Resposta:

```json
{
  "status": "open",
  "instanceName": "school_66b7f7b1d7d6e6b8d1a10001",
  "qrcode": null,
  "persistedStatus": "connected"
}
```

Observacoes:

- o corpo principal vem da Evolution;
- `persistedStatus` e o estado normalizado persistido na base local;
- o shape exato do payload da Evolution pode variar conforme a instancia/provedor.

Uso no frontend:

- indicador de conectividade;
- card de status do WhatsApp;
- alertas de reconexao.

### 3.3 `GET /api/whatsapp/sync-status`

Resposta:

```json
{
  "status": "connected"
}
```

Uso no frontend:

- reconfirmar conectividade;
- atualizar estados de tela apos tentativa de reconexao.

### 3.4 `DELETE /api/whatsapp/disconnect`

Resposta:

```json
{
  "message": "Desconectado com sucesso"
}
```

Uso no frontend:

- fluxo de logout/desconexao do WhatsApp.

### 3.5 `GET /api/notifications/logs`

Resposta:

```json
{
  "logs": [
    {
      "_id": "66b7f7b1d7d6e6b8d1a10011",
      "school_id": "66b7f7b1d7d6e6b8d1a10001",
      "invoice_id": "66b7f7b1d7d6e6b8d1a10022",
      "student_name": "Aluno Exemplo",
      "tutor_name": "Responsavel Exemplo",
      "target_phone": "5511999999999",
      "type": "new_invoice",
      "status": "sent",
      "scheduled_for": "2026-03-28T10:00:00.000Z",
      "sent_at": "2026-03-28T10:00:10.000Z",
      "attempts": 1,
      "error_message": null,
      "template_group": "HOJE",
      "template_index": 1,
      "message_text": "Texto final enviado",
      "message_preview": "Texto curto...",
      "error_code": null,
      "error_http_status": null,
      "error_raw": null,
      "sent_boleto_url": null,
      "sent_barcode": null,
      "sent_gateway": "cora",
      "sent_gateway_charge_id": "charge_123",
      "invoice_snapshot": {
        "description": "Mensalidade",
        "value": 120000,
        "dueDate": "2026-03-28T00:00:00.000Z",
        "student": "66b7f7b1d7d6e6b8d1a10033",
        "tutor": "66b7f7b1d7d6e6b8d1a10044",
        "gateway": "cora",
        "external_id": "ext-123"
      },
      "createdAt": "2026-03-28T10:00:05.000Z",
      "updatedAt": "2026-03-28T10:00:10.000Z"
    }
  ],
  "total": 1,
  "pages": 1
}
```

Importante:

- este endpoint retorna `NotificationLog`, que e um log operacional de cobranca;
- este endpoint nao retorna `provider_message_id`, `server_ack`, `delivered`, `read` nem o ledger novo de transporte;
- `status` aqui significa `queued`, `processing`, `sent`, `failed` ou `cancelled`.

Uso no frontend:

- tela de historico operacional;
- filtros por status do job;
- auditoria de tentativas e erros de negocio.

### 3.6 `GET /api/notifications/stats`

Resposta:

```json
{
  "queued": 4,
  "processing": 1,
  "sent": 18,
  "failed": 2,
  "total_today": 25
}
```

Uso no frontend:

- cards resumidos do painel;
- indicadores de fila do dia.

### 3.7 `GET /api/notifications/forecast`

Resposta:

```json
{
  "date": "2026-03-28T12:00:00.000Z",
  "total_expected": 12,
  "breakdown": {
    "due_today": 3,
    "overdue": 6,
    "reminder": 2,
    "new_invoice": 1
  }
}
```

Uso no frontend:

- previsao operacional de envios;
- planejamento visual do lote do dia.

### 3.8 `POST /api/notifications/enqueue`

Resposta de sucesso:

```json
{
  "success": true,
  "ok": true,
  "message": "Invoice reenfileirada com sucesso."
}
```

Resposta quando a fatura esta em HOLD:

```json
{
  "success": false,
  "ok": false,
  "reason": "HOLD_ACTIVE",
  "message": "Cobrança bloqueada: invoice está em compensação/HOLD ativo."
}
```

Erros comuns:

- `INVOICE_ID_REQUIRED`
- `INVOICE_NOT_FOUND`
- `INVOICE_NOT_ELIGIBLE`

Uso no frontend:

- acao de reenvio manual;
- feedback de bloqueio/eligibilidade.

### 3.9 `GET /api/notifications/config` e `POST /api/notifications/config`

Esses endpoints retornam e persistem a configuracao operacional de notificacoes.

Observacao:

- o shape e modelado pela entidade `NotificationConfig`;
- nao deve ser confundido com status de transporte.

## 4. Models e DTOs relevantes para o frontend

### 4.1 `NotificationLog`

Entidade usada por `/api/notifications/logs`, `/api/notifications/stats` e parte do fluxo operacional.

Campos mais relevantes para UI:

- `status`
- `scheduled_for`
- `sent_at`
- `attempts`
- `error_message`
- `error_code`
- `error_http_status`
- `message_text`
- `message_preview`
- `template_group`
- `template_index`
- `sent_boleto_url`
- `sent_barcode`
- `sent_gateway`
- `sent_gateway_charge_id`
- `invoice_snapshot`
- `createdAt`
- `updatedAt`

### 4.2 `School.whatsapp`

Entidade usada indiretamente pelos endpoints de conexao.

Campos relevantes:

- `status`
- `instanceName`
- `qrCode`
- `connectedPhone`
- `profileName`
- `lastSyncAt`
- `lastConnectedAt`
- `lastDisconnectedAt`
- `lastError`

### 4.3 `WhatsappTransportLog`

Existe internamente no backend, mas nao esta exposto por endpoint ainda.

Para o frontend, isso significa:

- nao ha DTO publico;
- nao ha model Flutter que dependa dele ainda;
- nao ha tela que consiga ler delivery/read/falha desse ledger via API hoje.

## 5. Como o frontend deve interpretar status

### 5.1 Status canonico interno do transporte

Esses estados existem no backend e sao os que deverao orientar a futura UI de transporte:

- `queued`
- `accepted_by_evolution`
- `server_ack`
- `delivered`
- `read`
- `failed`
- `deleted`

### 5.2 Mapeamento sugerido para UX

| Status | Sugestao de etiqueta | Uso de UI |
| --- | --- | --- |
| `queued` | Na fila | Badge neutro / cinza |
| `accepted_by_evolution` | Aceito | Badge informativo |
| `server_ack` | Processado | Badge informativo secundario |
| `delivered` | Entregue | Badge positiva |
| `read` | Lida | Badge positiva destacada |
| `failed` | Falha | Badge de erro |
| `deleted` | Deletada | Badge neutro/alerta |

### 5.3 Regras de exibicao

- use o status canonico como fonte principal;
- use `provider_status` apenas como apoio;
- nao inferir entrega a partir de `accepted_by_evolution`;
- nao inferir leitura a partir de `delivered`;
- considere que `read` pode nunca vir;
- considere que `deleted` pode nunca vir se a Evolution nao emitir o evento.

## 6. Campos uteis por tipo de tela

### Chips / badges

Use principalmente:

- `status` do ledger de transporte, quando o endpoint existir;
- `status` do `NotificationLog` para fila operacional;
- `persistedStatus` para estado da conexao do WhatsApp.

### Timeline

Quando o backend expor o ledger de transporte, a timeline deve usar:

- `queued_at`
- `accepted_at`
- `server_ack_at`
- `delivered_at`
- `read_at`
- `failed_at`
- `deleted_at`

### Mensagem de erro

Use:

- `error_message`
- `error_code`
- `error_http_status`
- `raw_last_error` apenas para auditoria interna

### Auditoria

Use:

- `raw_send_response`
- `raw_last_webhook_payload`
- `status_history`
- `provider_message_id`
- `provider_status`

### Reenvio

Use:

- `invoice_id`
- `status`
- `error_code`
- `error_message`
- `error_http_status`

### Filtros

Hoje os filtros disponiveis no frontend se limitam aos endpoints existentes:

- `GET /api/notifications/logs`: filtro por `status`, pagina e data
- `GET /api/notifications/stats`: agregacao por estado diario
- `GET /api/notifications/forecast`: data de referencia

Quando o ledger de transporte for exposto, os filtros ideais serao:

- `status`
- `provider_status`
- `instance_name`
- `destination`
- `provider_message_id`
- `date range`

## 7. Limites e pendencias

### Ja esta pronto

- persistencia interna do transporte;
- captura de resposta do envio;
- ingestao de `SEND_MESSAGE`, `MESSAGES_UPDATE` e `MESSAGES_DELETE`;
- protecao contra regressao de status;
- persistencia de payload bruto no backend.

### Ainda nao esta exposto para o frontend

- lista de `WhatsappTransportLog`;
- leitura de timeline de transporte por mensagem;
- filtro por `provider_message_id`;
- auditoria de delivery/read por tela.

### Dependencias externas

- `MESSAGES_DELETE` depende de a Evolution efetivamente emitir esse evento;
- `read` depende do comportamento do destinatario e do WhatsApp;
- webhooks dependem da instancia Evolution estar configurada com os eventos corretos.

### Caveats importantes

- o backend pode receber `accepted_by_evolution` sem nunca receber `delivered`;
- o backend pode receber `delivered` sem nunca receber `read`;
- o frontend nao deve assumir que a ausencia de `read` significa erro;
- o frontend nao deve usar `NotificationLog.sent` como prova de entrega.

## 8. Exemplo de como o frontend deve pensar

### Exemplo correto

- o log operacional mostra `sent`;
- o transport ledger, quando exposto, mostra `accepted_by_evolution`;
- depois `server_ack`;
- depois, eventualmente, `delivered`;
- depois, eventualmente, `read`.

### Exemplo incorreto

- considerar `NotificationLog.sent` como sinônimo de entrega;
- considerar `accepted_by_evolution` como sinonimo de dois tiques;
- esconder falha porque o webhook nao trouxe `read`.

## 9. Checklist para o time Flutter

- confirmar quais telas usam apenas `NotificationLog` e quais vao precisar do ledger de transporte no futuro;
- mapear `NotificationLog.status` como estado operacional, nao como status de entrega;
- tratar `status` e `persistedStatus` da conexao do WhatsApp separadamente do status da mensagem;
- tratar todos os campos de data como opcionais;
- exibir `error_message`, `error_code` e `error_http_status` quando houver falha;
- nao assumir leitura sem `read_at`;
- nao assumir entrega sem `delivered_at`;
- nao assumir sucesso total sem `provider_message_id` e sem payload persistido;
- preparar o model Flutter para receber um ledger de transporte quando o endpoint for criado;
- alinhar com o backend antes de criar qualquer contrato novo de leitura do transporte.

## 10. Conclusao pratica

O frontend ja pode consumir os endpoints existentes para:

- conexao do WhatsApp;
- logs operacionais de notificacao;
- stats do dia;
- forecast;
- configuracao;
- reenfileiramento manual.

O frontend ainda nao pode consumir o ledger de transporte real, porque esse contrato de leitura nao foi exposto em API publica/authenticated.

Quando esse endpoint for criado, este contrato deve ser expandido com:

- listagem por mensagem;
- timeline completa;
- filtro por `provider_message_id`;
- view detalhada de `status_history`;
- leitura de payload bruto para auditoria.
