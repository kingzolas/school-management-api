from dataclasses import dataclass
from typing import Dict, List, Optional

import cv2
import numpy as np


@dataclass
class BubbleReadResult:
    answers: List[Dict]
    debug_image: np.ndarray


class AcademyHubBubbleReader:
    def __init__(self, layout):
        self.layout = layout

    def read(self, warped_machine_gray: np.ndarray) -> BubbleReadResult:
        debug = cv2.cvtColor(warped_machine_gray, cv2.COLOR_GRAY2BGR)
        thresh = self._prepare_binary(warped_machine_gray)

        answers = []

        for q_idx in range(self.layout.questions_count):
            q_number = q_idx + 1
            cy = self.layout.row_centers_y[q_idx]

            bubble_scores = []

            for choice_idx, cx in enumerate(self.layout.bubble_centers_x):
                fill_ratio = self._measure_bubble_fill(thresh, cx, cy)
                bubble_scores.append(fill_ratio)

            marked_idx, status, confidence = self._decide_answer(bubble_scores)
            answer = self.layout.choices[marked_idx] if marked_idx is not None else None

            answers.append(
                {
                    "question": q_number,
                    "answer": answer,
                    "status": status,
                    "confidence": round(float(confidence), 4),
                    "scores": [round(float(s), 4) for s in bubble_scores],
                }
            )

            self._draw_debug_row(
                debug=debug,
                q_number=q_number,
                cy=cy,
                scores=bubble_scores,
                marked_idx=marked_idx,
                status=status,
            )

        return BubbleReadResult(answers=answers, debug_image=debug)

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

    def _measure_bubble_fill(self, thresh: np.ndarray, cx: float, cy: float) -> float:
        radius = int(round(self.layout.bubble_radius * 0.72))
        cx = int(round(cx))
        cy = int(round(cy))

        y1 = max(0, cy - radius)
        y2 = min(thresh.shape[0], cy + radius)
        x1 = max(0, cx - radius)
        x2 = min(thresh.shape[1], cx + radius)

        roi = thresh[y1:y2, x1:x2]
        if roi.size == 0:
            return 0.0

        h, w = roi.shape[:2]
        mask = np.zeros((h, w), dtype=np.uint8)
        cv2.circle(mask, (w // 2, h // 2), min(h, w) // 2 - 1, 255, -1)

        ink = cv2.bitwise_and(roi, roi, mask=mask)
        filled = np.count_nonzero(ink)
        total = np.count_nonzero(mask)

        if total == 0:
            return 0.0

        return filled / float(total)

    def _decide_answer(self, scores: List[float]):
        ordered = sorted(enumerate(scores), key=lambda x: x[1], reverse=True)
        top_idx, top_score = ordered[0]
        _, second_score = ordered[1]

        diff = top_score - second_score

        blank_threshold = 0.18
        sure_threshold = 0.28
        diff_threshold = 0.05
        multi_threshold = 0.03

        if top_score < blank_threshold:
            return None, "blank", 1.0 - top_score

        if top_score >= sure_threshold and diff >= diff_threshold:
            confidence = min(1.0, (top_score * 0.7) + (diff * 2.0))
            return top_idx, "ok", confidence

        if diff < multi_threshold and second_score >= blank_threshold:
            confidence = max(0.0, 1.0 - abs(diff))
            return None, "multiple", confidence

        confidence = min(1.0, (top_score * 0.5) + (diff * 1.5))
        return top_idx, "ambiguous", confidence

    def _draw_debug_row(
        self,
        debug: np.ndarray,
        q_number: int,
        cy: float,
        scores: List[float],
        marked_idx: Optional[int],
        status: str,
    ):
        cy = int(round(cy))

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

        for idx, cx in enumerate(self.layout.bubble_centers_x):
            cx = int(round(cx))
            radius = int(round(self.layout.bubble_radius))

            if marked_idx == idx and status in ("ok", "ambiguous"):
                cv2.circle(debug, (cx, cy), radius, row_color, 3)
            else:
                cv2.circle(debug, (cx, cy), radius, (255, 255, 0), 1)

            cv2.putText(
                debug,
                f"{scores[idx]:.2f}",
                (cx - 18, cy - radius - 6),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.34,
                (255, 0, 255),
                1,
                cv2.LINE_AA,
            )