import sys
import cv2
import numpy as np
import json
import traceback
import os
import math

# =========================================================
# CONFIG
# =========================================================

DEFAULT_CANONICAL_W = 1000
DEFAULT_CANONICAL_H = 1400

DEFAULT_ANCHOR_CENTERS = {
    "topLeft": {"x": 120, "y": 120},
    "topRight": {"x": 880, "y": 120},
    "bottomRight": {"x": 880, "y": 1280},
    "bottomLeft": {"x": 120, "y": 1280},
}

OPTIONS = ["A", "B", "C", "D", "E"]
MAX_RESIZE_SIDE = 1800

# -----------------------------
# ÂNCORAS TIPO "L" (CANTONEIRAS)
# -----------------------------
ANCHOR_MIN_AREA_RATIO = 0.00003
ANCHOR_MAX_AREA_RATIO = 0.05
ANCHOR_MIN_ASPECT = 0.40  # Tolerância maior para L-shapes
ANCHOR_MAX_ASPECT = 2.50
ANCHOR_MIN_EXTENT = 0.15  # Extent de um 'L' é menor que de um quadrado (geralmente 0.3~0.5)
ANCHOR_EDGE_BAND_X_RATIO = 0.24
ANCHOR_EDGE_BAND_Y_RATIO = 0.20
ANCHOR_MAX_CHILDREN = 0
ANCHOR_MAX_STDDEV = 45.0
ANCHOR_MAX_MEAN_GRAY = 120.0
ANCHOR_TOP_CANDIDATES = 30

# -----------------------------
# DETECÇÃO VISUAL DA ÁREA DE RESPOSTAS
# -----------------------------
ANSWER_ROI_FALLBACK = {
    "x1_ratio": 0.05,
    "y1_ratio": 0.05,
    "x2_ratio": 0.95,
    "y2_ratio": 0.95,
}

# -----------------------------
# BOLHAS
# -----------------------------
HOUGH_DP = 1.2
HOUGH_PARAM1 = 100
HOUGH_PARAM2 = 18

FILL_INNER_RADIUS_MULT = 0.56
FILL_MARKED_MIN = 0.42
FILL_MARKED_DELTA_MIN = 0.10
FILL_MARKED_RATIO_MIN = 1.30
FILL_AMBIGUOUS_MIN = 0.26

DEBUG_FONT = cv2.FONT_HERSHEY_SIMPLEX


# =========================================================
# LOGS
# =========================================================

def log_info(msg):
    sys.stderr.write(f"[PYTHON INFO] {msg}\n")


def log_warn(msg):
    sys.stderr.write(f"[PYTHON WARN] {msg}\n")


def log_error(msg):
    sys.stderr.write(f"[PYTHON ERROR] {msg}\n")


# =========================================================
# HELPERS
# =========================================================

def safe_int(v, default=0):
    try:
        return int(round(float(v)))
    except Exception:
        return default


def euclidean(p1, p2):
    return float(np.linalg.norm(np.array(p1, dtype=np.float32) - np.array(p2, dtype=np.float32)))


def resize_keep_aspect_max(image, max_side=MAX_RESIZE_SIDE):
    h, w = image.shape[:2]
    longest = max(h, w)
    if longest <= max_side:
        return image

    scale = max_side / float(longest)
    resized = cv2.resize(
        image,
        (max(1, int(round(w * scale))), max(1, int(round(h * scale)))),
        interpolation=cv2.INTER_AREA
    )
    log_info(f"Resize aplicado: {w}x{h} -> {resized.shape[1]}x{resized.shape[0]}")
    return resized


def order_points(pts):
    pts = np.array(pts, dtype=np.float32)
    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1).reshape(-1)
    return np.array([
        pts[np.argmin(s)],
        pts[np.argmin(d)],
        pts[np.argmax(s)],
        pts[np.argmax(d)]
    ], dtype=np.float32)


def get_contour_centroid(contour):
    m = cv2.moments(contour)
    if abs(m["m00"]) < 1e-6:
        x, y, w, h = cv2.boundingRect(contour)
        return np.array([x + w / 2.0, y + h / 2.0], dtype=np.float32)
    return np.array([m["m10"] / m["m00"], m["m01"] / m["m00"]], dtype=np.float32)


def clamp_box(x1, y1, x2, y2, w, h):
    return (
        max(0, min(w, x1)),
        max(0, min(h, y1)),
        max(0, min(w, x2)),
        max(0, min(h, y2))
    )


def circularity(contour):
    area = cv2.contourArea(contour)
    peri = cv2.arcLength(contour, True)
    if area <= 0 or peri <= 0:
        return 0.0
    return float((4.0 * math.pi * area) / (peri * peri))


def count_direct_children(hierarchy, idx):
    if hierarchy is None:
        return 0
    children = 0
    child = hierarchy[0][idx][2]
    while child != -1:
        children += 1
        child = hierarchy[0][child][0]
    return children


def load_layout_json(layout_path):
    if not layout_path or not os.path.exists(layout_path):
        return None
    with open(layout_path, "r", encoding="utf-8") as f:
        return json.load(f)


def normalize_image_github(im):
    im_gray = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(im_gray, (3, 3), 0)
    return cv2.adaptiveThreshold(
        blurred,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        77,
        10
    )


# =========================================================
# ÂNCORAS
# =========================================================

def preprocess_for_anchor_detection(gray):
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    _, th = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    th = cv2.morphologyEx(th, cv2.MORPH_OPEN, kernel)
    return th


def is_in_corner_band(cx, cy, w, h):
    band_x = w * ANCHOR_EDGE_BAND_X_RATIO
    band_y = h * ANCHOR_EDGE_BAND_Y_RATIO

    near_left = cx <= band_x
    near_right = cx >= (w - band_x)
    near_top = cy <= band_y
    near_bottom = cy >= (h - band_y)

    return (near_left or near_right) and (near_top or near_bottom)


def score_anchor_candidate(cand, image_shape):
    h, w = image_shape[:2]
    cx = cand["cx"]
    cy = cand["cy"]

    min_edge_dist = min(cx, w - cx, cy, h - cy)
    edge_score = 1.0 / (min_edge_dist + 1.0)
    darkness_score = max(0.0, 255.0 - cand["mean_gray"])
    uniformity_bonus = max(0.0, 60.0 - cand["std_gray"])
    child_penalty = cand["children"] * 50000.0

    return (
        (cand["area"] * 1.5) +  # Removido o peso do extent para não penalizar formato de "L"
        (darkness_score * 40.0) +
        (uniformity_bonus * 35.0) +
        (edge_score * 50000.0) -
        child_penalty
    )


def choose_best_anchor_per_quadrant(candidates, image_shape):
    h, w = image_shape[:2]
    cx_img = w / 2.0
    cy_img = h / 2.0

    quadrants = {"tl": [], "tr": [], "br": [], "bl": []}

    for cand in candidates:
        if cand["cx"] <= cx_img and cand["cy"] <= cy_img:
            quadrants["tl"].append(cand)
        elif cand["cx"] > cx_img and cand["cy"] <= cy_img:
            quadrants["tr"].append(cand)
        elif cand["cx"] > cx_img and cand["cy"] > cy_img:
            quadrants["br"].append(cand)
        else:
            quadrants["bl"].append(cand)

    selected = {}
    for key, items in quadrants.items():
        if not items:
            raise Exception(f"Falha ao localizar âncora no quadrante '{key}'.")
        items = sorted(items, key=lambda c: c["score"], reverse=True)
        selected[key] = items[0]

    return [
        selected["tl"],
        selected["tr"],
        selected["br"],
        selected["bl"],
    ]


def find_anchor_squares(gray, debug_image=None, binary_debug_path=None):
    th = preprocess_for_anchor_detection(gray)

    if binary_debug_path:
        cv2.imwrite(binary_debug_path, th)
        log_info(f"Imagem binária da detecção de âncoras salva em: {binary_debug_path}")

    contours, hierarchy = cv2.findContours(th, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)

    h, w = gray.shape[:2]
    img_area = h * w
    candidates = []

    log_info(f"Total de contornos encontrados para busca das âncoras: {len(contours)}")

    for idx, c in enumerate(contours):
        area = cv2.contourArea(c)
        if area <= 0:
            continue

        if area < img_area * ANCHOR_MIN_AREA_RATIO:
            continue
        if area > img_area * ANCHOR_MAX_AREA_RATIO:
            continue

        x, y, bw, bh = cv2.boundingRect(c)
        if bw <= 0 or bh <= 0:
            continue

        aspect = bw / float(bh)
        if not (ANCHOR_MIN_ASPECT <= aspect <= ANCHOR_MAX_ASPECT):
            continue

        rect_area = float(bw * bh)
        extent = area / rect_area if rect_area > 0 else 0.0
        if extent < ANCHOR_MIN_EXTENT:
            continue

        centroid = get_contour_centroid(c)
        cx, cy = float(centroid[0]), float(centroid[1])

        if not is_in_corner_band(cx, cy, w, h):
            continue

        x1, y1, x2, y2 = clamp_box(x, y, x + bw, y + bh, w, h)
        roi_gray = gray[y1:y2, x1:x2]
        if roi_gray.size == 0:
            continue

        mean_gray = float(np.mean(roi_gray))
        std_gray = float(np.std(roi_gray))
        children = count_direct_children(hierarchy, idx)

        if children > ANCHOR_MAX_CHILDREN:
            continue
        if mean_gray > ANCHOR_MAX_MEAN_GRAY:
            continue
        if std_gray > ANCHOR_MAX_STDDEV:
            continue

        cand = {
            "index": idx,
            "contour": c,
            "area": float(area),
            "bbox": (int(x), int(y), int(bw), int(bh)),
            "extent": float(extent),
            "aspect": float(aspect),
            "cx": cx,
            "cy": cy,
            "mean_gray": mean_gray,
            "std_gray": std_gray,
            "children": children
        }
        cand["score"] = score_anchor_candidate(cand, gray.shape)
        candidates.append(cand)

    if not candidates:
        raise Exception("Nenhum candidato de âncora 'L' encontrado após filtragem.")

    candidates = sorted(candidates, key=lambda c: c["score"], reverse=True)[:ANCHOR_TOP_CANDIDATES]

    log_info("Top candidatos de âncora:")
    for i, cand in enumerate(candidates[:15], start=1):
        log_info(
            f"  #{i:02d} | score={cand['score']:.2f} | area={cand['area']:.1f} | "
            f"extent={cand['extent']:.3f} | aspect={cand['aspect']:.3f} | "
            f"mean={cand['mean_gray']:.1f} | std={cand['std_gray']:.1f} | "
            f"children={cand['children']} | centroid=({cand['cx']:.1f},{cand['cy']:.1f}) | "
            f"bbox={cand['bbox']}"
        )

    selected = choose_best_anchor_per_quadrant(candidates, gray.shape)

    selected_contours = [item["contour"] for item in selected]
    selected_info = []

    labels = ["TL", "TR", "BR", "BL"]
    colors = {
        "TL": (0, 255, 0),
        "TR": (0, 255, 255),
        "BR": (255, 0, 0),
        "BL": (255, 0, 255),
    }

    for label, item in zip(labels, selected):
        selected_info.append({
            "label": label,
            "score": round(item["score"], 3),
            "area": round(item["area"], 3),
            "extent": round(item["extent"], 4),
            "aspect": round(item["aspect"], 4),
            "meanGray": round(item["mean_gray"], 3),
            "stdGray": round(item["std_gray"], 3),
            "children": int(item["children"]),
            "centroid": [round(item["cx"], 3), round(item["cy"], 3)],
            "bbox": list(item["bbox"]),
        })

        if debug_image is not None:
            cv2.drawContours(debug_image, [item["contour"]], -1, colors[label], 3)
            cv2.circle(debug_image, (int(item["cx"]), int(item["cy"])), 7, colors[label], -1)
            cv2.putText(
                debug_image,
                label,
                (int(item["cx"]) + 8, int(item["cy"]) - 8),
                DEBUG_FONT,
                0.7,
                colors[label],
                2
            )

    return selected_contours, selected_info


def get_source_points_from_anchor_contours(anchor_contours):
    points = []
    for c in anchor_contours:
        centroid = get_contour_centroid(c)
        points.append([float(centroid[0]), float(centroid[1])])
    return order_points(np.array(points, dtype=np.float32))


def get_destination_anchor_points(layout):
    cw = safe_int(layout.get("canonicalWidth", DEFAULT_CANONICAL_W), DEFAULT_CANONICAL_W) if layout else DEFAULT_CANONICAL_W
    ch = safe_int(layout.get("canonicalHeight", DEFAULT_CANONICAL_H), DEFAULT_CANONICAL_H) if layout else DEFAULT_CANONICAL_H

    anchors = layout.get("anchors", {}) if layout else {}
    merged = {
        "topLeft": anchors.get("topLeft", DEFAULT_ANCHOR_CENTERS["topLeft"]),
        "topRight": anchors.get("topRight", DEFAULT_ANCHOR_CENTERS["topRight"]),
        "bottomRight": anchors.get("bottomRight", DEFAULT_ANCHOR_CENTERS["bottomRight"]),
        "bottomLeft": anchors.get("bottomLeft", DEFAULT_ANCHOR_CENTERS["bottomLeft"]),
    }

    dest = np.array([
        [merged["topLeft"]["x"], merged["topLeft"]["y"]],
        [merged["topRight"]["x"], merged["topRight"]["y"]],
        [merged["bottomRight"]["x"], merged["bottomRight"]["y"]],
        [merged["bottomLeft"]["x"], merged["bottomLeft"]["y"]],
    ], dtype=np.float32)

    return cw, ch, dest


def warp_using_detected_anchors(image, anchor_contours, layout):
    cw, ch, dest_points = get_destination_anchor_points(layout)
    source_points = get_source_points_from_anchor_contours(anchor_contours)

    log_info(f"Source anchors detectados: {source_points.tolist()}")
    log_info(f"Destino canonical: {dest_points.tolist()}")

    width_top = euclidean(source_points[0], source_points[1])
    width_bottom = euclidean(source_points[3], source_points[2])
    height_left = euclidean(source_points[0], source_points[3])
    height_right = euclidean(source_points[1], source_points[2])

    log_info(
        f"Geometria das âncoras | width_top={width_top:.2f} | width_bottom={width_bottom:.2f} | "
        f"height_left={height_left:.2f} | height_right={height_right:.2f}"
    )

    if min(width_top, width_bottom, height_left, height_right) < 60:
        raise Exception("Âncoras detectadas geometricamente inválidas.")

    M = cv2.getPerspectiveTransform(source_points, dest_points)

    warped = cv2.warpPerspective(
        image,
        M,
        (cw, ch),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(255, 255, 255)
    )

    return warped, source_points, dest_points


# =========================================================
# DETECÇÃO VISUAL DA ÁREA DE RESPOSTAS
# =========================================================

def detect_answer_roi(warped_bgr, debug_image=None):
    """
    Tenta localizar visualmente o bloco central das respostas (agora sem o QR code ao lado).
    """
    h, w = warped_bgr.shape[:2]
    gray = cv2.cvtColor(warped_bgr, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)

    th = cv2.adaptiveThreshold(
        blur,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        51,
        7
    )

    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    th = cv2.morphologyEx(th, cv2.MORPH_CLOSE, kernel)

    contours, _ = cv2.findContours(th, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    candidates = []
    for c in contours:
        area = cv2.contourArea(c)
        if area < (w * h) * 0.04:
            continue

        x, y, bw, bh = cv2.boundingRect(c)
        if bw <= 0 or bh <= 0:
            continue

        aspect = bh / float(bw) if bw > 0 else 0
        cx = x + bw / 2.0
        cy = y + bh / 2.0

        # Sem QR Code, a caixa agora ficará quase centralizada
        if not (0.3 <= aspect <= 5.0):
            continue
        if bw > w * 0.95 or bh > h * 0.95:
            continue

        # Pontua melhor caixas grandes mais próximas ao centro
        score = area - abs(cx - (w * 0.5)) * 100 - abs(cy - (h * 0.5)) * 100
        candidates.append((score, (x, y, bw, bh)))

    if candidates:
        candidates.sort(key=lambda t: t[0], reverse=True)
        x, y, bw, bh = candidates[0][1]

        pad_x = int(round(bw * 0.04))
        pad_y = int(round(bh * 0.04))
        x1 = max(0, x + pad_x)
        y1 = max(0, y + pad_y)
        x2 = min(w, x + bw - pad_x)
        y2 = min(h, y + bh - pad_y)

        roi = (x1, y1, x2, y2)
        log_info(f"ROI da área de respostas detectada visualmente: {roi}")

        if debug_image is not None:
            cv2.rectangle(debug_image, (x1, y1), (x2, y2), (0, 255, 255), 2)
            cv2.putText(debug_image, "ANSWER ROI", (x1, max(20, y1 - 8)), DEBUG_FONT, 0.7, (0, 255, 255), 2)

        return roi, True

    # fallback (agora pegando praticamente a área toda limpa do meio)
    x1 = int(round(w * ANSWER_ROI_FALLBACK["x1_ratio"]))
    y1 = int(round(h * ANSWER_ROI_FALLBACK["y1_ratio"]))
    x2 = int(round(w * ANSWER_ROI_FALLBACK["x2_ratio"]))
    y2 = int(round(h * ANSWER_ROI_FALLBACK["y2_ratio"]))
    roi = (x1, y1, x2, y2)

    log_warn(f"Falha na detecção visual da área de respostas. Usando ROI fallback: {roi}")

    if debug_image is not None:
        cv2.rectangle(debug_image, (x1, y1), (x2, y2), (0, 165, 255), 2)
        cv2.putText(debug_image, "ANSWER ROI FALLBACK", (x1, max(20, y1 - 8)), DEBUG_FONT, 0.7, (0, 165, 255), 2)

    return roi, False


# =========================================================
# DETECÇÃO VISUAL DAS BOLHAS
# =========================================================

def deduplicate_circles(circles, dist_factor=0.6):
    if not circles:
        return []

    circles = sorted(circles, key=lambda c: c[2], reverse=True)
    kept = []

    for c in circles:
        x, y, r = c
        duplicate = False
        for kx, ky, kr in kept:
            if euclidean((x, y), (kx, ky)) < min(r, kr) * dist_factor:
                duplicate = True
                break
        if not duplicate:
            kept.append((x, y, r))

    return kept


def detect_bubble_circles(answer_roi_bgr, total_questions, debug_image=None):
    gray = cv2.cvtColor(answer_roi_bgr, cv2.COLOR_BGR2GRAY)
    blur = cv2.medianBlur(gray, 5)

    h, w = gray.shape[:2]
    min_r = max(8, int(round(min(w, h) * 0.018)))
    max_r = max(min_r + 2, int(round(min(w, h) * 0.055)))
    min_dist = max(12, int(round(h / max(10, total_questions + 2) * 0.55)))

    circles = cv2.HoughCircles(
        blur,
        cv2.HOUGH_GRADIENT,
        dp=HOUGH_DP,
        minDist=min_dist,
        param1=HOUGH_PARAM1,
        param2=HOUGH_PARAM2,
        minRadius=min_r,
        maxRadius=max_r
    )

    detected = []
    if circles is not None:
        circles = np.round(circles[0]).astype(int)
        for c in circles:
            detected.append((int(c[0]), int(c[1]), int(c[2])))

    detected = deduplicate_circles(detected)

    if not detected:
        raise Exception("Nenhum círculo de bolha foi detectado visualmente na área de respostas.")

    radii = np.array([r for _, _, r in detected], dtype=np.float32)
    median_r = float(np.median(radii))

    filtered = []
    for x, y, r in detected:
        if 0.70 * median_r <= r <= 1.35 * median_r:
            filtered.append((x, y, r))

    if len(filtered) < max(20, total_questions * 3):
        filtered = detected

    log_info(
        f"Círculos detectados na ROI | brutos={len(detected)} | filtrados={len(filtered)} | "
        f"median_r={median_r:.2f}"
    )

    if debug_image is not None:
        for x, y, r in filtered:
            cv2.circle(debug_image, (x, y), r, (255, 0, 255), 1)
            cv2.circle(debug_image, (x, y), 2, (0, 255, 255), -1)

    return filtered, median_r


# =========================================================
# CLUSTERING DE COLUNAS E LINHAS
# =========================================================

def kmeans_1d(values, k):
    data = np.array(values, dtype=np.float32).reshape(-1, 1)
    if len(data) < k:
        raise Exception(f"Quantidade insuficiente de pontos para clustering 1D. n={len(data)} k={k}")

    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 50, 0.2)
    attempts = 10
    compactness, labels, centers = cv2.kmeans(
        data,
        k,
        None,
        criteria,
        attempts,
        cv2.KMEANS_PP_CENTERS
    )

    centers = centers.reshape(-1)
    order = np.argsort(centers)

    remap = {old: new for new, old in enumerate(order)}
    sorted_centers = centers[order]
    remapped_labels = np.array([remap[int(l[0])] for l in labels], dtype=np.int32)

    return sorted_centers.tolist(), remapped_labels.tolist()


def build_visual_grid(circles, total_questions, total_options=5):
    xs = [c[0] for c in circles]
    ys = [c[1] for c in circles]
    rs = [c[2] for c in circles]

    col_centers, col_labels = kmeans_1d(xs, total_options)
    row_centers, row_labels = kmeans_1d(ys, total_questions)

    median_r = float(np.median(np.array(rs, dtype=np.float32)))

    grid = {}
    for i, (x, y, r) in enumerate(circles):
        row = row_labels[i]
        col = col_labels[i]
        expected_x = col_centers[col]
        expected_y = row_centers[row]

        dist = euclidean((x, y), (expected_x, expected_y))
        cell_score = dist + abs(r - median_r) * 2.0

        item = {
            "x": int(x),
            "y": int(y),
            "r": int(r),
            "row": int(row),
            "col": int(col),
            "distToCellCenter": float(dist),
            "cellScore": float(cell_score),
        }

        key = (row, col)
        if key not in grid or item["cellScore"] < grid[key]["cellScore"]:
            grid[key] = item

    return {
        "grid": grid,
        "row_centers": row_centers,
        "col_centers": col_centers,
        "median_r": median_r
    }


# =========================================================
# MÉTRICAS DE PREENCHIMENTO
# =========================================================

def compute_fill_metrics_from_inner_circle(normalized_binary, cx, cy, radius):
    h, w = normalized_binary.shape[:2]

    x1 = max(0, int(cx - radius - 2))
    y1 = max(0, int(cy - radius - 2))
    x2 = min(w, int(cx + radius + 3))
    y2 = min(h, int(cy + radius + 3))

    if x2 <= x1 or y2 <= y1:
        return {
            "fill_ratio": 0.0,
            "mean_inside": 255.0,
            "box": (x1, y1, x2, y2)
        }

    patch = normalized_binary[y1:y2, x1:x2]
    ph, pw = patch.shape[:2]

    mask = np.zeros((ph, pw), dtype=np.uint8)
    local_cx = int(round(cx - x1))
    local_cy = int(round(cy - y1))
    inner_r = max(3, int(round(radius * FILL_INNER_RADIUS_MULT)))

    cv2.circle(mask, (local_cx, local_cy), inner_r, 255, -1)

    inside = patch[mask == 255]
    if inside.size == 0:
        return {
            "fill_ratio": 0.0,
            "mean_inside": 255.0,
            "box": (x1, y1, x2, y2)
        }

    fill_ratio = float(np.mean(inside < 128))
    mean_inside = float(np.mean(inside))

    return {
        "fill_ratio": fill_ratio,
        "mean_inside": mean_inside,
        "box": (x1, y1, x2, y2)
    }


def draw_marked_alternative(debug_img, cx, cy, r, option, question):
    cv2.circle(debug_img, (int(cx), int(cy)), int(r) + 7, (255, 0, 0), 3)
    cv2.putText(
        debug_img,
        f"Q{question}:{option}",
        (int(cx) + 8, int(cy) - 8),
        DEBUG_FONT,
        0.50,
        (255, 0, 0),
        2
    )


# =========================================================
# LEITURA OMR VISUAL
# =========================================================

def read_bubble_sheet_visual(
    warped_bgr,
    total_questions,
    debug_image_path=None,
    normalized_debug_path=None,
    bubble_grid_debug_path=None
):
    if total_questions <= 0:
        raise Exception("total_questions inválido para leitura visual.")

    normalized = normalize_image_github(warped_bgr)
    roi_debug = warped_bgr.copy()

    if normalized_debug_path:
        cv2.imwrite(normalized_debug_path, normalized)
        log_info(f"Imagem normalizada do warp salva em: {normalized_debug_path}")

    roi_box, roi_detected = detect_answer_roi(warped_bgr, debug_image=roi_debug)
    x1, y1, x2, y2 = roi_box
    answer_roi_bgr = warped_bgr[y1:y2, x1:x2]

    circles_debug = answer_roi_bgr.copy()
    circles, median_r = detect_bubble_circles(answer_roi_bgr, total_questions, debug_image=circles_debug)

    grid_data = build_visual_grid(circles, total_questions, total_options=5)
    grid = grid_data["grid"]
    row_centers = grid_data["row_centers"]
    col_centers = grid_data["col_centers"]
    median_r = grid_data["median_r"]

    debug_vis = warped_bgr.copy()
    grid_debug = warped_bgr.copy()

    cv2.rectangle(debug_vis, (x1, y1), (x2, y2), (0, 255, 255), 2)
    cv2.rectangle(grid_debug, (x1, y1), (x2, y2), (0, 255, 255), 2)

    answers = []
    debug_rows = []

    for q_idx in range(total_questions):
        row_stats = []

        for opt_idx in range(5):
            option = OPTIONS[opt_idx]

            if (q_idx, opt_idx) in grid:
                item = grid[(q_idx, opt_idx)]
                cx = x1 + int(item["x"])
                cy = y1 + int(item["y"])
                r = int(item["r"])
                source = "detected_circle"
            else:
                cx = x1 + int(round(col_centers[opt_idx]))
                cy = y1 + int(round(row_centers[q_idx]))
                r = int(round(median_r))
                source = "cluster_center_fallback"

            metrics = compute_fill_metrics_from_inner_circle(normalized, cx, cy, r)

            row_stats.append({
                "option": option,
                "x": cx,
                "y": cy,
                "r": r,
                "source": source,
                "fill_ratio": metrics["fill_ratio"],
                "mean_inside": metrics["mean_inside"],
                "box": metrics["box"]
            })

        row_stats = sorted(row_stats, key=lambda s: s["fill_ratio"], reverse=True)

        best = row_stats[0]
        second = row_stats[1] if len(row_stats) > 1 else None

        second_fill = second["fill_ratio"] if second else 0.0
        ratio = (best["fill_ratio"] / (second_fill + 1e-5)) if second else 999.0
        delta = best["fill_ratio"] - second_fill

        is_marked = False
        is_ambiguous = False

        if (
            best["fill_ratio"] >= FILL_MARKED_MIN and
            delta >= FILL_MARKED_DELTA_MIN and
            ratio >= FILL_MARKED_RATIO_MIN
        ):
            is_marked = True
        elif best["fill_ratio"] >= FILL_AMBIGUOUS_MIN:
            is_ambiguous = True

        status = "MARKED" if is_marked else "AMBIGUOUS" if is_ambiguous else "BLANK"
        marked = best["option"] if is_marked else None

        answers.append({
            "question": q_idx + 1,
            "marked": marked
        })

        ordered_for_log = sorted(row_stats, key=lambda x: OPTIONS.index(x["option"]))
        per_option_summary = " | ".join([
            f"{s['option']}=fill:{s['fill_ratio']:.3f},mean:{s['mean_inside']:.1f},src:{s['source']}"
            for s in ordered_for_log
        ])

        log_info(
            f"Q{str(q_idx + 1).zfill(2)} | "
            f"best={best['option']} fill={best['fill_ratio']:.3f} mean={best['mean_inside']:.1f} | "
            f"second={second['option'] if second else '-'} fill={second_fill:.3f} | "
            f"delta={delta:.3f} | ratio={ratio:.3f} | status={status} | marked={marked} | "
            f"{per_option_summary}"
        )

        for stat in ordered_for_log:
            bx1, by1, bx2, by2 = stat["box"]
            cv2.rectangle(debug_vis, (bx1, by1), (bx2, by2), (0, 0, 255), 1)
            cv2.circle(debug_vis, (stat["x"], stat["y"]), max(2, stat["r"] // 4), (0, 255, 255), -1)
            cv2.putText(
                debug_vis,
                f"{stat['option']}:{stat['fill_ratio']:.2f}",
                (bx1, max(12, by1 - 4)),
                DEBUG_FONT,
                0.34,
                (0, 0, 255),
                1
            )

            cv2.circle(grid_debug, (stat["x"], stat["y"]), stat["r"], (0, 255, 0), 2)
            cv2.circle(grid_debug, (stat["x"], stat["y"]), 2, (255, 255, 0), -1)

        if is_marked:
            draw_marked_alternative(debug_vis, best["x"], best["y"], best["r"], best["option"], q_idx + 1)
        elif is_ambiguous:
            cv2.circle(debug_vis, (best["x"], best["y"]), best["r"] + 7, (0, 255, 255), 3)
            cv2.putText(
                debug_vis,
                f"Q{q_idx + 1}:AMB",
                (best["x"] + 8, best["y"] - 8),
                DEBUG_FONT,
                0.50,
                (0, 255, 255),
                2
            )
        else:
            cv2.circle(debug_vis, (best["x"], best["y"]), best["r"] + 7, (180, 180, 180), 2)

        debug_rows.append({
            "question": q_idx + 1,
            "status": status,
            "marked": marked,
            "bestOption": best["option"],
            "bestFillRatio": round(best["fill_ratio"], 4),
            "bestMeanInside": round(best["mean_inside"], 2),
            "secondOption": second["option"] if second else None,
            "secondFillRatio": round(second_fill, 4),
            "delta": round(delta, 4),
            "ratio": round(ratio, 4),
            "options": [
                {
                    "option": s["option"],
                    "fillRatio": round(s["fill_ratio"], 4),
                    "meanInside": round(s["mean_inside"], 2),
                    "x": int(s["x"]),
                    "y": int(s["y"]),
                    "r": int(s["r"]),
                    "source": s["source"],
                    "box": list(map(int, s["box"]))
                }
                for s in ordered_for_log
            ]
        })

    if debug_image_path:
        cv2.imwrite(debug_image_path, debug_vis)
        log_info(f"Imagem de debug da leitura salva em: {debug_image_path}")

    if bubble_grid_debug_path:
        cv2.imwrite(bubble_grid_debug_path, grid_debug)
        log_info(f"Imagem de debug da grade visual salva em: {bubble_grid_debug_path}")

    return {
        "answers": answers,
        "debug_rows": debug_rows,
        "total_questions": total_questions,
        "roi": list(map(int, roi_box)),
        "roiDetectedVisually": bool(roi_detected),
        "rowCenters": [round(v, 3) for v in row_centers],
        "colCenters": [round(v, 3) for v in col_centers],
        "medianRadius": round(float(median_r), 3),
        "detectedCirclesCount": len(circles)
    }


# =========================================================
# PIPELINE PRINCIPAL
# =========================================================

def process_image(image_path, correction_type, layout_path=None):
    try:
        log_info("=" * 80)
        log_info("Iniciando leitura OMR VISUAL")
        log_info(f"image_path={image_path}")
        log_info(f"correction_type={correction_type}")
        log_info(f"layout_path={layout_path}")

        image = cv2.imread(image_path)
        if image is None:
            raise Exception("Não foi possível ler a imagem enviada.")

        log_info(f"Imagem original carregada com shape={image.shape}")
        image = resize_keep_aspect_max(image, max_side=MAX_RESIZE_SIDE)
        log_info(f"Imagem após resize com shape={image.shape}")

        if correction_type != "BUBBLE_SHEET":
            raise Exception(f"Tipo de correção não suportado pelo script atual: {correction_type}")

        layout = load_layout_json(layout_path)
        total_questions = 15
        layout_version = None

        if layout:
            total_questions = safe_int(layout.get("totalQuestions", 15), 15)
            layout_version = layout.get("version")

        log_info(
            f"Config visual | total_questions={total_questions} | "
            f"layoutVersion={layout_version}"
        )

        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        log_info("Imagem convertida para cinza para detecção das âncoras.")

        base_dir, file_name = os.path.split(image_path)
        name, _ext = os.path.splitext(file_name)

        anchor_debug_path = os.path.join(base_dir, f"{name}_anchors_debug.jpg")
        anchor_binary_debug_path = os.path.join(base_dir, f"{name}_anchors_binary.jpg")
        debug_img_path = os.path.join(base_dir, f"{name}_visao_ia.jpg")
        normalized_warp_debug_path = os.path.join(base_dir, f"{name}_warp_normalized.jpg")
        bubble_grid_debug_path = os.path.join(base_dir, f"{name}_bubble_grid_debug.jpg")

        anchor_debug = image.copy()
        anchor_contours, anchor_debug_info = find_anchor_squares(
            gray,
            debug_image=anchor_debug,
            binary_debug_path=anchor_binary_debug_path
        )
        cv2.imwrite(anchor_debug_path, anchor_debug)
        log_info(f"Imagem de debug das âncoras salva em: {anchor_debug_path}")

        warped_student, source_points, dest_points = warp_using_detected_anchors(
            image,
            anchor_contours,
            layout
        )
        log_info(f"Transformação de perspectiva concluída | warped_shape={warped_student.shape}")

        result = read_bubble_sheet_visual(
            warped_student,
            total_questions=total_questions,
            debug_image_path=debug_img_path,
            normalized_debug_path=normalized_warp_debug_path,
            bubble_grid_debug_path=bubble_grid_debug_path
        )

        output = {
            "success": True,
            "type": "BUBBLE_SHEET",
            "answers": result["answers"],
            "total_questions_detected": result["total_questions"],
            "debug": {
                "method": "FULL_VISUAL_BUBBLE_DETECTION",
                "layoutVersion": layout_version,
                "anchor_binary_debug_image": anchor_binary_debug_path,
                "anchor_debug_image": anchor_debug_path,
                "debug_image": debug_img_path,
                "normalized_warp_debug_image": normalized_warp_debug_path,
                "bubble_grid_debug_image": bubble_grid_debug_path,
                "source_points": source_points.tolist(),
                "dest_points": dest_points.tolist(),
                "selected_anchors": anchor_debug_info,
                "answer_roi": result["roi"],
                "answer_roi_detected_visually": result["roiDetectedVisually"],
                "row_centers": result["rowCenters"],
                "col_centers": result["colCenters"],
                "median_radius": result["medianRadius"],
                "detected_circles_count": result["detectedCirclesCount"],
                "rows": result["debug_rows"]
            }
        }

        print(json.dumps(output, ensure_ascii=False))
        log_info("Leitura OMR visual finalizada com sucesso.")
        return

    except Exception as e:
        log_error(f"ERRO CRÍTICO: {str(e)}")
        print(json.dumps({
            "success": False,
            "error": str(e),
            "trace": traceback.format_exc()
        }, ensure_ascii=False))


if __name__ == "__main__":
    if len(sys.argv) > 2:
        process_image(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)