import sys
import cv2
import numpy as np
import json
import traceback

def process_image(image_path):
    try:
        sys.stderr.write(f"[PYTHON INFO] Lendo com Padrão Estrito 11/10: {image_path}\n")
        
        image = cv2.imread(image_path)
        if image is None:
            raise Exception("Não foi possível ler a imagem.")
        
        h, w = image.shape[:2]
        new_w = 1200 
        new_h = int((new_w / w) * h)
        image = cv2.resize(image, (new_w, new_h))

        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)

        # OTSU é perfeito para encontrar a diferença entre o papel branco e a tinta preta
        _, thresh = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

        contours, _ = cv2.findContours(thresh, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)

        candidates = []
        for c in contours:
            (x, y, w_box, h_box) = cv2.boundingRect(c)
            ar = w_box / float(h_box)
            
            # Filtro de proporção (deve ser aproximadamente quadrado para ser um círculo)
            if 0.8 <= ar <= 1.2 and w_box >= 15:
                area = cv2.contourArea(c)
                perimeter = cv2.arcLength(c, True)
                if perimeter == 0: continue
                
                circularity = 4 * np.pi * (area / (perimeter * perimeter))
                
                # A MATEMÁTICA: Um quadrado perfeito tem circularidade ~0.785. 
                # Usando 0.82 garantimos que NENHUM quadrado âncora será lido como bolinha!
                if circularity > 0.82:
                    candidates.append({
                        'cx': x + w_box // 2, 'cy': y + h_box // 2,
                        'w': w_box, 'h': h_box, 'c': c, 'x': x, 'y': y
                    })

        # Remove contornos duplicados (às vezes o OpenCV pega a linha de dentro e a de fora)
        unique_bubbles = []
        for cand in candidates:
            is_dup = False
            for ub in unique_bubbles:
                if abs(cand['cx'] - ub['cx']) < 15 and abs(cand['cy'] - ub['cy']) < 15:
                    is_dup = True
                    break
            if not is_dup:
                unique_bubbles.append(cand)

        sys.stderr.write(f"[PYTHON INFO] Círculos perfeitos encontrados: {len(unique_bubbles)}\n")

        # Agrupa os círculos horizontalmente (Eixo Y)
        unique_bubbles = sorted(unique_bubbles, key=lambda b: b['cy'])
        
        rows = []
        current_row = []
        for b in unique_bubbles:
            if not current_row:
                current_row.append(b)
            else:
                # Tolerância de alinhamento vertical (metade do tamanho de uma bolinha)
                if abs(b['cy'] - current_row[0]['cy']) < (b['h'] * 0.5):
                    current_row.append(b)
                else:
                    rows.append(current_row)
                    current_row = [b]
        if current_row:
            rows.append(current_row)

        # Filtra apenas as linhas que contêm pelo menos 10 bolinhas
        valid_rows = [r for r in rows if len(r) >= 10]
        valid_rows = sorted(valid_rows, key=lambda r: r[0]['cy']) # Ordena de cima para baixo

        if len(valid_rows) < 2:
            sys.stderr.write(f"[PYTHON ERROR] Não encontrou as 2 linhas. Linhas achadas: {[len(r) for r in rows]}\n")
            print(json.dumps({"success": False, "message": "Não foi possível identificar as linhas de notas (11 e 10 bolinhas)."}))
            return

        # A MÁGICA DO SEU PADRÃO: 
        # Como existe texto do lado esquerdo ("Inteiro:", "Decimal:"), pegamos os elementos contando da direita para a esquerda.
        # Pegamos exatamente os últimos 11 da linha de cima e os últimos 10 da linha de baixo.
        top_row = sorted(valid_rows[0], key=lambda b: b['cx'])[-11:]
        bottom_row = sorted(valid_rows[1], key=lambda b: b['cx'])[-10:]

        if len(top_row) != 11 or len(bottom_row) != 10:
            print(json.dumps({"success": False, "message": "As bolinhas não puderam ser isoladas corretamente."}))
            return

        def get_darkest_bubble(row, row_name):
            min_intensity = 255 # 255 é branco absoluto
            filled_index = 0
            
            for index, b in enumerate(row):
                mask = np.zeros(gray.shape, dtype="uint8")
                
                # Olha apenas para o miolo da bolinha (35% do raio) para ignorar o contorno impresso no papel
                radius = int(min(b['w'], b['h']) * 0.35)
                cv2.circle(mask, (b['cx'], b['cy']), radius, 255, -1)
                
                # Calcula a média de cor da imagem ORIGINAL dentro desse miolo
                mean_intensity = cv2.mean(gray, mask=mask)[0]
                
                # Se quiser ver a "nota" de escuridão de cada bolinha, tire o '#' da linha abaixo
                # sys.stderr.write(f" -> {row_name} [{index}]: Nível de Cinza = {mean_intensity:.1f}\n")

                if mean_intensity < min_intensity:
                    min_intensity = mean_intensity
                    filled_index = index
                    
            sys.stderr.write(f"[PYTHON RESULTADO] {row_name} - Bolinha mais escura: Índice {filled_index}\n")
            return filled_index

        inteiro_val = get_darkest_bubble(top_row, "Inteiros")
        decimal_val = get_darkest_bubble(bottom_row, "Decimais")

        final_grade = float(f"{inteiro_val}.{decimal_val}")

        sys.stderr.write(f"[PYTHON SUCESSO] Nota calculada: {final_grade}\n")

        print(json.dumps({
            "success": True, 
            "inteiro": inteiro_val, 
            "decimal": decimal_val, 
            "grade": final_grade,
            "debug": f"Lidas perfeitamente: Cima={len(top_row)}, Baixo={len(bottom_row)}"
        }))

    except Exception as e:
        sys.stderr.write(f"[PYTHON FATAL ERROR] {str(e)}\n{traceback.format_exc()}\n")
        print(json.dumps({"success": False, "error": str(e)}))

if __name__ == "__main__":
    if len(sys.argv) > 1:
        process_image(sys.argv[1])
    else:
        print(json.dumps({"success": False, "error": "Imagem não fornecida"}))