# OMR v2 controlled migration

## Scope

This branch integrates the validated OMR v2 engine into the official Academy Hub API without removing the legacy engine and without deploying automatically.

The lab project validated 5 and 10 question cards, but production exams are dynamic. In the official API, the source of truth is the exam metadata, not a fixed template name.

## Current API flow mapped before migration

- Exam creation: `src/api/services/exam.service.js#createExam`
- Question count: objective questions in `Exam.questions` where `type === 'OBJECTIVE'`
- Official answer key: `Exam.questions[].correctAnswer`
- OMR layout attached to exam: `Exam.settings.omrLayout`
- Answer sheet identity: `ExamSheet.qr_code_uuid`
- QR verification: `examService.verifyExamSheet(qrCodeUuid, schoolId)`
- OMR request endpoint: `POST /api/exams/process-omr`
- Debug endpoint: `POST /api/omr/debug`
- Python bridge: `src/api/services/omrProcessing.service.js`
- Legacy Python script: `src/scripts/process_omr.py`
- v2 Python script: `src/scripts/process_omr_v2.py`
- Grade calculation and persistence: `examService.buildBubbleSheetCorrection` and `examService.scanExamSheet`

The current QR code identifies the generated sheet by UUID. It does not need to be changed for this migration because the API resolves the exam through `ExamSheet`.

## Dynamic layout model

The official layout now uses:

```json
{
  "version": "ACADEMYHUB_OMR_V2",
  "layoutVersion": "academyhub-omr-v2",
  "totalQuestions": 40,
  "choices": ["A", "B", "C", "D", "E"],
  "blocks": [
    { "startQuestion": 1, "endQuestion": 20, "columns": 5 },
    { "startQuestion": 21, "endQuestion": 40, "columns": 5 }
  ]
}
```

Supported question count is 1 to 40 objective questions. Counts above 40 are rejected during exam layout generation.

## Feature flag

Use `OMR_ENGINE_VERSION`:

- `legacy`: default. Runs the existing Python engine.
- `v2`: runs `src/scripts/process_omr_v2.py`.
- `shadow`: runs legacy as the source of truth and runs v2 in parallel for divergence logging.

Rollback by environment variable:

```env
OMR_ENGINE_VERSION=legacy
```

## Python/Node bridge controls

The subprocess integration includes:

- controlled script selection by feature flag;
- `OMR_PYTHON_TIMEOUT_MS`, default `30000`;
- `OMR_MAX_IMAGE_BYTES`, default `8388608`;
- JSON parsing from stdout;
- stderr captured in controlled errors;
- debug file cleanup through the existing `KEEP_OMR_DEBUG_FILES` flag;
- no image bytes in logs.

Python dependencies:

```bash
pip install -r requirements.txt
```

Current requirements:

```txt
opencv-python-headless
numpy
```

## Safe status handling

For `v2`:

- `accepted`: the API may calculate and persist the grade.
- `review_required`: the API returns a controlled response and does not persist grade.
- `recapture_required`: the API returns a controlled response and does not persist grade.
- `failed`: technical error path; no grade is persisted.
- `QUESTION_COUNT_MISMATCH`: validation error; no grade is persisted.
- `INVALID_QUESTIONS`: invalid layout/question count; no grade is persisted.

The v2 engine does not convert perspective, marker, or grid failures into blank answers. Those cases become `not_detected`, `recapture_required`, or `QUESTION_COUNT_MISMATCH`.

## Test commands

```bash
npm run test:omr:v2
npm run test:omr:templates
npm run test:omr:all
```

`test:omr:all` currently covers:

- legacy bubble reader behavior;
- v2 dynamic layout for 1, 5, 10, 20, 30 and 40 questions;
- rejection above 40 questions;
- Python wrapper `INVALID_QUESTIONS`;
- anchor failure reported as `not_detected`, not `blank`.

## Deploy recommendation

1. Deploy with `OMR_ENGINE_VERSION=legacy`.
2. Enable `OMR_ENGINE_VERSION=shadow` for a small pilot group or low-traffic window.
3. Review `[OMR SHADOW]` divergence logs.
4. Enable `OMR_ENGINE_VERSION=v2` for a controlled school or teacher cohort.
5. Keep debug images disabled in production unless investigating a specific issue.

Recommended production env:

```env
OMR_ENGINE_VERSION=legacy
OMR_PYTHON_TIMEOUT_MS=30000
OMR_MAX_IMAGE_BYTES=8388608
OMR_DEBUG_ENABLED=false
OMR_DEBUG_SAVE_IMAGES=false
KEEP_OMR_DEBUG_FILES=false
```

## Rollback

Fast rollback:

```env
OMR_ENGINE_VERSION=legacy
```

Code rollback after merge:

```bash
git revert <commit>
```

If the branch has not been merged:

```bash
git checkout main
git branch -D feature/omr-v2-engine
```

## Known risks

- The lab Phase 3 safety images were not completed, so rollout should start in `shadow`.
- Existing generated cards may carry `ACADEMYHUB_OMR_V1`; v2 can still use `totalQuestions` dynamically for 1 to 40.
- The frontend/PDF renderer must respect the new two-block layout for 21 to 40 questions. This branch prepares backend metadata and engine support, but final visual validation of newly printed 20/30/40-question sheets is still required.
- Render must have Python and the requirements installed. Prefer `opencv-python-headless` to avoid GUI dependencies.

## Recommended commit

```bash
git add package.json src/api/controllers/exam.controller.js src/api/services/exam.service.js src/api/services/omrProcessing.service.js src/scripts/process_omr_v2.py src/scripts/academyhub_omr_v2 src/tests/services/omr.v2-engine.test.js docs/omr-v2-controlled-migration.md
git commit -m "feat(omr): integrate v2 engine with dynamic question support"
```
