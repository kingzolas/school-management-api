import argparse
from pathlib import Path

import cv2

from academyhub_omr.bubble_reader import AcademyHubBubbleReader
from academyhub_omr.layout_adapter import AcademyHubLayoutAdapter
from academyhub_omr.sheet_detector import AcademyHubSheetDetector


class AcademyHubOmrRunner:
    @staticmethod
    def run(image_path: str, questions_count: int, outdir: str = None):
        image_path = Path(image_path)

        if not image_path.exists():
            return {
                "success": False,
                "stage": "validation",
                "message": f"Imagem não encontrada: {image_path}",
                "answers": [],
            }

        try:
            layout = AcademyHubLayoutAdapter.build(questions_count)
        except Exception as exc:
            return {
                "success": False,
                "stage": "layout",
                "message": str(exc),
                "answers": [],
            }

        gray = cv2.imread(str(image_path), cv2.IMREAD_GRAYSCALE)
        if gray is None:
            return {
                "success": False,
                "stage": "image_load",
                "message": f"Não foi possível abrir a imagem: {image_path}",
                "answers": [],
            }

        debug_dir = None
        if outdir:
            debug_dir = Path(outdir)
            debug_dir.mkdir(parents=True, exist_ok=True)

        detector = AcademyHubSheetDetector(layout)
        detection = detector.detect_and_warp(gray)

        if debug_dir is not None:
            cv2.imwrite(str(debug_dir / "01_anchor_candidates.jpg"), detection.debug_image)

        if not detection.success or detection.warped_machine is None:
            return {
                "success": False,
                "stage": "sheet_detection",
                "message": detection.message,
                "anchorsFound": detection.anchors_found,
                "answers": [],
            }

        if debug_dir is not None:
            cv2.imwrite(str(debug_dir / "02_warped_machine.jpg"), detection.warped_machine)

        reader = AcademyHubBubbleReader(layout)
        read_result = reader.read(detection.warped_machine)

        if debug_dir is not None:
            cv2.imwrite(str(debug_dir / "03_bubble_debug.jpg"), read_result.debug_image)

        return {
            "success": True,
            "stage": "completed",
            "message": detection.message,
            "anchorsFound": detection.anchors_found,
            "questionsCount": layout.questions_count,
            "answers": read_result.answers,
            "debug": {
                "outdir": str(debug_dir) if debug_dir else None,
                "machineWidth": layout.machine_width,
                "machineHeight": layout.machine_height,
                "layoutDebug": layout.debug,
            },
        }


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True, help="Caminho da imagem do gabarito")
    parser.add_argument("--questions", required=True, type=int, help="Quantidade de questões objetivas")
    parser.add_argument("--outdir", required=False, default=None, help="Pasta de debug")
    return parser.parse_args()


if __name__ == "__main__":
    import json

    args = parse_args()
    result = AcademyHubOmrRunner.run(
        image_path=args.image,
        questions_count=args.questions,
        outdir=args.outdir,
    )
    print(json.dumps(result, ensure_ascii=False))