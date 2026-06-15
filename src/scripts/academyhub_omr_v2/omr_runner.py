import argparse
import time
from pathlib import Path

import cv2

from academyhub_omr.bubble_reader import AcademyHubBubbleReader
from academyhub_omr.layout_adapter import AcademyHubLayoutAdapter
from academyhub_omr.sheet_detector import AcademyHubSheetDetector


class AcademyHubOmrRunner:
    @staticmethod
    def run(
        image_path: str,
        questions_count: int,
        outdir: str = None,
        layout_data: dict = None,
        collect_performance: bool = False,
    ):
        total_start = time.perf_counter()
        performance = {} if collect_performance else None
        image_path = Path(image_path)

        if not image_path.exists():
            return {
                "success": False,
                "stage": "validation",
                "message": f"Imagem nao encontrada: {image_path}",
                "answers": [],
            }

        load_start = time.perf_counter()
        original_color = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
        if performance is not None:
            performance["pythonLoadImageMs"] = AcademyHubOmrRunner._elapsed_ms(load_start)
        if original_color is None:
            return {
                "success": False,
                "stage": "image_load",
                "message": f"Nao foi possivel abrir a imagem: {image_path}",
                "answers": [],
            }

        grayscale_start = time.perf_counter()
        gray = cv2.cvtColor(original_color, cv2.COLOR_BGR2GRAY)
        if performance is not None:
            performance["pythonGrayscaleMs"] = AcademyHubOmrRunner._elapsed_ms(grayscale_start)
        image_height, image_width = gray.shape[:2]

        try:
            layout_start = time.perf_counter()
            layouts = AcademyHubOmrRunner._build_layout_attempts(
                questions_count=questions_count,
                layout_data=layout_data,
            )
            if performance is not None:
                performance["pythonLayoutBuildMs"] = AcademyHubOmrRunner._elapsed_ms(layout_start)
        except Exception as exc:
            return {
                "success": False,
                "stage": "layout",
                "message": str(exc),
                "answers": [],
            }

        debug_root = None
        if outdir:
            debug_save_start = time.perf_counter()
            debug_root = Path(outdir)
            debug_root.mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(debug_root / "00_input.jpg"), original_color)
            cv2.imwrite(str(debug_root / "01_grayscale.jpg"), gray)
            if performance is not None:
                performance["pythonInitialDebugImageWriteMs"] = (
                    AcademyHubOmrRunner._elapsed_ms(debug_save_start)
                )

        attempts_summary = []
        last_result = None

        for index, layout in enumerate(layouts, start=1):
            source = layout.debug.get("source", f"layout_{index}")
            attempt_dir = None
            if debug_root is not None:
                attempt_dir = debug_root

            result = AcademyHubOmrRunner._run_single_layout(
                gray=gray,
                original_color=original_color,
                layout=layout,
                debug_dir=attempt_dir,
                image_width=image_width,
                image_height=image_height,
                collect_performance=collect_performance,
            )
            if performance is not None:
                performance.update(result.get("performance") or {})
                performance["pythonTotalMs"] = AcademyHubOmrRunner._elapsed_ms(total_start)
                result["performance"] = performance.copy()
                result["debug"]["performance"] = performance.copy()
            result["debug"]["layoutAttempts"] = attempts_summary + [
                AcademyHubOmrRunner._summarize_attempt(result, layout)
            ]

            attempts_summary.append(AcademyHubOmrRunner._summarize_attempt(result, layout))
            last_result = result

            if result.get("success"):
                if debug_root is not None:
                    result["debug"]["outdir"] = str(debug_root)
                return result

        if last_result is not None and debug_root is not None:
            last_result["debug"]["outdir"] = str(debug_root)
        if last_result is not None and performance is not None:
            performance["pythonTotalMs"] = AcademyHubOmrRunner._elapsed_ms(total_start)
            last_result["performance"] = performance.copy()
            last_result["debug"]["performance"] = performance.copy()
        return last_result

    @staticmethod
    def _build_layout_attempts(questions_count: int, layout_data: dict = None):
        layouts = []
        explicit = AcademyHubLayoutAdapter.build(
            questions_count=questions_count,
            layout_data=layout_data,
        )
        layouts.append(explicit)

        if explicit.debug.get("source") == "explicit_omr_layout":
            generated = AcademyHubLayoutAdapter.build(
                questions_count=questions_count,
                layout_data=None,
            )
            layouts.append(generated)

        return layouts

    @staticmethod
    def _run_single_layout(
        gray,
        original_color,
        layout,
        debug_dir,
        image_width: int,
        image_height: int,
        collect_performance: bool = False,
    ):
        attempt_start = time.perf_counter()
        performance = {} if collect_performance else None
        if debug_dir is not None:
            debug_dir.mkdir(parents=True, exist_ok=True)

        detector = AcademyHubSheetDetector(layout)
        detection = detector.detect_and_warp(gray, debug_base_image=original_color)
        if performance is not None and detection.performance:
            performance.update(detection.performance)

        if debug_dir is not None:
            overlay_start = time.perf_counter()
            cv2.imwrite(str(debug_dir / "02_threshold.jpg"), detection.threshold_image)
            cv2.imwrite(str(debug_dir / "03_anchors_detected.jpg"), detection.debug_image)
            if performance is not None:
                performance["pythonDetectionDebugImageWriteMs"] = (
                    AcademyHubOmrRunner._elapsed_ms(overlay_start)
                )

        if not detection.success or detection.warped_machine is None:
            result = {
                "success": False,
                "type": "BUBBLE_SHEET",
                "stage": "sheet_detection",
                "message": detection.message,
                "anchorsFound": detection.anchors_found,
                "questionsCount": layout.questions_count,
                "captureHints": detection.capture_hints,
                "answers": AcademyHubOmrRunner._build_anchor_failed_answers(layout, detection.message),
                "debug": AcademyHubOmrRunner._build_debug_payload(
                    debug_dir=debug_dir,
                    layout=layout,
                    image_width=image_width,
                    image_height=image_height,
                    detection=detection,
                    read_result=None,
                ),
            }
            if performance is not None:
                performance["pythonBubbleReadMs"] = 0.0
                performance["pythonLayoutAttemptMs"] = AcademyHubOmrRunner._elapsed_ms(attempt_start)
                result["performance"] = performance
                result["debug"]["performance"] = performance
            return result

        if debug_dir is not None:
            warped_write_start = time.perf_counter()
            cv2.imwrite(str(debug_dir / "04_warped.jpg"), detection.warped_machine)
            if performance is not None:
                performance["pythonWarpedImageWriteMs"] = (
                    AcademyHubOmrRunner._elapsed_ms(warped_write_start)
                )

        reader = AcademyHubBubbleReader(layout)
        bubble_start = time.perf_counter()
        read_result = reader.read(detection.warped_machine)
        if performance is not None:
            performance["pythonBubbleReadMs"] = AcademyHubOmrRunner._elapsed_ms(bubble_start)

        if debug_dir is not None:
            result_overlay_start = time.perf_counter()
            cv2.imwrite(str(debug_dir / "05_bubbles_overlay.jpg"), read_result.bubbles_overlay_image)
            cv2.imwrite(str(debug_dir / "06_result_overlay.jpg"), read_result.debug_image)
            if performance is not None:
                performance["pythonResultOverlayWriteMs"] = (
                    AcademyHubOmrRunner._elapsed_ms(result_overlay_start)
                )

        result = {
            "success": True,
            "type": "BUBBLE_SHEET",
            "stage": "completed",
            "message": detection.message,
            "anchorsFound": detection.anchors_found,
            "questionsCount": layout.questions_count,
            "captureHints": detection.capture_hints,
            "answers": read_result.answers,
            "debug": AcademyHubOmrRunner._build_debug_payload(
                debug_dir=debug_dir,
                layout=layout,
                image_width=image_width,
                image_height=image_height,
                detection=detection,
                read_result=read_result,
            ),
        }
        if performance is not None:
            performance["pythonLayoutAttemptMs"] = AcademyHubOmrRunner._elapsed_ms(attempt_start)
            result["performance"] = performance
            result["debug"]["performance"] = performance
        return result

    @staticmethod
    def _summarize_attempt(result, layout):
        return {
            "source": layout.debug.get("source"),
            "success": bool(result.get("success")),
            "stage": result.get("stage"),
            "message": result.get("message"),
            "anchorsFound": result.get("anchorsFound"),
            "machineWidth": layout.machine_width,
            "machineHeight": layout.machine_height,
        }

    @staticmethod
    def _build_anchor_failed_questions(layout, reason: str):
        threshold = AcademyHubBubbleReader.THRESHOLDS["blank"]
        questions = []

        for q_idx in range(layout.questions_count):
            q_number = q_idx + 1
            question_bubbles = layout.bubbles_for_question(q_number)
            options = {}

            for choice in layout.choices:
                bubble = question_bubbles.get(choice)
                if bubble is None:
                    options[choice] = {
                        "fillRatio": 0.0,
                        "innerFillRatio": 0.0,
                        "score": 0.0,
                        "decisionScore": 0.0,
                        "mean": None,
                        "innerMean": None,
                        "darknessDelta": 0.0,
                        "bbox": None,
                        "innerBbox": None,
                        "center": None,
                        "outOfBounds": True,
                        "missing": True,
                    }
                    continue

                options[choice] = {
                    "fillRatio": 0.0,
                    "innerFillRatio": 0.0,
                    "score": 0.0,
                    "decisionScore": 0.0,
                    "mean": None,
                    "innerMean": None,
                    "darknessDelta": 0.0,
                    "bbox": [
                        int(round(bubble.x - bubble.r)),
                        int(round(bubble.y - bubble.r)),
                        int(round(bubble.r * 2)),
                        int(round(bubble.r * 2)),
                    ],
                    "innerBbox": None,
                    "center": [int(round(bubble.x)), int(round(bubble.y))],
                    "outOfBounds": False,
                }

            questions.append(
                {
                    "question": q_number,
                    "selected": None,
                    "status": "anchor_failed",
                    "threshold": threshold,
                    "options": options,
                    "reason": reason,
                    "decision": {
                        "topOption": None,
                        "topScore": 0.0,
                        "secondOption": None,
                        "secondScore": 0.0,
                        "diff": 0.0,
                        "thresholds": AcademyHubBubbleReader.THRESHOLDS,
                        "scoreMetric": "innerFillRatio",
                    },
                    "topSecondDifference": 0.0,
                }
            )

        return questions

    @staticmethod
    def _build_anchor_failed_answers(layout, reason: str):
        questions = AcademyHubOmrRunner._build_anchor_failed_questions(layout, reason)
        answers = []

        for question in questions:
            answers.append(
                {
                    "question": question["question"],
                    "answer": None,
                    "status": "not_detected",
                    "confidence": 0.0,
                    "scores": [0.0 for _ in layout.choices],
                    "selected": None,
                    "debugStatus": "anchor_failed",
                    "threshold": question["threshold"],
                    "reason": reason,
                    "options": question["options"],
                    "topSecondDifference": 0.0,
                }
            )

        return answers

    @staticmethod
    def _build_debug_payload(
        debug_dir,
        layout,
        image_width: int,
        image_height: int,
        detection,
        read_result,
    ):
        selected_corners = None
        if detection.selected_corners is not None:
            selected_corners = [
                [round(float(point[0]), 2), round(float(point[1]), 2)]
                for point in detection.selected_corners
            ]

        homography_matrix = None
        if detection.homography_matrix is not None:
            homography_matrix = [
                [round(float(value), 6) for value in row]
                for row in detection.homography_matrix
            ]

        normalized_size = None
        if detection.normalized_size is not None:
            normalized_size = {
                "width": int(detection.normalized_size[0]),
                "height": int(detection.normalized_size[1]),
            }

        bubble_template = [
            {
                "question": bubble.question,
                "option": bubble.option,
                "center": [round(float(bubble.x), 2), round(float(bubble.y), 2)],
                "radius": round(float(bubble.r), 2),
                "bbox": [
                    int(round(bubble.x - bubble.r)),
                    int(round(bubble.y - bubble.r)),
                    int(round(bubble.r * 2)),
                    int(round(bubble.r * 2)),
                ],
            }
            for bubble in layout.bubbles
        ]

        return {
            "outdir": str(debug_dir) if debug_dir else None,
            "imageWidth": int(image_width),
            "imageHeight": int(image_height),
            "orientation": detection.orientation,
            "anchors": {
                "found": detection.anchors_found,
                "candidates": detection.anchor_candidates,
                "selectedCorners": selected_corners,
                "confidence": detection.selected_anchor_confidence,
                "missing": detection.missing_anchors,
            },
            "homography": {
                "applied": detection.homography_applied,
                "matrix": homography_matrix,
                "normalizedSize": normalized_size,
            },
            "machineWidth": layout.machine_width,
            "machineHeight": layout.machine_height,
            "layoutDebug": layout.debug,
            "bubbleTemplate": bubble_template,
            "questions": read_result.questions_debug
            if read_result
            else AcademyHubOmrRunner._build_anchor_failed_questions(layout, detection.message),
            "captureHints": detection.capture_hints,
            "layoutAttempts": [],
        }

    @staticmethod
    def _elapsed_ms(start: float) -> float:
        return round((time.perf_counter() - start) * 1000.0, 2)


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True, help="Caminho da imagem do gabarito")
    parser.add_argument("--questions", required=True, type=int, help="Quantidade de questoes objetivas")
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
