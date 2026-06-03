# OMR manual samples

Place local answer-card captures here when debugging OMR, for example:

```bash
samples/omr/heitor-cartao.local.jpeg
```

Images in this folder are ignored by Git because they can contain student data,
QR codes, and answer sheets. Use:

```bash
node scripts/debug-omr-image.js samples/omr/heitor-cartao.local.jpeg --questions 5
```
