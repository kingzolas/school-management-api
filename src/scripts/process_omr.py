import sys
import cv2
import numpy as np
import json
import traceback

def log_info(msg):
    sys.stderr.write(f"[PYTHON INFO] {msg}\n")

def process_image(image_path, correction_type):
    try:
        log_info("="*50)
        log_info(f"Iniciando leitura HÍBRIDA - Modo: {correction_type}")
        
        image = cv2.imread(image_path)
        if image is None:
            raise Exception("Não foi possível ler a imagem fornecida.")
        
        # Como o Flutter já recorta na orientação certa via máscara (verde), não precisamos mais girar.
        # Apenas padronizamos a largura para 1200px para os filtros de tamanho funcionarem.
        h, w = image.shape[:2]
        new_w = 1200 
        new_h = int((new_w / w) * h)
        image = cv2.resize(image, (new_w, new_h))

        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        
        # Binarização forte (O papel fica branco 255 e as impressões ficam pretas 0)
        thresh = cv2.adaptiveThreshold(blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 51, 15)

        # Fecha pequenos "buracos" nas bolinhas para ajudar o contorno
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)

        # ====================================================================
        # CAÇA ÀS BOLINHAS (Ignora QR Code, Âncoras, Textos, etc)
        # ====================================================================
        contours, _ = cv2.findContours(thresh, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        
        candidates = []
        for c in contours:
            (x, y, w_box, h_box) = cv2.boundingRect(c)
            ar = w_box / float(h_box)
            
            # Uma bolinha deve ser um quadrado razoável (0.7 a 1.3).
            # O tamanho da bolinha no nosso redimensionamento de 1200px deve estar entre 15 e 60 pixels.
            if 0.70 <= ar <= 1.30 and 15 <= w_box <= 60:
                area = cv2.contourArea(c)
                peri = cv2.arcLength(c, True)
                if peri == 0: continue
                
                # Tolerância de Circularidade baixa (aceita letras pintadas ou imperfeitas)
                circularity = 4 * np.pi * (area / (peri * peri))
                if circularity > 0.45: 
                    candidates.append({
                        'cx': x + w_box // 2, 'cy': y + h_box // 2,
                        'w': w_box, 'h': h_box, 'c': c, 'x': x, 'y': y, 'area': area
                    })

        if not candidates:
             raise Exception("Nenhuma bolinha foi localizada. O papel estava torto, cortado ou sem foco.")

        log_info(f"Filtro Inicial: Achou {len(candidates)} candidatos a bolinhas.")

        # Filtro de Sujeira: Remove coisas muito grandes ou muito pequenas baseadas na mediana
        areas = [cand['area'] for cand in candidates]
        median_area = np.median(areas)
        filtered_bubbles = [c for c in candidates if (median_area * 0.5) <= c['area'] <= (median_area * 1.8)]

        # Filtro de Duplicatas (O OpenCV as vezes acha a borda de dentro e de fora da bolinha)
        unique_bubbles = []
        for cand in filtered_bubbles:
            if not any(abs(cand['cx'] - ub['cx']) < 10 and abs(cand['cy'] - ub['cy']) < 10 for ub in unique_bubbles):
                unique_bubbles.append(cand)

        log_info(f"Filtro Final: {len(unique_bubbles)} bolinhas confirmadas na folha.")

        # FUNÇÃO MATADORA DE ESCURIDÃO
        def analyze_bubble_intensity(bubble):
            mask = np.zeros(gray.shape, dtype="uint8")
            # Mede apenas 35% do centro (Evita ler a borda preta impressa)
            radius = int(min(bubble['w'], bubble['h']) * 0.35)
            cv2.circle(mask, (bubble['cx'], bubble['cy']), radius, 255, -1)
            mean_val = cv2.mean(gray, mask=mask)[0]
            # Retorna valor de 0 a 255 (Quanto MAIOR, MAIS ESCURA a bolinha está)
            return 255 - mean_val 

        # ====================================================================
        # FLUXO A: GABARITO ANTIGO (NOTA DIRETA)
        # ====================================================================
        if correction_type == 'DIRECT_GRADE':
            # Agrupa por Eixo Y
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

            valid_rows = [r for r in rows if len(r) >= 9]
            if len(valid_rows) < 2:
                raise Exception("Erro: O formato antigo exige 2 linhas de bolinhas (Inteiro e Decimal).")

            valid_rows = sorted(valid_rows, key=lambda r: r[0]['cy']) 
            top_row = sorted(valid_rows[0], key=lambda b: b['cx'])[-11:]
            bottom_row = sorted(valid_rows[1], key=lambda b: b['cx'])[-10:]

            def get_darkest(row):
                max_darkness = -1
                idx = 0
                for i, b in enumerate(row):
                    darkness = analyze_bubble_intensity(b)
                    if darkness > max_darkness:
                        max_darkness = darkness
                        idx = i
                return idx

            inteiro_val = get_darkest(top_row)
            decimal_val = get_darkest(bottom_row)
            final_grade = float(f"{inteiro_val}.{decimal_val}")

            print(json.dumps({"success": True, "type": "DIRECT_GRADE", "grade": final_grade}))
            return

        # ====================================================================
        # FLUXO B: NOVO CARTÃO RESPOSTA (BUBBLE SHEET)
        # ====================================================================
        elif correction_type == 'BUBBLE_SHEET':
            # 1. Agrupamento rigoroso por Eixo Y (Linhas da Questão)
            unique_bubbles = sorted(unique_bubbles, key=lambda b: b['cy'])
            rows = []
            current_row = []
            for b in unique_bubbles:
                if not current_row:
                    current_row.append(b)
                else:
                    # Se o Y variar menos que a altura de 1 bolinha e meia, é a mesma linha
                    if abs(b['cy'] - current_row[0]['cy']) < (b['h'] * 1.5): 
                        current_row.append(b)
                    else:
                        rows.append(sorted(current_row, key=lambda i: i['cx']))
                        current_row = [b]
            if current_row:
                rows.append(sorted(current_row, key=lambda i: i['cx']))

            # 2. Divide as linhas em Blocos de 5 alternativas (Eixo X)
            blocks = []
            for row in rows:
                if len(row) < 4: continue # Ignora linhas soltas ou falhas enormes
                
                curr_block = [row[0]]
                for i in range(1, len(row)):
                    # Se o X for muito longe, quebrou a coluna (foi pra coluna da direita)
                    gap = row[i]['cx'] - row[i-1]['cx']
                    if gap < row[0]['w'] * 3.5: 
                        curr_block.append(row[i])
                    else:
                        if 4 <= len(curr_block) <= 6:
                            blocks.append(curr_block)
                        curr_block = [row[i]]
                
                if 4 <= len(curr_block) <= 6:
                    blocks.append(curr_block)

            if not blocks:
                raise Exception("Nenhum bloco de alternativas (A, B, C...) encontrado. Tente focar melhor nas bolinhas.")

            log_info(f"Achados {len(blocks)} blocos de questões.")

            # 3. Organiza os blocos em colunas (Se houver duas colunas no seu cartão)
            column_centroids = []
            for b in blocks:
                avg_cx = np.mean([bubble['cx'] for bubble in b])
                matched = False
                for col in column_centroids:
                    # Tolerância horizontal pra dizer "isso é a Coluna 1" ou "isso é a Coluna 2"
                    if abs(avg_cx - col['avg_cx']) < 250: 
                        col['blocks'].append(b)
                        col['avg_cx'] = np.mean([np.mean([bub['cx'] for bub in blk]) for blk in col['blocks']])
                        matched = True
                        break
                if not matched:
                    column_centroids.append({'avg_cx': avg_cx, 'blocks': [b]})
            
            # Ordena as colunas (Da esquerda para a direita)
            column_centroids = sorted(column_centroids, key=lambda c: c['avg_cx'])
            
            # Achata tudo: Coluna 1 (1 a 20), depois Coluna 2 (21 a 40)
            ordered_blocks = []
            for col_idx, col in enumerate(column_centroids):
                sorted_blocks = sorted(col['blocks'], key=lambda b: np.mean([bub['cy'] for bub in b]))
                ordered_blocks.extend(sorted_blocks)
                log_info(f"Coluna {col_idx+1} validada com {len(sorted_blocks)} blocos/questões.")

            answers = []
            options_labels = ['A', 'B', 'C', 'D', 'E']
            
            # 4. Leitura das Notas
            for i, block in enumerate(ordered_blocks):
                # Importante: Garantir que o bloco sempre será lido da esquerda (A) pra direita (E)
                block = sorted(block, key=lambda b: b['cx']) 
                
                darkness_list = [analyze_bubble_intensity(b) for b in block]
                max_idx = np.argmax(darkness_list)
                max_darkness = darkness_list[max_idx]
                min_darkness = np.min(darkness_list)
                
                # Trava contra "Em Branco":
                # Se a bolinha mais pintada não for pelo menos 25 níveis de cinza mais escura
                # que a bolinha mais branca, o aluno não pintou nada.
                if (max_darkness - min_darkness) < 25:
                    marked = None
                    log_text = "EM BRANCO"
                else:
                    marked = options_labels[max_idx] if max_idx < len(options_labels) else None
                    log_text = f"MARCOU {marked}"
                    
                log_info(f"Q{str(i+1).zfill(2)} | Tons Lidos: {[int(d) for d in darkness_list]} -> {log_text}")

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
            raise Exception(f"Modo de correção '{correction_type}' não suportado.")

    except Exception as e:
        log_info(f"ERRO CRÍTICO NA IA: {str(e)}")
        print(json.dumps({"success": False, "error": str(e), "trace": traceback.format_exc()}))

if __name__ == "__main__":
    if len(sys.argv) > 2:
        process_image(sys.argv[1], sys.argv[2])
    else:
        print(json.dumps({"success": False, "error": "Argumentos insuficientes. (python script.py imagem.jpg MODO)"}))