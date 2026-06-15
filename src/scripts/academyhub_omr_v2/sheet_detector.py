import itertools
import time
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
    threshold_image: np.ndarray
    anchors_found: int
    selected_corners: Optional[np.ndarray]
    anchor_candidates: List[dict]
    selected_anchor_confidence: Optional[float]
    homography_applied: bool
    homography_matrix: Optional[np.ndarray]
    normalized_size: Optional[Tuple[int, int]]
    orientation: str
    missing_anchors: List[str]
    capture_hints: List[str]
    message: str
    diagnostics: Optional[dict] = None
    performance: Optional[dict] = None


class AcademyHubSheetDetector:
    """
    Detects the main OMR area from the four black corner anchors, then warps
    the capture into the machine coordinate system used by the bubble reader.
    """

    def __init__(self, layout):
        self.layout = layout

    def detect_and_warp(
        self,
        gray_image: np.ndarray,
        debug_base_image: Optional[np.ndarray] = None,
    ) -> DetectionResult:
        original = gray_image.copy()
        if debug_base_image is not None:
            debug = debug_base_image.copy()
        else:
            debug = cv2.cvtColor(gray_image, cv2.COLOR_GRAY2BGR)
        orientation = self._detect_orientation(gray_image.shape)
        performance = {}
        total_start = time.perf_counter()

        threshold_start = time.perf_counter()
        thresh, threshold_debug = self._threshold_image(gray_image)
        performance["pythonThresholdMs"] = self._elapsed_ms(threshold_start)
        anchor_start = time.perf_counter()
        candidates, filter_debug = self._find_anchor_candidates(thresh, gray_image.shape)
        performance["pythonAnchorMs"] = self._elapsed_ms(anchor_start)
        diagnostics = {
            **threshold_debug,
            **filter_debug,
        }
        if len(candidates) < 4:
            fallback_start = time.perf_counter()
            fallback_thresh, fallback_threshold_debug = self._threshold_dark_on_paper(gray_image)
            fallback_candidates, fallback_filter_debug = self._find_anchor_candidates(
                fallback_thresh,
                gray_image.shape,
            )
            performance["pythonAnchorFallbackMs"] = self._elapsed_ms(fallback_start)
            if len(fallback_candidates) > len(candidates):
                thresh = fallback_thresh
                candidates = fallback_candidates
                diagnostics = {
                    **fallback_threshold_debug,
                    **fallback_filter_debug,
                    "fallbackUsed": True,
                    "fallbackReason": "not_enough_anchors_after_primary_threshold",
                    "primaryAnchorCandidatesAccepted": len(filter_debug.get("acceptedCandidates", [])),
                }
            else:
                diagnostics["fallbackUsed"] = False
                diagnostics["fallbackReason"] = "fallback_did_not_improve_anchor_candidates"

        best_quad = None
        best_metrics = None
        if len(candidates) >= 4:
            anchor_select_start = time.perf_counter()
            best_quad, best_metrics = self._choose_best_quad(candidates, gray_image.shape)
            performance["pythonAnchorSelectMs"] = self._elapsed_ms(anchor_select_start)

            if best_quad is None and diagnostics.get("thresholdMode") != "dark-on-paper":
                fallback_start = time.perf_counter()
                fallback_thresh, fallback_threshold_debug = self._threshold_dark_on_paper(gray_image)
                fallback_candidates, fallback_filter_debug = self._find_anchor_candidates(
                    fallback_thresh,
                    gray_image.shape,
                )
                fallback_quad, fallback_metrics = self._choose_best_quad(
                    fallback_candidates,
                    gray_image.shape,
                )
                performance["pythonAnchorFallbackMs"] = self._elapsed_ms(fallback_start)

                if fallback_quad is not None:
                    thresh = fallback_thresh
                    candidates = fallback_candidates
                    best_quad = fallback_quad
                    best_metrics = fallback_metrics
                    diagnostics = {
                        **fallback_threshold_debug,
                        **fallback_filter_debug,
                        "fallbackUsed": True,
                        "fallbackReason": "invalid_quad_after_primary_threshold",
                        "primaryAnchorCandidatesAccepted": len(filter_debug.get("acceptedCandidates", [])),
                    }
                else:
                    diagnostics["fallbackUsed"] = False
                    diagnostics["fallbackReason"] = "fallback_did_not_find_valid_quad"

        candidates_debug = [
            self._candidate_to_debug(candidate, gray_image.shape)
            for candidate in candidates
        ]

        for candidate in candidates:
            x, y, w, h = candidate.rect
            cv2.rectangle(debug, (x, y), (x + w, y + h), (0, 255, 255), 2)
            cx, cy = map(int, candidate.center)
            cv2.circle(debug, (cx, cy), 4, (255, 0, 0), -1)

        if len(candidates) < 4:
            missing_anchors = self._infer_missing_anchors(candidates, gray_image.shape)
            return DetectionResult(
                success=False,
                warped_machine=None,
                debug_image=debug,
                threshold_image=thresh,
                anchors_found=len(candidates),
                selected_corners=None,
                anchor_candidates=candidates_debug,
                selected_anchor_confidence=None,
                homography_applied=False,
                homography_matrix=None,
                normalized_size=None,
                orientation=orientation,
                missing_anchors=missing_anchors,
                capture_hints=self._build_capture_hints(
                    len(candidates),
                    missing_anchors,
                    "not_enough_anchors",
                ),
                message="Menos de 4 ancoras candidatas detectadas.",
                diagnostics={
                    **diagnostics,
                    "failureReason": "not_enough_anchors",
                },
                performance={
                    **performance,
                    "pythonHomographyMs": 0.0,
                    "pythonSheetDetectionMs": self._elapsed_ms(total_start),
                },
            )

        if best_quad is None:
            missing_anchors = self._infer_missing_anchors(candidates, gray_image.shape)
            return DetectionResult(
                success=False,
                warped_machine=None,
                debug_image=debug,
                threshold_image=thresh,
                anchors_found=len(candidates),
                selected_corners=None,
                anchor_candidates=candidates_debug,
                selected_anchor_confidence=None,
                homography_applied=False,
                homography_matrix=None,
                normalized_size=None,
                orientation=orientation,
                missing_anchors=missing_anchors,
                capture_hints=self._build_capture_hints(
                    len(candidates),
                    missing_anchors,
                    "invalid_quad",
                ),
                message="Nenhum conjunto valido de 4 ancoras encontrado.",
                diagnostics={
                    **diagnostics,
                    "failureReason": "invalid_quad",
                },
                performance={
                    **performance,
                    "pythonHomographyMs": 0.0,
                    "pythonSheetDetectionMs": self._elapsed_ms(total_start),
                },
            )

        ordered = self._order_points(best_quad.astype(np.float32))

        for idx, point in enumerate(ordered):
            x, y = map(int, point)
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

        homography_start = time.perf_counter()
        warped, matrix = self._warp_machine(original, ordered)
        performance["pythonHomographyMs"] = self._elapsed_ms(homography_start)
        performance["pythonSheetDetectionMs"] = self._elapsed_ms(total_start)

        return DetectionResult(
            success=True,
            warped_machine=warped,
            debug_image=debug,
            threshold_image=thresh,
            anchors_found=len(candidates),
            selected_corners=ordered,
            anchor_candidates=candidates_debug,
            selected_anchor_confidence=best_metrics.get("confidence")
            if best_metrics
            else None,
            homography_applied=True,
            homography_matrix=matrix,
            normalized_size=(self.layout.machine_width, self.layout.machine_height),
            orientation=orientation,
            missing_anchors=[],
            capture_hints=[],
            message="Area OMR principal detectada com sucesso.",
            diagnostics={
                **diagnostics,
                "failureReason": None,
            },
            performance=performance,
        )

    def _threshold_image(self, gray: np.ndarray) -> Tuple[np.ndarray, dict]:
        blur = cv2.GaussianBlur(gray, (5, 5), 0)
        threshold_value, thresh = cv2.threshold(
            blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU
        )

        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel, iterations=1)
        return thresh, self._threshold_diagnostics(
            thresh,
            gray.shape,
            mode="otsu-inverted",
            threshold_value=threshold_value,
        )

    def _threshold_dark_on_paper(self, gray: np.ndarray) -> Tuple[np.ndarray, dict]:
        blur = cv2.GaussianBlur(gray, (5, 5), 0)
        _, paper = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        paper_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 15))
        paper = cv2.morphologyEx(paper, cv2.MORPH_CLOSE, paper_kernel, iterations=2)

        contours, _ = cv2.findContours(paper, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        mask = np.zeros_like(gray)
        paper_rect = None
        paper_area_ratio = 0.0
        if contours:
            largest = max(contours, key=cv2.contourArea)
            cv2.drawContours(mask, [largest], -1, 255, -1)
            paper_rect = [int(value) for value in cv2.boundingRect(largest)]
            paper_area_ratio = float(cv2.contourArea(largest)) / float(max(1, gray.shape[0] * gray.shape[1]))
        else:
            mask[:, :] = 255

        masked = gray.copy()
        masked[mask == 0] = 255

        threshold_value = 140
        _, thresh = cv2.threshold(masked, threshold_value, 255, cv2.THRESH_BINARY_INV)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel, iterations=1)
        diagnostics = self._threshold_diagnostics(
            thresh,
            gray.shape,
            mode="dark-on-paper",
            threshold_value=threshold_value,
        )
        diagnostics["paperRect"] = paper_rect
        diagnostics["paperAreaRatio"] = round(float(paper_area_ratio), 4)
        return thresh, diagnostics

    @staticmethod
    def _threshold_diagnostics(
        thresh: np.ndarray,
        image_shape: Tuple[int, int],
        mode: str,
        threshold_value: Optional[float],
    ) -> dict:
        h, w = image_shape[:2]
        foreground_ratio = float(np.count_nonzero(thresh)) / float(max(1, h * w))
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        largest = None
        if contours:
            largest_contour = max(contours, key=cv2.contourArea)
            x, y, bw, bh = cv2.boundingRect(largest_contour)
            largest_area = cv2.contourArea(largest_contour)
            largest = {
                "rect": [int(x), int(y), int(bw), int(bh)],
                "areaRatio": round(float(largest_area) / float(max(1, h * w)), 4),
                "extent": round(float(largest_area) / float(max(1, bw * bh)), 4),
            }

        return {
            "thresholdMode": mode,
            "thresholdValue": None if threshold_value is None else round(float(threshold_value), 2),
            "blackPixelRatio": round(foreground_ratio, 4),
            "imageWidth": int(w),
            "imageHeight": int(h),
            "largestForegroundContour": largest,
        }

    def _find_anchor_candidates(
        self, thresh: np.ndarray, image_shape: Tuple[int, int]
    ) -> Tuple[List[AnchorCandidate], dict]:
        h, w = image_shape[:2]
        image_area = h * w

        contours, _ = cv2.findContours(
            thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )

        candidates: List[AnchorCandidate] = []
        stats = {
            "anchorCandidatesBeforeFilter": len(contours),
            "anchorCandidatesAfterAreaFilter": 0,
            "anchorCandidatesAfterSizeFilter": 0,
            "anchorCandidatesAfterFrameFilter": 0,
            "anchorCandidatesAfterShapeFilter": 0,
            "anchorCandidatesAfterExtentFilter": 0,
            "anchorCandidatesAfterApproxFilter": 0,
            "anchorCandidatesAfterSolidityFilter": 0,
            "acceptedCandidates": [],
        }

        for contour in contours:
            area = cv2.contourArea(contour)
            if area < image_area * 0.00015:
                continue
            stats["anchorCandidatesAfterAreaFilter"] += 1

            x, y, bw, bh = cv2.boundingRect(contour)
            if bw < 18 or bh < 18:
                continue
            stats["anchorCandidatesAfterSizeFilter"] += 1

            # Dark backgrounds can merge with the card and produce a full-frame
            # contour. A valid anchor can be near an edge, but it cannot occupy
            # a large chunk of the captured image.
            touches_frame = x <= 2 or y <= 2 or (x + bw) >= (w - 2) or (y + bh) >= (h - 2)
            too_large_for_anchor = bw > (w * 0.35) or bh > (h * 0.35)
            large_edge_contour = touches_frame and (bw > (w * 0.12) or bh > (h * 0.12))
            if too_large_for_anchor or large_edge_contour:
                continue
            stats["anchorCandidatesAfterFrameFilter"] += 1

            ratio = bw / float(bh)
            if not (0.60 <= ratio <= 1.40):
                continue
            stats["anchorCandidatesAfterShapeFilter"] += 1

            rect_area = float(bw * bh)
            if rect_area <= 0:
                continue

            extent = area / rect_area
            if not (0.20 <= extent <= 0.55):
                continue
            stats["anchorCandidatesAfterExtentFilter"] += 1

            perimeter = cv2.arcLength(contour, True)
            approx = cv2.approxPolyDP(contour, 0.04 * perimeter, True)
            if len(approx) < 4 or len(approx) > 8:
                continue
            stats["anchorCandidatesAfterApproxFilter"] += 1

            hull = cv2.convexHull(contour)
            hull_area = cv2.contourArea(hull)
            if hull_area <= 0:
                continue

            solidity = area / hull_area
            if not (0.45 <= solidity <= 0.95):
                continue
            stats["anchorCandidatesAfterSolidityFilter"] += 1

            candidates.append(
                AnchorCandidate(
                    contour=contour,
                    center=(x + bw / 2.0, y + bh / 2.0),
                    rect=(x, y, bw, bh),
                    area=area,
                    extent=extent,
                )
            )
            if len(stats["acceptedCandidates"]) < 16:
                stats["acceptedCandidates"].append(
                    {
                        "rect": [int(x), int(y), int(bw), int(bh)],
                        "center": [round(float(x + bw / 2.0), 2), round(float(y + bh / 2.0), 2)],
                        "area": round(float(area), 2),
                        "ratio": round(float(ratio), 4),
                        "extent": round(float(extent), 4),
                        "solidity": round(float(solidity), 4),
                        "approxPoints": int(len(approx)),
                    }
                )

        candidates.sort(key=lambda candidate: candidate.area, reverse=True)
        return candidates[:12], stats

    def _choose_best_quad(
        self,
        candidates: List[AnchorCandidate],
        image_shape: Tuple[int, int],
    ) -> Tuple[Optional[np.ndarray], Optional[dict]]:
        h, w = image_shape[:2]
        image_center = np.array([w / 2.0, h / 2.0], dtype=np.float32)

        best_score = None
        best_quad = None
        best_metrics = None

        for quad in itertools.combinations(candidates, 4):
            points = np.array([candidate.center for candidate in quad], dtype=np.float32)
            ordered = self._order_points(points)

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
                confidence = max(
                    0.0,
                    min(
                        1.0,
                        1.0
                        - min(1.0, ratio_error / max(expected_ratio, 0.001))
                        - (width_balance * 0.25)
                        - (height_balance * 0.25)
                        - (center_dist * 0.15),
                    ),
                )
                best_score = score
                best_quad = ordered
                best_metrics = {
                    "score": round(float(score), 4),
                    "ratio": round(float(ratio), 4),
                    "expectedRatio": round(float(expected_ratio), 4),
                    "ratioError": round(float(ratio_error), 4),
                    "widthBalance": round(float(width_balance), 4),
                    "heightBalance": round(float(height_balance), 4),
                    "areaRatio": round(float(poly_area / float(h * w)), 4),
                    "centerDistance": round(float(center_dist), 4),
                    "confidence": round(float(confidence), 4),
                }

        return best_quad, best_metrics

    def _warp_machine(
        self,
        gray_image: np.ndarray,
        ordered_pts: np.ndarray,
    ) -> Tuple[np.ndarray, np.ndarray]:
        anchor_points = self.layout.anchor_points
        dst = np.array(
            [
                anchor_points["topLeft"],
                anchor_points["topRight"],
                anchor_points["bottomRight"],
                anchor_points["bottomLeft"],
            ],
            dtype=np.float32,
        )

        matrix = cv2.getPerspectiveTransform(ordered_pts.astype(np.float32), dst)
        warped = cv2.warpPerspective(
            gray_image,
            matrix,
            (self.layout.machine_width, self.layout.machine_height),
        )
        return warped, matrix

    @staticmethod
    def _order_points(pts: np.ndarray) -> np.ndarray:
        rect = np.zeros((4, 2), dtype=np.float32)

        summed = pts.sum(axis=1)
        rect[0] = pts[np.argmin(summed)]
        rect[2] = pts[np.argmax(summed)]

        diff = np.diff(pts, axis=1)
        rect[1] = pts[np.argmin(diff)]
        rect[3] = pts[np.argmax(diff)]

        return rect

    @staticmethod
    def _detect_orientation(image_shape: Tuple[int, int]) -> str:
        h, w = image_shape[:2]
        if h > w * 1.08:
            return "portrait"
        if w > h * 1.08:
            return "landscape"
        return "square"

    @staticmethod
    def _elapsed_ms(start: float) -> float:
        return round((time.perf_counter() - start) * 1000.0, 2)

    def _candidate_to_debug(
        self,
        candidate: AnchorCandidate,
        image_shape: Tuple[int, int],
    ) -> dict:
        x, y, w, h = candidate.rect
        aspect = w / float(max(h, 1))
        shape_score = max(0.0, 1.0 - abs(1.0 - aspect))
        extent_score = max(0.0, 1.0 - abs(0.38 - candidate.extent) / 0.38)
        confidence = max(
            0.0,
            min(1.0, (shape_score * 0.55) + (extent_score * 0.45)),
        )

        return {
            "center": [
                round(float(candidate.center[0]), 2),
                round(float(candidate.center[1]), 2),
            ],
            "rect": [int(x), int(y), int(w), int(h)],
            "area": round(float(candidate.area), 2),
            "extent": round(float(candidate.extent), 4),
            "confidence": round(float(confidence), 4),
            "quadrant": self._quadrant_for_center(candidate.center, image_shape),
        }

    def _infer_missing_anchors(
        self,
        candidates: List[AnchorCandidate],
        image_shape: Tuple[int, int],
    ) -> List[str]:
        present = {
            self._quadrant_for_center(candidate.center, image_shape)
            for candidate in candidates
        }
        expected = {"topLeft", "topRight", "bottomRight", "bottomLeft"}
        return sorted(expected - present)

    @staticmethod
    def _quadrant_for_center(
        center: Tuple[float, float],
        image_shape: Tuple[int, int],
    ) -> str:
        h, w = image_shape[:2]
        x, y = center
        if y < h / 2.0 and x < w / 2.0:
            return "topLeft"
        if y < h / 2.0 and x >= w / 2.0:
            return "topRight"
        if y >= h / 2.0 and x >= w / 2.0:
            return "bottomRight"
        return "bottomLeft"

    @staticmethod
    def _build_capture_hints(
        anchors_found: int,
        missing_anchors: List[str],
        reason: str,
    ) -> List[str]:
        hints = []
        if anchors_found < 4:
            hints.append("Inclua os quatro cantos pretos dentro da area.")
        if any(anchor.startswith("bottom") for anchor in missing_anchors):
            hints.append("Evite cortar a parte inferior do cartao.")
        if any(anchor.startswith("top") for anchor in missing_anchors):
            hints.append("Evite cortar a parte superior do cartao.")
        if reason == "invalid_quad":
            hints.append("Mantenha o papel plano e reduza a inclinacao.")
        if not hints:
            hints.append("Aproxime ou afaste o cartao ate as quatro ancoras ficarem nitidas.")
        return hints
