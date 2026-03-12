import sys
import cv2
import numpy as np
import json
import traceback

def process_image(image_path):
    try:
        image = cv2.imread(image_path)
        if image is None:
            raise Exception("Não foi possível ler a imagem.")
        
        # Redimensionamento padrão
        h, w = image.shape[:2]
        new_w = 1200 
        new_h = int((new_w / w) * h)
        image = cv2.resize(image, (new_w, new_h))

        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)

        # 1. Defesa contra SOMBRAS (Volta do Adaptive Threshold)
        # É a melhor técnica para fotos de celular onde a iluminação é desigual
        thresh = cv2.adaptiveThreshold(blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 31, 10)

        # 2. Morfologia para fechar as bordas das bolinhas que a sombra possa ter quebrado
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)

        contours, _ = cv2.findContours(thresh, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)

        candidates = []
        for c in contours:
            (x, y, w_box, h_box) = cv2.boundingRect(c)
            ar = w_box / float(h_box)
            
            # Aceita ovais mais esticados (tilt do celular)
            if 0.65 <= ar <= 1.35 and w_box >= 15:
                area = cv2.contourArea(c)
                perimeter = cv2.arcLength(c, True)
                if perimeter == 0: continue
                
                circularity = 4 * np.pi * (area / (perimeter * perimeter))
                
                # 3. Tolerância a ângulos: Caiu de 0.82 para 0.60
                # Aceita bolinhas que parecem elipses na foto
                if circularity > 0.60:
                    candidates.append({
                        'cx': x + w_box // 2, 'cy': y + h_box // 2,
                        'w': w_box, 'h': h_box, 'c': c, 'x': x, 'y': y
                    })

        # Remove duplicatas (o OpenCV às vezes mapeia o traço de dentro e o de fora do círculo)
        unique_bubbles = []
        for cand in candidates:
            is_dup = False
            for ub in unique_bubbles:
                if abs(cand['cx'] - ub['cx']) < 15 and abs(cand['cy'] - ub['cy']) < 15:
                    is_dup = True
                    break
            if not is_dup:
                unique_bubbles.append(cand)

        # Agrupa por Eixo Y (Linhas)
        unique_bubbles = sorted(unique_bubbles, key=lambda b: b['cy'])
        
        rows = []
        current_row = []
        for b in unique_bubbles:
            if not current_row:
                current_row.append(b)
            else:
                # Tolerância de alinhamento vertical tolerante (até 60% da altura da bolinha)
                if abs(b['cy'] - current_row[0]['cy']) < (b['h'] * 0.6):
                    current_row.append(b)
                else:
                    rows.append(current_row)
                    current_row = [b]
        if current_row:
            rows.append(current_row)

        # Filtra apenas linhas com 10 bolinhas ou mais (Os quadrados âncora e sujeiras caem aqui)
        valid_rows = [r for r in rows if len(r) >= 10]
        valid_rows = sorted(valid_rows, key=lambda r: r[0]['cy']) # Ordena de cima pra baixo

        if len(valid_rows) < 2:
            # Melhoramos o erro para mostrar no celular exatamente o que a IA conseguiu ver
            print(json.dumps({
                "success": False, 
                "message": f"Não consegui ler. Achei {len(valid_rows)} linhas de notas e {len(unique_bubbles)} bolinhas avulsas."
            }))
            return

        # 4. A SUa MÁGICA: Pega da direita para a esquerda e ignora qualquer texto na esquerda
        top_row = sorted(valid_rows[0], key=lambda b: b['cx'])[-11:]
        bottom_row = sorted(valid_rows[1], key=lambda b: b['cx'])[-10:]

        if len(top_row) != 11 or len(bottom_row) != 10:
            print(json.dumps({"success": False, "message": "O gabarito está muito torto ou cortado na foto."}))
            return

        def get_darkest_bubble(row):
            min_intensity = 255 # Branco absoluto
            filled_index = 0
            
            for index, b in enumerate(row):
                mask = np.zeros(gray.shape, dtype="uint8")
                
                # Fotografa só a "gema" da bolinha, fugindo da tinta preta da borda impressa
                radius = int(min(b['w'], b['h']) * 0.35)
                cv2.circle(mask, (b['cx'], b['cy']), radius, 255, -1)
                
                # Tira a média de cor da foto original (ignorando sombras via thresholding)
                mean_intensity = cv2.mean(gray, mask=mask)[0]

                if mean_intensity < min_intensity:
                    min_intensity = mean_intensity
                    filled_index = index
                    
            return filled_index

        inteiro_val = get_darkest_bubble(top_row)
        decimal_val = get_darkest_bubble(bottom_row)

        final_grade = float(f"{inteiro_val}.{decimal_val}")

        print(json.dumps({
            "success": True, 
            "inteiro": inteiro_val, 
            "decimal": decimal_val, 
            "grade": final_grade,
            "debug": f"Lidas perfeitamente: Cima={len(top_row)}, Baixo={len(bottom_row)}"
        }))

    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))

if __name__ == "__main__":
    if len(sys.argv) > 1:
        process_image(sys.argv[1])
    else:
        print(json.dumps({"success": False, "error": "Imagem não fornecida"}))