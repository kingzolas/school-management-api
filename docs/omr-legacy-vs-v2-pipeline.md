# OMR legado vs OMR v2 - pipeline de compatibilidade

Data: 2026-06-15
Branch: `feature/omr-v2-engine`

## Resumo executivo

O detector de folha/ancoras usado pelo v2 segue o mesmo fluxo base do legado. A diferenca critica encontrada nesta auditoria nao esta na calibracao das bolhas, mas no contrato do adapter v2:

- o legado retorna `success: true` quando a leitura de bolhas termina, mesmo que alguma questao seja `blank`, `multiple` ou `ambiguous`;
- o v2 estava retornando `success: false` para qualquer `imageStatus` diferente de `accepted`;
- com isso, leituras v2 concluidas como `review_required` eram interrompidas pelo controller antes da montagem de `grade`, `objectiveGrade` e `correctionDetails`;
- o v2 tambem podia repassar a mensagem interna "Area OMR principal detectada com sucesso." sem entregar a correcao, gerando a sensacao de sucesso parcial no front.

Correcao aplicada: `review_required` agora e tratado como leitura concluida para resposta da API, mas a persistencia automatica da nota fica bloqueada. `recapture_required` continua retornando erro controlado.

## OMR legado

### Entrada

- Rota principal: `POST /api/exams/process-omr`.
- Controller: `src/api/controllers/exam.controller.js`.
- Service de subprocesso: `src/api/services/omrProcessing.service.js`.
- Script Python: `src/scripts/process_omr.py`.
- Recebe a imagem em base64 no body (`image`/`imageBase64`, conforme fluxo do front).
- A API remove o prefixo `data:image/...;base64,` e grava bytes brutos em `00_input.jpg`.
- Nao ha crop, resize, normalizacao EXIF ou rotacao no Node antes do Python.
- O legado recebe a imagem completa salva em disco.

### Processamento

- `process_omr.py` carrega o layout JSON da prova.
- `academyhub_omr.omr_runner` abre a imagem com OpenCV.
- O runner converte para grayscale e executa `AcademyHubSheetDetector`.
- O detector localiza a area OMR principal, procura quatro ancoras e faz a homografia.
- Quando a homografia existe, `AcademyHubBubbleReader` le as bolhas.
- Quando a deteccao de ancoras falha, o legado cria respostas sintaticas por questao com status `blank`, embora o erro real seja de captura.

### Retorno

- O script retorna JSON puro no stdout.
- Campos principais:
  - `success`
  - `type`
  - `stage`
  - `message`
  - `anchorsFound`
  - `questionsCount`
  - `answers`
  - `debug`
- `answers` e um array compativel com `examService.buildBubbleSheetCorrection`.
- O controller so chama `buildBubbleSheetCorrection` quando `result.success === true`.
- Em sucesso, o controller retorna `grade`, `objectiveGrade`, `correctionDetails` e pode persistir via `scanExamSheet`.
- Em erro, o controller retorna HTTP 200 com mensagem amigavel para o front.

## OMR v2 atual

### Entrada

- Usa a mesma rota: `POST /api/exams/process-omr`.
- Usa o mesmo controller e o mesmo `omrProcessing.service.js`.
- Script Python: `src/scripts/process_omr_v2.py`.
- Recebe a mesma imagem completa salva como `00_input.jpg`.
- Nao ha crop, resize, normalizacao EXIF ou rotacao no Node antes do Python.
- A quantidade de questoes vem da prova/layout, com suporte dinamico de 1 a 40 questoes.

### Processamento

- `process_omr_v2.py` valida `totalQuestions` entre 1 e 40.
- `academyhub_omr_v2.layout_adapter` monta layout dinamico.
- `academyhub_omr_v2.omr_runner` executa o mesmo detector de folha/ancoras do legado.
- A falha de ancoras passa a gerar `not_detected`, nao `blank`.
- A leitura concluida pode resultar em:
  - `accepted`
  - `review_required`
  - `recapture_required`
- `review_required` cobre multipla marcacao, questao incerta ou baixa confianca localizada.

### Retorno

- O v2 retorna o contrato novo, mantendo `answers` array para compatibilidade:
  - `success`
  - `imageStatus`
  - `errorCode`
  - `layoutVersion`
  - `requestedQuestions`
  - `detectedQuestions`
  - `evaluatedQuestions`
  - `confidence`
  - `answersMap`
  - `answers`
  - `questions`
  - `debug`
- Regra corrigida:
  - `accepted`: `success: true`, pode montar correcao e persistir se a rota pedir.
  - `review_required`: `success: true`, pode montar correcao para exibicao, mas nao persiste nota automaticamente.
  - `recapture_required`: `success: false`, nao monta correcao nem persiste.

## Comparativo

| Etapa | Legado | V2 | Diferenca | Risco |
| --- | --- | --- | --- | --- |
| Recebimento da imagem | Base64 gravado como `00_input.jpg` | Mesmo fluxo | Sem diferenca relevante | Baixo |
| EXIF/orientacao | Sem normalizacao no Node | Sem normalizacao no Node | Sem diferenca no adapter | Medio se fotos dependerem de EXIF |
| Crop | Nao ha crop no Node | Nao ha crop no Node | Sem diferenca | Baixo |
| Resize | Nao ha resize no Node | Nao ha resize no Node | Sem diferenca | Baixo |
| Threshold | Python legado | Python v2 equivalente | Sem recalibracao nesta etapa | Baixo |
| Deteccao da area OMR principal | `AcademyHubSheetDetector` | Mesmo detector base | Sem diferenca principal | Baixo |
| Deteccao de ancoras | Falha podia virar `blank` sintatico | Falha vira `not_detected`/`recapture_required` | V2 e mais seguro | Medio para mensagens antigas |
| Leitura de bolhas | Retorna `answers` array | Retorna `answers` array e `questions` contrato novo | Compatibilidade preservada | Baixo |
| Retorno de sucesso parcial | `success: true` se a leitura terminou | Antes: `success: false` para `review_required`; agora corrigido | Causa provavel da falha do front | Alto antes da correcao |
| Retorno de erro | HTTP 200 com `success:false` e mensagem | Mesmo padrao, com `imageStatus` e `errorCode` | Mais estruturado no v2 | Baixo |
| Mapeamento para front | Controller monta grade/correctionDetails quando `success:true` | Agora tambem monta para `review_required` | Corrigido | Alto antes da correcao |
| Persistencia de nota | Persiste em sucesso legado | V2 persiste somente `accepted` | Mais seguro | Baixo |

## Causa provavel da falha observada

O log informado mostrou:

```txt
pythonHomographyMs: 0
pythonBubbleReadMs: 0
```

Esse caso especifico indica que o Python nao chegou a homografia/leitura, provavelmente por baixa confianca na deteccao das quatro ancoras. Mesmo que o preview visual do front mostre os cantos dentro da mascara, o detector pode ter recebido outra imagem efetiva ou pode ter rejeitado os candidatos por geometria/contraste. Para confirmar isso, e necessario capturar os artefatos de debug da mesma requisicao.

O segundo sintoma, "Area OMR principal detectada com sucesso" sem resultado de correcao, tinha causa de adapter: o v2 podia concluir a leitura como `review_required`, mas enviava `success:false` e `evaluatedQuestions:0`. O controller entao retornava antes de montar `correctionDetails`.

## Debug temporario recomendado

Para capturar a imagem real recebida pela API e comparar entrada legado/v2:

```env
OMR_DEBUG_ENABLED=true
OMR_DEBUG_SAVE_IMAGES=true
KEEP_OMR_DEBUG_FILES=true
```

Com a correcao atual, quando debug estiver ativo, o diretorio da sessao passa a incluir:

- `original-received.jpg`
- `legacy-input.jpg` ou `v2-input.jpg`
- `legacy-threshold.jpg` ou `v2-threshold.jpg`
- `legacy-anchor-overlay.jpg` ou `v2-anchor-overlay.jpg`
- `legacy-result.json` ou `v2-result.json`
- `debug.json`
- `manifest.json`

Esses arquivos devem ficar desativados em producao normal.

## Regra de sucesso segura

A API so deve considerar leitura OMR concluida quando:

- `imageStatus` e `accepted` ou `review_required`;
- `evaluatedQuestions > 0`;
- `answers.length` corresponde a quantidade esperada da prova;
- a quantidade detectada bate com a quantidade solicitada.

Somente `accepted` pode persistir nota automaticamente. `review_required` deve retornar o resultado para revisao, mas sem gravacao silenciosa.

## Estado recomendado de producao

Enquanto a correcao nao estiver em producao, a recomendacao mais segura e voltar temporariamente para:

```env
OMR_ENGINE_VERSION=legacy
```

Depois de publicar esta correcao, o primeiro passo recomendado e:

```env
OMR_ENGINE_VERSION=shadow
```

Somente apos comparar logs e artefatos reais deve-se voltar a:

```env
OMR_ENGINE_VERSION=v2
```

## Pendencias para fechar o incidente

- Capturar a imagem real da requisicao que falhou com debug ativo.
- Comparar `legacy-input.jpg` e `v2-input.jpg` no mesmo fluxo.
- Conferir `v2-anchor-overlay.jpg` para saber quantas ancoras o detector realmente aceitou.
- Confirmar se o PDF/cartao usado em producao corresponde ao layout esperado pelo v2.
- Validar se ha cartoes antigos com diferenca de tamanho/posicao das ancoras.
