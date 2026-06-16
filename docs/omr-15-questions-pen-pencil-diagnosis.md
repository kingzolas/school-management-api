# OMR 15 Questions Pen vs Pencil Diagnosis

Generated at: 2026-06-16T19:22:18.727Z

## Summary

- Expected questions: 15
- Pen image status: accepted
- Pencil image status: accepted
- Pen confidence: 0.66
- Pencil confidence: 0.6498
- Answers equal: yes
- Passed: yes

## Question Comparison

| Questao | Caneta | Conf. Caneta | Lapis | Conf. Lapis | Divergencia |
|---:|---|---:|---|---:|---|
| 1 | B (marked) | 0.66 | B (marked) | 1 | nao |
| 2 | C (marked) | 0.66 | C (marked) | 0.66 | nao |
| 3 | D (marked) | 0.66 | D (marked) | 1 | nao |
| 4 | C (marked) | 0.66 | C (marked) | 0.9911 | nao |
| 5 | D (marked) | 1 | D (marked) | 0.66 | nao |
| 6 | D (marked) | 0.712 | D (marked) | 1 | nao |
| 7 | D (marked) | 0.8794 | D (marked) | 0.66 | nao |
| 8 | C (marked) | 1 | C (marked) | 0.66 | nao |
| 9 | D (marked) | 1 | D (marked) | 0.66 | nao |
| 10 | D (marked) | 1 | D (marked) | 0.66 | nao |
| 11 | E (marked) | 1 | E (marked) | 0.9771 | nao |
| 12 | D (marked) | 1 | D (marked) | 0.66 | nao |
| 13 | C (marked) | 1 | C (marked) | 0.66 | nao |
| 14 | D (marked) | 1 | D (marked) | 0.6498 | nao |
| 15 | D (marked) | 1 | D (marked) | 0.7398 | nao |

## Diagnosis

Os dois artefatos vieram do fluxo real do AcademyHub Mobile Web. O problema observado antes da correcao era falso branco/baixa confianca no lapis quando a marca ficava clara ou fora do miolo da bolha. O layout de 15 questoes estava coerente: requestedQuestions, detectedQuestions e evaluatedQuestions permaneceram em 15.

A correcao usa evidencia complementar de marca fraca baseada em contraste local e preenchimento do ROI maior da bolha, preservando o innerFillRatio como sinal principal. Isso evita baixar thresholds globais e reduz o risco de transformar bordas, sombra ou sujeira em resposta.

