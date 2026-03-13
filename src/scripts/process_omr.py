import sys
import cv2
import numpy as np
import json
import traceback

def log_info(msg):
    sys.stderr.write(f"[PYTHON INFO] {msg}\n")

def order_points(pts):
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]
    rect[3] = pts[np.argmax(diff)]
    return rect

def four_point_transform(image, pts):
    rect = order_points(pts)
    (tl, tr, br, bl) = rect
    
    widthA = np.sqrt(((br[0] - bl[0]) ** 2) + ((br[1] - bl[1]) ** 2))
    widthB = np.sqrt(((tr[0] - tl[0]) ** 2) + ((tr[1] - tl[1]) ** 2))
    maxWidth = max(int(widthA), int(widthB))
    
    heightA = np.sqrt(((tr[0] - br[0]) ** 2) + ((tr[1] - br[1]) ** 2))
    heightB = np.sqrt(((tl[0] - bl[0]) ** 2) + ((tl[1] - bl[1]) ** 2))
    maxHeight = max(int(heightA), int(heightB))
    
    dst = np.array([
        [0, 0],
        [maxWidth - 1, 0],
        [maxWidth - 1, maxHeight - 1],
        [0, maxHeight - 1]], dtype="float32")
    
    M = cv2.getPerspectiveTransform(rect, dst)
    return cv2.warpPerspective(image, M, (maxWidth, maxHeight))

def process_image(image_path, correction_type):
    try:
        log_info("="*50)
        log_info(f"Iniciando leitura extrema - Modo: {correction_type}")
        
        image = cv2.imread(image_path)
        if image is None:
            raise Exception("Não foi possível ler a imagem fornecida.")
        
        h, w = image.shape[:2]

        if correction_type == 'DIRECT_GRADE' and h > w:
            image = cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE)
        elif correction_type == 'BUBBLE_SHEET' and w > h:
            image = cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE)

        # Adiciona borda branca GIGANTE para garantir que as âncoras não fiquem presas na borda da foto
        image = cv2.copyMakeBorder(image, 60, 60, 60, 60, cv2.BORDER_CONSTANT, value=(255, 255, 255))

        new_w = 1200 
        new_h = int((new_w / image.shape[1]) * image.shape[0])
        image = cv2.resize(image, (new_w, new_h))

        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        
        # Binarização mais agressiva
        thresh = cv2.adaptiveThreshold(blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 51, 15)
        
        kernel_dilate = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
        thresh = cv2.dilate(thresh, kernel_dilate, iterations=1)

        # ====================================================================
        # PASSO 1: ENCONTRAR AS 4 ÂNCORAS PRETAS E CORTAR O LIXO
        # ====================================================================
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        anchors = []

        for c in contours:
            area = cv2.contourArea(c)
            # Âncoras são visivelmente os maiores quadrados sólidos do papel
            if area < 500 or area > 25000: 
                continue
                
            peri = cv2.arcLength(c, True)
            approx = cv2.approxPolyDP(c, 0.05 * peri, True) # 0.05 é bem tolerante a cantos arredondados
            
            if len(approx) >= 4:
                (x, y, w_box, h_box) = cv2.boundingRect(approx)
                ar = w_box / float(h_box)
                if 0.6 <= ar <= 1.4: # É "quadrado"
                    M = cv2.moments(c)
                    if M["m00"] != 0:
                        cX = int(M["m10"] / M["m00"])
                        cY = int(M["m01"] / M["m00"])
                        anchors.append([cX, cY])

        # Se achar mais de 4, pega as 4 maiores áreas (evita confundir com o QR code)
        if len(anchors) >= 4:
            # Organiza os pontos para pegar os extremos da imagem
            pts = np.array(anchors, dtype="float32")
            rect = order_points(pts)
            log_info("4 Âncoras perfeitamente localizadas. Recortando imagem pela matriz.")
            
            # Corta a imagem EXATAMENTE nos pontos das âncoras
            warped_gray = four_point_transform(gray, rect)
            
            # Adiciona uma borda branca de segurança ao redor do novo recorte
            warped_gray = cv2.copyMakeBorder(warped_gray, 30, 30, 30, 30, cv2.BORDER_CONSTANT, value=(255, 255, 255))
            
            gray = warped_gray
            h, w = gray.shape[:2]
            
            # Refaz a binarização na imagem limpa
            blurred = cv2.GaussianBlur(gray, (5, 5), 0)
            thresh = cv2.adaptiveThreshold(blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 51, 15)
        else:
            raise Exception(f"Achei {len(anchors)} âncoras. Preciso das 4. O papel pode estar muito amassado ou cortado na foto.")

        # ====================================================================
        # PASSO 2: ENCONTRAR AS BOLINHAS COM TOLERÂNCIA MÁXIMA
        # ====================================================================
        contours, _ = cv2.findContours(thresh, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        
        candidates = []
        for c in contours:
            (x, y, w_box, h_box) = cv2.boundingRect(c)
            ar = w_box / float(h_box)
            
            # Aceita literalmente qualquer coisa que caiba num quadrado proporcional e seja pequeno (bolinhas)
            if 0.5 <= ar <= 1.5 and 15 <= w_box <= 80:
                area = cv2.contourArea(c)
                peri = cv2.arcLength(c, True)
                if peri == 0: continue
                
                # Circularidade quase zero (aceita borrões e letras)
                circularity = 4 * np.pi * (area / (peri * peri))
                if circularity > 0.15: 
                    candidates.append({
                        'cx': x + w_box // 2, 'cy': y + h_box // 2,
                        'w': w_box, 'h': h_box, 'c': c, 'area': area
                    })

        if not candidates:
             raise Exception("Nenhuma alternativa identificada no cartão. Está muito longe ou sem foco.")

        # Filtra os candidatos baseados na mediana de tamanho (ignora textos finos)
        areas = [cand['area'] for cand in candidates]
        median_area = np.median(areas)
        filtered_bubbles = [c for c in candidates if (median_area * 0.3) <= c['area'] <= (median_area * 3.0)]

        # Remove sobreposições
        unique_bubbles = []
        for cand in filtered_bubbles:
            if not any(abs(cand['cx'] - ub['cx']) < 15 and abs(cand['cy'] - ub['cy']) < 15 for ub in unique_bubbles):
                unique_bubbles.append(cand)

        log_info(f"Bolinhas validadas na folha: {len(unique_bubbles)}")

        def analyze_bubble_intensity(bubble):
            mask = np.zeros(gray.shape, dtype="uint8")
            radius = int(min(bubble['w'], bubble['h']) * 0.40)
            cv2.circle(mask, (bubble['cx'], bubble['cy']), radius, 255, -1)
            mean_val = cv2.mean(gray, mask=mask)[0]
            return 255 - mean_val 

        # ====================================================================
        # FLUXO A: GABARITO ANTIGO (NOTA DIRETA)
        # ====================================================================
        if correction_type == 'DIRECT_GRADE':
            unique_bubbles = sorted(unique_bubbles, key=lambda b: b['cy'])
            rows = []
            current_row = []
            for b in unique_bubbles:
                if not current_row:
                    current_row.append(b)
                else:
                    if abs(b['cy'] - current_row[0]['cy']) < (b['h'] * 0.8):
                        current_row.append(b)
                    else:
                        rows.append(sorted(current_row, key=lambda i: i['cx']))
                        current_row = [b]
            if current_row:
                rows.append(sorted(current_row, key=lambda i: i['cx']))

            valid_rows = [r for r in rows if len(r) >= 9]
            if len(valid_rows) < 2:
                raise Exception("Não encontrei as 2 fileiras do gabarito antigo.")

            valid_rows = sorted(valid_rows, key=lambda r: r[0]['cy']) 
            top_row = sorted(valid_rows[0], key=lambda b: b['cx'])[-11:]
            bottom_row = sorted(valid_rows[1], key=lambda b: b['cx'])[-10:]

            def get_darkest(row, row_name=""):
                max_darkness = -1
                idx = 0
                intensities = []
                for i, b in enumerate(row):
                    darkness = analyze_bubble_intensity(b)
                    intensities.append(int(darkness))
                    if darkness > max_darkness:
                        max_darkness = darkness
                        idx = i
                log_info(f"[{row_name}] Escuridão: {intensities} -> Marcou: {idx}")
                return idx

            inteiro_val = get_darkest(top_row, "Inteiros")
            decimal_val = get_darkest(bottom_row, "Decimais")
            final_grade = float(f"{inteiro_val}.{decimal_val}")

            print(json.dumps({"success": True, "type": "DIRECT_GRADE", "grade": final_grade}))
            return

        # ====================================================================
        # FLUXO B: CARTÃO RESPOSTA (BUBBLE SHEET)
        # ====================================================================
        elif correction_type == 'BUBBLE_SHEET':
            # 1. Agrupa por linhas aproximadas (Eixo Y)
            unique_bubbles = sorted(unique_bubbles, key=lambda b: b['cy'])
            rows = []
            current_row = []
            for b in unique_bubbles:
                if not current_row:
                    current_row.append(b)
                else:
                    if abs(b['cy'] - current_row[0]['cy']) < (b['h'] * 1.5): # Mais tolerância vertical
                        current_row.append(b)
                    else:
                        rows.append(sorted(current_row, key=lambda i: i['cx']))
                        current_row = [b]
            if current_row:
                rows.append(sorted(current_row, key=lambda i: i['cx']))

            # 2. Divide cada linha em blocos de questões (Eixo X)
            blocks = []
            for row in rows:
                if len(row) < 3: continue 
                
                curr_block = [row[0]]
                for i in range(1, len(row)):
                    gap = row[i]['cx'] - row[i-1]['cx']
                    if gap < row[0]['w'] * 3.5: # Estão na mesma questão
                        curr_block.append(row[i])
                    else: 
                        # Pulou de coluna. Salva o bloco se for válido
                        if 4 <= len(curr_block) <= 6:
                            blocks.append(curr_block)
                        curr_block = [row[i]]
                
                if 4 <= len(curr_block) <= 6:
                    blocks.append(curr_block)

            log_info(f"Questões isoladas pela IA: {len(blocks)}")
            if not blocks:
                raise Exception("A IA não conseguiu separar as letras A, B, C, D. Tire a foto mais plana.")

            # 3. Organiza os blocos em colunas e depois por linha
            column_centroids = []
            for b in blocks:
                avg_cx = np.mean([bubble['cx'] for bubble in b])
                matched = False
                for col in column_centroids:
                    if abs(avg_cx - col['avg_cx']) < 250: # Tolerância Larga para colunas
                        col['blocks'].append(b)
                        col['avg_cx'] = np.mean([np.mean([bub['cx'] for bub in blk]) for blk in col['blocks']])
                        matched = True
                        break
                if not matched:
                    column_centroids.append({'avg_cx': avg_cx, 'blocks': [b]})
            
            column_centroids = sorted(column_centroids, key=lambda c: c['avg_cx'])
            
            ordered_blocks = []
            for col_idx, col in enumerate(column_centroids):
                sorted_blocks = sorted(col['blocks'], key=lambda b: np.mean([bub['cy'] for bub in b]))
                ordered_blocks.extend(sorted_blocks)
                log_info(f"Coluna {col_idx + 1} possui {len(sorted_blocks)} questões válidas.")

            answers = []
            options_labels = ['A', 'B', 'C', 'D', 'E']
            
            # 4. Leitura Final e Trava de Bolinha em Branco
            for i, block in enumerate(ordered_blocks):
                # Garante que A,B,C estão da esquerda pra direita dentro do bloco
                block = sorted(block, key=lambda b: b['cx']) 
                
                darkness_list = [analyze_bubble_intensity(b) for b in block]
                max_idx = np.argmax(darkness_list)
                max_darkness = darkness_list[max_idx]
                min_darkness = np.min(darkness_list)
                
                # Se a bolinha mais escura não tiver pelo menos 20 pontos de diferença
                # para a bolinha mais clara, significa que o aluno não pintou forte o suficiente (ou deixou em branco)
                if (max_darkness - min_darkness) < 20:
                    marked = None
                    status_log = "EM BRANCO"
                else:
                    marked = options_labels[max_idx] if max_idx < len(options_labels) else None
                    status_log = f"Marcou {marked}"
                    
                log_info(f"Q{str(i+1).zfill(2)} | Escuridão lida: {[int(d) for d in darkness_list]} -> {status_log}")

                answers.append({"question": i + 1, "marked": marked})

            print(json.dumps({
                "success": True,
                "type": "BUBBLE_SHEET",
                "answers": answers,
                "total_questions_detected": len(answers)
            }))
            return

        else:
            raise Exception(f"Modo desconhecido: {correction_type}")

    except Exception as e:
        log_info(f"FALHA FATAL: {str(e)}")
        print(json.dumps({"success": False, "error": str(e), "trace": traceback.format_exc()}))

if __name__ == "__main__":
    if len(sys.argv) > 2:
        process_image(sys.argv[1], sys.argv[2])
    else:
        print(json.dumps({"success": False, "error": "Argumentos insuficientes."}))