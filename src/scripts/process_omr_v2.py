import json
import os
import sys
import time
from pathlib import Path

CURRENT_DIR = Path(__file__).resolve().parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

from academyhub_omr_v2.omr_runner import AcademyHubOmrRunner

MIN_QUESTIONS = 1
MAX_QUESTIONS = 40
CHOICES = ["A", "B", "C", "D", "E"]
LOW_CONFIDENCE_REVIEW_THRESHOLD = 0.60


def load_layout(layout_path: str):
    if not layout_path:
        return None

    path_obj = Path(layout_path)
    if not path_obj.exists():
        raise FileNotFoundError(f"Layout nao encontrado: {layout_path}")

    with open(path_obj, "r", encoding="utf-8") as file:
        return json.load(file)


def extract_questions_count(layout_data):
    if not layout_data:
        return None

    for key in ("totalQuestions", "questionsCount", "questions"):
        value = layout_data.get(key)
        if isinstance(value, int) and value > 0:
            return value

    return None


def validate_questions_count(value):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    if parsed < MIN_QUESTIONS or parsed > MAX_QUESTIONS:
        return None
    return parsed


def env_flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return str(value).strip().lower() in ("1", "true", "yes", "on")


def elapsed_ms(start: float) -> float:
    return round((time.perf_counter() - start) * 1000.0, 2)


def normalize_status(status):
    if status == "ok":
        return "marked"
    if status == "ambiguous":
        return "uncertain"
    if status in ("blank", "multiple", "not_detected"):
        return status
    return status or "not_detected"


def build_error(message: str, correction_type: str = "BUBBLE_SHEET", **extra):
    return {
        "success": False,
        "type": correction_type,
        "imageStatus": extra.pop("imageStatus", "failed"),
        "message": message,
        "answers": [],
        "questions": [],
        **extra,
    }


def build_contract_question(answer):
    status = normalize_status(answer.get("status"))
    selected = answer.get("marked")
    if status == "multiple":
        selected = "MULTIPLE"
    elif status == "uncertain":
        selected = "UNCERTAIN"
    elif status in ("blank", "not_detected"):
        selected = None

    scores = {}
    raw_scores = answer.get("scores") or []
    for index, choice in enumerate(CHOICES):
        value = raw_scores[index] if index < len(raw_scores) else 0.0
        scores[choice] = {"final": round(float(value or 0.0), 4)}

    question = {
        "number": answer.get("question"),
        "selected": selected,
        "status": status,
        "confidence": answer.get("confidence"),
        "scores": scores,
    }
    if status == "multiple":
        question["markedAlternatives"] = answer.get("markedAlternatives") or []
    if answer.get("reason"):
        question["warning"] = answer.get("reason")
    return question


def build_answers_map(answers):
    mapped = {}
    for answer in answers:
        question = str(answer.get("question"))
        status = normalize_status(answer.get("status"))
        if status == "multiple":
            mapped[question] = "MULTIPLE"
        elif status == "uncertain":
            mapped[question] = "UNCERTAIN"
        elif status in ("blank", "not_detected"):
            mapped[question] = None
        else:
            mapped[question] = answer.get("marked")
    return mapped


def result_image_status(normalized_answers, python_success):
    if not python_success:
        return "recapture_required"
    if not normalized_answers:
        return "recapture_required"
    statuses = {normalize_status(answer.get("status")) for answer in normalized_answers}
    if "not_detected" in statuses:
        return "recapture_required"
    if "multiple" in statuses or "uncertain" in statuses:
        return "review_required"
    if any(
        normalize_status(answer.get("status")) == "marked"
        and float(answer.get("confidence") or 0.0) < LOW_CONFIDENCE_REVIEW_THRESHOLD
        for answer in normalized_answers
    ):
        return "review_required"
    return "accepted"


def is_completed_read(normalized_answers, python_success, requested_questions, detected_questions, image_status):
    return (
        bool(python_success)
        and image_status in ("accepted", "review_required")
        and int(detected_questions or 0) == int(requested_questions or 0)
        and len(normalized_answers) == int(requested_questions or 0)
    )


def build_question_count_mismatch(requested, detected, layout_version):
    return {
        "success": False,
        "imageStatus": "review_required",
        "errorCode": "QUESTION_COUNT_MISMATCH",
        "message": (
            f"A prova possui {requested} questoes, mas a folha/imagem permitiu "
            f"detectar apenas {detected} questoes com seguranca."
        ),
        "type": "BUBBLE_SHEET",
        "layoutVersion": layout_version,
        "requestedQuestions": requested,
        "detectedQuestions": detected,
        "evaluatedQuestions": 0,
        "answers": [],
        "questions": [],
        "warnings": [
            "Quantidade de questoes detectada nao corresponde a quantidade esperada pela prova."
        ],
    }


def main():
    performance_enabled = env_flag("OMR_PERFORMANCE_DEBUG", False)
    total_start = time.perf_counter()
    performance = {} if performance_enabled else None

    try:
        if len(sys.argv) < 3:
            print(json.dumps(build_error("Uso invalido do script."), ensure_ascii=False))
            return

        image_path = sys.argv[1]
        correction_type = sys.argv[2]
        layout_path = sys.argv[3] if len(sys.argv) > 3 else None

        if correction_type != "BUBBLE_SHEET":
            print(
                json.dumps(
                    build_error(
                        "O motor OMR v2 atende somente correctionType=BUBBLE_SHEET.",
                        correction_type,
                        errorCode="INVALID_CORRECTION_TYPE",
                        imageStatus="review_required",
                    ),
                    ensure_ascii=False,
                )
            )
            return

        layout_start = time.perf_counter()
        layout_data = load_layout(layout_path) if layout_path else None
        if performance is not None:
            performance["pythonLayoutJsonLoadMs"] = elapsed_ms(layout_start)

        raw_questions = extract_questions_count(layout_data)
        questions_count = validate_questions_count(raw_questions)
        layout_version = (
            layout_data.get("version")
            if isinstance(layout_data, dict)
            else "academyhub-omr-v2"
        )

        if not questions_count:
            print(
                json.dumps(
                    build_error(
                        "Layout OMR invalido ou sem totalQuestions entre 1 e 40.",
                        correction_type,
                        imageStatus="review_required",
                        errorCode="INVALID_QUESTIONS",
                        requestedQuestions=raw_questions,
                        detectedQuestions=None,
                        evaluatedQuestions=0,
                        layoutVersion=layout_version,
                    ),
                    ensure_ascii=False,
                )
            )
            return

        save_images = env_flag("OMR_DEBUG_SAVE_IMAGES", False)
        debug_root = os.getenv("OMR_DEBUG_DIR")
        if save_images and debug_root:
            outdir = str(Path(debug_root))
        elif save_images:
            outdir = str(Path(image_path).resolve().parent / f"debug_{Path(image_path).stem}")
        else:
            outdir = None

        result = AcademyHubOmrRunner.run(
            image_path=image_path,
            questions_count=questions_count,
            outdir=outdir,
            layout_data=layout_data,
            collect_performance=performance_enabled,
        )

        if performance is not None:
            performance.update(result.get("performance") or {})
            performance["pythonTotalProcessMs"] = elapsed_ms(total_start)

        normalized_answers = []
        for answer in result.get("answers", []):
            status = normalize_status(answer.get("status"))
            marked = answer.get("answer") if status == "marked" else None
            normalized_answers.append(
                {
                    "question": answer.get("question"),
                    "marked": marked,
                    "status": answer.get("status"),
                    "confidence": answer.get("confidence"),
                    "scores": answer.get("scores", []),
                    "selected": marked,
                    "debugStatus": answer.get("debugStatus"),
                    "threshold": answer.get("threshold"),
                    "reason": answer.get("reason"),
                    "options": answer.get("options"),
                    "topSecondDifference": answer.get("topSecondDifference"),
                    "markedAlternatives": answer.get("markedAlternatives", []),
                }
            )

        not_detected = [
            answer
            for answer in normalized_answers
            if normalize_status(answer.get("status")) == "not_detected"
        ]
        detected_questions = max(0, questions_count - len(not_detected))
        if detected_questions and detected_questions < questions_count:
            print(
                json.dumps(
                    build_question_count_mismatch(
                        questions_count,
                        detected_questions,
                        layout_version,
                    ),
                    ensure_ascii=False,
                )
            )
            return

        image_status = result_image_status(normalized_answers, result.get("success", False))
        read_completed = is_completed_read(
            normalized_answers,
            result.get("success", False),
            questions_count,
            detected_questions,
            image_status,
        )
        if not read_completed and image_status == "accepted":
            image_status = "recapture_required"

        error_code = None
        if not read_completed:
            error_code = (
                "OMR_RECAPTURE_REQUIRED"
                if image_status == "recapture_required"
                else "OMR_REVIEW_REQUIRED"
            )

        confidence_values = [
            float(item.get("confidence") or 0.0)
            for item in normalized_answers
            if normalize_status(item.get("status")) != "not_detected"
        ]

        if read_completed and image_status == "review_required":
            message = "Leitura OMR concluida com pontos para revisao."
        elif read_completed:
            message = "Leitura OMR concluida."
        else:
            message = result.get("message")

        payload = {
            "success": read_completed,
            "imageStatus": image_status,
            "errorCode": error_code,
            "type": "BUBBLE_SHEET",
            "layoutVersion": layout_version,
            "requestedQuestions": questions_count,
            "detectedQuestions": detected_questions,
            "evaluatedQuestions": questions_count if read_completed else 0,
            "confidence": round(min(confidence_values), 4) if confidence_values else 0.0,
            "stage": result.get("stage"),
            "message": message,
            "anchorsFound": result.get("anchorsFound"),
            "questionsCount": result.get("questionsCount"),
            "orientation": result.get("orientation") or (result.get("debug") or {}).get("orientation"),
            "captureHints": result.get("captureHints", []),
            "warnings": result.get("captureHints", []),
            "answersMap": build_answers_map(normalized_answers),
            "answers": normalized_answers,
            "questions": [build_contract_question(item) for item in normalized_answers],
            "debug": result.get("debug"),
        }

        if performance is not None:
            payload["performance"] = performance

        print(json.dumps(payload, ensure_ascii=False))
    except Exception as exc:
        print(
            json.dumps(
                build_error(
                    f"Falha no motor OMR v2: {str(exc)}",
                    imageStatus="failed",
                    errorCode="OMR_V2_EXCEPTION",
                ),
                ensure_ascii=False,
            )
        )


if __name__ == "__main__":
    main()
