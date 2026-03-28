# WhatsApp Transport Handoff

Documento de handoff tecnico da nova estrutura de rastreamento de mensagens WhatsApp via Evolution API no backend do Academy Hub.

Este arquivo descreve a estrutura interna implementada no backend, o fluxo canônico de status, os campos persistidos, os eventos da Evolution usados e as limitacoes atuais. Para o contrato de consumo pelo Flutter, ver [whatsapp-transport-api-contract.md](whatsapp-transport-api-contract.md).

## 1. Visao geral

### Problema anterior

Antes desta estruturacao, o backend tratava a resposta HTTP de envio como se fosse prova de entrega. Na pratica:

- `NotificationLog.sent` era usado como indicador operacional de envio do job.
- A resposta da Evolution era descartada no envio.
- Os webhooks de status da Evolution nao eram consumidos.
- O backend nao persistia `provider_message_id`, nem payload bruto de envio ou de update.
- Nao havia trilha confiavel para diferenciar:
  - requisicao aceita localmente;
  - mensagem aceita pela Evolution;
  - ack do servidor;
  - entrega;
  - leitura;
  - falha;
  - exclusao.

### O que mudou

O backend passou a ter um ledger proprio de transporte de mensagens WhatsApp, separado do fluxo de negocio de cobranca.

As mudancas principais foram:

- persistencia da resposta do envio;
- captura de `provider_message_id` e timestamps do provider quando existem;
- ingestao de `SEND_MESSAGE`, `MESSAGES_UPDATE` e `MESSAGES_DELETE`;
- persistencia de payload bruto de envio e de webhook;
- status canonicos internos com protecao contra regressao;
- idempotencia por `provider_message_id + instance_name` quando o provider message id esta disponivel.

### Porque isso foi feito

O objetivo e parar de tratar "aceito pela API" como "entregue". A nova modelagem separa:

- estado operacional do job;
- estado de transporte real da mensagem;
- evidencias brutas do provider;
- timestamps por etapa.

### Diferenca entre os estados

| Conceito | O que significa | Fonte |
| --- | --- | --- |
| Requisicao aceita | O backend chamou a Evolution e a request foi enviada com sucesso localmente | `whatsapp.service.js` |
| Mensagem aceita pela Evolution | A Evolution aceitou o envio e retornou resposta valida | resposta HTTP do send e evento `SEND_MESSAGE` |
| Ack do servidor | O provider confirmou processamento/ack do lado do WhatsApp | evento `MESSAGES_UPDATE` com `SERVER_ACK` |
| Entregue | O WhatsApp sinalizou entrega ao dispositivo do destinatario | evento `MESSAGES_UPDATE` com `DELIVERY_ACK` |
| Lida | O destinatario leu a mensagem | evento `MESSAGES_UPDATE` com `READ` |
| Falha | O envio ou o provider reportou erro | erro do send ou `MESSAGES_UPDATE` com `ERROR` |
| Deletada | O provider reportou remocao/exclusao da mensagem | evento `MESSAGES_DELETE` ou status `DELETED` |

## 2. Fluxo de status

A estrutura canonica atual do backend usa estes estados:

- `queued`
- `accepted_by_evolution`
- `server_ack`
- `delivered`
- `read`
- `failed`
- `deleted`

### Semantica por status

| Status | Significado | Evento / origem | Confianca | Timestamp esperado |
| --- | --- | --- | --- | --- |
| `queued` | Mensagem entrou na fila local do backend e ainda nao teve confirmacao do provider | Fluxo local antes do send | Alta, apenas local | `queued_at` |
| `accepted_by_evolution` | A Evolution aceitou a requisicao de envio ou sinalizou o envio inicial | Resposta do `sendText` / `sendFile` e/ou `SEND_MESSAGE` | Media-alta, mas nao e prova de entrega | `accepted_at` |
| `server_ack` | O provider reportou ack de servidor para a mensagem | `MESSAGES_UPDATE` com `SERVER_ACK` | Alta para ack do provider, nao para entrega final | `server_ack_at` |
| `delivered` | O WhatsApp reportou entrega ao dispositivo do destinatario | `MESSAGES_UPDATE` com `DELIVERY_ACK` | Alta, mas depende do provider emitir o evento | `delivered_at` |
| `read` | O destinatario abriu/leu a mensagem | `MESSAGES_UPDATE` com `READ` | Media, depende do comportamento do usuario e do app | `read_at` |
| `failed` | A mensagem nao foi aceita ou o provider reportou erro | Erro no send ou `MESSAGES_UPDATE` com `ERROR` | Alta quando ha erro explicito | `failed_at` |
| `deleted` | A mensagem foi deletada ou o provider reportou exclusao | `MESSAGES_DELETE` ou status `DELETED` | Media, depende do provider e da configuracao de eventos | `deleted_at` |

### Observacoes importantes

- `accepted_by_evolution` nao significa entregue.
- `server_ack` nao significa entregue.
- `delivered` nao significa lida.
- `read` pode nunca acontecer, mesmo com entrega bem-sucedida.
- O backend guarda tambem `provider_status` bruto para preservar o valor original do provider.
- `PLAYED` existe no provider Evolution em alguns fluxos, mas nao foi promovido a estado canonico no Academy Hub; ele fica apenas como status bruto, se vier.

## 3. Campos persistidos

O ledger de transporte foi modelado no backend no arquivo [`src/api/models/whatsapp_transport_log.model.js`](../src/api/models/whatsapp_transport_log.model.js).

### Campo a campo

| Campo | Tipo esperado | Pode ser null | Finalidade / momento de preenchimento |
| --- | --- | --- | --- |
| `school_id` | `ObjectId` | Nao | Identifica a escola dona do envio |
| `instance_name` | `string` | Nao | Nome da instancia Evolution usada no envio |
| `instance_id` | `string` | Sim | ID da instancia quando a Evolution o disponibiliza |
| `provider_message_id` | `string` | Sim | Identificador da mensagem no provider; base da correlacao |
| `remote_jid` | `string` | Sim | JID do destinatario, quando disponivel |
| `destination` | `string` | Sim | Numero normalizado do destino, geralmente telefone em formato numerico |
| `source` | `string` | Nao | Origem interna do envio (`notification.service`, `whatsappBot.service`, `whatsapp.subscriber`, etc.) |
| `status` | `string` | Nao | Status canonico atual do transporte |
| `status_rank` | `number` | Nao | Ordem monotonica de estado para evitar regressao |
| `provider_status` | `string` | Sim | Status bruto do provider (`PENDING`, `SERVER_ACK`, `DELIVERY_ACK`, `READ`, `ERROR`, `DELETED`, etc.) |
| `provider_message_timestamp` | `Date` | Sim | Timestamp bruto do provider, quando a Evolution envia essa informacao |
| `queued_at` | `Date` | Sim | Quando o backend iniciou o fluxo de envio |
| `accepted_at` | `Date` | Sim | Quando o backend recebeu confirmacao de envio aceito pela Evolution |
| `server_ack_at` | `Date` | Sim | Quando o ack de servidor foi registrado |
| `delivered_at` | `Date` | Sim | Quando a entrega foi confirmada |
| `read_at` | `Date` | Sim | Quando a leitura foi confirmada |
| `failed_at` | `Date` | Sim | Quando a falha foi registrada |
| `deleted_at` | `Date` | Sim | Quando a remocao/exclusao foi registrada |
| `last_event_at` | `Date` | Sim | Timestamp do ultimo evento processado para este transporte |
| `last_event_type` | `string` | Sim | Ultimo tipo de evento observado (`SEND_MESSAGE`, `MESSAGES_UPDATE`, `SEND_MESSAGE_ERROR`, etc.) |
| `raw_send_response` | `Mixed` | Sim | Body bruto da resposta do envio aceito pela Evolution |
| `raw_last_webhook_payload` | `Mixed` | Sim | Ultimo payload bruto de webhook armazenado |
| `raw_last_error` | `Mixed` | Sim | Erro bruto associado ao envio, quando houver |
| `error_message` | `string` | Sim | Mensagem amigavel do erro |
| `error_code` | `string` | Sim | Codigo do erro, se o provider ou o client o informar |
| `error_http_status` | `number` | Sim | HTTP status do erro, quando existir |
| `attempts` | `number` | Nao | Numero minimo de tentativas/ocorrencias registradas |
| `metadata` | `Mixed` | Sim | Metadados internos da origem do envio e da correlacao |
| `status_history` | `Array<Subdocument>` | Nao | Historico de eventos do transporte, com limite de 20 entradas |

### Observacoes de implementacao

- O ledger usa um indice unico parcial por `school_id + instance_name + provider_message_id` quando o `provider_message_id` existe.
- `status_history` e mantido com limite de 20 registros por documento.
- `raw_send_response`, `raw_last_webhook_payload` e `raw_last_error` sao campos de auditoria, nao devem ser usados como fonte primaria para logica de UI.
- O ledger nao substitui `NotificationLog`; ele complementa o fluxo de transporte.

## 4. Eventos da Evolution usados

### Eventos relevantes para transporte

| Evento | Papel no Academy Hub | Campos relevantes esperados | Uso no backend |
| --- | --- | --- | --- |
| `SEND_MESSAGE` | Confirma a aceitagao inicial do envio pela Evolution | `key.id`, `key.remoteJid`, `messageTimestamp`, `status`, `instanceId` | Atualiza `accepted_by_evolution`, `provider_message_id`, `accepted_at`, `raw_send_response` |
| `MESSAGES_UPDATE` | Alimenta transicoes de status de transporte | `keyId`, `remoteJid`, `fromMe`, `participant`, `status`, `messageId`, `instanceId` | Atualiza `server_ack`, `delivered`, `read`, `failed` quando aplicavel |
| `MESSAGES_DELETE` | Sinaliza exclusao/remocao da mensagem | `key`, `status`, `instanceId` | Atualiza `deleted` e registra payload bruto |

### Eventos relacionados, mas nao canonicos de transporte

| Evento | Papel | Observacao |
| --- | --- | --- |
| `MESSAGES_UPSERT` | Inbound / recebimento de mensagens | Continua sendo usado pelo bot, nao representa transporte de outbound |
| `CONNECTION_UPDATE` | Estado da conexao da instancia | Usado para status da conexao da escola, nao de mensagem |
| `QRCODE_UPDATED` | Setup da conexao | Usado apenas para pareamento |
| `SEND_MESSAGE_UPDATE` | Edicao de mensagem enviada | Nao e parte do fluxo canonico de transporte atual |

### O que o backend faz com os eventos

- `SEND_MESSAGE`, `MESSAGES_UPDATE` e `MESSAGES_DELETE` sao persistidos no ledger de transporte.
- O payload bruto do webhook tambem e armazenado.
- Os eventos de inbound continuam alimentando o bot e nao foram misturados com o transporte.

## 5. Regras importantes de negocio e tecnicas

- `NotificationLog.sent` continua sendo estado operacional do job da fila. Nao deve ser interpretado como entrega.
- O backend agora diferencia processamento local de transporte real.
- O estado do transporte nao pode regredir. Um evento antigo nao sobrescreve um estado mais avancado.
- A correlacao principal e feita por `provider_message_id + instance_name`.
- Quando `provider_message_id` nao existe, a correlacao fica degradada e nao ha garantia de idempotencia forte.
- Repeticoes de webhook podem acrescentar historico, mas nao devem rebaixar o status atual.
- `provider_status` deve ser tratado como apoio e auditoria, nao como status de UX primario.
- Payload bruto foi intencionalmente mantido para diagnostico de integracao e analise de problemas de entrega.

## 6. Estrutura pronta para consumo

### O que esta pronto no backend

- Persistencia do ledger de transporte.
- Captura de resposta de envio.
- Captura de eventos de status da Evolution.
- Protecao contra regressao de status.
- Metadados de origem do envio.

### O que ainda nao esta exposto como endpoint

- Nao existe, neste momento, um endpoint publico/authenticated para listar `WhatsappTransportLog`.
- O front-end ainda nao pode consumir esse ledger diretamente por API.

### Contrato de leitura atual

Para o contrato de leitura ja existente no frontend, ver:

- [whatsapp-transport-api-contract.md](whatsapp-transport-api-contract.md)

## 7. Exemplos reais de payload / shape

Os exemplos abaixo sao coerentes com a modelagem implementada. Sao exemplos sintaticos, nao dumps reais.

### 7.1 Documento inicial apos envio aceito

```json
{
  "school_id": "66b7f7b1d7d6e6b8d1a10001",
  "instance_name": "school_66b7f7b1d7d6e6b8d1a10001",
  "instance_id": "instance-01",
  "provider_message_id": "3EB0B0A12D3C4E5F@s.whatsapp.net",
  "remote_jid": "5511999999999@s.whatsapp.net",
  "destination": "5511999999999",
  "source": "notification.service",
  "status": "accepted_by_evolution",
  "status_rank": 20,
  "provider_status": null,
  "provider_message_timestamp": "2026-03-28T10:15:02.000Z",
  "queued_at": "2026-03-28T10:15:01.120Z",
  "accepted_at": "2026-03-28T10:15:02.450Z",
  "server_ack_at": null,
  "delivered_at": null,
  "read_at": null,
  "failed_at": null,
  "deleted_at": null,
  "last_event_at": "2026-03-28T10:15:02.450Z",
  "last_event_type": "SEND_MESSAGE",
  "raw_send_response": {
    "key": {
      "id": "3EB0B0A12D3C4E5F@s.whatsapp.net",
      "remoteJid": "5511999999999@s.whatsapp.net",
      "fromMe": true
    },
    "status": "PENDING",
    "messageTimestamp": 1743156902
  },
  "raw_last_webhook_payload": null,
  "raw_last_error": null,
  "error_message": null,
  "error_code": null,
  "error_http_status": null,
  "attempts": 1,
  "metadata": {
    "notification_log_id": "66b7f7b1d7d6e6b8d1a10011",
    "request_kind": "text",
    "transport_kind": "text"
  },
  "status_history": [
    {
      "event_type": "SEND_REQUEST",
      "canonical_status": "queued",
      "occurred_at": "2026-03-28T10:15:01.120Z",
      "source": "notification.service"
    },
    {
      "event_type": "SEND_MESSAGE",
      "canonical_status": "accepted_by_evolution",
      "provider_status": "PENDING",
      "occurred_at": "2026-03-28T10:15:02.450Z",
      "source": "notification.service"
    }
  ]
}
```

### 7.2 Depois de `SERVER_ACK`

```json
{
  "status": "server_ack",
  "provider_status": "SERVER_ACK",
  "server_ack_at": "2026-03-28T10:15:03.100Z",
  "last_event_at": "2026-03-28T10:15:03.100Z",
  "last_event_type": "MESSAGES_UPDATE"
}
```

### 7.3 Depois de `DELIVERY_ACK`

```json
{
  "status": "delivered",
  "provider_status": "DELIVERY_ACK",
  "delivered_at": "2026-03-28T10:15:05.800Z",
  "last_event_at": "2026-03-28T10:15:05.800Z",
  "last_event_type": "MESSAGES_UPDATE"
}
```

### 7.4 Depois de `READ`

```json
{
  "status": "read",
  "provider_status": "READ",
  "read_at": "2026-03-28T10:16:11.250Z",
  "last_event_at": "2026-03-28T10:16:11.250Z",
  "last_event_type": "MESSAGES_UPDATE"
}
```

### 7.5 Falha de envio

```json
{
  "status": "failed",
  "provider_status": "ERROR",
  "failed_at": "2026-03-28T10:15:02.900Z",
  "error_message": "Falha no envio WhatsApp: arquivo nao encontrado na URL informada.",
  "error_code": "ECONNABORTED",
  "error_http_status": 400,
  "raw_last_error": {
    "message": "Request failed with status code 400",
    "details": "..."
  },
  "last_event_type": "SEND_MESSAGE_ERROR"
}
```

## 8. O que o front-end deve considerar

- Nao tratar `accepted_by_evolution` como entregue.
- Nao tratar `server_ack` como entregue.
- Nao tratar `NotificationLog.sent` como prova de entrega.
- Usar `provider_status` apenas como contexto auxiliar.
- Exibir a timeline por etapas quando houver dados.
- Considerar que alguns campos podem ser `null`.
- Considerar que `read` pode nunca chegar.
- Exibir erro com `error_message`, `error_code` e `error_http_status` quando houver.
- Tratar `raw_*` como auditoria e nao como dado de UX principal.
- Preparar UI para registros sem `provider_message_id` em cenarios degradados, embora isso nao seja o caso ideal.

## 9. Limitacoes e pendencias

- O ledger de transporte esta pronto na persistencia, mas ainda nao ha endpoint publico/authenticated para leitura.
- O backend ainda nao fornece listagem paginada desse ledger para o front.
- `MESSAGES_DELETE` depende da Evolution emitir o evento e da instancia estar com a assinatura correta.
- `PLAYED` nao foi modelado como estado canonico.
- Status sem `provider_message_id` ficam com correlacao mais fraca.
- A validacao em runtime com mensagem de texto, documento e erro real ainda deve ser feita em ambiente local.
- Payloads brutos podem crescer; devem ser usados para auditoria, nao como fonte primaria de exibicao padrao.

## 10. Checklist para o front-end

- [ ] Ler o contrato de endpoint atual em [whatsapp-transport-api-contract.md](whatsapp-transport-api-contract.md).
- [ ] Modelar o ledger de transporte com todos os campos canonicamente relevantes.
- [ ] Mapear `queued`, `accepted_by_evolution`, `server_ack`, `delivered`, `read`, `failed` e `deleted` para UI.
- [ ] Exibir chips ou badges diferentes para estado canonico e para `provider_status`.
- [ ] Montar timeline com timestamps por etapa.
- [ ] Tratar `null` em todos os timestamps e campos auxiliares.
- [ ] Tratar falha com `error_message`, `error_code` e `error_http_status`.
- [ ] Nao assumir entrega/leitura sem status correspondente.
- [ ] Nao usar `NotificationLog.sent` como prova de entrega.
- [ ] Preparar a UI para eventual endpoint futuro de leitura do `WhatsappTransportLog`.

