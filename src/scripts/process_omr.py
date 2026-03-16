import json
import os
import sys
from pathlib import Path

CURRENT_DIR = Path(__file__).resolve().parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

from academyhub_omr.omr_runner import AcademyHubOmrRunner


def load_layout(layout_path: str):
    if not layout_path:
        return None

    path_obj = Path(layout_path)
    if not path_obj.exists():
        raise FileNotFoundError(f"Layout não encontrado: {layout_path}")

    with open(path_obj, "r", encoding="utf-8") as f:
        return json.load(f)


def extract_questions_count(layout_data):
    if not layout_data:
        return None

    for key in ("totalQuestions", "questionsCount"):
        value = layout_data.get(key)
        if isinstance(value, int) and value > 0:
            return value

    return None


def build_error(message: str, correction_type: str = "BUBBLE_SHEET"):
    return {
        "success": False,
        "type": correction_type,
        "message": message,
        "answers": [],
    }


def main():
    try:
        if len(sys.argv) < 3:
            print(json.dumps(build_error("Uso inválido do script."), ensure_ascii=False))
            return

        image_path = sys.argv[1]
        correction_type = sys.argv[2]
        layout_path = sys.argv[3] if len(sys.argv) > 3 else None

        if correction_type != "BUBBLE_SHEET":
            print(
                json.dumps(
                    build_error(
                        "O novo motor Python atende somente correctionType=BUBBLE_SHEET.",
                        correction_type,
                    ),
                    ensure_ascii=False,
                )
            )
            return

        layout_data = load_layout(layout_path) if layout_path else None
        questions_count = extract_questions_count(layout_data)

        if not questions_count:
            print(
                json.dumps(
                    build_error(
                        "Layout OMR inválido ou sem totalQuestions.",
                        correction_type,
                    ),
                    ensure_ascii=False,
                )
            )
            return

        debug_root = os.getenv("OMR_DEBUG_DIR")
        if debug_root:
            outdir = str(Path(debug_root) / f"omr_{Path(image_path).stem}")
        else:
            outdir = str(Path(image_path).resolve().parent / f"debug_{Path(image_path).stem}")

        result = AcademyHubOmrRunner.run(
            image_path=image_path,
            questions_count=questions_count,
            outdir=outdir,
        )

        normalized_answers = []
        for answer in result.get("answers", []):
            normalized_answers.append(
                {
                    "question": answer.get("question"),
                    "marked": answer.get("answer"),
                    "status": answer.get("status"),
                    "confidence": answer.get("confidence"),
                    "scores": answer.get("scores", []),
                }
            )

        payload = {
            "success": result.get("success", False),
            "type": "BUBBLE_SHEET",
            "stage": result.get("stage"),
            "message": result.get("message"),
            "anchorsFound": result.get("anchorsFound"),
            "questionsCount": result.get("questionsCount"),
            "answers": normalized_answers,
            "debug": result.get("debug"),
        }

        print(json.dumps(payload, ensure_ascii=False))
    except Exception as exc:
        print(
            json.dumps(
                build_error(f"Falha no motor OMR: {str(exc)}"),
                ensure_ascii=False,
            )
        )


if __name__ == "__main__":
    main()