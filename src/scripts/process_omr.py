import sys
import cv2
import numpy as np
import json
import traceback
import math

# =========================================================
# LOG
# =========================================================

def log_info(msg):
    sys.stderr.write(f"[PYTHON INFO] {msg}\n")


# =========================================================
# UTILITÁRIOS
# =========================================================

def order_points(pts):
    """
    Ordena pontos em:
    top-left, top-right, bottom-right, bottom-left
    """
    pts = np.array(pts, dtype="float32")
    s = pts.sum(axis=1)
    diff = np.diff(pts, axis=1).reshape(-1)

    tl = pts[np.argmin(s)]
    br = pts[np.argmax(s)]
    tr = pts[np.argmin(diff)]
    bl = pts[np.argmax(diff)]

    return np.array([tl, tr, br, bl], dtype="float32")


def distance(p1, p2):
    return float(np.linalg.norm(np.array(p1) - np.array(p2)))


def ensure_odd(v):
    return v if v % 2 == 1 else v + 1


def kmeans_1d(values, k, attempts=20):
    """
    Clusterização 1D usando cv2.kmeans.
    Retorna centros ordenados.
    """
    if len(values) < k:
        raise ValueError(f"Valores insuficientes para clusterizar em {k} grupos.")

    Z = np.array(values, dtype=np.float32).reshape(-1, 1)
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 100, 0.2)
    compactness, labels, centers = cv2.kmeans(
        Z,
        k,
        None,
        criteria,
        attempts,
        cv2.KMEANS_PP_CENTERS
    )

    centers = centers.flatten()
    centers.sort()
    return centers.tolist()


def nearest_index(value, centers):
    distances = [abs(value - c) for c in centers]
    return int(np.argmin(distances))


def rect_center(rect):
    x, y, w, h = rect
    return (x + w / 2.0, y + h / 2.0)


def circle_mask(shape, center, radius):
    mask = np.zeros(shape[:2], dtype=np.uint8)
    cv2.circle(mask, center, int(radius), 255, -1)
    return mask


def annulus_mask(shape, center, inner_radius, outer_radius):
    mask = np.zeros(shape[:2], dtype=np.uint8)
    cv2.circle(mask, center, int(outer_radius), 255, -1)
    cv2.circle(mask, center, int(inner_radius), 0, -1)
    return mask


# =========================================================
# DETECÇÃO DAS ÂNCORAS
# =========================================================

def find_anchor_squares(gray):
    """
    Procura os 4 quadrados pretos de âncora.
    Estratégia:
    - threshold invertido
    - encontra contornos
    - filtra quadrados razoavelmente sólidos
    - pega os 4 melhores por área/solidez
    """
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    _, th = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    th = cv2.morphologyEx(th, cv2.MORPH_OPEN, kernel)

    contours, _ = cv2.findContours(th, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    h, w = gray.shape[:2]
    page_area = h * w
    candidates = []

    for c in contours:
        area = cv2.contourArea(c)
        if area < page_area * 0.00005 or area > page_area * 0.02:
            continue

        x, y, bw, bh = cv2.boundingRect(c)
        if bh == 0:
            continue

        ar = bw / float(bh)
        if not (0.75 <= ar <= 1.25):
            continue

        rect_area = bw * bh
        if rect_area == 0:
            continue

        extent = area / float(rect_area)
        if extent < 0.55:
            continue

        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, 0.06 * peri, True)

        # aceita 4-8 lados porque foto pode deformar
        if len(approx) < 4 or len(approx) > 8:
            continue

        candidates.append({
            "rect": (x, y, bw, bh),
            "area": area,
            "extent": extent,
            "cx": x + bw / 2.0,
            "cy": y + bh / 2.0,
            "contour": c
        })

    if len(candidates) < 4:
        raise Exception("Não foi possível encontrar as 4 âncoras pretas do cartão.")

    # Mantém os melhores candidatos por área/solidez
    candidates = sorted(
        candidates,
        key=lambda item: (item["area"] * item["extent"]),
        reverse=True
    )

    # pega mais alguns para montar melhor combinação
    pool = candidates[:12]

    # tenta achar combinação de 4 que melhor se distribui nos 4 cantos
    best = None
    best_score = None

    import itertools
    for combo in itertools.combinations(pool, 4):
        pts = np.array([[c["cx"], c["cy"]] for c in combo], dtype=np.float32)
        ordered = order_points(pts)

        tl, tr, br, bl = ordered
        width_top = distance(tl, tr)
        width_bottom = distance(bl, br)
        height_left = distance(tl, bl)
        height_right = distance(tr, br)

        if min(width_top, width_bottom, height_left, height_right) < 50:
            continue

        # score favorece retângulo grande e proporcional
        area_like = ((width_top + width_bottom) / 2.0) * ((height_left + height_right) / 2.0)
        ratio_penalty = abs(width_top - width_bottom) + abs(height_left - height_right)
        score = area_like - ratio_penalty * 20

        if best_score is None or score > best_score:
            best_score = score
            best = ordered

    if best is None:
        raise Exception("Falha ao validar geometricamente as 4 âncoras.")

    return best


def warp_by_anchors(image, anchor_points, output_size=(1000, 1400)):
    """
    Faz a correção de perspectiva usando as 4 âncoras.
    """
    W, H = output_size
    dst = np.array([
        [60, 60],
        [W - 60, 60],
        [W - 60, H - 60],
        [60, H - 60]
    ], dtype=np.float32)

    M = cv2.getPerspectiveTransform(anchor_points, dst)
    warped = cv2.warpPerspective(image, M, (W, H))

    return warped, M


# =========================================================
# LEITURA DAS BOLHAS
# =========================================================

def get_answer_roi(warped):
    """
    Recorta a região onde estão as alternativas.
    Esses limites foram definidos em cima do layout enviado.
    Como a folha já foi retificada, eles ficam estáveis.
    """
    H, W = warped.shape[:2]

    # Região da tabela de respostas no cartão enviado
    x1 = int(W * 0.66)
    x2 = int(W * 0.94)
    y1 = int(H * 0.26)
    y2 = int(H * 0.80)

    return warped[y1:y2, x1:x2].copy(), (x1, y1, x2, y2)


def detect_bubbles_in_roi(roi_gray):
    """
    Detecta círculos na ROI das respostas.
    Usa HoughCircles porque, após a correção de perspectiva,
    as bolhas ficam bem mais regulares.
    """
    blur = cv2.GaussianBlur(roi_gray, (7, 7), 1.2)
    h, w = roi_gray.shape[:2]

    circles = cv2.HoughCircles(
        blur,
        cv2.HOUGH_GRADIENT,
        dp=1.15,
        minDist=max(12, int(h / 25)),
        param1=120,
        param2=16,
        minRadius=max(6, int(min(h, w) * 0.015)),
        maxRadius=max(20, int(min(h, w) * 0.05))
    )

    if circles is None:
        return []

    circles = np.round(circles[0]).astype(int)

    # filtro fino
    filtered = []
    for (x, y, r) in circles:
        if x - r < 0 or y - r < 0 or x + r >= w or y + r >= h:
            continue
        if not (6 <= r <= 24):
            continue
        filtered.append((x, y, r))

    # remove duplicatas próximas
    unique = []
    for c in sorted(filtered, key=lambda item: item[2], reverse=True):
        x, y, r = c
        duplicated = False
        for ux, uy, ur in unique:
            if math.hypot(x - ux, y - uy) < max(r, ur) * 0.8:
                duplicated = True
                break
        if not duplicated:
            unique.append(c)

    return unique


def build_grid_from_detected_circles(circles, expected_rows=13, expected_cols=5):
    """
    Cria a grade 13x5 a partir dos círculos detectados.
    Clusteriza X em 5 colunas e Y em 13 linhas.
    """
    if len(circles) < 30:
        raise Exception(
            f"Círculos insuficientes detectados na área de respostas ({len(circles)}). "
            "A imagem está desfocada, escura ou a ROI não foi localizada corretamente."
        )

    xs = [c[0] for c in circles]
    ys = [c[1] for c in circles]
    rs = [c[2] for c in circles]

    col_centers = kmeans_1d(xs, expected_cols)
    row_centers = kmeans_1d(ys, expected_rows)
    avg_r = int(np.median(rs))

    tolerance_x = max(10, int(avg_r * 1.4))
    tolerance_y = max(10, int(avg_r * 1.4))

    # mapa de círculos atribuídos
    assigned = {}
    for (x, y, r) in circles:
        ci = nearest_index(x, col_centers)
        ri = nearest_index(y, row_centers)

        if abs(x - col_centers[ci]) <= tolerance_x and abs(y - row_centers[ri]) <= tolerance_y:
            key = (ri, ci)
            # se houver mais de um, fica o mais perto do centro esperado
            dist = abs(x - col_centers[ci]) + abs(y - row_centers[ri])
            if key not in assigned or dist < assigned[key]["dist"]:
                assigned[key] = {"x": x, "y": y, "r": r, "dist": dist}

    # gera grade final; se faltar algum círculo, usa posição esperada
    grid = []
    for ri, y in enumerate(row_centers):
        row = []
        for ci, x in enumerate(col_centers):
            key = (ri, ci)
            if key in assigned:
                row.append({
                    "x": int(assigned[key]["x"]),
                    "y": int(assigned[key]["y"]),
                    "r": int(assigned[key]["r"]),
                    "synthetic": False
                })
            else:
                row.append({
                    "x": int(round(x)),
                    "y": int(round(y)),
                    "r": avg_r,
                    "synthetic": True
                })
        grid.append(row)

    return grid, row_centers, col_centers, avg_r


def bubble_fill_score(gray, bubble):
    """
    Mede se a bolha está preenchida.

    Estratégia:
    - inner circle: centro da bolha
    - outer annulus: região ao redor da bolha
    - usa:
        1) diferença de intensidade (background - centro)
        2) proporção de pixels escuros no centro
    """
    x = int(bubble["x"])
    y = int(bubble["y"])
    r = int(bubble["r"])

    inner_r = max(3, int(r * 0.52))
    bg_inner = int(r * 1.15)
    bg_outer = int(r * 1.9)

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

    # threshold local usando média entre fundo e centro
    local_threshold = max(60, min(220, int((inner_mean + bg_mean) / 2.0)))

    inner_pixels = gray[inner_mask == 255]
    if len(inner_pixels) == 0:
        fill_ratio = 0.0
    else:
        fill_ratio = float(np.mean(inner_pixels < local_threshold))

    darkness_gain = float(bg_mean - inner_mean)

    # score combinado
    score = darkness_gain + (fill_ratio * 90.0)

    return {
        "score": score,
        "fill_ratio": fill_ratio,
        "inner_mean": inner_mean,
        "bg_mean": bg_mean
    }


def read_bubble_sheet_answers(warped_bgr):
    """
    Fluxo principal do cartão de respostas.
    """
    warped_gray = cv2.cvtColor(warped_bgr, cv2.COLOR_BGR2GRAY)
    roi, (x1, y1, x2, y2) = get_answer_roi(warped_gray)

    circles = detect_bubbles_in_roi(roi)
    log_info(f"Círculos detectados na ROI: {len(circles)}")

    grid, row_centers, col_centers, avg_r = build_grid_from_detected_circles(circles, 13, 5)

    options_labels = ["A", "B", "C", "D", "E"]
    answers = []
    debug_rows = []

    for q_idx, row in enumerate(grid, start=1):
        stats = []
        for ci, bubble in enumerate(row):
            st = bubble_fill_score(roi, bubble)
            stats.append(st)

        scores = [s["score"] for s in stats]
        fill_ratios = [s["fill_ratio"] for s in stats]

        best_idx = int(np.argmax(scores))
        sorted_scores = sorted(scores, reverse=True)
        best_score = sorted_scores[0]
        second_score = sorted_scores[1] if len(sorted_scores) > 1 else -9999.0
        best_fill = fill_ratios[best_idx]

        # thresholds ajustados para esse tipo de cartão
        # branco: score baixo e fill_ratio muito baixo
        is_blank = (best_score < 18 and best_fill < 0.18)

        # múltipla/ambígua: duas muito parecidas e ambas relativamente fortes
        is_ambiguous = (
            not is_blank and
            (best_score - second_score) < 10 and
            best_fill > 0.18
        )

        if is_blank:
            marked = None
            status = "BLANK"
        elif is_ambiguous:
            marked = None
            status = "AMBIGUOUS"
        else:
            marked = options_labels[best_idx]
            status = "MARKED"

        answers.append({
            "question": q_idx,
            "marked": marked
        })

        debug_rows.append({
            "question": q_idx,
            "scores": [round(v, 2) for v in scores],
            "fill_ratios": [round(v, 3) for v in fill_ratios],
            "status": status,
            "marked": marked
        })

        log_info(
            f"Q{str(q_idx).zfill(2)} | "
            f"scores={[round(v, 1) for v in scores]} | "
            f"fills={[round(v, 2) for v in fill_ratios]} | "
            f"{status} -> {marked}"
        )

    return {
        "answers": answers,
        "debug_rows": debug_rows,
        "circles_detected": len(circles),
        "avg_radius": avg_r,
        "roi": {"x1": x1, "y1": y1, "x2": x2, "y2": y2}
    }


# =========================================================
# FLUXO GABARITO ANTIGO (mantido, mas melhorado)
# =========================================================

def detect_direct_grade(gray):
    """
    Mantive um fluxo separado para DIRECT_GRADE,
    mas com leitura mais limpa do que a atual.
    """
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

    top_row = sorted(grouped[0], key=lambda c: c[0])
    bottom_row = sorted(grouped[1], key=lambda c: c[0])

    if len(top_row) < 11 or len(bottom_row) < 10:
        raise Exception("O formato DIRECT_GRADE exige 11 bolhas na linha superior e 10 na inferior.")

    top_row = top_row[-11:]
    bottom_row = bottom_row[-10:]

    def get_score(c):
        x, y, r = c
        bubble = {"x": x, "y": y, "r": r}
        return bubble_fill_score(gray, bubble)["score"]

    top_scores = [get_score(c) for c in top_row]
    bottom_scores = [get_score(c) for c in bottom_row]

    inteiro_val = int(np.argmax(top_scores))
    decimal_val = int(np.argmax(bottom_scores))
    final_grade = float(f"{inteiro_val}.{decimal_val}")

    return {
        "grade": final_grade,
        "top_scores": [round(v, 2) for v in top_scores],
        "bottom_scores": [round(v, 2) for v in bottom_scores]
    }


# =========================================================
# PROCESSAMENTO PRINCIPAL
# =========================================================

def process_image(image_path, correction_type):
    try:
        log_info("=" * 60)
        log_info(f"Iniciando processamento OMR | modo={correction_type}")

        image = cv2.imread(image_path)
        if image is None:
            raise Exception("Não foi possível ler a imagem fornecida.")

        # padroniza tamanho base
        h, w = image.shape[:2]
        target_w = 1600
        scale = target_w / float(w)
        image = cv2.resize(image, (target_w, int(h * scale)))

        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

        if correction_type == "BUBBLE_SHEET":
            anchors = find_anchor_squares(gray)
            log_info(f"Âncoras localizadas: {anchors.tolist()}")

            warped, _ = warp_by_anchors(image, anchors, output_size=(1000, 1400))
            result = read_bubble_sheet_answers(warped)

            print(json.dumps({
                "success": True,
                "type": "BUBBLE_SHEET",
                "answers": result["answers"],
                "total_questions_detected": len(result["answers"]),
                "debug": {
                    "circles_detected": result["circles_detected"],
                    "avg_radius": result["avg_radius"],
                    "roi": result["roi"],
                    "rows": result["debug_rows"]
                }
            }))
            return

        elif correction_type == "DIRECT_GRADE":
            grade_result = detect_direct_grade(gray)

            print(json.dumps({
                "success": True,
                "type": "DIRECT_GRADE",
                "grade": grade_result["grade"],
                "debug": {
                    "top_scores": grade_result["top_scores"],
                    "bottom_scores": grade_result["bottom_scores"]
                }
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