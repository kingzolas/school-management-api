import sys
import cv2
import numpy as np
import json
import traceback

def process_image(image_path, correction_type):
    try:
        sys.stderr.write(f"[PYTHON INFO] Lendo imagem: {image_path} no modo {correction_type}\n")
        
        image = cv2.imread(image_path)
        if image is None:
            raise Exception("Não foi possível ler a imagem.")
        
        h, w = image.shape[:2]

        # AUTO-ROTAÇÃO INTELIGENTE
        if h > w:
            image = cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE)
            sys.stderr.write("[PYTHON INFO] Foto em retrato rotacionada para paisagem.\n")
            h, w = image.shape[:2]

        # Redimensionamento
        new_w = 1200 
        new_h = int((new_w / w) * h)
        image = cv2.resize(image, (new_w, new_h))

        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)

        # Threshold para lidar com sombras
        thresh = cv2.adaptiveThreshold(blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 31, 10)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)

        contours, _ = cv2.findContours(thresh, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)

        candidates = []
        for c in contours:
            (x, y, w_box, h_box) = cv2.boundingRect(c)
            ar = w_box / float(h_box)
            
            # Aceita ovais (ângulo do celular) - Tamanho mínimo de 12px
            if 0.65 <= ar <= 1.35 and w_box >= 12:
                area = cv2.contourArea(c)
                perimeter = cv2.arcLength(c, True)
                if perimeter == 0: continue
                
                circularity = 4 * np.pi * (area / (perimeter * perimeter))
                
                if circularity > 0.60:
                    candidates.append({
                        'cx': x + w_box // 2, 'cy': y + h_box // 2,
                        'w': w_box, 'h': h_box, 'c': c, 'x': x, 'y': y,
                        'area': area
                    })

        if not candidates:
             raise Exception("Nenhum círculo encontrado.")

        # FILTRO ANTI-QR CODE (Mediana de Tamanho)
        areas = [cand['area'] for cand in candidates]
        median_area = np.median(areas)
        
        filtered_bubbles = []
        for cand in candidates:
            if (median_area * 0.4) <= cand['area'] <= (median_area * 2.0):
                filtered_bubbles.append(cand)

        # Remove duplicatas
        unique_bubbles = []
        for cand in filtered_bubbles:
            is_dup = False
            for ub in unique_bubbles:
                if abs(cand['cx'] - ub['cx']) < 15 and abs(cand['cy'] - ub['cy']) < 15:
                    is_dup = True
                    break
            if not is_dup:
                unique_bubbles.append(cand)

        # Agrupa por Eixo Y (Linhas horizontais)
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
                    rows.append(current_row)
                    current_row = [b]
        if current_row:
            rows.append(current_row)

        # FUNÇÃO DE LEITURA DE INTENSIDADE
        def analyze_bubble_intensity(bubble):
            mask = np.zeros(gray.shape, dtype="uint8")
            radius = int(min(bubble['w'], bubble['h']) * 0.35)
            cv2.circle(mask, (bubble['cx'], bubble['cy']), radius, 255, -1)
            return cv2.mean(gray, mask=mask)[0] # (0 = preto, 255 = branco)

        # ====================================================================
        # FLUXO A: GABARITO ANTIGO (NOTA DIRETA)
        # ====================================================================
        if correction_type == 'DIRECT_GRADE':
            # Pega linhas com 9 bolinhas ou mais
            valid_rows = [r for r in rows if len(r) >= 9]
            valid_rows = sorted(valid_rows, key=lambda r: r[0]['cy']) 

            if len(valid_rows) < 2:
                raise Exception("Erro: O formato antigo exige 2 linhas de bolinhas (Inteiro e Decimal).")

            top_row = sorted(valid_rows[0], key=lambda b: b['cx'])[-11:]
            bottom_row = sorted(valid_rows[1], key=lambda b: b['cx'])[-10:]

            def get_darkest(row):
                min_int = 255 
                idx = 0
                for i, b in enumerate(row):
                    intensity = analyze_bubble_intensity(b)
                    if intensity < min_int:
                        min_int = intensity
                        idx = i
                return idx

            inteiro_val = get_darkest(top_row)
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
            blocks = []
            for row in rows:
                row = sorted(row, key=lambda b: b['cx'])
                if not row: continue
                
                curr_block = [row[0]]
                for i in range(1, len(row)):
                    gap = row[i]['cx'] - row[i-1]['cx']
                    if gap < row[0]['w'] * 3.5:
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
            
            # Organiza os blocos em colunas
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
                
                intensities = [analyze_bubble_intensity(b) for b in block]
                min_idx = np.argmin(intensities)
                min_intensity = intensities[min_idx]
                avg_intensity = np.mean(intensities)
                
                # Se não tem contraste, está em branco
                if min_intensity > avg_intensity * 0.85:
                    marked = None
                else:
                    marked = options_labels[min_idx] if min_idx < len(options_labels) else None
                    
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
        print(json.dumps({"success": False, "error": str(e), "trace": traceback.format_exc()}))

if __name__ == "__main__":
    if len(sys.argv) > 2:
        process_image(sys.argv[1], sys.argv[2])
    else:
        print(json.dumps({"success": False, "error": "Argumentos insuficientes. Envie a imagem e o tipo de correção."}))