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

CANONICAL_W = 1000
CANONICAL_H = 1400
OPTIONS = ["A", "B", "C", "D", "E"]


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


def resize_keep_aspect(image, target_w=1200): # REDUZIDO DE 1600 PARA 1200 PARA PERFORMANCE
    h, w = image.shape[:2]
    scale = target_w / float(w)
    return cv2.resize(image, (target_w, int(h * scale)))


def preprocess_gray(gray):
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    eq = clahe.apply(gray)
    eq = cv2.GaussianBlur(eq, (3, 3), 0)
    return eq


def circle_mask(shape, center, radius):
    mask = np.zeros(shape[:2], dtype=np.uint8)
    cv2.circle(mask, center, int(radius), 255, -1)
    return mask


def annulus_mask(shape, center, inner_radius, outer_radius):
    mask = np.zeros(shape[:2], dtype=np.uint8)
    cv2.circle(mask, center, int(outer_radius), 255, -1)
    cv2.circle(mask, center, int(inner_radius), 0, -1)
    return mask


def safe_int(v, default=0):
    try:
        return int(round(float(v)))
    except Exception:
        return default


def load_layout_json(layout_path):
    if not layout_path:
        raise Exception("Layout OMR não informado para o modo BUBBLE_SHEET.")

    if not os.path.exists(layout_path):
        raise Exception(f"Arquivo de layout OMR não encontrado: {layout_path}")

    with open(layout_path, "r", encoding="utf-8") as f:
        layout = json.load(f)

    if not isinstance(layout, dict):
        raise Exception("Layout OMR inválido: JSON não é um objeto.")

    required = ["canonicalWidth", "canonicalHeight", "anchors", "bubbles", "totalQuestions"]
    for key in required:
        if key not in layout:
            raise Exception(f"Layout OMR inválido: campo obrigatório ausente '{key}'.")

    return layout


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


def warp_using_layout_anchors(image, student_anchors, layout):
    cw = safe_int(layout.get("canonicalWidth", CANONICAL_W), CANONICAL_W)
    ch = safe_int(layout.get("canonicalHeight", CANONICAL_H), CANONICAL_H)

    anchors = layout.get("anchors", {})
    required = ["topLeft", "topRight", "bottomRight", "bottomLeft"]
    for k in required:
        if k not in anchors:
            raise Exception(f"Layout OMR inválido: âncora '{k}' ausente.")

    dst = np.array([
        [anchors["topLeft"]["x"], anchors["topLeft"]["y"]],
        [anchors["topRight"]["x"], anchors["topRight"]["y"]],
        [anchors["bottomRight"]["x"], anchors["bottomRight"]["y"]],
        [anchors["bottomLeft"]["x"], anchors["bottomLeft"]["y"]],
    ], dtype=np.float32)

    M = cv2.getPerspectiveTransform(student_anchors, dst)
    warped = cv2.warpPerspective(image, M, (cw, ch))

    return warped, M


# =========================================================
# BOLHAS / LEITURA
# =========================================================

def build_question_grid_from_layout(layout):
    bubbles = layout.get("bubbles", [])
    if not bubbles:
        raise Exception("Layout OMR inválido: lista de bolhas vazia.")

    questions_map = {}
    for bubble in bubbles:
        q = safe_int(bubble.get("question"))
        option = str(bubble.get("option", "")).strip().upper()

        if q <= 0 or option not in OPTIONS:
            continue

        questions_map.setdefault(q, {})
        questions_map[q][option] = {
            "x": safe_int(bubble.get("x")),
            "y": safe_int(bubble.get("y")),
            "r": max(4, safe_int(bubble.get("r", 11))),
            "question": q,
            "option": option,
            "columnIndex": bubble.get("columnIndex"),
            "rowIndex": bubble.get("rowIndex"),
        }

    total_questions = safe_int(layout.get("totalQuestions", 0))
    if total_questions <= 0:
        total_questions = max(questions_map.keys()) if questions_map else 0

    rows = []
    for q in range(1, total_questions + 1):
        row = []
        row_map = questions_map.get(q, {})
        for opt in OPTIONS:
            if opt not in row_map:
                raise Exception(f"Layout OMR inválido: bolha ausente para Q{q} opção {opt}.")
            row.append(row_map[opt])
        rows.append(row)

    return rows


def bubble_fill_score(gray, bubble, search_radius=0):
    base_x = int(bubble["x"])
    base_y = int(bubble["y"])
    r = int(bubble["r"])
    option = bubble.get("option", "")

    best = None

    for dy in range(-search_radius, search_radius + 1):
        for dx in range(-search_radius, search_radius + 1):
            x = base_x + dx
            y = base_y + dy

            inner_r = max(3, int(r * 0.50))
            bg_inner = int(r * 1.18)
            bg_outer = int(r * 1.95)

            h, w = gray.shape[:2]
            if x - bg_outer < 0 or y - bg_outer < 0 or x + bg_outer >= w or y + bg_outer >= h:
                continue

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

            # Mantemos o score base para retrocompatibilidade com o DIRECT_GRADE
            score = darkness_gain + (fill_ratio * 100.0)

            candidate = {
                "score": score,
                "fill_ratio": fill_ratio,
                "darkness_gain": darkness_gain,
                "inner_mean": inner_mean,
                "bg_mean": bg_mean,
                "x": x,
                "y": y,
                "option": option
            }

            if best is None or candidate["score"] > best["score"]:
                best = candidate

    if best is None:
        return {
            "score": -9999.0,
            "fill_ratio": 0.0,
            "darkness_gain": 0.0,
            "inner_mean": 255.0,
            "bg_mean": 255.0,
            "x": base_x,
            "y": base_y,
            "option": option
        }

    return best


def read_bubble_sheet(warped_bgr, layout):
    student_gray = cv2.cvtColor(warped_bgr, cv2.COLOR_BGR2GRAY)
    student_gray = preprocess_gray(student_gray)

    question_grid = build_question_grid_from_layout(layout)
    total_questions = len(question_grid)

    answers = []
    debug_rows = []

    for q_idx, row in enumerate(question_grid, start=1):
        # Search radius reduzido para 1 para mais agilidade
        row_stats = [bubble_fill_score(student_gray, bubble, search_radius=1) for bubble in row]

        # NOVA REGRA: Ordenamos pelas bolhas de maior preenchimento absoluto (fill_ratio)
        sorted_stats = sorted(row_stats, key=lambda s: s["fill_ratio"], reverse=True)
        best = sorted_stats[0]
        second = sorted_stats[1] if len(sorted_stats) > 1 else None

        best_fill = best["fill_ratio"]
        best_darkness = best["darkness_gain"]
        second_fill = second["fill_ratio"] if second else 0.0

        is_blank = best_fill < 0.32
        is_ambiguous = False

        if not is_blank:
            # Verifica rasura/dupla marcação: duas bolhas com preenchimento forte
            if best_fill >= 0.45 and second_fill >= 0.45:
                is_ambiguous = True
            # Verifica se não abriu vantagem clara sobre a segunda
            elif (best_fill - second_fill) < 0.10 and best_fill >= 0.40:
                is_ambiguous = True

        marked = None
        status = "UNKNOWN"

        if is_blank:
            status = "BLANK"
        elif is_ambiguous:
            status = "AMBIGUOUS"
        elif best_fill >= 0.50 and best_darkness >= 15:
            marked = best["option"]
            status = "MARKED"
        else:
            # Caiu no limbo de marcação fraca demais ou sujeira que não chegou no limiar.
            # Por segurança, classificamos como BLANK para não inventar nota.
            status = "BLANK"

        answers.append({
            "question": q_idx,
            "marked": marked
        })

        # Mantendo o formato original de debug para não quebrar a sua interface/JSON
        raw_scores = [s["score"] for s in row_stats]
        adjusted_scores = [s["score"] - min(raw_scores) for s in row_stats]
        fill_ratios = [s["fill_ratio"] for s in row_stats]

        # Encontra o índice original da melhor bolha para o debug
        best_idx = 0
        for i, s in enumerate(row_stats):
            if s["option"] == best["option"]:
                best_idx = i

        debug_rows.append({
            "question": q_idx,
            "raw_scores": [round(v, 2) for v in raw_scores],
            "adjusted_scores": [round(v, 2) for v in adjusted_scores],
            "fill_ratios": [round(v, 3) for v in fill_ratios],
            "status": status,
            "marked": marked,
            "best_center": {
                "x": int(row_stats[best_idx]["x"]),
                "y": int(row_stats[best_idx]["y"])
            }
        })

        log_info(
            f"Q{str(q_idx).zfill(2)} "
            f"| fills={[round(v, 2) for v in fill_ratios]} "
            f"| gain={[round(s['darkness_gain'], 1) for s in row_stats]} "
            f"| {status} -> {marked}"
        )

    return {
        "answers": answers,
        "debug_rows": debug_rows,
        "total_questions": total_questions
    }


# =========================================================
# DIRECT_GRADE (MANTIDO INTACTO)
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

    if len(ys) < 5:
        raise Exception("Bolhas insuficientes para o modo DIRECT_GRADE.")

    row_centers = sorted(np.percentile(ys, [30, 70]).tolist())

    grouped = {0: [], 1: []}
    for c in circles:
        idx = 0 if abs(c[1] - row_centers[0]) <= abs(c[1] - row_centers[1]) else 1
        grouped[idx].append(c)

    top_row = sorted(grouped[0], key=lambda c: c[0])[-11:]
    bottom_row = sorted(grouped[1], key=lambda c: c[0])[-10:]

    if len(top_row) < 11 or len(bottom_row) < 10:
        raise Exception("DIRECT_GRADE exige 11 bolhas na linha superior e 10 na inferior.")

    def score_circle(c):
        x, y, r = c
        return bubble_fill_score(gray, {"x": x, "y": y, "r": r}, search_radius=2)["score"]

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

def process_image(image_path, correction_type, layout_path=None):
    try:
        log_info("=" * 60)
        log_info(f"Iniciando leitura OMR | Modo={correction_type}")

        image = cv2.imread(image_path)
        if image is None:
            raise Exception("Não foi possível ler a imagem fornecida.")

        image = resize_keep_aspect(image, 1200) # Resize reduzido
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

        if correction_type == "BUBBLE_SHEET":
            layout = load_layout_json(layout_path)

            log_info(
                f"Layout OMR carregado | "
                f"questions={layout.get('totalQuestions')} | "
                f"columns={layout.get('columnCount')} | "
                f"version={layout.get('version')}"
            )

            log_info("Detectando âncoras na folha do aluno...")
            student_anchors = find_anchor_squares(gray)

            # Processamento direto após o Warp (ECC pesado foi totalmente removido)
            warped_student, _ = warp_using_layout_anchors(image, student_anchors, layout)

            log_info("Analisando preenchimento das respostas...")
            result = read_bubble_sheet(warped_student, layout)

            print(json.dumps({
                "success": True,
                "type": "BUBBLE_SHEET",
                "answers": result["answers"],
                "total_questions_detected": result["total_questions"],
                "debug": {
                    "layoutVersion": layout.get("version"),
                    "totalQuestions": layout.get("totalQuestions"),
                    "columnCount": layout.get("columnCount"),
                    "answerRegion": layout.get("answerRegion"),
                    "ecc_correlation": None, # Mantido nulo para retrocompatibilidade
                    "rows": result["debug_rows"]
                }
            }))
            return

        elif correction_type == "DIRECT_GRADE":
            gray = preprocess_gray(gray)
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
        image_path = sys.argv[1]
        correction_type = sys.argv[2]
        layout_path = sys.argv[3] if len(sys.argv) > 3 else None
        process_image(image_path, correction_type, layout_path)
    else:
        print(json.dumps({
            "success": False,
            "error": "Argumentos insuficientes. Uso: python script.py imagem.jpg MODO [layout.json]"
        }))