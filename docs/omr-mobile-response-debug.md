# OMR Mobile Response Debug

Data: 2026-06-16

## Contexto

Fluxo afetado:

```txt
AcademyHub Mobile Web
POST /api/exams/process-omr
OMR_ENGINE_VERSION=v2
prova com 15 questoes
```

Sintoma observado:

```txt
Correcao Concluida!
O resultado esta pronto para validacao.
```

Depois do toast, o app continuava na camera e nao abria o bottom sheet com a nota e os botoes Cancelar/Confirmar.

## Causa encontrada

O backend passou a retornar `correctionDetails` como objeto estruturado:

```json
{
  "correctionDetails": {
    "totalQuestions": 15,
    "correctCount": 15,
    "wrongCount": 0,
    "blankCount": 0,
    "multipleCount": 0,
    "studentAnswers": {},
    "answerKey": {},
    "questionResults": []
  }
}
```

O Mobile Web ainda esperava o contrato legado:

```dart
details = aiResult['correctionDetails'] as List<dynamic>;
```

Esse cast falhava depois do dialog de sucesso e antes da chamada de `_showGradeConfirmationModal`, por isso o card de validacao nao abria.

## Contrato corrigido no backend

O endpoint continua retornando a nota normalizada e os campos estruturados no topo:

```json
{
  "success": true,
  "imageStatus": "accepted",
  "grade": 10,
  "objectiveGrade": 10,
  "maxGrade": 10,
  "totalQuestions": 15,
  "correctCount": 15,
  "wrongCount": 0,
  "blankCount": 0,
  "multipleCount": 0,
  "uncertainCount": 0,
  "notDetectedCount": 0,
  "studentAnswers": {
    "1": "A"
  },
  "answerKey": {
    "1": "A"
  },
  "questionResults": [],
  "correctionDetails": [],
  "correctionSummary": {
    "totalQuestions": 15,
    "correctCount": 15,
    "wrongCount": 0,
    "blankCount": 0,
    "multipleCount": 0,
    "uncertainCount": 0,
    "notDetectedCount": 0,
    "studentAnswers": {},
    "answerKey": {},
    "questionResults": []
  },
  "correctionDetailsPayload": {
    "totalQuestions": 15,
    "correctCount": 15,
    "wrongCount": 0,
    "blankCount": 0,
    "multipleCount": 0,
    "uncertainCount": 0,
    "notDetectedCount": 0,
    "studentAnswers": {},
    "answerKey": {},
    "questionResults": []
  }
}
```

Compatibilidade:

- `correctionDetails`: volta a ser a lista legada para front antigo.
- `correctionSummary`: novo resumo estruturado para UI e persistencia detalhada.
- `correctionDetailsPayload`: alias temporario do resumo estruturado.
- `questionResults`, `studentAnswers` e `answerKey`: continuam no topo para consumo direto.

## Ajuste no Mobile Web

O Mobile agora aceita:

- `correctionDetails` como lista legada;
- `correctionDetails.questionResults` quando vier como objeto;
- `correctionSummary.questionResults`;
- `correctionDetailsPayload.questionResults`;
- `questionResults` no topo.

O card passa a exibir:

```txt
Nota calculada pela IA: 10.0
Acertos: 15/15
```

No Confirmar, o Mobile envia:

- `grade`;
- `objectiveGrade`;
- `answers`;
- `correctionDetails` estruturado;
- contadores de questoes.
