import argparse
import time
from pathlib import Path

import cv2
import numpy as np

from .bubble_reader import AcademyHubBubbleReader
from .layout_adapter import AcademyHubLayoutAdapter
from .sheet_detector import AcademyHubSheetDetector


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
        orientation_start = time.perf_counter()
        orientation_candidates = []

        for rotation in (0, 90, 180, 270):
            rotated_color = AcademyHubOmrRunner._rotate_image(original_color, rotation)
            rotated_gray = AcademyHubOmrRunner._rotate_image(gray, rotation)
            result = AcademyHubOmrRunner._run_single_layout_once(
                gray=rotated_gray,
                original_color=rotated_color,
                layout=layout,
                debug_dir=None,
                image_width=rotated_gray.shape[1],
                image_height=rotated_gray.shape[0],
                collect_performance=collect_performance,
            )
            score = AcademyHubOmrRunner._orientation_score(result, rotated_gray)
            orientation_candidates.append(
                {
                    "rotation": rotation,
                    "score": score,
                    "result": result,
                    "gray": rotated_gray,
                    "color": rotated_color,
                }
            )

        original_candidate = next(
            item for item in orientation_candidates if item["rotation"] == 0
        )
        if original_candidate["result"].get("success"):
            best = original_candidate
        else:
            best = max(
                orientation_candidates,
                key=lambda item: (
                    bool(item["result"].get("success")),
                    item["score"],
                    int(item["result"].get("anchorsFound") or 0),
                ),
            )

        rotated_color = best["color"]
        rotated_gray = best["gray"]
        result = AcademyHubOmrRunner._run_single_layout_once(
            gray=rotated_gray,
            original_color=rotated_color,
            layout=layout,
            debug_dir=debug_dir,
            image_width=rotated_gray.shape[1],
            image_height=rotated_gray.shape[0],
            collect_performance=collect_performance,
        )

        orientation_summary = [
            {
                "rotation": item["rotation"],
                "score": round(float(item["score"]), 4),
                "success": bool(item["result"].get("success")),
                "stage": item["result"].get("stage"),
                "anchorsFound": item["result"].get("anchorsFound"),
                "anchorConfidence": (
                    item["result"].get("debug", {})
                    .get("anchors", {})
                    .get("confidence")
                ),
                "headerScore": round(
                    float(
                        AcademyHubOmrRunner._header_position_score_from_result(
                            item["result"],
                            item["gray"],
                        )
                    ),
                    4,
                ),
            }
            for item in orientation_candidates
        ]
        method = "rotation-fallback+corner-markers+header-position"

        result["orientation"] = {
            "detectedRotation": best["rotation"],
            "confidence": round(float(best["score"]), 4),
            "method": method,
            "candidates": orientation_summary,
        }
        result.setdefault("debug", {})["orientation"] = result["orientation"]
        if debug_dir is not None:
            cv2.imwrite(str(debug_dir / "01_auto_oriented.jpg"), rotated_color)

        if collect_performance:
            result.setdefault("performance", {})
            result["performance"]["pythonOrientationMs"] = AcademyHubOmrRunner._elapsed_ms(
                orientation_start
            )
            result.setdefault("debug", {}).setdefault("performance", {}).update(
                result["performance"]
            )

        return result

    @staticmethod
    def _run_single_layout_once(
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
            "gridCalibration": read_result.grid_calibration,
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
    def _rotate_image(image, rotation: int):
        if rotation == 90:
            return cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)
        if rotation == 180:
            return cv2.rotate(image, cv2.ROTATE_180)
        if rotation == 270:
            return cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE)
        return image.copy()

    @staticmethod
    def _orientation_score(result, gray) -> float:
        anchors = result.get("debug", {}).get("anchors", {})
        anchor_confidence = float(anchors.get("confidence") or 0.0)
        answers = result.get("answers") or []
        answer_confidence = 0.0
        if answers:
            answer_confidence = sum(float(item.get("confidence") or 0.0) for item in answers) / max(
                1,
                len(answers),
            )

        completed_bonus = 0.18 if result.get("success") else 0.0
        header_score = AcademyHubOmrRunner._header_position_score_from_result(result, gray)
        score = (
            completed_bonus
            + (anchor_confidence * 0.36)
            + (answer_confidence * 0.30)
            + (header_score * 0.34)
        )
        return max(0.0, min(1.0, score))

    @staticmethod
    def _header_position_score_from_result(result, gray) -> float:
        corners = (
            result.get("debug", {})
            .get("anchors", {})
            .get("selectedCorners")
        )
        if not corners:
            return 0.0

        corners_array = cv2.UMat(np.array(corners, dtype=np.float32)).get()
        return AcademyHubOmrRunner._header_position_score(gray, corners_array)

    @staticmethod
    def _header_position_score(gray, corners) -> float:
        h, w = gray.shape[:2]
        top_y = int(max(0, np.mean(corners[:2, 1])))
        bottom_y = int(min(h, np.mean(corners[2:, 1])))

        detected, qr_points = cv2.QRCodeDetector().detect(gray)
        if detected and qr_points is not None:
            qr_y = float(np.mean(qr_points.reshape(-1, 2)[:, 1]))
            if qr_y < top_y:
                return 1.0
            if qr_y > bottom_y:
                return 0.0

        left_x = int(max(0, np.min(corners[:, 0])))
        right_x = int(min(w, np.max(corners[:, 0])))
        span = max(1, bottom_y - top_y)
        band = max(30, int(span * 1.25))
        top = gray[max(0, top_y - band):top_y, left_x:right_x]
        bottom = gray[bottom_y:min(h, bottom_y + band), left_x:right_x]

        def ink_density(region):
            if region.size == 0:
                return 0.0
            local_background = cv2.GaussianBlur(region, (0, 0), 12)
            black_hat = np.maximum(
                local_background.astype(np.int16) - region.astype(np.int16),
                0,
            )
            return float(np.mean(black_hat > 25))

        top_density = ink_density(top)
        bottom_density = ink_density(bottom)
        density_difference = top_density - bottom_density
        broad_score = max(0.0, min(1.0, 0.5 + density_difference * 5.0))

        divider_band = max(20, int(span * 0.22))
        top_divider = gray[max(0, top_y - divider_band):top_y, left_x:right_x]
        bottom_divider = gray[bottom_y:min(h, bottom_y + divider_band), left_x:right_x]

        def horizontal_line_score(region):
            if region.size == 0:
                return 0.0
            background = cv2.GaussianBlur(region, (0, 0), 8)
            black_hat = background.astype(np.int16) - region.astype(np.int16)
            return float(np.max(np.mean(black_hat > 20, axis=1)))

        divider_score = max(
            0.0,
            min(
                1.0,
                0.5
                + (
                    horizontal_line_score(top_divider)
                    - horizontal_line_score(bottom_divider)
                )
                * 4.0,
            ),
        )
        if abs(density_difference) >= 0.018:
            return broad_score
        return divider_score

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
                "diagnostics": detection.diagnostics or {},
            },
            "homography": {
                "applied": detection.homography_applied,
                "matrix": homography_matrix,
                "normalizedSize": normalized_size,
            },
            "machineWidth": layout.machine_width,
            "machineHeight": layout.machine_height,
            "layoutDebug": layout.debug,
            "gridCalibration": read_result.grid_calibration if read_result else None,
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
