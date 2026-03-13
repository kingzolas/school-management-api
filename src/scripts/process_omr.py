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


def resize_keep_aspect(image, target_w=1600):
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
# TEMPLATE SINTÉTICO A PARTIR DO LAYOUT
# =========================================================

def build_synthetic_template_from_layout(layout):
    """
    Cria um template sintético canônico, só para ajudar no ECC/alinhamento fino.
    Não depende de PNG salvo em disco.
    """
    cw = safe_int(layout.get("canonicalWidth", CANONICAL_W), CANONICAL_W)
    ch = safe_int(layout.get("canonicalHeight", CANONICAL_H), CANONICAL_H)

    canvas = np.full((ch, cw), 255, dtype=np.uint8)

    # desenha âncoras
    anchors = layout.get("anchors", {})
    for key in ["topLeft", "topRight", "bottomRight", "bottomLeft"]:
        if key in anchors:
            x = safe_int(anchors[key]["x"])
            y = safe_int(anchors[key]["y"])
            size = 12
            x1 = max(0, x - size // 2)
            y1 = max(0, y - size // 2)
            x2 = min(cw, x1 + size)
            y2 = min(ch, y1 + size)
            canvas[y1:y2, x1:x2] = 0

    # registradores centrais
    center_registers = layout.get("centerRegisters", {})
    for key in ["top", "bottom"]:
        if key in center_registers:
            x = safe_int(center_registers[key]["x"])
            y = safe_int(center_registers[key]["y"])
            cv2.rectangle(canvas, (x - 5, y - 1), (x + 5, y + 1), 120, -1)

    # área geral das respostas
    answer_region = layout.get("answerRegion")
    if answer_region:
        x1 = safe_int(answer_region.get("x1"))
        y1 = safe_int(answer_region.get("y1"))
        x2 = safe_int(answer_region.get("x2"))
        y2 = safe_int(answer_region.get("y2"))
        cv2.rectangle(canvas, (x1, y1), (x2, y2), 210, 1)

    # guias de linha
    for row in layout.get("rowGuides", []):
        left_tick = row.get("leftTick")
        right_tick = row.get("rightTick")

        if left_tick:
            cv2.line(
                canvas,
                (safe_int(left_tick["x1"]), safe_int(left_tick["y"])),
                (safe_int(left_tick["x2"]), safe_int(left_tick["y"])),
                150,
                1
            )

        if right_tick:
            cv2.line(
                canvas,
                (safe_int(right_tick["x1"]), safe_int(right_tick["y"])),
                (safe_int(right_tick["x2"]), safe_int(right_tick["y"])),
                150,
                1
            )

    # marcadores de opção
    for option_guide in layout.get("optionGuides", []):
        top_marker = option_guide.get("topMarker")
        bottom_marker = option_guide.get("bottomMarker")

        if top_marker:
            x = safe_int(top_marker["x"])
            y = safe_int(top_marker["y"])
            cv2.circle(canvas, (x, y), 1, 150, -1)

        if bottom_marker:
            x = safe_int(bottom_marker["x"])
            y = safe_int(bottom_marker["y"])
            cv2.circle(canvas, (x, y), 1, 150, -1)

    # bolhas vazias
    for bubble in layout.get("bubbles", []):
        x = safe_int(bubble["x"])
        y = safe_int(bubble["y"])
        r = max(4, safe_int(bubble.get("r", 11)))
        cv2.circle(canvas, (x, y), r, 0, 1)

    return preprocess_gray(canvas)


def refine_alignment_with_synthetic_template(student_bgr, synthetic_template_gray, layout):
    student_gray = cv2.cvtColor(student_bgr, cv2.COLOR_BGR2GRAY)
    student_gray = preprocess_gray(student_gray)

    warp_mode = cv2.MOTION_AFFINE
    warp_matrix = np.eye(2, 3, dtype=np.float32)

    criteria = (
        cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT,
        60,
        1e-5
    )

    cw = safe_int(layout.get("canonicalWidth", CANONICAL_W), CANONICAL_W)
    ch = safe_int(layout.get("canonicalHeight", CANONICAL_H), CANONICAL_H)

    try:
        cc, warp_matrix = cv2.findTransformECC(
            synthetic_template_gray,
            student_gray,
            warp_matrix,
            warp_mode,
            criteria,
            None,
            1
        )

        refined = cv2.warpAffine(
            student_bgr,
            warp_matrix,
            (cw, ch),
            flags=cv2.INTER_LINEAR + cv2.WARP_INVERSE_MAP,
            borderMode=cv2.BORDER_REPLICATE
        )
        log_info(f"ECC refinement OK | cc={round(float(cc), 6)}")
        return refined, float(cc)
    except Exception as e:
        log_info(f"ECC refinement falhou, seguindo só com warp por âncoras: {str(e)}")
        return student_bgr, None


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
    """
    Mede preenchimento local de uma bolha.
    search_radius tenta compensar pequenos desalinhamentos residuais.
    """
    base_x = int(bubble["x"])
    base_y = int(bubble["y"])
    r = int(bubble["r"])

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

            # score base
            score = darkness_gain + (fill_ratio * 100.0)

            candidate = {
                "score": score,
                "fill_ratio": fill_ratio,
                "inner_mean": inner_mean,
                "bg_mean": bg_mean,
                "x": x,
                "y": y
            }

            if best is None or candidate["score"] > best["score"]:
                best = candidate

    if best is None:
        return {
            "score": -9999.0,
            "fill_ratio": 0.0,
            "inner_mean": 255.0,
            "bg_mean": 255.0,
            "x": base_x,
            "y": base_y
        }

    return best


def read_bubble_sheet(warped_bgr, layout):
    """
    Leitura baseada no layout geométrico salvo no banco.
    Não depende mais de template PNG em arquivo.
    """
    student_gray = cv2.cvtColor(warped_bgr, cv2.COLOR_BGR2GRAY)
    student_gray = preprocess_gray(student_gray)

    question_grid = build_question_grid_from_layout(layout)
    total_questions = len(question_grid)

    answers = []
    debug_rows = []

    for q_idx, row in enumerate(question_grid, start=1):
        row_stats = [bubble_fill_score(student_gray, bubble, search_radius=2) for bubble in row]

        raw_scores = [s["score"] for s in row_stats]
        fill_ratios = [s["fill_ratio"] for s in row_stats]

        # normalização por linha
        min_score = min(raw_scores)
        adjusted_scores = [s - min_score for s in raw_scores]

        best_idx = int(np.argmax(adjusted_scores))
        best_score = adjusted_scores[best_idx]
        best_fill = fill_ratios[best_idx]

        sorted_scores = sorted(adjusted_scores, reverse=True)
        second_score = sorted_scores[1] if len(sorted_scores) > 1 else -9999.0

        # Critérios
        # branco: nenhuma bolha se destacou de forma real
        is_blank = (best_score < 12 and best_fill < 0.18)

        # ambígua: duas bolhas muito próximas e fortes
        strong_count = sum(
            1 for s, f in zip(adjusted_scores, fill_ratios)
            if s > 10 and f > 0.16
        )
        is_ambiguous = (
            not is_blank and
            strong_count >= 2 and
            (best_score - second_score) < 7
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
            f"| raw={[round(v, 1) for v in raw_scores]} "
            f"| adjusted={[round(v, 1) for v in adjusted_scores]} "
            f"| fills={[round(v, 2) for v in fill_ratios]} "
            f"| {status} -> {marked}"
        )

    return {
        "answers": answers,
        "debug_rows": debug_rows,
        "total_questions": total_questions
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

    # clusterização simplificada em duas linhas
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

        image = resize_keep_aspect(image, 1600)
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

            warped_student, _ = warp_using_layout_anchors(image, student_anchors, layout)

            log_info("Construindo template sintético do layout...")
            synthetic_template = build_synthetic_template_from_layout(layout)

            log_info("Refinando alinhamento contra template sintético...")
            warped_student, ecc_cc = refine_alignment_with_synthetic_template(
                warped_student,
                synthetic_template,
                layout
            )

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
                    "ecc_correlation": round(ecc_cc, 6) if ecc_cc is not None else None,
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