import sys
import cv2
import numpy as np
import json
import traceback

# Helper para os logs não sujarem o JSON final
def log_info(msg):
    sys.stderr.write(f"[PYTHON INFO] {msg}\n")

# Função para ordenar coordenadas (Top-Left, Top-Right, Bottom-Right, Bottom-Left)
def order_points(pts):
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]
    rect[3] = pts[np.argmax(diff)]
    return rect

# Função para aplicar a transformação de perspectiva (Deixa a folha 100% reta)
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
    warped = cv2.warpPerspective(image, M, (maxWidth, maxHeight))
    return warped

def process_image(image_path, correction_type):
    try:
        log_info(f"Iniciando leitura: {image_path} no modo {correction_type}")
        
        image = cv2.imread(image_path)
        if image is None:
            raise Exception("Não foi possível ler a imagem fornecida.")
        
        h, w = image.shape[:2]

        if h > w:
            image = cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE)
            log_info("Imagem rotacionada 90 graus (estava em modo retrato).")

        # Redimensionamento
        new_w = 1200 
        new_h = int((new_w / w) * image.shape[0])
        image = cv2.resize(image, (new_w, new_h))

        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        
        # Binarização forte
        thresh = cv2.adaptiveThreshold(blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 51, 15)

        # ====================================================================
        # PASSO 1: ENCONTRAR AS 4 ÂNCORAS PRETAS E ALINHAR A FOLHA
        # ====================================================================
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        anchors = []

        for c in contours:
            area = cv2.contourArea(c)
            if area < 300 or area > 5000: # Filtra ruídos minúsculos ou bordas gigantes
                continue
                
            peri = cv2.arcLength(c, True)
            approx = cv2.approxPolyDP(c, 0.04 * peri, True)
            
            # Se tiver 4 cantos e for quadrado, é uma âncora
            if len(approx) == 4:
                (x, y, w_box, h_box) = cv2.boundingRect(approx)
                ar = w_box / float(h_box)
                if 0.8 <= ar <= 1.2:
                    M = cv2.moments(c)
                    if M["m00"] != 0:
                        cX = int(M["m10"] / M["m00"])
                        cY = int(M["m01"] / M["m00"])
                        anchors.append([cX, cY])

        if len(anchors) >= 4:
            log_info(f"Encontradas {len(anchors)} âncoras. Realizando alinhamento de perspectiva...")
            # Pega as 4 maiores áreas se achar mais de 4 (ex: se achou um quadrado de QR code)
            pts = np.array(anchors[:4], dtype="float32")
            warped_gray = four_point_transform(gray, pts)
            
            # Refaz o threshold na imagem já cortada e alinhada
            blurred = cv2.GaussianBlur(warped_gray, (5, 5), 0)
            thresh = cv2.adaptiveThreshold(blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 51, 15)
            # Reatribui para o resto do script continuar normalmente
            gray = warped_gray
            h, w = gray.shape[:2]
        else:
            log_info(f"AVISO: Encontrou apenas {len(anchors)} âncoras. Tentando ler sem alinhamento...")

        # ====================================================================
        # PASSO 2: ENCONTRAR AS BOLINHAS 
        # ====================================================================
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)

        contours, _ = cv2.findContours(thresh, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        candidates = []
        
        for c in contours:
            (x, y, w_box, h_box) = cv2.boundingRect(c)
            ar = w_box / float(h_box)
            
            # Gabaritos podem distorcer um pouco, mas a bolinha sempre é redonda
            if 0.70 <= ar <= 1.30 and w_box >= 12:
                area = cv2.contourArea(c)
                peri = cv2.arcLength(c, True)
                if peri == 0: continue
                circularity = 4 * np.pi * (area / (peri * peri))
                
                if circularity > 0.65:
                    candidates.append({
                        'cx': x + w_box // 2, 'cy': y + h_box // 2,
                        'w': w_box, 'h': h_box, 'c': c, 'area': area
                    })

        if not candidates:
             raise Exception("Nenhum círculo encontrado. O ambiente pode estar muito escuro ou a folha cortada.")

        # Filtra lixo via Mediana de tamanho (Ignora letras, textos, QR codes pequenos)
        areas = [cand['area'] for cand in candidates]
        median_area = np.median(areas)
        
        filtered_bubbles = [c for c in candidates if (median_area * 0.5) <= c['area'] <= (median_area * 1.8)]

        # Tira bolinhas duplicadas (mesmo X e Y)
        unique_bubbles = []
        for cand in filtered_bubbles:
            if not any(abs(cand['cx'] - ub['cx']) < 10 and abs(cand['cy'] - ub['cy']) < 10 for ub in unique_bubbles):
                unique_bubbles.append(cand)

        log_info(f"Total de bolinhas candidatas identificadas: {len(unique_bubbles)}")

        # Agrupa em linhas horizontais
        unique_bubbles = sorted(unique_bubbles, key=lambda b: b['cy'])
        rows = []
        current_row = []
        for b in unique_bubbles:
            if not current_row:
                current_row.append(b)
            else:
                if abs(b['cy'] - current_row[0]['cy']) < (b['h'] * 0.7):
                    current_row.append(b)
                else:
                    rows.append(sorted(current_row, key=lambda i: i['cx']))
                    current_row = [b]
        if current_row:
            rows.append(sorted(current_row, key=lambda i: i['cx']))

        # FUNÇÃO MATADORA DE LEITURA
        def analyze_bubble_intensity(bubble):
            mask = np.zeros(gray.shape, dtype="uint8")
            # Corta um círculo ligeiramente menor que a bolinha para não ler a borda preta impressa
            radius = int(min(bubble['w'], bubble['h']) * 0.35)
            cv2.circle(mask, (bubble['cx'], bubble['cy']), radius, 255, -1)
            mean_val = cv2.mean(gray, mask=mask)[0]
            # Retorna a intensidade onde 0 é BRANCO e 255 é PRETO (Invertido para ser mais lógico: Maior = Mais escuro)
            return 255 - mean_val 

        # ====================================================================
        # FLUXO A: GABARITO ANTIGO (NOTA DIRETA)
        # ====================================================================
        if correction_type == 'DIRECT_GRADE':
            valid_rows = [r for r in rows if len(r) >= 9]
            if len(valid_rows) < 2:
                raise Exception("Erro: Não encontrei as 2 fileiras de bolinhas para lançar a nota manual.")

            top_row = valid_rows[0][-11:]
            bottom_row = valid_rows[1][-10:]

            def get_darkest(row):
                max_darkness = -1
                idx = 0
                for i, b in enumerate(row):
                    darkness = analyze_bubble_intensity(b)
                    log_info(f"Lendo Bolinha [{i}]: Escuridão={darkness:.1f}")
                    if darkness > max_darkness:
                        max_darkness = darkness
                        idx = i
                return idx

            log_info("Analisando Inteiro (Linha de Cima):")
            inteiro_val = get_darkest(top_row)
            log_info("Analisando Decimal (Linha de Baixo):")
            decimal_val = get_darkest(bottom_row)
            
            final_grade = float(f"{inteiro_val}.{decimal_val}")

            print(json.dumps({
                "success": True, 
                "type": "DIRECT_GRADE",
                "grade": final_grade
            }))
            return

        # ====================================================================
        # FLUXO B: NOVO CARTÃO RESPOSTA (BUBBLE SHEET)
        # ====================================================================
        elif correction_type == 'BUBBLE_SHEET':
            # Isola os blocos de questões (Se a linha tiver uma falha e tiver 4, aceita também)
            blocks = []
            for row in rows:
                if not row: continue
                curr_block = [row[0]]
                for i in range(1, len(row)):
                    # Se tiver muito longe, é o bloco da coluna da direita
                    if (row[i]['cx'] - row[i-1]['cx']) < row[0]['w'] * 3.5:
                        curr_block.append(row[i])
                    else:
                        if len(curr_block) >= 4:
                            blocks.append(curr_block)
                        curr_block = [row[i]]
                if len(curr_block) >= 4:
                    blocks.append(curr_block)

            if not blocks:
                raise Exception("Nenhum bloco de alternativas (A, B, C...) encontrado.")

            question_blocks = [b for b in blocks if 4 <= len(b) <= 6]
            log_info(f"Identificadas {len(question_blocks)} questões no papel.")
            
            # Organiza as colunas (Esquerda e Direita)
            column_centroids = []
            for b in question_blocks:
                avg_cx = np.mean([bubble['cx'] for bubble in b])
                matched = False
                for col in column_centroids:
                    if abs(avg_cx - col['avg_cx']) < 150:
                        col['blocks'].append(b)
                        col['avg_cx'] = np.mean([np.mean([bub['cx'] for bub in blk]) for blk in col['blocks']])
                        matched = True
                        break
                if not matched:
                    column_centroids.append({'avg_cx': avg_cx, 'blocks': [b]})
            
            column_centroids = sorted(column_centroids, key=lambda c: c['avg_cx'])
            ordered_blocks = []
            for col in column_centroids:
                sorted_blocks = sorted(col['blocks'], key=lambda b: np.mean([bub['cy'] for bub in b]))
                ordered_blocks.extend(sorted_blocks)

            answers = []
            options_labels = ['A', 'B', 'C', 'D', 'E']
            
            for i, block in enumerate(ordered_blocks):
                block = sorted(block, key=lambda b: b['cx'])
                
                darkness_list = [analyze_bubble_intensity(b) for b in block]
                max_darkness_idx = np.argmax(darkness_list)
                max_darkness = darkness_list[max_darkness_idx]
                
                # Regra do "Em Branco":
                # Se a bolinha "mais pintada" for quase tão branca quanto a bolinha mais branca da linha, está em branco.
                min_darkness = np.min(darkness_list)
                
                log_info(f"Questão {i+1}: {options_labels[:len(block)]} -> Escuridão: {[int(d) for d in darkness_list]}")

                # Threshold de segurança: Diferença entre a bolinha marcada e as limpas tem que ser clara
                if (max_darkness - min_darkness) < 20:
                    log_info(f"--> Questão {i+1}: NADA MARCADO")
                    marked = None
                else:
                    marked = options_labels[max_darkness_idx] if max_darkness_idx < len(options_labels) else None
                    log_info(f"--> Questão {i+1}: Marcou {marked}")
                    
                answers.append({
                    "question": i + 1,
                    "marked": marked
                })

            print(json.dumps({
                "success": True,
                "type": "BUBBLE_SHEET",
                "answers": answers,
                "total_questions_detected": len(answers)
            }))
            return

        else:
            raise Exception(f"Tipo de correção desconhecido: {correction_type}")

    except Exception as e:
        log_info(f"FALHA FATAL NO PYTHON: {str(e)}")
        print(json.dumps({"success": False, "error": str(e), "trace": traceback.format_exc()}))

if __name__ == "__main__":
    if len(sys.argv) > 2:
        process_image(sys.argv[1], sys.argv[2])
    else:
        print(json.dumps({"success": False, "error": "Argumentos insuficientes."}))