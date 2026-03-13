import sys
import cv2
import numpy as np
import json
import traceback

# Helper para os logs aparecerem perfeitamente no console do Node.js (Render)
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
        log_info(f"===================================================")
        log_info(f"Iniciando leitura da imagem no modo {correction_type}")
        
        image = cv2.imread(image_path)
        if image is None:
            raise Exception("Não foi possível ler a imagem fornecida.")
        
        h, w = image.shape[:2]

        if h > w:
            image = cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE)
            log_info("Imagem rotacionada 90 graus (estava em modo retrato).")

        # Redimensionamento padrão para a IA ter uma referência matemática constante
        new_w = 1200 
        new_h = int((new_w / w) * image.shape[0])
        image = cv2.resize(image, (new_w, new_h))

        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        
        # Binarização mais sensível para não apagar bolinhas impressas muito finas
        thresh = cv2.adaptiveThreshold(blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 41, 11)

        # Engrossa um pouco as linhas para garantir que o círculo feche
        kernel_dilate = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
        thresh = cv2.dilate(thresh, kernel_dilate, iterations=1)

        # ====================================================================
        # PASSO 1: ENCONTRAR AS 4 ÂNCORAS PRETAS E ALINHAR A FOLHA
        # ====================================================================
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        anchors = []

        for c in contours:
            area = cv2.contourArea(c)
            # Âncoras são quadrados razoavelmente grandes, mas menores que a página
            if area < 300 or area > 15000: 
                continue
                
            peri = cv2.arcLength(c, True)
            approx = cv2.approxPolyDP(c, 0.04 * peri, True)
            
            # Se tiver 4 cantos e for parecido com um quadrado
            if len(approx) == 4:
                (x, y, w_box, h_box) = cv2.boundingRect(approx)
                ar = w_box / float(h_box)
                if 0.7 <= ar <= 1.3: # Mais tolerância para distorção
                    M = cv2.moments(c)
                    if M["m00"] != 0:
                        cX = int(M["m10"] / M["m00"])
                        cY = int(M["m01"] / M["m00"])
                        anchors.append([cX, cY])

        if len(anchors) >= 4:
            log_info(f"Sucesso: {len(anchors)} âncoras encontradas. Ajustando perspectiva...")
            pts = np.array(anchors[:4], dtype="float32")
            warped_gray = four_point_transform(gray, pts)
            
            blurred = cv2.GaussianBlur(warped_gray, (5, 5), 0)
            thresh = cv2.adaptiveThreshold(blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 41, 11)
            thresh = cv2.dilate(thresh, kernel_dilate, iterations=1)
            gray = warped_gray
            h, w = gray.shape[:2]
        else:
            log_info(f"AVISO: Encontrou apenas {len(anchors)} âncoras. Prosseguindo sem alinhamento...")

        # ====================================================================
        # PASSO 2: ENCONTRAR AS BOLINHAS 
        # ====================================================================
        kernel_close = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel_close)

        contours, _ = cv2.findContours(thresh, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        log_info(f"Contornos brutos encontrados na imagem: {len(contours)}")

        candidates = []
        for c in contours:
            (x, y, w_box, h_box) = cv2.boundingRect(c)
            ar = w_box / float(h_box)
            
            # Tamanho esperado das bolinhas na imagem de 1200px (Ignora âncoras gigantes > 90px)
            if 0.60 <= ar <= 1.40 and 12 <= w_box <= 80:
                area = cv2.contourArea(c)
                peri = cv2.arcLength(c, True)
                if peri == 0: continue
                
                # Tolerância DRASTICAMENTE reduzida para aceitar bolinhas rabiscadas ou tortas
                circularity = 4 * np.pi * (area / (peri * peri))
                if circularity > 0.45: 
                    candidates.append({
                        'cx': x + w_box // 2, 'cy': y + h_box // 2,
                        'w': w_box, 'h': h_box, 'c': c, 'area': area
                    })

        log_info(f"Candidatos com formato de bolinha: {len(candidates)}")

        if not candidates:
             raise Exception("Nenhuma bolinha encontrada. Melhore a iluminação e enquadre na linha verde.")

        # Filtra lixo usando a mediana do tamanho das bolinhas
        areas = [cand['area'] for cand in candidates]
        median_area = np.median(areas)
        
        filtered_bubbles = [c for c in candidates if (median_area * 0.4) <= c['area'] <= (median_area * 2.2)]
        log_info(f"Bolinhas após filtro de tamanho (removendo ruídos): {len(filtered_bubbles)}")

        # Remove bolinhas sobrepostas (duplicatas do mesmo círculo)
        unique_bubbles = []
        for cand in filtered_bubbles:
            if not any(abs(cand['cx'] - ub['cx']) < 10 and abs(cand['cy'] - ub['cy']) < 10 for ub in unique_bubbles):
                unique_bubbles.append(cand)

        log_info(f"Total de bolinhas reais prontas para análise: {len(unique_bubbles)}")

        # Agrupa em linhas horizontais
        unique_bubbles = sorted(unique_bubbles, key=lambda b: b['cy'])
        rows = []
        current_row = []
        for b in unique_bubbles:
            if not current_row:
                current_row.append(b)
            else:
                # Se a variação vertical for pequena, pertence à mesma linha
                if abs(b['cy'] - current_row[0]['cy']) < (b['h'] * 0.8):
                    current_row.append(b)
                else:
                    rows.append(sorted(current_row, key=lambda i: i['cx']))
                    current_row = [b]
        if current_row:
            rows.append(sorted(current_row, key=lambda i: i['cx']))

        # FUNÇÃO PARA CALCULAR A ESCURIDÃO
        def analyze_bubble_intensity(bubble):
            mask = np.zeros(gray.shape, dtype="uint8")
            # Usa 40% do raio para ler SÓ o centro da bolinha (onde a caneta fica), ignorando a borda preta
            radius = int(min(bubble['w'], bubble['h']) * 0.40)
            cv2.circle(mask, (bubble['cx'], bubble['cy']), radius, 255, -1)
            mean_val = cv2.mean(gray, mask=mask)[0]
            # Retorna valor de 0 a 255 (Quanto MAIOR, MAIS ESCURA a bolinha está)
            return 255 - mean_val 


        # ====================================================================
        # FLUXO A: GABARITO ANTIGO (NOTA DIRETA)
        # ====================================================================
        if correction_type == 'DIRECT_GRADE':
            valid_rows = [r for r in rows if len(r) >= 9]
            if len(valid_rows) < 2:
                raise Exception("Não encontrei as 2 fileiras de bolinhas para lançar a nota manual.")

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

            inteiro_val = get_darkest(top_row, "Fileira Inteiros")
            decimal_val = get_darkest(bottom_row, "Fileira Decimais")
            
            final_grade = float(f"{inteiro_val}.{decimal_val}")
            log_info(f"Nota final calculada: {final_grade}")

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
            blocks = []
            for row in rows:
                if not row: continue
                curr_block = [row[0]]
                for i in range(1, len(row)):
                    # Distância horizontal. Se for maior que 150px, é porque pulou pra coluna da direita.
                    gap = row[i]['cx'] - row[i-1]['cx']
                    if gap < 150: 
                        curr_block.append(row[i])
                    else:
                        if len(curr_block) >= 3: # Aceita blocos a partir de 3 bolinhas pra evitar quebra por falha
                            blocks.append(curr_block)
                        curr_block = [row[i]]
                
                if len(curr_block) >= 3:
                    blocks.append(curr_block)

            question_blocks = [b for b in blocks if 3 <= len(b) <= 6]
            log_info(f"Total de blocos de alternativas identificados: {len(question_blocks)}")

            if not question_blocks:
                raise Exception("Não consegui separar as alternativas (A, B, C...). Tente tirar a foto mais de perto.")

            # Organiza os blocos em colunas para garantir que a Questão 1 venha antes da Questão 21
            column_centroids = []
            for b in question_blocks:
                avg_cx = np.mean([bubble['cx'] for bubble in b])
                matched = False
                for col in column_centroids:
                    if abs(avg_cx - col['avg_cx']) < 150: # Tolerância vertical da coluna
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
                log_info(f"Coluna {col_idx + 1} identificada com {len(sorted_blocks)} questões.")

            answers = []
            options_labels = ['A', 'B', 'C', 'D', 'E']
            
            for i, block in enumerate(ordered_blocks):
                block = sorted(block, key=lambda b: b['cx']) # A -> E
                
                darkness_list = [analyze_bubble_intensity(b) for b in block]
                max_idx = np.argmax(darkness_list)
                max_darkness = darkness_list[max_idx]
                min_darkness = np.min(darkness_list)
                
                # REGRA DE PROTEÇÃO CONTRA QUESTÃO EM BRANCO
                # Se a diferença de escuridão entre a bolinha mais pintada e a bolinha mais branca for menor que 25,
                # significa que o aluno não pintou nada. É só a sujeira do papel ou a borda preta enganando a IA.
                if (max_darkness - min_darkness) < 25:
                    marked = None
                    status_log = "EM BRANCO"
                else:
                    marked = options_labels[max_idx] if max_idx < len(options_labels) else None
                    status_log = f"Marcou {marked}"
                    
                log_info(f"Q{str(i+1).zfill(2)} | Escuridão: {[int(d) for d in darkness_list]} -> {status_log}")

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
        log_info(f"FALHA FATAL NA IA: {str(e)}")
        print(json.dumps({"success": False, "error": str(e), "trace": traceback.format_exc()}))

if __name__ == "__main__":
    if len(sys.argv) > 2:
        process_image(sys.argv[1], sys.argv[2])
    else:
        print(json.dumps({"success": False, "error": "Argumentos insuficientes."}))