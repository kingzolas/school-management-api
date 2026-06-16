# OMR 15 Questions Pen vs Pencil Diagnosis

Generated at: 2026-06-16T22:58:15.074Z

## Summary

- Expected questions: 15
- Pen image status: accepted
- Pencil image status: accepted
- Pen confidence: 0.66
- Pencil confidence: 0.66
- Answers equal: yes
- Passed: yes

## Grid Calibration

| Caso | Status | Circulos detectados | Circulos casados | Erro medio px | Erro maximo px | Drift primeira linha | Drift ultima linha |
|---|---|---:|---:|---:|---:|---:|---:|
| pen | ok | 75 | 75 / 75 | 0.97 | 3.584 | 4.035 | 10.6 |
| pencil | ok | 75 | 75 / 75 | 0.906 | 3.413 | 4.075 | 9.785 |

## Question Comparison

| Questao | Caneta | Conf. Caneta | Lapis | Conf. Lapis | Divergencia |
|---:|---|---:|---|---:|---|
| 1 | B (marked) | 1 | B (marked) | 1 | nao |
| 2 | C (marked) | 0.66 | C (marked) | 1 | nao |
| 3 | D (marked) | 0.66 | D (marked) | 1 | nao |
| 4 | C (marked) | 1 | C (marked) | 1 | nao |
| 5 | D (marked) | 1 | D (marked) | 1 | nao |
| 6 | D (marked) | 1 | D (marked) | 0.66 | nao |
| 7 | D (marked) | 1 | D (marked) | 1 | nao |
| 8 | C (marked) | 1 | C (marked) | 1 | nao |
| 9 | D (marked) | 0.7398 | D (marked) | 1 | nao |
| 10 | D (marked) | 1 | D (marked) | 0.9633 | nao |
| 11 | E (marked) | 1 | E (marked) | 1 | nao |
| 12 | D (marked) | 1 | D (marked) | 1 | nao |
| 13 | C (marked) | 1 | C (marked) | 1 | nao |
| 14 | D (marked) | 0.66 | D (marked) | 1 | nao |
| 15 | D (marked) | 0.712 | D (marked) | 1 | nao |

## Diagnosis

Os dois artefatos vieram do fluxo real do AcademyHub Mobile Web. O problema observado antes da correcao era falso branco/baixa confianca no lapis quando a marca ficava clara ou fora do miolo da bolha. O layout de 15 questoes estava coerente: requestedQuestions, detectedQuestions e evaluatedQuestions permaneceram em 15.

A calibracao geometrica agora detecta os circulos reais da folha, ajusta os centros por transformacao afim e expõe erro medio/maximo de alinhamento. O overlay mostra centro teorico em magenta e centro recalibrado em verde.

O threshold de leitura foi ajustado para preservar marcacoes a lapis que ficavam visiveis no grayscale mas sumiam no binario anterior. As regras de decisao e thresholds do weakMarkScore nao foram relaxados nesta rodada.

