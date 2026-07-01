#!/usr/bin/env python3
"""
Emergency OMR preview for AcademyHub early-childhood assessment sheets.

This version is intentionally dry-run only. It reads the authenticated Desktop
session to fetch the real class roster, but never sends a write request.
"""

from __future__ import annotations

import argparse
import csv
import html
import json
import math
import os
import re
import shutil
import sys
import unicodedata
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import cv2
import numpy as np


API_BASE_URL = "https://school-management-api-76ef.onrender.com/api"
PREFS_PATH = (
    Path(os.environ.get("APPDATA", ""))
    / "com.example"
    / "academyhub"
    / "shared_preferences.json"
)
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
ROWS_PER_PAGE = 11

STATUS_VALUES = {
    "A": "autonomy",
    "AP": "support",
    "ED": "developing",
    "NT": "not_worked",
}
FINAL_STATUS_OPTIONS = ["autonomy", "support", "developing", "not_worked", None]
FINAL_STATUS_TEXT = {"autonomy", "support", "developing", "not_worked", "null"}

AREA_DEFINITIONS = {
    "LINGUAGEM / PORTUGUÊS": {
        "key": "early_language_portuguese",
        "aliases": ("linguagem portugues", "linguagem", "portugues"),
    },
    "MATEMÁTICA": {
        "key": "early_math",
        "aliases": ("matematica",),
    },
    "NATUREZA E SOCIEDADE": {
        "key": "early_nature_society",
        "aliases": ("natureza e sociedade", "natureza sociedade"),
    },
    "ARTE": {
        "key": "early_art",
        "aliases": ("arte",),
    },
    "ENSINO RELIGIOSO / VALORES": {
        "key": "early_values_religion",
        "aliases": (
            "ensino religioso valores",
            "ensino religioso",
            "religioso valores",
            "valores",
        ),
    },
}

COLOR_BGR = {
    "confident": (68, 145, 58),
    "doubt": (0, 184, 230),
    "conflict": (53, 53, 220),
    "pending": (145, 145, 145),
}


def normalize(value: Any) -> str:
    text = "" if value is None else str(value)
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def correction_slug(value: Any, uppercase: bool = False) -> str:
    text = "" if value is None else str(value)
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r"[^A-Za-z0-9]+", "_", text).strip("_")
    return text.upper() if uppercase else text


def correction_id(
    class_name: str,
    developmental_key: str,
    student_name: str,
    criterion: str,
) -> str:
    return "__".join(
        [
            correction_slug(class_name, uppercase=True),
            developmental_key,
            correction_slug(student_name),
            correction_slug(criterion, uppercase=True),
        ]
    )


def canonical_area(value: Any) -> str | None:
    normalized = normalize(value)
    if not normalized:
        return None
    for area, definition in AREA_DEFINITIONS.items():
        if normalized == normalize(area):
            return area
        if any(alias in normalized for alias in definition["aliases"]):
            return area
    return None


def read_session() -> tuple[str, dict[str, Any], str]:
    if not PREFS_PATH.exists():
        raise RuntimeError(
            f"Sessão do AcademyHub Desktop não encontrada em {PREFS_PATH}."
        )
    prefs = json.loads(PREFS_PATH.read_text(encoding="utf-8"))
    token = prefs.get("flutter.authToken")
    user_raw = prefs.get("flutter.userData")
    if not token or not user_raw:
        raise RuntimeError("Token ou usuário ausente na sessão local do Desktop.")
    user = json.loads(user_raw)
    school_id = user.get("school_id") or user.get("schoolId")
    if not school_id:
        raise RuntimeError("Usuário autenticado sem escola no contexto local.")
    return token, user, str(school_id)


def api_get(
    path: str,
    token: str,
    query: dict[str, Any] | None = None,
) -> Any:
    url = f"{API_BASE_URL}{path}"
    if query:
        clean = {key: str(value) for key, value in query.items() if value is not None}
        url = f"{url}?{urllib.parse.urlencode(clean)}"
    request = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="GET",
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return json.loads(response.read().decode(charset))


def enrollment_student(enrollment: dict[str, Any]) -> dict[str, Any]:
    student = enrollment.get("student") or enrollment.get("studentId") or {}
    if isinstance(student, dict):
        return student
    return {"_id": str(student), "fullName": "Aluno sem nome"}


def load_real_context(
    school_name: str,
    year: int,
    allowed_classes: set[str],
) -> dict[str, Any]:
    token, user, school_id = read_session()
    school = api_get(f"/schools/{school_id}", token)
    actual_school = school.get("name") or school.get("tradeName") or ""
    if normalize(actual_school) != normalize(school_name):
        raise RuntimeError(
            f"Escola autenticada é '{actual_school}', mas foi solicitada '{school_name}'."
        )

    classes = api_get("/classes", token, {"schoolYear": year, "status": "Ativa"})
    if not isinstance(classes, list):
        classes = api_get("/classes", token)

    selected_classes = []
    for class_item in classes:
        class_name = normalize(class_item.get("name"))
        class_year = int(class_item.get("schoolYear") or year)
        status = normalize(class_item.get("status"))
        if class_name in allowed_classes and class_year == year and status == "ativa":
            selected_classes.append(class_item)

    found = {normalize(item.get("name")) for item in selected_classes}
    missing = sorted(allowed_classes - found)
    if missing:
        raise RuntimeError(
            "Turmas ativas não encontradas na API: " + ", ".join(missing)
        )

    rosters: dict[str, dict[str, Any]] = {}
    for class_item in selected_classes:
        enrollments = api_get(
            "/enrollments",
            token,
            {"class": class_item["_id"], "status": "Ativa"},
        )
        students = [enrollment_student(item) for item in enrollments]
        students.sort(key=lambda item: normalize(item.get("fullName")))
        rosters[normalize(class_item.get("name"))] = {
            "class": class_item,
            "students": students,
        }

    return {
        "token": token,
        "user": user,
        "school": school,
        "rosters": rosters,
    }


def read_mapping(path: Path | None) -> dict[str, dict[str, Any]]:
    if path is None:
        return {}
    raw = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(raw, list):
        raise RuntimeError("O arquivo de mapeamento deve conter uma lista JSON.")
    result = {}
    for item in raw:
        if not isinstance(item, dict) or not item.get("file"):
            raise RuntimeError("Cada item do mapeamento precisa do campo 'file'.")
        result[normalize(Path(str(item["file"])).name)] = item
    return result


def parse_confirmation(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return normalize(value) in {"true", "1", "sim", "yes", "y"}


def read_corrections(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        raise RuntimeError(f"Arquivo de correções não encontrado: {path}")
    if path.suffix.lower() == ".json":
        records = json.loads(path.read_text(encoding="utf-8-sig"))
        if not isinstance(records, list):
            raise RuntimeError("O JSON de correções deve conter uma lista.")
    elif path.suffix.lower() == ".csv":
        with path.open(encoding="utf-8-sig", newline="") as handle:
            records = list(csv.DictReader(handle))
    else:
        raise RuntimeError("Correções devem estar em arquivo JSON ou CSV.")

    corrections: dict[str, dict[str, Any]] = {}
    for row_number, raw in enumerate(records, start=1):
        if not isinstance(raw, dict):
            raise RuntimeError(f"Correção {row_number} não é um objeto válido.")
        item_id = str(raw.get("id") or "").strip()
        if not item_id:
            raise RuntimeError(f"Correção {row_number} sem id.")
        if item_id in corrections:
            raise RuntimeError(f"ID de correção duplicado: {item_id}")
        if "finalStatus" not in raw:
            final_text = ""
        else:
            final_raw = raw.get("finalStatus")
            final_text = (
                "null"
                if final_raw is None
                else str(final_raw).strip().lower()
            )
        if final_text and final_text not in FINAL_STATUS_TEXT:
            raise RuntimeError(
                f"finalStatus inválido em {item_id}: '{final_text}'. "
                "Use autonomy, support, developing, not_worked, null ou vazio."
            )
        corrections[item_id] = {
            **raw,
            "id": item_id,
            "finalStatusText": final_text,
            "confirmedByUser": parse_confirmation(raw.get("confirmedByUser")),
        }
    return corrections


def discover_images(input_path: Path) -> list[Path]:
    if input_path.is_file():
        return [input_path] if input_path.suffix.lower() in IMAGE_EXTENSIONS else []
    return sorted(
        path
        for path in input_path.rglob("*")
        if path.is_file()
        and path.suffix.lower() in IMAGE_EXTENSIONS
        and "early_childhood_import_preview" not in path.parts
    )


def rotate_to_landscape(image: np.ndarray) -> tuple[np.ndarray, str]:
    height, width = image.shape[:2]
    if width >= height:
        return image.copy(), "none"

    counter_clockwise = cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE)
    clockwise = cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)

    def orientation_score(candidate: np.ndarray) -> float:
        hsv = cv2.cvtColor(candidate, cv2.COLOR_BGR2HSV)
        blue = cv2.inRange(hsv, (82, 45, 20), (132, 255, 220))
        row_fraction = np.mean(blue > 0, axis=1)
        height_candidate = candidate.shape[0]
        top_logo = float(np.sum(row_fraction[: int(height_candidate * 0.28)]))
        lower_table = float(
            np.max(row_fraction[int(height_candidate * 0.28) : int(height_candidate * 0.72)])
        )
        return top_logo + (lower_table * 10)

    if orientation_score(counter_clockwise) >= orientation_score(clockwise):
        return counter_clockwise, "90_counter_clockwise"
    return clockwise, "90_clockwise"


def group_consecutive(indices: np.ndarray) -> list[np.ndarray]:
    if indices.size == 0:
        return []
    split_points = np.where(np.diff(indices) > 1)[0] + 1
    return [group for group in np.split(indices, split_points) if group.size]


@dataclass
class TableGeometry:
    x_left: float
    x_right: float
    header_top: float
    header_bottom: float
    header_bottom_slope: float
    header_bottom_intercept: float
    x_centers: list[float]
    y_centers: list[float]
    cell_pitch: float
    row_pitch: float
    checkbox_size: float
    calibration_matches_x: int
    calibration_matches_y: int

    def row_center(self, column_index: int, row_index: int) -> float:
        x_center = self.x_centers[column_index]
        header_bottom = (
            self.header_bottom_slope * x_center
        ) + self.header_bottom_intercept
        return header_bottom + ((row_index + 0.5) * self.row_pitch)


def cluster_values(values: list[float], tolerance: float) -> list[tuple[float, int]]:
    if not values:
        return []
    clusters: list[list[float]] = []
    for value in sorted(values):
        if not clusters or value - float(np.mean(clusters[-1])) > tolerance:
            clusters.append([value])
        else:
            clusters[-1].append(value)
    return [(float(np.median(items)), len(items)) for items in clusters]


def fit_axis(
    expected: list[float],
    clusters: list[tuple[float, int]],
    max_distance: float,
) -> tuple[list[float], int]:
    differences: list[float] = []
    candidates = [value for value, _count in clusters]
    for value in expected:
        if not candidates:
            break
        nearest = min(candidates, key=lambda candidate: abs(candidate - value))
        if abs(nearest - value) <= max_distance:
            differences.append(nearest - value)
    if differences:
        offset = float(np.median(differences))
        return [value + offset for value in expected], len(differences)
    return expected, 0


def detect_table_geometry(
    image: np.ndarray,
    expected_rows: int,
) -> tuple[TableGeometry, np.ndarray]:
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    blue = cv2.inRange(hsv, (85, 50, 20), (128, 255, 210))
    height, width = image.shape[:2]
    row_fraction = np.mean(blue > 0, axis=1)
    candidate_rows = np.where(
        (row_fraction > 0.30)
        & (np.arange(height) > height * 0.25)
        & (np.arange(height) < height * 0.75)
    )[0]
    runs = group_consecutive(candidate_rows)
    if not runs:
        raise RuntimeError("Faixa azul do cabeçalho da tabela não localizada.")
    header_run = max(
        runs,
        key=lambda run: len(run) * float(np.mean(row_fraction[run])),
    )
    header_top = float(header_run[0])
    header_bottom = float(header_run[-1] + 1)

    band = blue[int(header_top) : int(header_bottom), :]
    col_fraction = np.mean(band > 0, axis=0)
    candidate_cols = np.where(col_fraction > 0.35)[0]
    col_runs = group_consecutive(candidate_cols)
    if not col_runs:
        raise RuntimeError("Limites horizontais da tabela não localizados.")
    table_run = max(col_runs, key=len)
    x_left = float(table_run[0])
    x_right = float(table_run[-1] + 1)
    table_width = x_right - x_left

    line_x = []
    line_y = []
    search_top = max(0, int(header_top) - 20)
    search_bottom = min(height, int(header_bottom) + 35)
    minimum_run = max(7, int((header_bottom - header_top) * 0.22))
    for x in range(int(x_left), int(x_right)):
        values = np.where(blue[search_top:search_bottom, x] > 0)[0] + search_top
        groups = group_consecutive(values)
        groups = [group for group in groups if len(group) >= minimum_run]
        if not groups:
            continue
        header_group = max(groups, key=len)
        line_x.append(float(x))
        line_y.append(float(header_group[-1]))
    if len(line_x) >= int(table_width * 0.55):
        header_bottom_slope, header_bottom_intercept = np.polyfit(
            line_x,
            line_y,
            1,
        )
        header_bottom_slope = float(header_bottom_slope)
        header_bottom_intercept = float(header_bottom_intercept)
    else:
        header_bottom_slope = 0.0
        header_bottom_intercept = header_bottom
    reference_header_bottom = (
        header_bottom_slope * ((x_left + x_right) / 2)
    ) + header_bottom_intercept

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    threshold = cv2.adaptiveThreshold(
        gray,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        31,
        12,
    )

    total_width_cm = 0.65 + 5.05 + (16 * 1.28)
    expected_x = [
        x_left
        + table_width
        * ((0.65 + 5.05 + (index * 1.28) + 0.64) / total_width_cm)
        for index in range(16)
    ]
    cell_pitch = table_width * (1.28 / total_width_cm)
    row_pitch = table_width * ((24 / 72) / (total_width_cm / 2.54))
    expected_y = [
        reference_header_bottom + ((index + 0.5) * row_pitch)
        for index in range(expected_rows)
    ]

    contours, _hierarchy = cv2.findContours(
        threshold,
        cv2.RETR_LIST,
        cv2.CHAIN_APPROX_SIMPLE,
    )
    x_values: list[float] = []
    y_values: list[float] = []
    y_min = header_bottom - 4
    y_max = header_bottom + (row_pitch * (expected_rows + 0.75))
    for contour in contours:
        x, y, box_width, box_height = cv2.boundingRect(contour)
        area = cv2.contourArea(contour)
        aspect = box_width / max(box_height, 1)
        if not (
            9 <= box_width <= max(26, cell_pitch * 0.58)
            and 9 <= box_height <= max(24, row_pitch * 0.82)
            and 0.58 <= aspect <= 1.75
            and area >= 55
            and expected_x[0] - cell_pitch * 0.7 <= x <= expected_x[-1] + cell_pitch * 0.7
            and y_min <= y <= y_max
        ):
            continue
        x_values.append(x + (box_width / 2))
        y_values.append(y + (box_height / 2))

    x_clusters = cluster_values(x_values, max(4.0, cell_pitch * 0.13))
    y_clusters = cluster_values(y_values, max(4.0, row_pitch * 0.18))
    x_centers, x_matches = fit_axis(expected_x, x_clusters, cell_pitch * 0.42)
    y_centers, y_matches = fit_axis(expected_y, y_clusters, row_pitch * 0.42)
    if y_centers:
        y_calibration_offset = float(
            np.median(
                [
                    actual - expected_value
                    for actual, expected_value in zip(y_centers, expected_y)
                ]
            )
        )
        header_bottom_intercept += y_calibration_offset

    if x_matches < 12:
        raise RuntimeError(
            f"Grade incompleta: apenas {x_matches}/16 colunas de marcação localizadas."
        )
    minimum_y_matches = max(2, math.ceil(expected_rows * 0.60))
    if y_matches < minimum_y_matches:
        raise RuntimeError(
            f"Grade incompleta: apenas {y_matches}/{expected_rows} linhas localizadas."
        )

    checkbox_size = max(10.0, min(cell_pitch * 0.36, row_pitch * 0.62))
    return (
        TableGeometry(
            x_left=x_left,
            x_right=x_right,
            header_top=header_top,
            header_bottom=reference_header_bottom + y_calibration_offset,
            header_bottom_slope=header_bottom_slope,
            header_bottom_intercept=header_bottom_intercept,
            x_centers=x_centers,
            y_centers=y_centers,
            cell_pitch=cell_pitch,
            row_pitch=row_pitch,
            checkbox_size=checkbox_size,
            calibration_matches_x=x_matches,
            calibration_matches_y=y_matches,
        ),
        threshold,
    )


def border_midpoint(
    projection: np.ndarray,
    expected_size: float,
    patch_radius: int,
) -> float:
    best_score = -1.0
    best_midpoint = float(patch_radius)
    minimum_size = max(8, int(expected_size * 0.65))
    maximum_size = min(len(projection) - 1, int(expected_size * 1.35))
    for first in range(len(projection)):
        last_limit = min(len(projection), first + maximum_size + 1)
        for last in range(first + minimum_size, last_limit):
            midpoint = (first + last) / 2
            score = (
                float(projection[first] + projection[last])
                - (0.20 * abs(midpoint - patch_radius))
            )
            if score > best_score:
                best_score = score
                best_midpoint = midpoint
    return best_midpoint


def checkbox_score(
    threshold: np.ndarray,
    x_center: float,
    y_center: float,
    checkbox_size: float,
) -> tuple[float, float, float]:
    height, width = threshold.shape[:2]
    patch_radius = max(11, int(round(checkbox_size * 0.90)))
    x = int(round(x_center))
    y = int(round(y_center))
    x0 = max(0, x - patch_radius)
    x1 = min(width, x + patch_radius + 1)
    y0 = max(0, y - patch_radius)
    y1 = min(height, y + patch_radius + 1)
    patch = threshold[y0:y1, x0:x1] > 0
    if patch.shape[0] < 9 or patch.shape[1] < 9:
        return 0.0, x_center, y_center

    local_radius_x = x - x0
    local_radius_y = y - y0
    refined_x = x0 + border_midpoint(
        patch.sum(axis=0),
        checkbox_size,
        local_radius_x,
    )
    refined_y = y0 + border_midpoint(
        patch.sum(axis=1),
        checkbox_size,
        local_radius_y,
    )

    inner_radius = max(4, int(round(checkbox_size * 0.38)))
    refined_x_int = int(round(refined_x))
    refined_y_int = int(round(refined_y))
    ix0 = max(0, refined_x_int - inner_radius)
    ix1 = min(width, refined_x_int + inner_radius + 1)
    iy0 = max(0, refined_y_int - inner_radius)
    iy1 = min(height, refined_y_int + inner_radius + 1)
    inner_patch = threshold[iy0:iy1, ix0:ix1] > 0
    score = float(np.mean(inner_patch)) if inner_patch.size else 0.0
    return score, refined_x, refined_y


def classify_group(scores: list[float]) -> dict[str, Any]:
    labels = list(STATUS_VALUES)
    ranking = sorted(range(4), key=lambda index: scores[index], reverse=True)
    best_index = ranking[0]
    second_index = ranking[1]
    baseline = float(np.median([scores[index] for index in ranking[1:]]))
    best_signal = scores[best_index] - baseline
    second_signal = scores[second_index] - baseline
    margin = scores[best_index] - scores[second_index]

    if best_signal < 0.05:
        state = "pending"
        value = None
        selected = []
    elif (
        second_signal >= 0.12
        and scores[second_index] >= 0.28
        and margin < 0.06
    ):
        state = "conflict"
        value = None
        selected = [
            labels[index]
            for index in ranking
            if scores[index] - baseline >= 0.10
        ]
    elif best_signal < 0.12 or margin < 0.08:
        state = "doubt"
        value = None
        selected = [labels[best_index]]
        if margin < 0.04:
            selected.append(labels[second_index])
    else:
        state = "confident"
        value = STATUS_VALUES[labels[best_index]]
        selected = [labels[best_index]]

    confidence = max(
        0.0,
        min(1.0, ((best_signal - 0.04) / 0.26) * 0.65 + (margin / 0.24) * 0.35),
    )
    return {
        "state": state,
        "value": value,
        "selectedOptions": selected,
        "confidence": round(confidence, 3),
        "scores": {
            label: round(scores[index], 4)
            for index, label in enumerate(labels)
        },
        "signal": round(best_signal, 4),
        "margin": round(margin, 4),
    }


def infer_from_path(
    image_path: Path,
    class_names: list[str],
) -> dict[str, Any] | None:
    normalized_path = normalize(str(image_path.parent))
    matched_class = next(
        (
            class_name
            for class_name in sorted(class_names, key=len, reverse=True)
            if normalize(class_name) in normalized_path
        ),
        None,
    )
    matched_area = canonical_area(normalized_path)
    if matched_class and matched_area:
        return {
            "className": matched_class,
            "area": matched_area,
            "pagePart": 1,
            "source": "subfolder",
        }
    return None


def try_ocr_header(
    image: np.ndarray,
    class_names: list[str],
) -> dict[str, Any] | None:
    if not shutil.which("tesseract"):
        return None
    try:
        import pytesseract  # type: ignore
    except ImportError:
        return None
    crop = image[: int(image.shape[0] * 0.42), :]
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    text = pytesseract.image_to_string(gray, lang="por")
    normalized_text = normalize(text)
    matched_class = next(
        (
            class_name
            for class_name in sorted(class_names, key=len, reverse=True)
            if normalize(class_name) in normalized_text
        ),
        None,
    )
    matched_area = canonical_area(normalized_text)
    if not matched_class or not matched_area:
        return None
    part_match = re.search(r"parte\s*([12])", normalized_text)
    return {
        "className": matched_class,
        "area": matched_area,
        "pagePart": int(part_match.group(1)) if part_match else 1,
        "source": "header_ocr",
        "ocrText": text.strip(),
    }


def resolve_identity(
    image_path: Path,
    oriented: np.ndarray,
    mapping: dict[str, dict[str, Any]],
    class_names: list[str],
) -> dict[str, Any] | None:
    ocr = try_ocr_header(oriented, class_names)
    if ocr:
        return ocr
    folder = infer_from_path(image_path, class_names)
    if folder:
        return folder
    mapped = mapping.get(normalize(image_path.name))
    if not mapped:
        return None
    area = canonical_area(mapped.get("area"))
    class_name = next(
        (
            name
            for name in class_names
            if normalize(name) == normalize(mapped.get("className"))
        ),
        None,
    )
    if not area or not class_name:
        return None
    expected_key = AREA_DEFINITIONS[area]["key"]
    mapped_key = mapped.get("developmentalKey")
    if mapped_key and mapped_key != expected_key:
        raise RuntimeError(
            f"developmentalKey '{mapped_key}' não corresponde à área '{area}'."
        )
    return {
        "className": class_name,
        "area": area,
        "pagePart": int(mapped.get("pagePart") or 1),
        "developmentalKey": expected_key,
        "expectedStudents": mapped.get("expectedStudents"),
        "notes": mapped.get("notes"),
        "forceReview": mapped.get("forceReview") or [],
        "source": "mapping",
    }


def safe_stem(path: Path) -> str:
    value = normalize(path.stem).replace(" ", "_")
    return value[:90] or "sheet"


def image_quality_metrics(
    image: np.ndarray,
    geometry: TableGeometry,
) -> dict[str, Any]:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    brightness = float(np.mean(gray))
    grid_score = (
        (geometry.calibration_matches_x / 16)
        + (geometry.calibration_matches_y / max(1, len(geometry.y_centers)))
    ) / 2
    if sharpness >= 120 and grid_score >= 0.88:
        verdict = "sufficient"
    elif sharpness >= 65 and grid_score >= 0.72:
        verdict = "usable_with_review"
    else:
        verdict = "retake_recommended"
    return {
        "verdict": verdict,
        "sharpness": round(sharpness, 2),
        "meanBrightness": round(brightness, 2),
        "gridDetectionScore": round(grid_score, 3),
    }


def render_debug_overlay(
    image: np.ndarray,
    geometry: TableGeometry,
    student_rows: list[dict[str, Any]],
    checkbox_centers: list[list[tuple[float, float]]],
    title: str,
) -> np.ndarray:
    overlay = image.copy()
    cv2.rectangle(
        overlay,
        (int(geometry.x_left), int(geometry.header_top)),
        (
            int(geometry.x_right),
            int(geometry.header_bottom + geometry.row_pitch * len(student_rows)),
        ),
        (210, 120, 20),
        2,
    )
    box_half = max(6, int(round(geometry.checkbox_size / 2)))
    for row_index, student in enumerate(student_rows):
        row_y = int(round(geometry.y_centers[row_index]))
        for criterion_index in range(4):
            assessment = student["criteria"][f"C{criterion_index + 1}"]
            state = assessment["state"]
            selected = set(assessment["selectedOptions"])
            for option_index, option in enumerate(STATUS_VALUES):
                column_index = (criterion_index * 4) + option_index
                refined_x, refined_y = checkbox_centers[row_index][column_index]
                x = int(round(refined_x))
                y = int(round(refined_y))
                is_selected = option in selected
                color = COLOR_BGR[state] if is_selected else (180, 180, 180)
                thickness = 3 if is_selected else 1
                cv2.rectangle(
                    overlay,
                    (x - box_half, y - box_half),
                    (x + box_half, y + box_half),
                    color,
                    thickness,
                )
        cv2.putText(
            overlay,
            str(student["rowNumber"]),
            (int(geometry.x_left) - 24, row_y + 4),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.42,
            (30, 30, 30),
            1,
            cv2.LINE_AA,
        )
    cv2.rectangle(overlay, (0, 0), (overlay.shape[1], 34), (255, 255, 255), -1)
    cv2.putText(
        overlay,
        title,
        (12, 23),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.55,
        (20, 20, 20),
        1,
        cv2.LINE_AA,
    )
    return overlay


def process_sheet(
    image_path: Path,
    identity: dict[str, Any],
    roster_entry: dict[str, Any],
    output_dir: Path,
    year: int,
    bimester: int,
) -> dict[str, Any]:
    original = cv2.imread(str(image_path))
    if original is None:
        raise RuntimeError("Imagem inválida ou não suportada pelo OpenCV.")
    oriented, rotation = rotate_to_landscape(original)

    page_part = int(identity.get("pagePart") or 1)
    start_index = (page_part - 1) * ROWS_PER_PAGE
    all_students = roster_entry["students"]
    page_students = all_students[start_index : start_index + ROWS_PER_PAGE]
    if not page_students:
        raise RuntimeError(
            f"Parte {page_part} não possui alunos na turma {identity['className']}."
        )
    expected_students = identity.get("expectedStudents")
    if expected_students is not None and int(expected_students) != len(page_students):
        raise RuntimeError(
            f"Mapping esperava {expected_students} alunos, mas a API forneceu "
            f"{len(page_students)} para esta página."
        )

    geometry, threshold = detect_table_geometry(oriented, len(page_students))
    student_rows = []
    checkbox_centers: list[list[tuple[float, float]]] = []
    for row_index, student in enumerate(page_students):
        criteria = {}
        row_centers: list[tuple[float, float]] = []
        row_scores: list[float] = []
        for column_index in range(16):
            score, refined_x, refined_y = checkbox_score(
                threshold,
                geometry.x_centers[column_index],
                geometry.row_center(column_index, row_index),
                geometry.checkbox_size,
            )
            row_scores.append(score)
            row_centers.append((refined_x, refined_y))
        checkbox_centers.append(row_centers)
        for criterion_index in range(4):
            start = criterion_index * 4
            scores = row_scores[start : start + 4]
            criteria[f"C{criterion_index + 1}"] = classify_group(scores)
        student_rows.append(
            {
                "rowNumber": start_index + row_index + 1,
                "studentId": student.get("_id") or student.get("id"),
                "studentName": student.get("fullName") or "Aluno sem nome",
                "criteria": criteria,
            }
        )

    for override in identity.get("forceReview", []):
        target_student = normalize(override.get("studentName"))
        criterion = str(override.get("criterion") or "").upper()
        for student_row in student_rows:
            if normalize(student_row["studentName"]) != target_student:
                continue
            assessment = student_row["criteria"].get(criterion)
            if not assessment:
                continue
            candidate_options = [
                option
                for option in override.get("candidateOptions", [])
                if option in STATUS_VALUES
            ]
            assessment["state"] = "doubt"
            assessment["value"] = None
            if candidate_options:
                assessment["selectedOptions"] = candidate_options
            assessment["forcedReview"] = True
            assessment["reviewReason"] = override.get("reason")

    debug_dir = output_dir / "debug_output"
    debug_dir.mkdir(parents=True, exist_ok=True)
    stem = safe_stem(image_path)
    oriented_name = f"{stem}_oriented.jpg"
    threshold_name = f"{stem}_threshold.jpg"
    overlay_name = f"{stem}_omr_debug.jpg"
    cv2.imwrite(str(debug_dir / oriented_name), oriented)
    cv2.imwrite(str(debug_dir / threshold_name), threshold)
    debug_overlay = render_debug_overlay(
        oriented,
        geometry,
        student_rows,
        checkbox_centers,
        (
            unicodedata.normalize(
                "NFKD",
                f"{identity['className']} | {identity['area']} | "
                f"{bimester}o bimestre / {year}",
            )
            .encode("ascii", "ignore")
            .decode("ascii")
        ),
    )
    cv2.imwrite(str(debug_dir / overlay_name), debug_overlay)

    class_item = roster_entry["class"]
    return {
        "file": str(image_path),
        "fileName": image_path.name,
        "identified": True,
        "identificationSource": identity["source"],
        "className": identity["className"],
        "classId": class_item.get("_id"),
        "shift": class_item.get("shift"),
        "area": identity["area"],
        "developmentalKey": AREA_DEFINITIONS[identity["area"]]["key"],
        "year": year,
        "bimester": bimester,
        "pagePart": page_part,
        "expectedStudents": expected_students,
        "notes": identity.get("notes"),
        "rotationApplied": rotation,
        "geometry": {
            "tableBounds": {
                "xLeft": round(geometry.x_left, 2),
                "xRight": round(geometry.x_right, 2),
                "headerTop": round(geometry.header_top, 2),
                "headerBottom": round(geometry.header_bottom, 2),
                "headerBottomSlope": round(geometry.header_bottom_slope, 5),
            },
            "columnsMatched": geometry.calibration_matches_x,
            "rowsMatched": geometry.calibration_matches_y,
            "expectedRows": len(page_students),
        },
        "imageQuality": image_quality_metrics(oriented, geometry),
        "debugImages": {
            "oriented": f"debug_output/{oriented_name}",
            "threshold": f"debug_output/{threshold_name}",
            "overlay": f"debug_output/{overlay_name}",
        },
        "students": student_rows,
    }


def apply_manual_corrections(
    sheets: list[dict[str, Any]],
    corrections: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    assessment_index: dict[str, tuple[dict[str, Any], dict[str, Any]]] = {}
    for sheet in sheets:
        if sheet.get("error") or sheet.get("ignored"):
            continue
        for student in sheet.get("students", []):
            for criterion, assessment in student["criteria"].items():
                item_id = correction_id(
                    sheet["className"],
                    sheet["developmentalKey"],
                    student["studentName"],
                    criterion,
                )
                assessment_index[item_id] = (assessment, {
                    "className": sheet["className"],
                    "area": sheet["area"],
                    "developmentalKey": sheet["developmentalKey"],
                    "studentName": student["studentName"],
                    "criterion": criterion,
                    "sourceFile": sheet["fileName"],
                })

    applied = []
    invalid_or_incomplete = []
    unknown_ids = []
    for item_id, correction in corrections.items():
        target = assessment_index.get(item_id)
        if not target:
            unknown_ids.append(item_id)
            continue
        assessment, identity = target
        if assessment["state"] not in {"doubt", "conflict", "pending"}:
            invalid_or_incomplete.append(
                {
                    "id": item_id,
                    "reason": "O item não exige revisão no processamento atual.",
                }
            )
            continue
        final_text = correction["finalStatusText"]
        confirmed = correction["confirmedByUser"]
        if not confirmed or not final_text:
            invalid_or_incomplete.append(
                {
                    "id": item_id,
                    "reason": (
                        "confirmedByUser não está true."
                        if not confirmed
                        else "finalStatus está vazio."
                    ),
                }
            )
            continue

        original_state = assessment["state"]
        original_value = assessment.get("value")
        original_options = list(assessment.get("selectedOptions") or [])
        final_value = None if final_text == "null" else final_text
        assessment["originalState"] = original_state
        assessment["originalValue"] = original_value
        assessment["originalSelectedOptions"] = original_options
        assessment["state"] = "manual_null" if final_value is None else "manual"
        assessment["value"] = final_value
        assessment["selectedOptions"] = []
        assessment["manualCorrection"] = {
            "id": item_id,
            "finalStatus": final_text,
            "confirmedByUser": True,
        }
        applied.append(
            {
                "id": item_id,
                **identity,
                "originalState": original_state,
                "originalValue": original_value,
                "originalSelectedOptions": original_options,
                "finalStatus": final_text,
                "confirmedByUser": True,
            }
        )
    return {
        "provided": len(corrections),
        "applied": applied,
        "incomplete": invalid_or_incomplete,
        "unknownIds": unknown_ids,
    }


def count_assessments(sheets: list[dict[str, Any]]) -> dict[str, int]:
    counters = {
        "markingsAnalyzed": 0,
        "markingsRead": 0,
        "confident": 0,
        "manuallyCorrected": 0,
        "confirmedNull": 0,
        "doubts": 0,
        "conflicts": 0,
        "pending": 0,
    }
    for sheet in sheets:
        for student in sheet.get("students", []):
            for assessment in student["criteria"].values():
                counters["markingsAnalyzed"] += 1
                state = assessment["state"]
                if state == "confident":
                    counters["confident"] += 1
                    counters["markingsRead"] += 1
                elif state == "doubt":
                    counters["doubts"] += 1
                    counters["markingsRead"] += 1
                elif state == "conflict":
                    counters["conflicts"] += 1
                elif state == "manual":
                    counters["manuallyCorrected"] += 1
                    counters["markingsRead"] += 1
                elif state == "manual_null":
                    counters["manuallyCorrected"] += 1
                    counters["confirmedNull"] += 1
                else:
                    counters["pending"] += 1
    return counters


def build_consolidated_report(
    sheets: list[dict[str, Any]],
    total_images: int,
    mapped_images: int,
    rosters: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    processed = [
        sheet
        for sheet in sheets
        if not sheet.get("error") and not sheet.get("ignored")
    ]
    ignored = [
        {
            "file": sheet.get("file"),
            "fileName": sheet.get("fileName"),
            "reason": sheet.get("reason") or sheet.get("error") or "Não processada.",
            "mapped": bool(sheet.get("mapped")),
        }
        for sheet in sheets
        if sheet.get("error") or sheet.get("ignored")
    ]
    counts = count_assessments(processed)
    processed_classes = sorted({sheet["className"] for sheet in processed}, key=normalize)
    processed_areas = sorted({sheet["area"] for sheet in processed}, key=normalize)
    unique_students = sum(
        len(rosters[normalize(class_name)]["students"])
        for class_name in processed_classes
    )

    class_summaries = []
    area_summaries = []
    doubts = []
    conflicts = []
    pending_items = []
    applied_corrections = []
    expected_area_names = list(AREA_DEFINITIONS)
    for class_name in processed_classes:
        class_sheets = [
            sheet for sheet in processed if sheet["className"] == class_name
        ]
        roster = rosters[normalize(class_name)]["students"]
        class_counts = count_assessments(class_sheets)
        areas_present = sorted(
            {sheet["area"] for sheet in class_sheets},
            key=lambda area: expected_area_names.index(area),
        )
        class_summaries.append(
            {
                "className": class_name,
                "students": len(roster),
                "imagesProcessed": len(class_sheets),
                "areasProcessed": len(areas_present),
                "areasExpected": len(expected_area_names),
                "complete": len(areas_present) == len(expected_area_names),
                "expectedMarkings": len(roster) * len(expected_area_names) * 4,
                **class_counts,
            }
        )
        for area in expected_area_names:
            area_sheets = [
                sheet for sheet in class_sheets if sheet["area"] == area
            ]
            if not area_sheets:
                continue
            area_sheets.sort(key=lambda sheet: sheet["pagePart"])
            area_counts = count_assessments(area_sheets)
            area_summary = {
                "className": class_name,
                "area": area,
                "developmentalKey": AREA_DEFINITIONS[area]["key"],
                "images": [
                    {
                        "fileName": sheet["fileName"],
                        "pagePart": sheet["pagePart"],
                        "debugOverlay": sheet["debugImages"]["overlay"],
                    }
                    for sheet in area_sheets
                ],
                "studentsFound": sum(
                    len(sheet.get("students", [])) for sheet in area_sheets
                ),
                **area_counts,
            }
            area_summaries.append(area_summary)

            for sheet in area_sheets:
                for student in sheet.get("students", []):
                    for criterion, assessment in student["criteria"].items():
                        item_id = correction_id(
                            class_name,
                            sheet["developmentalKey"],
                            student["studentName"],
                            criterion,
                        )
                        if assessment["state"] in {"manual", "manual_null"}:
                            applied_corrections.append(
                                {
                                    "id": item_id,
                                    "className": class_name,
                                    "area": area,
                                    "developmentalKey": sheet["developmentalKey"],
                                    "studentId": student["studentId"],
                                    "studentName": student["studentName"],
                                    "criterion": criterion,
                                    "issueType": assessment.get("originalState"),
                                    "originalValue": assessment.get("originalValue"),
                                    "originalSelectedOptions": assessment.get(
                                        "originalSelectedOptions", []
                                    ),
                                    "finalStatus": (
                                        "null"
                                        if assessment["state"] == "manual_null"
                                        else assessment["value"]
                                    ),
                                    "confirmedByUser": True,
                                    "sourceFile": sheet["fileName"],
                                    "debugImage": sheet["debugImages"]["overlay"],
                                }
                            )
                            continue
                        if assessment["state"] not in {
                            "doubt",
                            "conflict",
                            "pending",
                        }:
                            continue
                        item = {
                            "id": item_id,
                            "className": class_name,
                            "area": area,
                            "developmentalKey": sheet["developmentalKey"],
                            "studentId": student["studentId"],
                            "studentName": student["studentName"],
                            "criterion": criterion,
                            "state": assessment["state"],
                            "selectedOptions": assessment["selectedOptions"],
                            "candidateStatuses": [
                                STATUS_VALUES[option]
                                for option in assessment["selectedOptions"]
                            ],
                            "confidence": assessment["confidence"],
                            "scores": assessment["scores"],
                            "fileName": sheet["fileName"],
                            "debugOverlay": sheet["debugImages"]["overlay"],
                            "recommendedAction": "Revisar manualmente antes de qualquer apply.",
                            "reviewReason": assessment.get("reviewReason"),
                            "forcedReview": bool(assessment.get("forcedReview")),
                        }
                        if assessment["state"] == "doubt":
                            doubts.append(item)
                        elif assessment["state"] == "conflict":
                            conflicts.append(item)
                        else:
                            pending_items.append(item)

    summary = {
        "imagesFound": total_images,
        "imagesMapped": mapped_images,
        "imagesProcessed": len(processed),
        "imagesIdentified": sum(1 for sheet in processed if sheet.get("identified")),
        "imagesIgnored": len(ignored),
        "totalClasses": len(processed_classes),
        "distinctAreas": len(processed_areas),
        "classAreaCombinations": len(area_summaries),
        "totalStudents": unique_students,
        "studentRowsProcessed": sum(
            len(sheet.get("students", [])) for sheet in processed
        ),
        "errors": sum(1 for sheet in sheets if sheet.get("error")),
        **counts,
    }
    summary["unresolvedReviews"] = (
        summary["doubts"] + summary["conflicts"] + summary["pending"]
    )
    summary["applyReady"] = summary["unresolvedReviews"] == 0
    return {
        "summary": summary,
        "byClass": class_summaries,
        "byArea": area_summaries,
        "doubts": doubts,
        "conflicts": conflicts,
        "pendingItems": pending_items,
        "appliedCorrections": applied_corrections,
        "unprocessedImages": ignored,
    }


def write_json(
    output_dir: Path,
    metadata: dict[str, Any],
    sheets: list[dict[str, Any]],
    report: dict[str, Any],
    file_name: str = "early_childhood_import_preview.json",
) -> Path:
    path = output_dir / file_name
    payload = {
        "metadata": metadata,
        **report,
        "sheets": sheets,
    }
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return path


def write_csv(
    output_dir: Path,
    sheets: list[dict[str, Any]],
    file_name: str = "early_childhood_import_preview.csv",
) -> Path:
    path = output_dir / file_name
    fieldnames = [
        "file",
        "className",
        "shift",
        "area",
        "developmentalKey",
        "pagePart",
        "rowNumber",
        "studentId",
        "studentName",
        "criterion",
        "state",
        "value",
        "source",
        "originalState",
        "originalValue",
        "finalStatus",
        "manuallyCorrected",
        "selectedOptions",
        "confidence",
        "scoreA",
        "scoreAP",
        "scoreED",
        "scoreNT",
    ]
    with path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for sheet in sheets:
            if sheet.get("error") or sheet.get("ignored"):
                continue
            for student in sheet["students"]:
                for criterion, assessment in student["criteria"].items():
                    writer.writerow(
                        {
                            "file": sheet["fileName"],
                            "className": sheet["className"],
                            "shift": sheet.get("shift") or "",
                            "area": sheet["area"],
                            "developmentalKey": sheet["developmentalKey"],
                            "pagePart": sheet["pagePart"],
                            "rowNumber": student["rowNumber"],
                            "studentId": student["studentId"],
                            "studentName": student["studentName"],
                            "criterion": criterion,
                            "state": assessment["state"],
                            "value": (
                                "null"
                                if assessment["state"] == "manual_null"
                                else assessment["value"] or ""
                            ),
                            "source": (
                                "manual_correction"
                                if assessment["state"] in {"manual", "manual_null"}
                                else "omr"
                            ),
                            "originalState": assessment.get("originalState", ""),
                            "originalValue": assessment.get("originalValue") or "",
                            "finalStatus": (
                                assessment.get("manualCorrection", {}).get(
                                    "finalStatus", ""
                                )
                            ),
                            "manuallyCorrected": assessment["state"]
                            in {"manual", "manual_null"},
                            "selectedOptions": "|".join(
                                assessment["selectedOptions"]
                            ),
                            "confidence": assessment["confidence"],
                            "scoreA": assessment["scores"]["A"],
                            "scoreAP": assessment["scores"]["AP"],
                            "scoreED": assessment["scores"]["ED"],
                            "scoreNT": assessment["scores"]["NT"],
                        }
                    )
    return path


def build_correction_records(
    output_dir: Path,
    report: dict[str, Any],
) -> list[dict[str, Any]]:
    corrections: list[dict[str, Any]] = []
    for item in [
        *report["doubts"],
        *report["conflicts"],
        *report["pendingItems"],
    ]:
        detected_status = (
            item["candidateStatuses"][0]
            if len(item["candidateStatuses"]) == 1
            else None
        )
        corrections.append(
            {
                "id": item["id"],
                "className": item["className"],
                "area": item["area"],
                "developmentalKey": item["developmentalKey"],
                "studentName": item["studentName"],
                "criterion": item["criterion"],
                "detectedStatus": detected_status,
                "confidence": item["confidence"],
                "issueType": item["state"],
                "availableOptions": FINAL_STATUS_OPTIONS,
                "suggestedStatus": detected_status,
                "finalStatus": "",
                "confirmedByUser": False,
                "sourceFile": item["fileName"],
                "debugImage": str(
                    (output_dir / item["debugOverlay"]).resolve()
                ),
                "reviewReason": item.get("reviewReason"),
            }
        )
    corrections.sort(key=lambda item: item["id"])
    return corrections


def write_corrections_template(
    output_dir: Path,
    report: dict[str, Any],
    *,
    json_name: str = "early_childhood_import_corrections_template.json",
    csv_name: str = "early_childhood_import_corrections_template.csv",
) -> tuple[Path, Path]:
    json_path = output_dir / json_name
    csv_path = output_dir / csv_name
    corrections = build_correction_records(output_dir, report)
    json_path.write_text(
        json.dumps(corrections, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    csv_fields = [
        "id",
        "className",
        "area",
        "studentName",
        "criterion",
        "issueType",
        "detectedStatus",
        "suggestedStatus",
        "finalStatus",
        "confirmedByUser",
        "sourceFile",
    ]
    with csv_path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=csv_fields)
        writer.writeheader()
        for correction in corrections:
            writer.writerow(
                {
                    field: correction.get(field, "")
                    for field in csv_fields
                }
            )
    return json_path, csv_path


def write_corrections_editor(
    output_dir: Path,
    report: dict[str, Any],
    metadata: dict[str, Any],
    file_name: str = "early_childhood_corrections_editor.html",
) -> Path:
    path = output_dir / file_name
    records = build_correction_records(output_dir, report)
    editor_items = []
    for item in records:
        debug_path = Path(item["debugImage"])
        editor_items.append(
            {
                **item,
                "debugImage": f"debug_output/{debug_path.name}",
            }
        )
    embedded_data = json.dumps(
        editor_items,
        ensure_ascii=False,
        separators=(",", ":"),
    ).replace("</", "<\\/")
    title_context = (
        f"{metadata['schoolName']} · {metadata['bimester']}º Bimestre / "
        f"{metadata['year']}"
    )
    template = """<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Revisão manual · Avaliação Infantil</title>
  <style>
    :root {
      color-scheme: light;
      --canvas: #edf0f3;
      --surface: #ffffff;
      --surface-soft: #f7f8fa;
      --ink: #172033;
      --muted: #667085;
      --line: #d5dbe4;
      --navy: #173b6d;
      --navy-dark: #102b50;
      --green: #237a4b;
      --green-soft: #e6f5ec;
      --amber: #9a6700;
      --amber-soft: #fff4d6;
      --red: #b42318;
      --red-soft: #fee9e7;
      --gray-soft: #eceff3;
      --blue-soft: #e9f1fb;
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      min-width: 320px;
      background: var(--canvas);
      color: var(--ink);
      font-family: "Segoe UI", Aptos, Tahoma, sans-serif;
      letter-spacing: 0;
    }
    button, input, select { font: inherit; }
    button { cursor: pointer; }
    .topbar {
      position: sticky;
      top: 0;
      z-index: 20;
      border-bottom: 1px solid #0b2443;
      background: var(--navy);
      color: white;
    }
    .topbar-inner {
      width: min(1440px, 100%);
      margin: 0 auto;
      padding: 14px 22px 12px;
    }
    .heading-row {
      display: grid;
      grid-template-columns: minmax(250px, 1fr) auto;
      gap: 20px;
      align-items: center;
    }
    h1, h2, h3 {
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      letter-spacing: 0;
    }
    h1 { font-size: 23px; line-height: 1.1; }
    .context {
      margin: 5px 0 0;
      color: #d5e4f4;
      font-size: 13px;
    }
    .counters {
      display: grid;
      grid-template-columns: repeat(3, 104px);
      gap: 8px;
    }
    .counter {
      min-height: 52px;
      padding: 7px 10px;
      border: 1px solid #45658b;
      background: #12325b;
    }
    .counter strong { display: block; font-size: 20px; line-height: 1; }
    .counter span { color: #c7d8ec; font-size: 11px; }
    .progress-track {
      height: 4px;
      margin-top: 12px;
      overflow: hidden;
      background: #355679;
    }
    .progress-bar {
      width: 0;
      height: 100%;
      background: #68d391;
      transition: width 180ms ease;
    }
    main {
      width: min(1440px, 100%);
      margin: 0 auto;
      padding: 18px 22px 48px;
    }
    .toolbar {
      display: grid;
      grid-template-columns: minmax(230px, 1.5fr) repeat(3, minmax(150px, .7fr)) auto;
      gap: 10px;
      align-items: end;
      padding: 14px;
      border: 1px solid var(--line);
      background: var(--surface);
    }
    .field label {
      display: block;
      margin-bottom: 5px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .field input, .field select {
      width: 100%;
      height: 38px;
      border: 1px solid #b8c1ce;
      border-radius: 3px;
      background: white;
      color: var(--ink);
      padding: 0 10px;
    }
    .unresolved-toggle {
      display: flex;
      height: 38px;
      align-items: center;
      gap: 8px;
      white-space: nowrap;
      color: #344054;
      font-size: 13px;
    }
    .unresolved-toggle input { width: 17px; height: 17px; }
    .actionbar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 12px 0 16px;
      align-items: center;
    }
    .actionbar .spacer { flex: 1; }
    .button {
      min-height: 38px;
      border: 1px solid #9da9b8;
      border-radius: 3px;
      padding: 8px 12px;
      background: white;
      color: #243247;
      font-weight: 700;
    }
    .button:hover { border-color: #5f7085; background: #f7f9fb; }
    .button.primary {
      border-color: var(--navy);
      background: var(--navy);
      color: white;
    }
    .button.primary:hover { background: var(--navy-dark); }
    .button.danger { color: var(--red); }
    .notice {
      margin-right: 8px;
      color: var(--muted);
      font-size: 13px;
    }
    .notice.warning { color: var(--amber); font-weight: 700; }
    .group-heading {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 16px;
      margin: 26px 0 9px;
      padding-bottom: 7px;
      border-bottom: 2px solid var(--navy);
    }
    .group-heading h2 { color: var(--navy); font-size: 19px; }
    .group-heading span { color: var(--muted); font-size: 12px; }
    .review-list { display: grid; gap: 8px; }
    .review-item {
      display: grid;
      grid-template-columns: 170px minmax(220px, .8fr) minmax(510px, 2fr);
      min-height: 154px;
      border: 1px solid var(--line);
      border-left: 6px solid #98a2b3;
      background: var(--surface);
      transition: border-color 150ms ease, background 150ms ease;
    }
    .review-item.issue-doubt { border-left-color: #e0a800; }
    .review-item.issue-conflict { border-left-color: var(--red); }
    .review-item.issue-pending { border-left-color: #7d8795; }
    .review-item.reviewed {
      border-color: #75b78e;
      border-left-color: var(--green);
      background: #fbfefc;
    }
    .evidence {
      position: relative;
      min-height: 152px;
      overflow: hidden;
      border-right: 1px solid var(--line);
      background: #18202b;
    }
    .evidence button {
      display: block;
      width: 100%;
      height: 100%;
      min-height: 152px;
      border: 0;
      padding: 0;
      background: transparent;
    }
    .evidence img {
      display: block;
      width: 100%;
      height: 152px;
      object-fit: cover;
    }
    .evidence .zoom-label {
      position: absolute;
      right: 6px;
      bottom: 6px;
      padding: 3px 6px;
      background: rgba(16, 24, 40, .84);
      color: white;
      font-size: 10px;
    }
    .identity {
      padding: 14px;
      border-right: 1px solid var(--line);
    }
    .identity-line {
      display: flex;
      align-items: center;
      gap: 7px;
      margin-bottom: 8px;
    }
    .issue-label {
      padding: 3px 6px;
      border-radius: 2px;
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
    }
    .issue-label.doubt { color: #754d00; background: var(--amber-soft); }
    .issue-label.conflict { color: #8d1b13; background: var(--red-soft); }
    .issue-label.pending { color: #475467; background: var(--gray-soft); }
    .criterion {
      color: var(--navy);
      font-size: 12px;
      font-weight: 800;
    }
    .identity h3 {
      margin-bottom: 6px;
      font-family: "Segoe UI", Aptos, sans-serif;
      font-size: 15px;
      line-height: 1.25;
    }
    .identity p {
      margin: 3px 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
    }
    .status-data {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 5px;
      margin-top: 11px;
    }
    .status-data div {
      padding: 6px;
      background: var(--surface-soft);
      font-size: 11px;
    }
    .status-data strong { display: block; color: #344054; }
    .decision {
      display: flex;
      min-width: 0;
      flex-direction: column;
      justify-content: center;
      padding: 14px 16px;
    }
    .decision-title {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 9px;
      color: #344054;
      font-size: 12px;
      font-weight: 800;
    }
    .saved-state { color: var(--green); font-weight: 700; }
    .options {
      display: grid;
      grid-template-columns: repeat(5, minmax(94px, 1fr));
      gap: 6px;
      margin: 0;
      padding: 0;
      border: 0;
      min-width: 0;
    }
    .option { position: relative; min-width: 0; }
    .option input {
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }
    .option span {
      display: flex;
      min-height: 54px;
      align-items: center;
      justify-content: center;
      border: 1px solid #b7c0cd;
      border-radius: 3px;
      padding: 7px;
      background: white;
      color: #344054;
      text-align: center;
      font-size: 11px;
      line-height: 1.2;
    }
    .option input:focus-visible + span {
      outline: 3px solid #9bc2ea;
      outline-offset: 1px;
    }
    .option input:checked + span {
      border-color: var(--green);
      background: var(--green-soft);
      color: #175b37;
      font-weight: 800;
    }
    .option.null-option input:checked + span {
      border-color: #697586;
      background: var(--gray-soft);
      color: #344054;
    }
    .decision-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      margin-top: 9px;
      color: var(--muted);
      font-size: 11px;
    }
    .clear-button {
      border: 0;
      padding: 3px 0;
      background: transparent;
      color: #8d1b13;
      font-size: 11px;
      font-weight: 700;
    }
    .empty-state {
      padding: 38px;
      border: 1px solid var(--line);
      background: white;
      color: var(--muted);
      text-align: center;
    }
    dialog {
      width: min(1180px, calc(100vw - 32px));
      max-height: calc(100vh - 32px);
      border: 1px solid #344054;
      padding: 0;
      background: #111820;
    }
    dialog::backdrop { background: rgba(9, 17, 29, .82); }
    dialog img {
      display: block;
      width: 100%;
      max-height: calc(100vh - 76px);
      object-fit: contain;
    }
    .dialog-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 9px 12px;
      color: white;
      background: #111820;
      font-size: 12px;
    }
    .dialog-bar button {
      border: 1px solid #8290a3;
      padding: 5px 9px;
      background: transparent;
      color: white;
    }
    @media (max-width: 1050px) {
      .toolbar { grid-template-columns: 1fr 1fr; }
      .review-item { grid-template-columns: 150px minmax(210px, .7fr) minmax(420px, 1.5fr); }
      .options { grid-template-columns: repeat(3, 1fr); }
    }
    @media (max-width: 760px) {
      .topbar { position: static; }
      .heading-row { grid-template-columns: 1fr; }
      .counters { grid-template-columns: repeat(3, 1fr); }
      main, .topbar-inner { padding-left: 12px; padding-right: 12px; }
      .toolbar { grid-template-columns: 1fr; }
      .review-item { grid-template-columns: 1fr; }
      .evidence, .identity { border-right: 0; border-bottom: 1px solid var(--line); }
      .options { grid-template-columns: 1fr 1fr; }
      .option:last-child { grid-column: 1 / -1; }
      .actionbar .spacer { display: none; }
      .actionbar .button { flex: 1; }
    }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="topbar-inner">
      <div class="heading-row">
        <div>
          <h1>Revisão manual da Avaliação Infantil</h1>
          <p class="context">__TITLE_CONTEXT__ · somente conferência local</p>
        </div>
        <div class="counters" aria-live="polite">
          <div class="counter"><strong id="totalCount">0</strong><span>Total</span></div>
          <div class="counter"><strong id="reviewedCount">0</strong><span>Revisados</span></div>
          <div class="counter"><strong id="remainingCount">0</strong><span>Faltando</span></div>
        </div>
      </div>
      <div class="progress-track" aria-hidden="true"><div class="progress-bar" id="progressBar"></div></div>
    </div>
  </header>

  <main>
    <section class="toolbar" aria-label="Filtros de revisão">
      <div class="field">
        <label for="searchInput">Buscar aluno ou arquivo</label>
        <input id="searchInput" type="search" placeholder="Digite um nome, critério ou arquivo">
      </div>
      <div class="field"><label for="classFilter">Turma</label><select id="classFilter"></select></div>
      <div class="field"><label for="areaFilter">Área</label><select id="areaFilter"></select></div>
      <div class="field"><label for="issueFilter">Tipo</label><select id="issueFilter"></select></div>
      <label class="unresolved-toggle"><input id="unresolvedOnly" type="checkbox"> Mostrar somente não revisados</label>
    </section>

    <div class="actionbar">
      <span class="notice warning" id="reviewNotice">Há itens sem revisão.</span>
      <span class="spacer"></span>
      <button class="button danger" id="resetButton" type="button">Limpar escolhas</button>
      <button class="button" id="exportCsvButton" type="button">Exportar correções CSV</button>
      <button class="button primary" id="exportJsonButton" type="button">Exportar correções JSON</button>
    </div>

    <div id="editorRoot"></div>
  </main>

  <dialog id="imageDialog">
    <div class="dialog-bar"><span id="dialogCaption"></span><button id="closeDialogButton" type="button">Fechar</button></div>
    <img id="dialogImage" alt="Imagem ampliada da ficha">
  </dialog>

  <script>
    const ITEMS = __EMBEDDED_DATA__;
    const STORAGE_KEY = "academyhub_early_childhood_review_2026_b2_v1";
    const OPTION_LABELS = {
      autonomy: "Realiza com autonomia",
      support: "Realiza com apoio",
      developing: "Em desenvolvimento",
      not_worked: "Não trabalhado no bimestre",
      null: "Deixar pendente"
    };
    const ISSUE_LABELS = { doubt: "Dúvida", conflict: "Conflito", pending: "Pendência" };
    const OPTION_ORDER = ["autonomy", "support", "developing", "not_worked", "null"];
    const state = Object.fromEntries(ITEMS.map(item => [item.id, ""]));

    const root = document.getElementById("editorRoot");
    const totalCount = document.getElementById("totalCount");
    const reviewedCount = document.getElementById("reviewedCount");
    const remainingCount = document.getElementById("remainingCount");
    const progressBar = document.getElementById("progressBar");
    const reviewNotice = document.getElementById("reviewNotice");
    const searchInput = document.getElementById("searchInput");
    const classFilter = document.getElementById("classFilter");
    const areaFilter = document.getElementById("areaFilter");
    const issueFilter = document.getElementById("issueFilter");
    const unresolvedOnly = document.getElementById("unresolvedOnly");
    const imageDialog = document.getElementById("imageDialog");
    const dialogImage = document.getElementById("dialogImage");
    const dialogCaption = document.getElementById("dialogCaption");

    function escapeHtml(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    function loadState() {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
        for (const item of ITEMS) {
          if (OPTION_ORDER.includes(saved[item.id])) state[item.id] = saved[item.id];
        }
      } catch (_error) {
        // The editor remains fully usable even if storage is unavailable.
      }
    }

    function saveState() {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_error) {}
    }

    function fillSelect(select, values, allLabel) {
      select.innerHTML = `<option value="">${escapeHtml(allLabel)}</option>` +
        values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
    }

    function configureFilters() {
      fillSelect(classFilter, [...new Set(ITEMS.map(item => item.className))].sort(), "Todas as turmas");
      fillSelect(areaFilter, [...new Set(ITEMS.map(item => item.area))].sort(), "Todas as áreas");
      issueFilter.innerHTML = `<option value="">Todos os tipos</option>` +
        Object.entries(ISSUE_LABELS).map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
    }

    function matchesFilters(item) {
      const query = searchInput.value.trim().toLocaleLowerCase("pt-BR");
      const searchable = `${item.studentName} ${item.criterion} ${item.sourceFile} ${item.area}`.toLocaleLowerCase("pt-BR");
      return (!query || searchable.includes(query))
        && (!classFilter.value || item.className === classFilter.value)
        && (!areaFilter.value || item.area === areaFilter.value)
        && (!issueFilter.value || item.issueType === issueFilter.value)
        && (!unresolvedOnly.checked || !state[item.id]);
    }

    function optionMarkup(item, value) {
      const checked = state[item.id] === value ? "checked" : "";
      const nullClass = value === "null" ? "null-option" : "";
      return `<label class="option ${nullClass}">
        <input type="radio" name="${escapeHtml(item.id)}" value="${value}" ${checked}>
        <span>${escapeHtml(OPTION_LABELS[value])}</span>
      </label>`;
    }

    function itemMarkup(item) {
      const selected = state[item.id];
      const reviewed = Boolean(selected);
      const detected = item.detectedStatus ? OPTION_LABELS[item.detectedStatus] : "Sem leitura conclusiva";
      const suggested = item.suggestedStatus ? OPTION_LABELS[item.suggestedStatus] : "Sem sugestão";
      return `<article class="review-item issue-${item.issueType} ${reviewed ? "reviewed" : ""}" data-item-id="${escapeHtml(item.id)}">
        <div class="evidence">
          <button type="button" data-image="${escapeHtml(item.debugImage)}" data-caption="${escapeHtml(item.studentName + " · " + item.criterion)}" title="Ampliar imagem">
            <img src="${escapeHtml(item.debugImage)}" alt="Debug OMR de ${escapeHtml(item.studentName)}" loading="lazy">
            <span class="zoom-label">Ampliar evidência</span>
          </button>
        </div>
        <div class="identity">
          <div class="identity-line">
            <span class="issue-label ${item.issueType}">${escapeHtml(ISSUE_LABELS[item.issueType])}</span>
            <span class="criterion">${escapeHtml(item.criterion)}</span>
          </div>
          <h3>${escapeHtml(item.studentName)}</h3>
          <p><strong>${escapeHtml(item.className)}</strong> · ${escapeHtml(item.area)}</p>
          <p>${escapeHtml(item.sourceFile)}</p>
          <div class="status-data">
            <div><strong>Detectado</strong>${escapeHtml(detected)}</div>
            <div><strong>Sugestão</strong>${escapeHtml(suggested)}</div>
          </div>
        </div>
        <div class="decision">
          <div class="decision-title">
            <span>Confirme o resultado pedagógico</span>
            <span class="saved-state">${reviewed ? "Revisado" : ""}</span>
          </div>
          <fieldset class="options" aria-label="Correção de ${escapeHtml(item.studentName)} ${escapeHtml(item.criterion)}">
            ${OPTION_ORDER.map(value => optionMarkup(item, value)).join("")}
          </fieldset>
          <div class="decision-footer">
            <span>${reviewed ? `Selecionado: ${escapeHtml(OPTION_LABELS[selected])}` : "Nenhuma opção selecionada"}</span>
            <button class="clear-button" type="button" data-clear-id="${escapeHtml(item.id)}">Limpar</button>
          </div>
        </div>
      </article>`;
    }

    function render() {
      const visible = ITEMS.filter(matchesFilters);
      const groups = new Map();
      for (const item of visible) {
        const key = `${item.className}|||${item.area}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
      }
      if (!visible.length) {
        root.innerHTML = `<div class="empty-state">Nenhum item corresponde aos filtros atuais.</div>`;
      } else {
        root.innerHTML = [...groups.entries()].map(([key, items]) => {
          const [className, area] = key.split("|||");
          const reviewedInGroup = items.filter(item => state[item.id]).length;
          return `<section>
            <div class="group-heading">
              <h2>${escapeHtml(className)} · ${escapeHtml(area)}</h2>
              <span>${reviewedInGroup}/${items.length} revisados neste grupo</span>
            </div>
            <div class="review-list">${items.map(itemMarkup).join("")}</div>
          </section>`;
        }).join("");
      }
      attachItemEvents();
      updateCounters();
    }

    function attachItemEvents() {
      root.querySelectorAll('input[type="radio"]').forEach(input => {
        input.addEventListener("change", event => {
          const itemId = event.target.name;
          state[itemId] = event.target.value;
          saveState();
          render();
          document.querySelector(`[data-item-id="${CSS.escape(itemId)}"]`)?.scrollIntoView({ block: "nearest" });
        });
      });
      root.querySelectorAll("[data-clear-id]").forEach(button => {
        button.addEventListener("click", () => {
          state[button.dataset.clearId] = "";
          saveState();
          render();
        });
      });
      root.querySelectorAll("[data-image]").forEach(button => {
        button.addEventListener("click", () => {
          dialogImage.src = button.dataset.image;
          dialogCaption.textContent = button.dataset.caption;
          imageDialog.showModal();
        });
      });
    }

    function updateCounters() {
      const reviewed = ITEMS.filter(item => state[item.id]).length;
      const remaining = ITEMS.length - reviewed;
      totalCount.textContent = ITEMS.length;
      reviewedCount.textContent = reviewed;
      remainingCount.textContent = remaining;
      progressBar.style.width = `${ITEMS.length ? (reviewed / ITEMS.length) * 100 : 0}%`;
      reviewNotice.textContent = remaining
        ? `Há ${remaining} item(ns) sem revisão. A exportação continuará possível, mas eles permanecerão bloqueados.`
        : "Todos os itens foram revisados. O arquivo está pronto para o dry-run resolvido.";
      reviewNotice.classList.toggle("warning", remaining > 0);
    }

    function exportRecords() {
      return ITEMS.map(item => {
        const selected = state[item.id];
        return {
          id: item.id,
          className: item.className,
          area: item.area,
          developmentalKey: item.developmentalKey,
          studentName: item.studentName,
          criterion: item.criterion,
          issueType: item.issueType,
          detectedStatus: item.detectedStatus,
          suggestedStatus: item.suggestedStatus,
          finalStatus: selected === "null" ? null : selected,
          confirmedByUser: Boolean(selected),
          sourceFile: item.sourceFile
        };
      });
    }

    function confirmIncompleteExport() {
      const remaining = ITEMS.filter(item => !state[item.id]).length;
      return !remaining || window.confirm(
        `Ainda existem ${remaining} item(ns) sem revisão. Deseja exportar mesmo assim?`
      );
    }

    function download(content, mimeType, fileName) {
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function csvCell(value) {
      const text = value == null ? "" : String(value);
      return `"${text.replaceAll('"', '""')}"`;
    }

    document.getElementById("exportJsonButton").addEventListener("click", () => {
      if (!confirmIncompleteExport()) return;
      download(
        JSON.stringify(exportRecords(), null, 2),
        "application/json;charset=utf-8",
        "early_childhood_import_corrections_filled.json"
      );
    });

    document.getElementById("exportCsvButton").addEventListener("click", () => {
      if (!confirmIncompleteExport()) return;
      const fields = ["id", "className", "area", "studentName", "criterion", "issueType", "detectedStatus", "suggestedStatus", "finalStatus", "confirmedByUser", "sourceFile"];
      const rows = exportRecords().map(record => fields.map(field => {
        const value = field === "finalStatus" && record[field] === null ? "null" : record[field];
        return csvCell(value);
      }).join(","));
      download(
        "\\ufeff" + fields.join(",") + "\\n" + rows.join("\\n"),
        "text/csv;charset=utf-8",
        "early_childhood_import_corrections_filled.csv"
      );
    });

    document.getElementById("resetButton").addEventListener("click", () => {
      if (!window.confirm("Limpar todas as escolhas salvas neste navegador?")) return;
      for (const item of ITEMS) state[item.id] = "";
      saveState();
      render();
    });
    document.getElementById("closeDialogButton").addEventListener("click", () => imageDialog.close());
    imageDialog.addEventListener("click", event => {
      if (event.target === imageDialog) imageDialog.close();
    });
    [searchInput, classFilter, areaFilter, issueFilter, unresolvedOnly].forEach(control => {
      control.addEventListener(control === searchInput ? "input" : "change", render);
    });

    loadState();
    configureFilters();
    render();
  </script>
</body>
</html>
"""
    document = (
        template.replace("__EMBEDDED_DATA__", embedded_data)
        .replace("__TITLE_CONTEXT__", html.escape(title_context))
    )
    path.write_text(document, encoding="utf-8")
    return path


def write_summary_text(
    output_dir: Path,
    metadata: dict[str, Any],
    report: dict[str, Any],
    file_name: str = "early_childhood_import_summary.txt",
) -> Path:
    path = output_dir / file_name
    summary = report["summary"]
    lines = [
        "ACADEMYHUB - PRÉVIA OMR DA AVALIAÇÃO INFANTIL",
        "=" * 52,
        f"Escola: {metadata['schoolName']}",
        f"Ano/Bimestre: {metadata['year']} / {metadata['bimester']}º Bimestre",
        "Modo: DRY-RUN (nenhuma gravação no banco)",
        "",
        "RESUMO GERAL",
        f"Imagens encontradas: {summary['imagesFound']}",
        f"Imagens mapeadas: {summary['imagesMapped']}",
        f"Imagens processadas: {summary['imagesProcessed']}",
        f"Imagens ignoradas: {summary['imagesIgnored']}",
        f"Turmas: {summary['totalClasses']}",
        f"Áreas distintas: {summary['distinctAreas']}",
        f"Combinações turma/área: {summary['classAreaCombinations']}",
        f"Alunos únicos: {summary['totalStudents']}",
        f"Linhas de aluno processadas: {summary['studentRowsProcessed']}",
        f"Marcações analisadas: {summary['markingsAnalyzed']}",
        f"Confiantes: {summary['confident']}",
        f"Corrigidas manualmente: {summary['manuallyCorrected']}",
        f"Null confirmados: {summary['confirmedNull']}",
        f"Dúvidas: {summary['doubts']}",
        f"Conflitos: {summary['conflicts']}",
        f"Pendências: {summary['pending']}",
        f"Itens ainda não resolvidos: {summary['unresolvedReviews']}",
        "",
        "RESUMO POR TURMA",
    ]
    for item in report["byClass"]:
        lines.extend(
            [
                f"- {item['className']}",
                f"  Áreas processadas: {item['areasProcessed']}/{item['areasExpected']}",
                f"  Alunos: {item['students']}",
                f"  Marcações esperadas/analisadas: {item['expectedMarkings']}/{item['markingsAnalyzed']}",
                f"  Confiantes: {item['confident']} | Dúvidas: {item['doubts']} | "
                f"Conflitos: {item['conflicts']} | Pendências: {item['pending']} | "
                f"Corrigidas: {item['manuallyCorrected']}",
            ]
        )
    lines.extend(["", "RESUMO POR ÁREA"])
    for item in report["byArea"]:
        images = ", ".join(image["fileName"] for image in item["images"])
        lines.extend(
            [
                f"- {item['className']} / {item['area']}",
                f"  Imagens: {images}",
                f"  Alunos: {item['studentsFound']} | Marcações: {item['markingsAnalyzed']}",
                f"  Confiantes: {item['confident']} | Dúvidas: {item['doubts']} | "
                f"Conflitos: {item['conflicts']} | Pendências: {item['pending']} | "
                f"Corrigidas: {item['manuallyCorrected']}",
            ]
        )
    lines.extend(["", "CORREÇÕES MANUAIS APLICADAS"])
    if not report["appliedCorrections"]:
        lines.append("- Nenhuma.")
    for item in report["appliedCorrections"]:
        lines.append(
            f"- {item['className']} / {item['area']} / {item['studentName']} / "
            f"{item['criterion']}: {item['originalValue']} -> {item['finalStatus']}"
        )
    lines.extend(["", "ITENS PARA REVISÃO MANUAL"])
    review_items = [
        *report["doubts"],
        *report["conflicts"],
        *report["pendingItems"],
    ]
    if not review_items:
        lines.append("- Nenhum.")
    for item in review_items:
        candidates = ", ".join(item["candidateStatuses"]) or "sem candidato"
        lines.append(
            f"- {item['className']} / {item['area']} / {item['studentName']} / "
            f"{item['criterion']}: {item['state']} (candidatos: {candidates})"
        )
    lines.extend(["", "IMAGENS NÃO PROCESSADAS"])
    if not report["unprocessedImages"]:
        lines.append("- Nenhuma.")
    for item in report["unprocessedImages"]:
        lines.append(f"- {item['fileName']}: {item['reason']}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def state_label(state: str) -> str:
    return {
        "confident": "Confiante",
        "doubt": "Dúvida",
        "conflict": "Conflito",
        "pending": "Pendente",
    }.get(state, state)


def write_html(
    output_dir: Path,
    metadata: dict[str, Any],
    sheets: list[dict[str, Any]],
    report: dict[str, Any],
    file_name: str = "early_childhood_import_review.html",
) -> Path:
    path = output_dir / file_name
    summary = report["summary"]
    sheet_sections = []
    current_class = None
    processed_sheets = sorted(
        [
            sheet
            for sheet in sheets
            if not sheet.get("error") and not sheet.get("ignored")
        ],
        key=lambda sheet: (
            normalize(sheet["className"]),
            list(AREA_DEFINITIONS).index(sheet["area"]),
            sheet["pagePart"],
        ),
    )
    for sheet in processed_sheets:
        if sheet["className"] != current_class:
            current_class = sheet["className"]
            class_summary = next(
                item
                for item in report["byClass"]
                if item["className"] == current_class
            )
            sheet_sections.append(
                f"""
                <div class="class-band">
                  <h2>{html.escape(current_class)}</h2>
                  <span>{class_summary['areasProcessed']}/{class_summary['areasExpected']} áreas ·
                  {class_summary['students']} alunos ·
                  {class_summary['markingsAnalyzed']} marcações</span>
                </div>
                """
            )
        rows = []
        for student in sheet["students"]:
            cells = []
            for criterion in ("C1", "C2", "C3", "C4"):
                assessment = student["criteria"][criterion]
                if assessment["state"] == "manual_null":
                    value = "null confirmado"
                else:
                    value = assessment["value"] or "Revisar"
                selected = ", ".join(assessment["selectedOptions"]) or "—"
                source = (
                    "Correção manual"
                    if assessment["state"] in {"manual", "manual_null"}
                    else "OMR"
                )
                cells.append(
                    f"""
                    <td class="{assessment['state']}">
                      <strong>{html.escape(selected)}</strong>
                      <span>{html.escape(value)}</span>
                      <span>{source}</span>
                      <small>{assessment['confidence']:.0%}</small>
                    </td>
                    """
                )
            rows.append(
                f"""
                <tr>
                  <td>{student['rowNumber']}</td>
                  <td>{html.escape(student['studentName'])}</td>
                  {''.join(cells)}
                </tr>
                """
            )
        quality = sheet["imageQuality"]
        notes = (
            f"<p class='technical'>{html.escape(sheet['notes'])}</p>"
            if sheet.get("notes")
            else ""
        )
        sheet_sections.append(
            f"""
            <section>
              <div class="section-head">
                <div>
                  <h2>{html.escape(sheet['area'])} · parte {sheet['pagePart']}</h2>
                  <p>{html.escape(str(sheet.get('shift') or 'Turno não informado'))}
                     · identificação: {html.escape(sheet['identificationSource'])}</p>
                </div>
                <span class="quality">{html.escape(quality['verdict'])}</span>
              </div>
              <a class="debug-link" href="{html.escape(sheet['debugImages']['overlay'])}">
                <img src="{html.escape(sheet['debugImages']['overlay'])}"
                     alt="Imagem de debug da leitura OMR">
              </a>
              <table>
                <thead>
                  <tr><th>Nº</th><th>Aluno(a)</th><th>C1</th><th>C2</th><th>C3</th><th>C4</th></tr>
                </thead>
                <tbody>{''.join(rows)}</tbody>
              </table>
              <p class="technical">
                Grade: {sheet['geometry']['columnsMatched']}/16 colunas,
                {sheet['geometry']['rowsMatched']}/{sheet['geometry']['expectedRows']} linhas;
                nitidez: {quality['sharpness']};
                rotação: {html.escape(sheet['rotationApplied'])}.
              </p>
              {notes}
            </section>
            """
        )

    class_rows = "".join(
        f"""
        <tr>
          <td>{html.escape(item['className'])}</td>
          <td>{item['areasProcessed']}/{item['areasExpected']}</td>
          <td>{item['students']}</td>
          <td>{item['expectedMarkings']}</td>
          <td>{item['confident']}</td>
          <td class="manual">{item['manuallyCorrected']}</td>
          <td class="doubt">{item['doubts']}</td>
          <td class="conflict">{item['conflicts']}</td>
          <td class="pending">{item['pending']}</td>
        </tr>
        """
        for item in report["byClass"]
    )
    review_rows = "".join(
        f"""
        <tr>
          <td>{html.escape(item['className'])}</td>
          <td>{html.escape(item['area'])}</td>
          <td>{html.escape(item['studentName'])}</td>
          <td>{html.escape(item['criterion'])}</td>
          <td class="{item['state']}">{html.escape(state_label(item['state']))}</td>
          <td>{html.escape(', '.join(item['candidateStatuses']) or '—')}</td>
          <td>{item['confidence']:.0%}</td>
          <td>{html.escape(item['fileName'])}</td>
        </tr>
        """
        for item in [
            *report["doubts"],
            *report["conflicts"],
            *report["pendingItems"],
        ]
    )
    if not review_rows:
        review_rows = "<tr><td colspan='8'>Nenhum item para revisão.</td></tr>"
    applied_rows = "".join(
        f"""
        <tr>
          <td>{html.escape(item['className'])}</td>
          <td>{html.escape(item['area'])}</td>
          <td>{html.escape(item['studentName'])}</td>
          <td>{html.escape(item['criterion'])}</td>
          <td>{html.escape(str(item.get('originalValue') or item.get('originalSelectedOptions') or '—'))}</td>
          <td class="manual">{html.escape(item['finalStatus'])}</td>
          <td>{html.escape(item['sourceFile'])}</td>
        </tr>
        """
        for item in report["appliedCorrections"]
    )
    if not applied_rows:
        applied_rows = "<tr><td colspan='7'>Nenhuma correção manual aplicada.</td></tr>"
    ignored_rows = "".join(
        f"<li><strong>{html.escape(item['fileName'])}</strong>: {html.escape(item['reason'])}</li>"
        for item in report["unprocessedImages"]
    ) or "<li>Nenhuma imagem ignorada.</li>"

    document = f"""<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Prévia OMR · Avaliação Infantil</title>
  <style>
    :root {{
      color-scheme: light;
      --ink: #172033;
      --muted: #667085;
      --line: #d8dee8;
      --navy: #173b6d;
      --green: #dcfce7;
      --yellow: #fef3c7;
      --red: #fee2e2;
      --gray: #eef1f5;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      background: #f5f7fa;
      color: var(--ink);
      font-family: Arial, Helvetica, sans-serif;
      line-height: 1.4;
    }}
    header {{
      padding: 28px max(24px, calc((100vw - 1180px) / 2));
      color: white;
      background: var(--navy);
    }}
    header h1 {{ margin: 0 0 6px; font-size: 24px; }}
    header p {{ margin: 0; color: #d9e6f5; }}
    main {{ max-width: 1180px; margin: 24px auto 48px; padding: 0 24px; }}
    .summary {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: 10px;
      margin-bottom: 22px;
    }}
    .metric {{
      padding: 14px;
      border: 1px solid var(--line);
      background: white;
      border-radius: 6px;
    }}
    .metric strong {{ display: block; font-size: 22px; color: var(--navy); }}
    .metric span {{ color: var(--muted); font-size: 12px; }}
    .class-band {{
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 16px;
      margin: 30px 0 12px;
      padding: 12px 16px;
      color: white;
      background: var(--navy);
      border-radius: 6px;
    }}
    .class-band h2 {{ margin: 0; color: white; }}
    .class-band span {{ color: #d9e6f5; font-size: 13px; }}
    section {{
      margin: 0 0 22px;
      padding: 18px;
      border: 1px solid var(--line);
      background: white;
      border-radius: 6px;
    }}
    .section-head {{
      display: flex;
      align-items: start;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 14px;
    }}
    h2 {{ margin: 0 0 4px; font-size: 18px; color: var(--navy); }}
    .section-head p {{ margin: 0; color: var(--muted); font-size: 13px; }}
    .quality {{
      padding: 5px 8px;
      border: 1px solid #b8c6d8;
      border-radius: 4px;
      color: var(--navy);
      background: #edf4fb;
      font-size: 12px;
      white-space: nowrap;
    }}
    .debug-link img {{
      display: block;
      width: 100%;
      max-height: 640px;
      object-fit: contain;
      border: 1px solid var(--line);
      background: #111;
    }}
    table {{ width: 100%; border-collapse: collapse; margin-top: 16px; }}
    th, td {{ padding: 9px 10px; border: 1px solid var(--line); text-align: left; }}
    th {{ color: white; background: var(--navy); font-size: 12px; }}
    td:nth-child(n+3) {{ text-align: center; min-width: 110px; }}
    td strong, td span, td small {{ display: block; }}
    td span {{ font-size: 11px; color: #475467; }}
    td small {{ margin-top: 3px; color: #667085; }}
    .confident {{ background: var(--green); }}
    .doubt {{ background: var(--yellow); }}
    .conflict {{ background: var(--red); }}
    .pending {{ background: var(--gray); }}
    .manual, .manual_null {{ background: #dbeafe; }}
    .technical {{ margin: 12px 0 0; color: var(--muted); font-size: 12px; }}
    .error {{ padding: 12px; color: #991b1b; background: var(--red); }}
    .overview {{ margin-bottom: 22px; }}
    .overview table {{ margin-top: 8px; }}
    ul {{ margin-bottom: 0; }}
    @media (max-width: 760px) {{
      table {{ display: block; overflow-x: auto; }}
      .section-head {{ display: block; }}
      .quality {{ display: inline-block; margin-top: 8px; }}
    }}
  </style>
</head>
<body>
  <header>
    <h1>Prévia de importação · Avaliação Infantil</h1>
    <p>{html.escape(metadata['schoolName'])} · {metadata['bimester']}º Bimestre / {metadata['year']} · dry-run</p>
  </header>
  <main>
    <div class="summary">
      <div class="metric"><strong>{summary['imagesProcessed']}</strong><span>imagens processadas</span></div>
      <div class="metric"><strong>{summary['imagesIgnored']}</strong><span>imagem ignorada</span></div>
      <div class="metric"><strong>{summary['totalStudents']}</strong><span>alunos únicos</span></div>
      <div class="metric"><strong>{summary['markingsAnalyzed']}</strong><span>marcações analisadas</span></div>
      <div class="metric"><strong>{summary['confident']}</strong><span>confiantes</span></div>
      <div class="metric"><strong>{summary['manuallyCorrected']}</strong><span>corrigidas manualmente</span></div>
      <div class="metric"><strong>{summary['unresolvedReviews']}</strong><span>ainda para revisar</span></div>
      <div class="metric"><strong>{summary['doubts']}</strong><span>dúvidas</span></div>
      <div class="metric"><strong>{summary['conflicts']}</strong><span>conflitos</span></div>
      <div class="metric"><strong>{summary['pending']}</strong><span>pendentes</span></div>
    </div>
    <section class="overview">
      <h2>Resumo por turma</h2>
      <table>
        <thead><tr><th>Turma</th><th>Áreas</th><th>Alunos</th><th>Esperadas</th><th>Confiantes</th><th>Corrigidas</th><th>Dúvidas</th><th>Conflitos</th><th>Pendentes</th></tr></thead>
        <tbody>{class_rows}</tbody>
      </table>
    </section>
    <section class="overview">
      <h2>Correções manuais aplicadas</h2>
      <table>
        <thead><tr><th>Turma</th><th>Área</th><th>Aluno(a)</th><th>Critério</th><th>Leitura OMR</th><th>Valor final</th><th>Imagem</th></tr></thead>
        <tbody>{applied_rows}</tbody>
      </table>
    </section>
    <section class="overview">
      <h2>Itens para revisão manual</h2>
      <table>
        <thead><tr><th>Turma</th><th>Área</th><th>Aluno(a)</th><th>Critério</th><th>Estado</th><th>Candidatos</th><th>Confiança</th><th>Imagem</th></tr></thead>
        <tbody>{review_rows}</tbody>
      </table>
    </section>
    <section class="overview">
      <h2>Imagens não processadas</h2>
      <ul>{ignored_rows}</ul>
    </section>
    {''.join(sheet_sections)}
  </main>
</body>
</html>
"""
    path.write_text(document, encoding="utf-8")
    return path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Prévia OMR emergencial das fichas de Avaliação Infantil."
    )
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--school", required=True)
    parser.add_argument("--year", required=True, type=int)
    parser.add_argument("--bimester", required=True, type=int)
    parser.add_argument(
        "--classes",
        default="MATERNAL,MATERNAL B",
        help="Turmas permitidas, separadas por vírgula.",
    )
    parser.add_argument("--mapping", type=Path)
    parser.add_argument("--corrections", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--apply", action="store_true")
    return parser.parse_args()


def validate_apply_readiness(report: dict[str, Any]) -> None:
    unresolved = int(report["summary"]["unresolvedReviews"])
    if unresolved:
        raise RuntimeError(
            f"Apply bloqueado: existem {unresolved} itens de revisão manual não resolvidos."
        )
    for item in report.get("appliedCorrections", []):
        if item["finalStatus"] == "null" and not item.get("confirmedByUser", True):
            raise RuntimeError(
                "Apply bloqueado: existe finalStatus null sem confirmação do usuário."
            )


def main() -> int:
    args = parse_args()
    if not args.dry_run and not args.apply:
        raise RuntimeError("A flag --dry-run é obrigatória; nenhum dado será gravado.")
    if not args.input.exists():
        raise RuntimeError(f"Entrada não encontrada: {args.input}")

    allowed_display = [
        item.strip() for item in args.classes.split(",") if item.strip()
    ]
    allowed_normalized = {normalize(item) for item in allowed_display}
    context = load_real_context(args.school, args.year, allowed_normalized)
    class_names = [
        entry["class"].get("name")
        for entry in context["rosters"].values()
    ]
    mapping = read_mapping(args.mapping)
    images = discover_images(args.input)
    if args.limit:
        images = images[: args.limit]
    if not images:
        raise RuntimeError("Nenhuma imagem compatível foi encontrada para processar.")

    output_dir = (
        args.output.resolve()
        if args.output
        else (args.input if args.input.is_dir() else args.input.parent)
        / "early_childhood_import_preview"
    )
    output_dir.mkdir(parents=True, exist_ok=True)

    sheets = []
    for image_path in images:
        mapped_item = mapping.get(normalize(image_path.name))
        if mapping and not mapped_item:
            sheets.append(
                {
                    "file": str(image_path),
                    "fileName": image_path.name,
                    "identified": False,
                    "ignored": True,
                    "mapped": False,
                    "reason": "Imagem não consta no arquivo de mapping.",
                }
            )
            continue
        if mapped_item and mapped_item.get("skip"):
            sheets.append(
                {
                    "file": str(image_path),
                    "fileName": image_path.name,
                    "identified": True,
                    "ignored": True,
                    "mapped": True,
                    "reason": mapped_item.get("notes")
                    or "Imagem marcada para ser ignorada no mapping.",
                }
            )
            continue
        try:
            original = cv2.imread(str(image_path))
            if original is None:
                raise RuntimeError("Imagem inválida.")
            oriented, _rotation = rotate_to_landscape(original)
            identity = resolve_identity(
                image_path,
                oriented,
                mapping,
                class_names,
            )
            if not identity:
                raise RuntimeError(
                    "Turma/área não identificadas por OCR, subpasta ou mapping."
                )
            roster_entry = context["rosters"].get(normalize(identity["className"]))
            if not roster_entry:
                raise RuntimeError(
                    f"Turma '{identity['className']}' não encontrada no contexto da API."
                )
            sheets.append(
                {
                    **process_sheet(
                    image_path=image_path,
                    identity=identity,
                    roster_entry=roster_entry,
                    output_dir=output_dir,
                    year=args.year,
                    bimester=args.bimester,
                    ),
                    "mapped": bool(mapped_item),
                }
            )
        except Exception as exc:
            sheets.append(
                {
                    "file": str(image_path),
                    "fileName": image_path.name,
                    "identified": False,
                    "mapped": bool(mapped_item),
                    "error": str(exc),
                }
            )

    mapped_images = sum(
        1 for image in images if normalize(image.name) in mapping
    )
    correction_run = {
        "provided": 0,
        "applied": [],
        "incomplete": [],
        "unknownIds": [],
    }
    if args.corrections:
        corrections = read_corrections(args.corrections.resolve())
        correction_run = apply_manual_corrections(sheets, corrections)

    report = build_consolidated_report(
        sheets=sheets,
        total_images=len(images),
        mapped_images=mapped_images,
        rosters=context["rosters"],
    )
    report["correctionRun"] = {
        "input": str(args.corrections.resolve()) if args.corrections else None,
        "provided": correction_run["provided"],
        "appliedCount": len(correction_run["applied"]),
        "incompleteCount": len(correction_run["incomplete"]),
        "incomplete": correction_run["incomplete"],
        "unknownIds": correction_run["unknownIds"],
        "remainingReviews": report["summary"]["unresolvedReviews"],
    }
    summary = report["summary"]
    if args.apply:
        validate_apply_readiness(report)
        raise RuntimeError(
            "Apply bloqueado nesta versão emergencial, mesmo com todas as revisões resolvidas."
        )
    school = context["school"]
    user = context["user"]
    metadata = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "dryRun": True,
        "writesPerformed": 0,
        "schoolId": school.get("_id"),
        "schoolName": school.get("name"),
        "year": args.year,
        "bimester": args.bimester,
        "authenticatedUser": user.get("fullName") or user.get("name"),
        "input": str(args.input.resolve()),
        "mapping": str(args.mapping.resolve()) if args.mapping else None,
        "corrections": (
            str(args.corrections.resolve()) if args.corrections else None
        ),
        "output": str(output_dir),
        "allowedClasses": class_names,
        "statusMapping": STATUS_VALUES,
        "areaMapping": {
            area: definition["key"]
            for area, definition in AREA_DEFINITIONS.items()
        },
    }

    resolved = args.corrections is not None
    json_path = write_json(
        output_dir,
        metadata,
        sheets,
        report,
        (
            "early_childhood_import_resolved_preview.json"
            if resolved
            else "early_childhood_import_preview.json"
        ),
    )
    csv_path = write_csv(
        output_dir,
        sheets,
        (
            "early_childhood_import_resolved_preview.csv"
            if resolved
            else "early_childhood_import_preview.csv"
        ),
    )
    html_path = write_html(
        output_dir,
        metadata,
        sheets,
        report,
        (
            "early_childhood_import_resolved_review.html"
            if resolved
            else "early_childhood_import_review.html"
        ),
    )
    summary_path = write_summary_text(
        output_dir,
        metadata,
        report,
        (
            "early_childhood_import_resolved_summary.txt"
            if resolved
            else "early_childhood_import_summary.txt"
        ),
    )
    corrections_json, corrections_csv = write_corrections_template(
        output_dir,
        report,
        json_name=(
            "early_childhood_import_remaining_corrections.json"
            if resolved
            else "early_childhood_import_corrections_template.json"
        ),
        csv_name=(
            "early_childhood_import_remaining_corrections.csv"
            if resolved
            else "early_childhood_import_corrections_template.csv"
        ),
    )
    editor_path = write_corrections_editor(
        output_dir,
        report,
        metadata,
        (
            "early_childhood_remaining_corrections_editor.html"
            if resolved
            else "early_childhood_corrections_editor.html"
        ),
    )
    result = {
        "outputDirectory": str(output_dir),
        "json": str(json_path),
        "csv": str(csv_path),
        "html": str(html_path),
        "summaryText": str(summary_path),
        "correctionsTemplateJson": str(corrections_json),
        "correctionsTemplateCsv": str(corrections_csv),
        "correctionsEditor": str(editor_path),
        "correctionRun": report["correctionRun"],
        "applyReadiness": {
            "ready": summary["applyReady"],
            "message": (
                "Pronto para futura validação de apply."
                if summary["applyReady"]
                else (
                    "Apply bloqueado: existem "
                    f"{summary['unresolvedReviews']} itens de revisão manual não resolvidos."
                )
            ),
        },
        "debugDirectory": str(output_dir / "debug_output"),
        "summary": summary,
        "dryRun": True,
        "writesPerformed": 0,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if summary["imagesProcessed"] else 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERRO: {exc}", file=sys.stderr)
        raise SystemExit(1)
