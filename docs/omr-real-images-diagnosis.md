# OMR real images diagnosis

Generated at: 2026-06-16T19:51:44.284Z

## Summary

- Images processed: 31
- V2 completed reads: 31
- V2 anchor failures: 0
- V2 recapture_required: 0
- Legacy completed reads: 21
- Input hash mismatches: 0
- Answer divergences: 89

## Findings

- A imagem entregue ao legado e ao v2 e gravada a partir do mesmo base64 da rota, sem crop/resize no Node.
- `inputHashMatches=true` confirma que a imagem temporaria e byte-a-byte igual ao arquivo original usado no teste.
- O v2 deve completar todas as imagens processaveis; `v2AnchorFailures` e `v2RecaptureRequired` precisam ficar em zero neste lote.
- Divergencias de resposta sao informativas neste script: quando o legado falha antes da leitura e o v2 conclui, as respostas aparecem como divergentes sem indicar regressao do v2.
- Quando houver falha de ancoras, consulte `v2-threshold.jpg`, `v2-anchor-overlay.jpg` e `v2-result.json` no diretorio de debug indicado.

## Per image

| Image | Questions | Legacy | V2 | V2 anchors | V2 stage | Divergences | Debug |
| --- | ---: | --- | --- | ---: | --- | ---: | --- |
| Teste Gab OMR/WhatsApp Image 2026-06-15 at 10.32.34.jpeg | 10 | accepted/completed | accepted/completed | 6 | completed | 0 | C:\Users\User\Documents\Projetos\school-management-api\debug\omr-real-images\01-Teste-Gab-OMR-10-32-34\v2 |
| Teste Gab OMR/WhatsApp Image 2026-06-15 at 10.32.46.jpeg | 10 | accepted/completed | review_required/completed | 7 | completed | 2 | C:\Users\User\Documents\Projetos\school-management-api\debug\omr-real-images\02-Teste-Gab-OMR-10-32-46\v2 |
| Teste Gab OMR/WhatsApp Image 2026-06-15 at 10.33.15.jpeg | 10 | accepted/completed | accepted/completed | 11 | completed | 0 | C:\Users\User\Documents\Projetos\school-management-api\debug\omr-real-images\03-Teste-Gab-OMR-10-33-15\v2 |
| Teste Gab OMR/WhatsApp Image 2026-06-15 at 10.33.28.jpeg | 10 | accepted/completed | review_required/completed | 6 | completed | 1 | C:\Users\User\Documents\Projetos\school-management-api\debug\omr-real-images\04-Teste-Gab-OMR-10-33-28\v2 |
| Teste Gab OMR/WhatsApp Image 2026-06-15 at 10.33.41.jpeg | 10 | accepted/completed | review_required/completed | 7 | completed | 4 | C:\Users\User\Documents\Projetos\school-management-api\debug\omr-real-images\05-Teste-Gab-OMR-10-33-41\v2 |
| Teste Gab OMR/WhatsApp Image 2026-06-15 at 10.34.02.jpeg | 10 | accepted/completed | review_required/completed | 6 | completed | 4 | C:\Users\User\Documents\Projetos\school-management-api\debug\omr-real-images\06-Teste-Gab-OMR-10-34-02\v2 |
| Teste Gab OMR/WhatsApp Image 2026-06-15 at 10.34.11.jpeg | 10 | accepted/completed | review_required/completed | 7 | completed | 1 | C:\Users\User\Documents\Projetos\school-management-api\debug\omr-real-images\07-Teste-Gab-OMR-10-34-11\v2 |
| Teste Gab OMR/WhatsApp Image 2026-06-15 at 10.34.47.jpeg | 10 | accepted/completed | review_required/completed | 6 | completed | 1 | C:\Users\User\Documents\Projetos\school-management-api\debug\omr-real-images\08-Teste-Gab-OMR-10-34-47\v2 |
| Teste Gab OMR/WhatsApp Image 2026-06-15 at 10.35.17.jpeg | 10 | accepted/completed | review_required/completed | 6 | completed | 2 | C:\Users\User\Documents\Projetos\school-management-api\debug\omr-real-images\09-Teste-Gab-OMR-10-35-17\v2 |
| Teste Gab OMR/WhatsApp Image 2026-06-15 at 14.53.15.jpeg | 5 | failed/sheet_detection | review_required/completed | 5 | completed | 5 | C:\Users\User\Documents\Projetos\school-management-api\debug\omr-real-images\10-Teste-Gab-OMR-14-53-15\v2 |
| Teste Gab OMR/WhatsApp Image 2026-06-15 at 14.53.16 (1).jpeg | 5 | failed/sheet_detection | review_required/completed | 4 | completed | 5 | C:\Users\User\Documents\Projetos\school-management-api\debug\omr-real-images\11-Teste-Gab-OMR-14-53-16-1\v2 |
| Teste Gab OMR/WhatsApp Image 2026-06-15 at 14.53.16 (2).jpeg | 5 | failed/sheet_detection | accepted/completed | 4 | completed | 5 | C:\Users\User\Documents\Projetos\school-management-api\debug\omr-real-images\12-Teste-Gab-OMR-14-53-16-2\v2 |
| Teste Gab OMR/WhatsApp Image 2026-06-15 at 14.53.16 (3).jpeg | 10 | accepted/completed | accepted/completed | 5 | completed | 0 | C:\Users\User\Documents\Projetos\school-management-api\debug\omr-real-images\13-Teste-Gab-OMR-14-53-16-3\v2 |
| Teste Gab OMR/WhatsApp Image 2026-06-15 at 14.53.16 (4).jpeg | 10 | accepted/completed | accepted/completed | 4 | completed | 0 | C:\Users\User\Documents\Projetos\school-management-api\debug\omr-real-images\14-Teste-Gab-OMR-14-53-16-4\v2 |
| Teste Gab OMR/WhatsApp Image 2026-06-15 at 14.53.16.jpeg | 5 | failed/sheet_detection | review_required/completed | 5 | completed | 5 | C:\Users\User\Documents\Projetos\school-management-api\debug\omr-real-images\15-Teste-Gab-OMR-14-53-16\v2 |
| Teste Gab OMR/WhatsApp Image 2026-06-15 at 14.53.17.jpeg | 10 | accepted/completed | review_required/completed | 5 | completed | 0 | C:\Users\User\Documents\Projetos\school-management-api\debug\omr-real-images\16-Teste-Gab-OMR-14-53-17\v2 |
| Teste OMR 2/WhatsApp Image 2026-06-15 at 14.53.15.jpeg | 5 | failed/sheet_detection | review_required/completed | 5 | completed | 5 | C:\Users\User\Documents\Projetos\school-management-api\debug\omr-real-images\17-Teste-OMR-2-14-53-15\v2 |
| Teste OMR 2/WhatsApp Image 2026-06-15 at 14.53.16 (1).jpeg | 5 | failed/sheet_detection | review_required/completed | 4 | completed | 5 | C:\Users\User\Documents\Projetos\school-management-api\debug\omr-real-images\18-Teste-OMR-2-14-53-16-1\v2 |
| Teste OMR 2/WhatsApp Image 2026-06-15 at 14.53.16 (2).jpeg | 5 | failed/sheet_detection | accepted/completed | 4 | completed | 5 | C:\Users\User\Documents\Projetos\school-management-api\debug\omr-real-images\19-Teste-OMR-2-14-53-16-2\v2 |
| Teste OMR 2/WhatsApp Image 2026-06-15 at 14.53.16 (3).jpeg | 10 | accepted/completed | accepted/completed | 5 | completed | 0 | C:\Users\User\Documents\Projetos\school-management-api\debug\omr-real-images\20-Teste-OMR-2-14-53-16-3\v2 |
| Teste OMR 2/WhatsApp Image 2026-06-15 at 14.53.16 (4).jpeg | 10 | accepted/completed | accepted/completed | 4 | completed | 0 | C:\Users\User\Documents\Projetos\school-management-api\debug\omr-real-images\21-Teste-OMR-2-14-53-16-4\v2 |
| Teste OMR 2/WhatsApp Image 2026-06-15 at 14.53.16.jpeg | 5 | failed/sheet_detection | review_required/completed | 5 | completed | 5 | C:\Users\User\Documents\Projetos\school-management-api\debug\omr-real-images\22-Teste-OMR-2-14-53-16\v2 |
| Teste OMR 2/WhatsApp Image 2026-06-15 at 14.53.17.jpeg | 10 | accepted/completed | review_required/completed | 5 | completed | 0 | C:\Users\User\Documents\Projetos\school-management-api\debug\omr-real-images\23-Teste-OMR-2-14-53-17\v2 |
| Teste OMR 2/WhatsApp Image 2026-06-15 at 16.00.38 (1).jpeg | 10 | accepted/completed | review_required/completed | 6 | completed | 0 | C:\Users\User\Documents\Projetos\school-management-api\debug\omr-real-images\24-Teste-OMR-2-16-00-38-1\v2 |
| Teste OMR 2/WhatsApp Image 2026-06-15 at 16.00.38 (2).jpeg | 10 | accepted/completed | review_required/completed | 4 | completed | 8 | C:\Users\User\Documents\Projetos\school-management-api\debug\omr-real-images\25-Teste-OMR-2-16-00-38-2\v2 |
| Teste OMR 2/WhatsApp Image 2026-06-15 at 16.00.38 (3).jpeg | 10 | accepted/completed | review_required/completed | 5 | completed | 2 | C:\Users\User\Documents\Projetos\school-management-api\debug\omr-real-images\26-Teste-OMR-2-16-00-38-3\v2 |
| Teste OMR 2/WhatsApp Image 2026-06-15 at 16.00.38 (4).jpeg | 10 | failed/sheet_detection | review_required/completed | 5 | completed | 8 | C:\Users\User\Documents\Projetos\school-management-api\debug\omr-real-images\27-Teste-OMR-2-16-00-38-4\v2 |
| Teste OMR 2/WhatsApp Image 2026-06-15 at 16.00.38 (5).jpeg | 10 | accepted/completed | review_required/completed | 4 | completed | 1 | C:\Users\User\Documents\Projetos\school-management-api\debug\omr-real-images\28-Teste-OMR-2-16-00-38-5\v2 |
| Teste OMR 2/WhatsApp Image 2026-06-15 at 16.00.38 (6).jpeg | 10 | accepted/completed | review_required/completed | 4 | completed | 4 | C:\Users\User\Documents\Projetos\school-management-api\debug\omr-real-images\29-Teste-OMR-2-16-00-38-6\v2 |
| Teste OMR 2/WhatsApp Image 2026-06-15 at 16.00.38 (7).jpeg | 10 | failed/sheet_detection | review_required/completed | 5 | completed | 10 | C:\Users\User\Documents\Projetos\school-management-api\debug\omr-real-images\30-Teste-OMR-2-16-00-38-7\v2 |
| Teste OMR 2/WhatsApp Image 2026-06-15 at 16.00.38.jpeg | 10 | accepted/completed | review_required/completed | 6 | completed | 1 | C:\Users\User\Documents\Projetos\school-management-api\debug\omr-real-images\31-Teste-OMR-2-16-00-38\v2 |

