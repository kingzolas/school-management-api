import itertools
from dataclasses import dataclass
from typing import List, Optional, Tuple

import cv2
import numpy as np


@dataclass
class AnchorCandidate:
    contour: np.ndarray
    center: Tuple[float, float]
    rect: Tuple[int, int, int, int]
    area: float
    extent: float


@dataclass
class DetectionResult:
    success: bool
    warped_machine: Optional[np.ndarray]
    debug_image: np.ndarray
    anchors_found: int
    selected_corners: Optional[np.ndarray]
    message: str


class AcademyHubSheetDetector:
    """
    Detector da área principal OMR usando as 4 âncoras em L.
    Já tenta ignorar âncoras extras de outro gabarito vizinho.
    """

    def __init__(self, layout):
        self.layout = layout

    def detect_and_warp(self, gray_image: np.ndarray) -> DetectionResult:
        original = gray_image.copy()
        debug = cv2.cvtColor(gray_image, cv2.COLOR_GRAY2BGR)

        thresh = self._threshold_image(gray_image)
        candidates = self._find_anchor_candidates(thresh, gray_image.shape)

        for cand in candidates:
            x, y, w, h = cand.rect
            cv2.rectangle(debug, (x, y), (x + w, y + h), (0, 255, 255), 2)
            cx, cy = map(int, cand.center)
            cv2.circle(debug, (cx, cy), 4, (255, 0, 0), -1)

        if len(candidates) < 4:
            return DetectionResult(
                success=False,
                warped_machine=None,
                debug_image=debug,
                anchors_found=len(candidates),
                selected_corners=None,
                message="Menos de 4 âncoras candidatas detectadas.",
            )

        best_quad = self._choose_best_quad(candidates, gray_image.shape)

        if best_quad is None:
            return DetectionResult(
                success=False,
                warped_machine=None,
                debug_image=debug,
                anchors_found=len(candidates),
                selected_corners=None,
                message="Nenhum conjunto válido de 4 âncoras encontrado.",
            )

        ordered = self._order_points(best_quad.astype(np.float32))

        for idx, pt in enumerate(ordered):
            x, y = map(int, pt)
            cv2.circle(debug, (x, y), 8, (0, 0, 255), -1)
            cv2.putText(
                debug,
                ["TL", "TR", "BR", "BL"][idx],
                (x + 8, y - 8),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (0, 0, 255),
                2,
                cv2.LINE_AA,
            )

        warped = self._warp_machine(original, ordered)

        return DetectionResult(
            success=True,
            warped_machine=warped,
            debug_image=debug,
            anchors_found=len(candidates),
            selected_corners=ordered,
            message="Área OMR principal detectada com sucesso.",
        )

    def _threshold_image(self, gray: np.ndarray) -> np.ndarray:
        blur = cv2.GaussianBlur(gray, (5, 5), 0)
        _, thresh = cv2.threshold(
            blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU
        )

        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel, iterations=1)
        return thresh

    def _find_anchor_candidates(
        self, thresh: np.ndarray, image_shape: Tuple[int, int]
    ) -> List[AnchorCandidate]:
        h, w = image_shape[:2]
        image_area = h * w

        contours, _ = cv2.findContours(
            thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )

        candidates: List[AnchorCandidate] = []

        for cnt in contours:
            area = cv2.contourArea(cnt)
            if area < image_area * 0.00015:
                continue

            x, y, bw, bh = cv2.boundingRect(cnt)
            if bw < 18 or bh < 18:
                continue

            ratio = bw / float(bh)
            if not (0.60 <= ratio <= 1.40):
                continue

            rect_area = float(bw * bh)
            if rect_area <= 0:
                continue

            extent = area / rect_area
            if not (0.20 <= extent <= 0.55):
                continue

            peri = cv2.arcLength(cnt, True)
            approx = cv2.approxPolyDP(cnt, 0.04 * peri, True)
            if len(approx) < 4 or len(approx) > 8:
                continue

            hull = cv2.convexHull(cnt)
            hull_area = cv2.contourArea(hull)
            if hull_area <= 0:
                continue

            solidity = area / hull_area
            if not (0.45 <= solidity <= 0.95):
                continue

            center = (x + bw / 2.0, y + bh / 2.0)

            candidates.append(
                AnchorCandidate(
                    contour=cnt,
                    center=center,
                    rect=(x, y, bw, bh),
                    area=area,
                    extent=extent,
                )
            )

        candidates.sort(key=lambda c: c.area, reverse=True)
        return candidates[:12]

    def _choose_best_quad(
        self, candidates: List[AnchorCandidate], image_shape: Tuple[int, int]
    ) -> Optional[np.ndarray]:
        h, w = image_shape[:2]
        image_center = np.array([w / 2.0, h / 2.0], dtype=np.float32)

        best_score = None
        best_quad = None

        for quad in itertools.combinations(candidates, 4):
            pts = np.array([c.center for c in quad], dtype=np.float32)
            ordered = self._order_points(pts)

            tl, tr, br, bl = ordered

            width_top = np.linalg.norm(tr - tl)
            width_bottom = np.linalg.norm(br - bl)
            height_left = np.linalg.norm(bl - tl)
            height_right = np.linalg.norm(br - tr)

            width_avg = (width_top + width_bottom) / 2.0
            height_avg = (height_left + height_right) / 2.0

            if width_avg < 80 or height_avg < 80:
                continue

            ratio = width_avg / max(height_avg, 1.0)
            expected_ratio = self.layout.expected_machine_ratio
            ratio_error = abs(ratio - expected_ratio)

            if ratio_error > max(0.35, expected_ratio * 0.55):
                continue

            width_balance = abs(width_top - width_bottom) / max(width_avg, 1.0)
            height_balance = abs(height_left - height_right) / max(height_avg, 1.0)

            if width_balance > 0.35 or height_balance > 0.35:
                continue

            poly_area = cv2.contourArea(ordered.astype(np.float32))
            if poly_area < (h * w * 0.03):
                continue

            quad_center = ordered.mean(axis=0)
            center_dist = np.linalg.norm(quad_center - image_center) / max(w, h)

            score = (
                (ratio_error * 4.0)
                + (width_balance * 2.0)
                + (height_balance * 2.0)
                + (center_dist * 1.5)
                - (poly_area / float(h * w))
            )

            if best_score is None or score < best_score:
                best_score = score
                best_quad = ordered

        return best_quad

    def _warp_machine(
        self, gray_image: np.ndarray, ordered_pts: np.ndarray
    ) -> np.ndarray:
        dst = np.array(
            [
                [
                    self.layout.anchor_offset + self.layout.anchor_size / 2.0,
                    self.layout.anchor_offset + self.layout.anchor_size / 2.0,
                ],
                [
                    self.layout.machine_width
                    - (self.layout.anchor_offset + self.layout.anchor_size / 2.0),
                    self.layout.anchor_offset + self.layout.anchor_size / 2.0,
                ],
                [
                    self.layout.machine_width
                    - (self.layout.anchor_offset + self.layout.anchor_size / 2.0),
                    self.layout.machine_height
                    - (self.layout.anchor_offset + self.layout.anchor_size / 2.0),
                ],
                [
                    self.layout.anchor_offset + self.layout.anchor_size / 2.0,
                    self.layout.machine_height
                    - (self.layout.anchor_offset + self.layout.anchor_size / 2.0),
                ],
            ],
            dtype=np.float32,
        )

        matrix = cv2.getPerspectiveTransform(ordered_pts.astype(np.float32), dst)
        warped = cv2.warpPerspective(
            gray_image,
            matrix,
            (self.layout.machine_width, self.layout.machine_height),
        )
        return warped

    @staticmethod
    def _order_points(pts: np.ndarray) -> np.ndarray:
        rect = np.zeros((4, 2), dtype=np.float32)

        s = pts.sum(axis=1)
        rect[0] = pts[np.argmin(s)]
        rect[2] = pts[np.argmax(s)]

        diff = np.diff(pts, axis=1)
        rect[1] = pts[np.argmin(diff)]
        rect[3] = pts[np.argmax(diff)]

        return rect