from dataclasses import dataclass
from typing import Dict, List, Optional

import cv2
import numpy as np


@dataclass
class BubbleReadResult:
    answers: List[Dict]
    debug_image: np.ndarray
    threshold_image: np.ndarray
    bubbles_overlay_image: np.ndarray
    questions_debug: List[Dict]


class AcademyHubBubbleReader:
    THRESHOLDS = {
        "blank": 0.18,
        "sure": 0.28,
        "diff": 0.05,
        "multiple": 0.03,
    }

    def __init__(self, layout):
        self.layout = layout

    def read(self, warped_machine_gray: np.ndarray) -> BubbleReadResult:
        debug = cv2.cvtColor(warped_machine_gray, cv2.COLOR_GRAY2BGR)
        bubbles_overlay = debug.copy()
        thresh = self._prepare_binary(warped_machine_gray)

        answers = []
        questions_debug = []

        for q_idx in range(self.layout.questions_count):
            q_number = q_idx + 1
            question_bubbles = self.layout.bubbles_for_question(q_number)

            bubble_scores = []
            option_details: Dict[str, Dict] = {}

            for choice in self.layout.choices:
                bubble = question_bubbles.get(choice)
                if bubble is None:
                    detail = self._missing_bubble_detail(choice)
                else:
                    detail = self._measure_bubble(
                        thresh=thresh,
                        gray=warped_machine_gray,
                        cx=bubble.x,
                        cy=bubble.y,
                        radius=bubble.r,
                    )

                option_details[choice] = detail
                bubble_scores.append(detail["fillRatio"])

            has_template_mismatch = any(
                option_details[choice].get("missing") for choice in self.layout.choices
            )
            all_out_of_bounds = all(
                option_details[choice].get("outOfBounds") for choice in self.layout.choices
            )

            marked_idx, status, confidence, debug_status, reason = self._decide_answer(
                bubble_scores,
                template_mismatch=has_template_mismatch,
                out_of_bounds=all_out_of_bounds,
            )
            answer = self.layout.choices[marked_idx] if marked_idx is not None else None
            decision_debug = self._build_decision_debug(bubble_scores)

            answers.append(
                {
                    "question": q_number,
                    "answer": answer,
                    "status": status,
                    "confidence": round(float(confidence), 4),
                    "scores": [round(float(s), 4) for s in bubble_scores],
                    "selected": answer,
                    "debugStatus": debug_status,
                    "threshold": self.THRESHOLDS["blank"],
                    "reason": reason,
                    "options": option_details,
                    "topSecondDifference": decision_debug["diff"],
                }
            )

            questions_debug.append(
                {
                    "question": q_number,
                    "selected": answer,
                    "status": debug_status,
                    "threshold": self.THRESHOLDS["blank"],
                    "options": option_details,
                    "reason": reason,
                    "decision": decision_debug,
                    "topSecondDifference": decision_debug["diff"],
                }
            )

            self._draw_bubbles_overlay(
                overlay=bubbles_overlay,
                q_number=q_number,
                option_details=option_details,
            )

            self._draw_debug_row(
                debug=debug,
                q_number=q_number,
                question_bubbles=question_bubbles,
                scores=bubble_scores,
                marked_idx=marked_idx,
                status=status,
            )

        return BubbleReadResult(
            answers=answers,
            debug_image=debug,
            threshold_image=thresh,
            bubbles_overlay_image=bubbles_overlay,
            questions_debug=questions_debug,
        )

    def _prepare_binary(self, gray: np.ndarray) -> np.ndarray:
        blur = cv2.GaussianBlur(gray, (5, 5), 0)
        return cv2.adaptiveThreshold(
            blur,
            255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY_INV,
            31,
            8,
        )

    def _measure_bubble(
        self,
        thresh: np.ndarray,
        gray: np.ndarray,
        cx: float,
        cy: float,
        radius: float,
    ) -> Dict:
        measure_radius = int(round(radius * 0.72))
        cx = int(round(cx))
        cy = int(round(cy))

        intended_x1 = cx - measure_radius
        intended_y1 = cy - measure_radius
        intended_x2 = cx + measure_radius
        intended_y2 = cy + measure_radius

        y1 = max(0, intended_y1)
        y2 = min(thresh.shape[0], intended_y2)
        x1 = max(0, intended_x1)
        x2 = min(thresh.shape[1], intended_x2)

        roi = thresh[y1:y2, x1:x2]
        gray_roi = gray[y1:y2, x1:x2]
        bbox = [int(x1), int(y1), int(max(0, x2 - x1)), int(max(0, y2 - y1))]
        out_of_bounds = (
            intended_x1 < 0
            or intended_y1 < 0
            or intended_x2 > thresh.shape[1]
            or intended_y2 > thresh.shape[0]
            or roi.size == 0
        )

        if roi.size == 0:
            return {
                "fillRatio": 0.0,
                "score": 0.0,
                "mean": None,
                "bbox": bbox,
                "center": [int(cx), int(cy)],
                "outOfBounds": True,
            }

        h, w = roi.shape[:2]
        mask = np.zeros((h, w), dtype=np.uint8)
        cv2.circle(mask, (w // 2, h // 2), min(h, w) // 2 - 1, 255, -1)

        ink = cv2.bitwise_and(roi, roi, mask=mask)
        filled = np.count_nonzero(ink)
        total = np.count_nonzero(mask)

        if total == 0:
            fill_ratio = 0.0
        else:
            fill_ratio = filled / float(total)

        masked_gray = cv2.bitwise_and(gray_roi, gray_roi, mask=mask)
        gray_pixels = masked_gray[mask > 0]
        mean_value = float(np.mean(gray_pixels)) if gray_pixels.size else None

        return {
            "fillRatio": round(float(fill_ratio), 4),
            "score": round(float(fill_ratio), 4),
            "mean": round(mean_value, 2) if mean_value is not None else None,
            "bbox": bbox,
            "center": [int(cx), int(cy)],
            "outOfBounds": bool(out_of_bounds),
        }

    def _missing_bubble_detail(self, choice: str) -> Dict:
        return {
            "fillRatio": 0.0,
            "score": 0.0,
            "mean": None,
            "bbox": None,
            "center": None,
            "outOfBounds": True,
            "missing": True,
            "option": choice,
        }

    def _decide_answer(
        self,
        scores: List[float],
        template_mismatch: bool = False,
        out_of_bounds: bool = False,
    ):
        if template_mismatch:
            return (
                None,
                "blank",
                0.0,
                "template_mismatch",
                "one or more expected bubbles are missing from the template",
            )

        if out_of_bounds:
            return (
                None,
                "blank",
                0.0,
                "out_of_bounds",
                "all option bounding boxes are outside the normalized image",
            )

        ordered = sorted(enumerate(scores), key=lambda x: x[1], reverse=True)
        top_idx, top_score = ordered[0]
        _, second_score = ordered[1]

        diff = top_score - second_score

        blank_threshold = self.THRESHOLDS["blank"]
        sure_threshold = self.THRESHOLDS["sure"]
        diff_threshold = self.THRESHOLDS["diff"]
        multi_threshold = self.THRESHOLDS["multiple"]

        if top_score < blank_threshold:
            return (
                None,
                "blank",
                1.0 - top_score,
                "blank",
                "highest option below blank threshold",
            )

        if top_score >= sure_threshold and diff >= diff_threshold:
            confidence = min(1.0, (top_score * 0.7) + (diff * 2.0))
            return (
                top_idx,
                "ok",
                confidence,
                "marked",
                "top option above sure threshold and separated from second option",
            )

        if diff < multi_threshold and second_score >= blank_threshold:
            confidence = max(0.0, 1.0 - abs(diff))
            return (
                None,
                "multiple",
                confidence,
                "multiple",
                "top two options are too close above blank threshold",
            )

        confidence = min(1.0, (top_score * 0.5) + (diff * 1.5))
        return (
            top_idx,
            "ambiguous",
            confidence,
            "low_confidence",
            "top option above blank threshold but below sure decision rule",
        )

    def _build_decision_debug(self, scores: List[float]) -> Dict:
        ordered = sorted(enumerate(scores), key=lambda x: x[1], reverse=True)
        top_idx, top_score = ordered[0]
        second_idx, second_score = ordered[1]
        return {
            "topOption": self.layout.choices[top_idx],
            "topScore": round(float(top_score), 4),
            "secondOption": self.layout.choices[second_idx],
            "secondScore": round(float(second_score), 4),
            "diff": round(float(top_score - second_score), 4),
            "thresholds": self.THRESHOLDS,
        }

    def _draw_debug_row(
        self,
        debug: np.ndarray,
        q_number: int,
        question_bubbles: Dict,
        scores: List[float],
        marked_idx: Optional[int],
        status: str,
    ):
        row_bubbles = list(question_bubbles.values())
        if row_bubbles:
            cy = int(round(sum(b.y for b in row_bubbles) / len(row_bubbles)))
        elif q_number - 1 < len(self.layout.row_centers_y):
            cy = int(round(self.layout.row_centers_y[q_number - 1]))
        else:
            cy = 20 + (q_number * 24)

        color_map = {
            "ok": (0, 255, 0),
            "blank": (180, 180, 180),
            "multiple": (0, 0, 255),
            "ambiguous": (0, 165, 255),
        }
        row_color = color_map.get(status, (255, 255, 0))

        cv2.putText(
            debug,
            f"{q_number:02d}",
            (20, cy + 4),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            row_color,
            2,
            cv2.LINE_AA,
        )

        if marked_idx is not None and status in ("ok", "ambiguous"):
            selected = self.layout.choices[marked_idx]
            status_label = "marked" if status == "ok" else "low_confidence"
            label = f"{selected} {status_label}"
        else:
            label = "multiple" if status == "multiple" else "blank"

        cv2.putText(
            debug,
            label,
            (70, cy + 4),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.45,
            row_color,
            1,
            cv2.LINE_AA,
        )

        for idx, choice in enumerate(self.layout.choices):
            bubble = question_bubbles.get(choice)
            if bubble is None:
                continue

            cx = int(round(bubble.x))
            bubble_cy = int(round(bubble.y))
            radius = int(round(bubble.r))

            if marked_idx == idx and status in ("ok", "ambiguous"):
                cv2.circle(debug, (cx, bubble_cy), radius, row_color, 3)
            else:
                cv2.circle(debug, (cx, bubble_cy), radius, (255, 255, 0), 1)

            cv2.putText(
                debug,
                f"{scores[idx]:.2f}",
                (cx - 18, bubble_cy - radius - 6),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.34,
                (255, 0, 255),
                1,
                cv2.LINE_AA,
            )

    def _draw_bubbles_overlay(
        self,
        overlay: np.ndarray,
        q_number: int,
        option_details: Dict[str, Dict],
    ):
        for choice, detail in option_details.items():
            bbox = detail.get("bbox")
            center = detail.get("center")

            if not bbox or not center:
                continue

            x, y, w, h = [int(value) for value in bbox]
            cx, cy = [int(value) for value in center]
            color = (0, 255, 255)
            if detail.get("outOfBounds"):
                color = (0, 0, 255)

            cv2.rectangle(overlay, (x, y), (x + w, y + h), color, 1)
            cv2.circle(overlay, (cx, cy), 2, (255, 0, 255), -1)
            cv2.putText(
                overlay,
                f"{q_number}{choice}",
                (x, max(10, y - 4)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.32,
                color,
                1,
                cv2.LINE_AA,
            )
