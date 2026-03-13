import sys
import cv2
import numpy as np
import json
import traceback
import math
import os

# =========================================================
# CONFIG
# =========================================================

BUBBLE_TEMPLATE_PATH = os.environ.get(
    "OMR_BUBBLE_TEMPLATE_PATH",
    "/opt/render/project/src/src/assets/omr/bubble_sheet_template.png"
)

CANONICAL_W = 1000
CANONICAL_H = 1400

OPTIONS = ["A", "B", "C", "D", "E"]
EXPECTED_ROWS = 13
EXPECTED_COLS = 5


# =========================================================
# LOG
# =========================================================

def log_info(msg):
    sys.stderr.write(f"[PYTHON INFO] {msg}\n")


# =========================================================
# HELPERS
# =========================================================

def order_points(pts):
    pts = np.array(pts, dtype=np.float32)
    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1).reshape(-1)

    tl = pts[np.argmin(s)]
    br = pts[np.argmax(s)]
    tr = pts[np.argmin(d)]
    bl = pts[np.argmax(d)]

    return np.array([tl, tr, br, bl], dtype=np.float32)


def euclidean(p1, p2):
    return float(np.linalg.norm(np.array(p1) - np.array(p2)))


def resize_keep_aspect(image, target_w=1600):
    h, w = image.shape[:2]
    scale = target_w / float(w)
    return cv2.resize(image, (target_w, int(h * scale)))


def circle_mask(shape, center, radius):
    mask = np.zeros(shape[:2], dtype=np.uint8)
    cv2.circle(mask, center, int(radius), 255, -1)
    return mask


def annulus_mask(shape, center, inner_radius, outer_radius):
    mask = np.zeros(shape[:2], dtype=np.uint8)
    cv2.circle(mask, center, int(outer_radius), 255, -1)
    cv2.circle(mask, center, int(inner_radius), 0, -1)
    return mask


def nearest_index(value, centers):
    arr = np.array([abs(value - c) for c in centers], dtype=np.float32)
    return int(np.argmin(arr))


def kmeans_1d(values, k):
    if len(values) < k:
        raise Exception(f"Valores insuficientes para clusterizar em {k} grupos.")

    Z = np.array(values, dtype=np.float32).reshape(-1, 1)
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 100, 0.2)

    _, labels, centers = cv2.kmeans(
        Z,
        k,
        None,
        criteria,
        20,
        cv2.KMEANS_PP_CENTERS
    )

    centers = centers.flatten().tolist()
    centers.sort()
    return centers


# =========================================================
# ÂNCORAS
# =========================================================

def find_anchor_squares(gray):
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    _, th = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    th = cv2.morphologyEx(th, cv2.MORPH_OPEN, kernel)

    contours, _ = cv2.findContours(th, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    h, w = gray.shape[:2]
    img_area = h * w
    candidates = []

    for c in contours:
        area = cv2.contourArea(c)
        if area < img_area * 0.00003 or area > img_area * 0.02:
            continue

        x, y, bw, bh = cv2.boundingRect(c)
        if bh == 0:
            continue

        ar = bw / float(bh)
        if not (0.75 <= ar <= 1.25):
            continue

        rect_area = bw * bh
        if rect_area <= 0:
            continue

        extent = area / float(rect_area)
        if extent < 0.55:
            continue

        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, 0.06 * peri, True)
        if len(approx) < 4 or len(approx) > 8:
            continue

        candidates.append({
            "x": x, "y": y, "w": bw, "h": bh,
            "cx": x + bw / 2.0,
            "cy": y + bh / 2.0,
            "area": area,
            "extent": extent
        })

    if len(candidates) < 4:
        raise Exception("Não foi possível localizar as 4 âncoras pretas.")

    candidates = sorted(
        candidates,
        key=lambda c: c["area"] * c["extent"],
        reverse=True
    )[:12]

    import itertools
    best_pts = None
    best_score = None

    for combo in itertools.combinations(candidates, 4):
        pts = np.array([[c["cx"], c["cy"]] for c in combo], dtype=np.float32)
        ordered = order_points(pts)
        tl, tr, br, bl = ordered

        wt = euclidean(tl, tr)
        wb = euclidean(bl, br)
        hl = euclidean(tl, bl)
        hr = euclidean(tr, br)

        if min(wt, wb, hl, hr) < 80:
            continue

        rect_like = ((wt + wb) / 2.0) * ((hl + hr) / 2.0)
        penalty = abs(wt - wb) + abs(hl - hr)
        score = rect_like - (penalty * 20.0)

        if best_score is None or score > best_score:
            best_score = score
            best_pts = ordered

    if best_pts is None:
        raise Exception("Falha ao validar geometricamente as 4 âncoras.")

    return best_pts


def warp_using_anchors(image, anchors):
    dst = np.array([
        [60, 60],
        [CANONICAL_W - 60, 60],
        [CANONICAL_W - 60, CANONICAL_H - 60],
        [60, CANONICAL_H - 60]
    ], dtype=np.float32)

    M = cv2.getPerspectiveTransform(anchors, dst)
    warped = cv2.warpPerspective(image, M, (CANONICAL_W, CANONICAL_H))
    return warped, M


# =========================================================
# TEMPLATE / GRADE FIXA
# =========================================================

def get_answers_roi_from_canonical(gray):
    """
    ROI fixa do quadro de respostas no layout canônico.
    Ajustada para o cartão enviado.
    """
    H, W = gray.shape[:2]
    x1 = int(W * 0.66)
    x2 = int(W * 0.93)
    y1 = int(H * 0.27)
    y2 = int(H * 0.80)
    return (x1, y1, x2, y2)


def detect_template_bubbles(template_gray):
    """
    Descobre as posições das 65 bolhas no TEMPLATE VAZIO.
    Isso é muito mais estável do que descobrir na folha marcada.
    """
    x1, y1, x2, y2 = get_answers_roi_from_canonical(template_gray)
    roi = template_gray[y1:y2, x1:x2]

    blur = cv2.GaussianBlur(roi, (7, 7), 1.2)

    circles = cv2.HoughCircles(
        blur,
        cv2.HOUGH_GRADIENT,
        dp=1.15,
        minDist=18,
        param1=120,
        param2=16,
        minRadius=8,
        maxRadius=20
    )

    if circles is None:
        raise Exception("Não foi possível detectar as bolhas no template vazio.")

    circles = np.round(circles[0]).astype(int).tolist()

    # remove duplicatas
    unique = []
    for x, y, r in sorted(circles, key=lambda c: c[2], reverse=True):
        dup = False
        for ux, uy, ur in unique:
            if math.hypot(x - ux, y - uy) < max(r, ur) * 0.8:
                dup = True
                break
        if not dup:
            unique.append((x, y, r))

    if len(unique) < 50:
        raise Exception(f"Poucas bolhas detectadas no template: {len(unique)}.")

    xs = [c[0] for c in unique]
    ys = [c[1] for c in unique]
    rs = [c[2] for c in unique]

    col_centers = kmeans_1d(xs, EXPECTED_COLS)
    row_centers = kmeans_1d(ys, EXPECTED_ROWS)
    median_r = int(np.median(rs))

    tol_x = max(12, int(median_r * 1.5))
    tol_y = max(12, int(median_r * 1.5))

    assigned = {}
    for x, y, r in unique:
        ci = nearest_index(x, col_centers)
        ri = nearest_index(y, row_centers)

        if abs(x - col_centers[ci]) <= tol_x and abs(y - row_centers[ri]) <= tol_y:
            key = (ri, ci)
            dist = abs(x - col_centers[ci]) + abs(y - row_centers[ri])
            if key not in assigned or dist < assigned[key]["dist"]:
                assigned[key] = {"x": x, "y": y, "r": r, "dist": dist}

    grid = []
    for ri, yy in enumerate(row_centers):
        row = []
        for ci, xx in enumerate(col_centers):
            key = (ri, ci)
            if key in assigned:
                row.append({
                    "x": int(assigned[key]["x"] + x1),
                    "y": int(assigned[key]["y"] + y1),
                    "r": int(assigned[key]["r"]),
                    "synthetic": False
                })
            else:
                row.append({
                    "x": int(round(xx + x1)),
                    "y": int(round(yy + y1)),
                    "r": int(median_r),
                    "synthetic": True
                })
        grid.append(row)

    return {
        "grid": grid,
        "roi": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
        "median_r": median_r
    }


def load_template_grid():
    template = cv2.imread(BUBBLE_TEMPLATE_PATH)
    if template is None:
        raise Exception(f"Template vazio não encontrado em: {BUBBLE_TEMPLATE_PATH}")

    template = cv2.resize(template, (CANONICAL_W, CANONICAL_H))
    template_gray = cv2.cvtColor(template, cv2.COLOR_BGR2GRAY)

    anchors = find_anchor_squares(template_gray)
    warped_template, _ = warp_using_anchors(template, anchors)
    warped_gray = cv2.cvtColor(warped_template, cv2.COLOR_BGR2GRAY)

    return detect_template_bubbles(warped_gray)


# =========================================================
# LEITURA DAS BOLHAS
# =========================================================

def bubble_fill_score(gray, bubble):
    x = int(bubble["x"])
    y = int(bubble["y"])
    r = int(bubble["r"])

    inner_r = max(3, int(r * 0.52))
    bg_inner = int(r * 1.20)
    bg_outer = int(r * 1.90)

    h, w = gray.shape[:2]
    if x - bg_outer < 0 or y - bg_outer < 0 or x + bg_outer >= w or y + bg_outer >= h:
        return {
            "score": -9999.0,
            "fill_ratio": 0.0,
            "inner_mean": 255.0,
            "bg_mean": 255.0
        }

    inner_mask = circle_mask(gray.shape, (x, y), inner_r)
    bg_mask = annulus_mask(gray.shape, (x, y), bg_inner, bg_outer)

    inner_mean = cv2.mean(gray, mask=inner_mask)[0]
    bg_mean = cv2.mean(gray, mask=bg_mask)[0]

    local_threshold = max(60, min(220, int((inner_mean + bg_mean) / 2.0)))

    inner_pixels = gray[inner_mask == 255]
    if len(inner_pixels) == 0:
        fill_ratio = 0.0
    else:
        fill_ratio = float(np.mean(inner_pixels < local_threshold))

    darkness_gain = float(bg_mean - inner_mean)
    score = darkness_gain + (fill_ratio * 100.0)

    return {
        "score": score,
        "fill_ratio": fill_ratio,
        "inner_mean": inner_mean,
        "bg_mean": bg_mean
    }


def read_bubble_sheet(warped_bgr, template_grid_info):
    gray = cv2.cvtColor(warped_bgr, cv2.COLOR_BGR2GRAY)
    grid = template_grid_info["grid"]

    answers = []
    debug_rows = []

    for q_idx, row in enumerate(grid, start=1):
        row_stats = [bubble_fill_score(gray, bubble) for bubble in row]

        scores = [s["score"] for s in row_stats]
        fills = [s["fill_ratio"] for s in row_stats]

        best_idx = int(np.argmax(scores))
        best_score = scores[best_idx]

        sorted_scores = sorted(scores, reverse=True)
        second_score = sorted_scores[1] if len(sorted_scores) > 1 else -9999.0
        best_fill = fills[best_idx]

        # branco
        is_blank = (best_score < 18 and best_fill < 0.18)

        # múltipla / ambígua
        strong_count = sum(1 for s, f in zip(scores, fills) if s > 20 and f > 0.18)
        is_ambiguous = (
            not is_blank and
            (strong_count >= 2 and (best_score - second_score) < 12)
        )

        if is_blank:
            marked = None
            status = "BLANK"
        elif is_ambiguous:
            marked = None
            status = "AMBIGUOUS"
        else:
            marked = OPTIONS[best_idx]
            status = "MARKED"

        answers.append({
            "question": q_idx,
            "marked": marked
        })

        debug_rows.append({
            "question": q_idx,
            "scores": [round(v, 2) for v in scores],
            "fill_ratios": [round(v, 3) for v in fills],
            "status": status,
            "marked": marked
        })

        log_info(
            f"Q{str(q_idx).zfill(2)} "
            f"| scores={[round(v, 1) for v in scores]} "
            f"| fills={[round(v, 2) for v in fills]} "
            f"| {status} -> {marked}"
        )

    return {
        "answers": answers,
        "debug_rows": debug_rows
    }


# =========================================================
# DIRECT_GRADE
# =========================================================

def detect_direct_grade(gray):
    blur = cv2.GaussianBlur(gray, (5, 5), 0)

    circles = cv2.HoughCircles(
        blur,
        cv2.HOUGH_GRADIENT,
        dp=1.2,
        minDist=18,
        param1=120,
        param2=16,
        minRadius=6,
        maxRadius=22
    )

    if circles is None:
        raise Exception("Não foi possível localizar as bolinhas do modo DIRECT_GRADE.")

    circles = np.round(circles[0]).astype(int).tolist()
    circles = sorted(circles, key=lambda c: c[1])

    ys = [c[1] for c in circles]
    row_centers = kmeans_1d(ys, 2)

    grouped = {0: [], 1: []}
    for c in circles:
        ri = nearest_index(c[1], row_centers)
        grouped[ri].append(c)

    top_row = sorted(grouped[0], key=lambda c: c[0])[-11:]
    bottom_row = sorted(grouped[1], key=lambda c: c[0])[-10:]

    if len(top_row) < 11 or len(bottom_row) < 10:
        raise Exception("DIRECT_GRADE exige 11 bolhas na linha superior e 10 na inferior.")

    def score_circle(c):
        x, y, r = c
        return bubble_fill_score(gray, {"x": x, "y": y, "r": r})["score"]

    top_scores = [score_circle(c) for c in top_row]
    bottom_scores = [score_circle(c) for c in bottom_row]

    inteiro = int(np.argmax(top_scores))
    decimal = int(np.argmax(bottom_scores))
    grade = float(f"{inteiro}.{decimal}")

    return {
        "grade": grade,
        "debug": {
            "top_scores": [round(v, 2) for v in top_scores],
            "bottom_scores": [round(v, 2) for v in bottom_scores]
        }
    }


# =========================================================
# MAIN
# =========================================================

def process_image(image_path, correction_type):
    try:
        log_info("=" * 60)
        log_info(f"Iniciando leitura OMR | Modo={correction_type}")

        image = cv2.imread(image_path)
        if image is None:
            raise Exception("Não foi possível ler a imagem fornecida.")

        image = resize_keep_aspect(image, 1600)
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

        if correction_type == "BUBBLE_SHEET":
            log_info("Carregando template oficial do cartão...")
            template_grid_info = load_template_grid()

            log_info("Detectando âncoras na folha do aluno...")
            student_anchors = find_anchor_squares(gray)
            warped_student, _ = warp_using_anchors(image, student_anchors)

            result = read_bubble_sheet(warped_student, template_grid_info)

            print(json.dumps({
                "success": True,
                "type": "BUBBLE_SHEET",
                "answers": result["answers"],
                "total_questions_detected": len(result["answers"]),
                "debug": {
                    "template_roi": template_grid_info["roi"],
                    "template_radius": template_grid_info["median_r"],
                    "rows": result["debug_rows"]
                }
            }))
            return

        elif correction_type == "DIRECT_GRADE":
            result = detect_direct_grade(gray)
            print(json.dumps({
                "success": True,
                "type": "DIRECT_GRADE",
                "grade": result["grade"],
                "debug": result["debug"]
            }))
            return

        else:
            raise Exception(f"Modo de correção '{correction_type}' não suportado.")

    except Exception as e:
        log_info(f"ERRO CRÍTICO: {str(e)}")
        print(json.dumps({
            "success": False,
            "error": str(e),
            "trace": traceback.format_exc()
        }))


if __name__ == "__main__":
    if len(sys.argv) > 2:
        process_image(sys.argv[1], sys.argv[2])
    else:
        print(json.dumps({
            "success": False,
            "error": "Argumentos insuficientes. Uso: python script.py imagem.jpg MODO"
        }))