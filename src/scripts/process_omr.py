import sys
import cv2
import numpy as np
import json

def process_image(image_path):
    try:
        # LOG INICIAL PARA VER SE O PYTHON LIGOU
        sys.stderr.write(f"[PYTHON INFO] Tentando carregar imagem: {image_path}\n")

        # 1. Carrega a imagem da prova
        image = cv2.imread(image_path)
        if image is None:
            raise Exception("Não foi possível ler a imagem do disco.")
        
        sys.stderr.write(f"[PYTHON INFO] Imagem carregada com sucesso. Resolução original: {image.shape}\n")

        # Redimensiona mantendo a proporção para não amassar as bolinhas
        h, w = image.shape[:2]
        new_w = 1000
        new_h = int((new_w / w) * h)
        image = cv2.resize(image, (new_w, new_h))

        sys.stderr.write(f"[PYTHON INFO] Imagem redimensionada para: {image.shape}\n")

        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)

        # Binarização adaptativa
        thresh = cv2.adaptiveThreshold(blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 15, 5)

        # Procura contornos
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        sys.stderr.write(f"[PYTHON INFO] Total de contornos encontrados na imagem: {len(contours)}\n")

        bubbles = []
        for c in contours:
            (x, y, w_box, h_box) = cv2.boundingRect(c)
            ar = w_box / float(h_box)
            
            # Regras para achar uma bolinha (Mínimo 10px, máximo 60px, proporção quadrada)
            if 0.7 <= ar <= 1.3 and 10 <= w_box <= 60 and 10 <= h_box <= 60:
                bubbles.append((x, y, w_box, h_box, c))

        sys.stderr.write(f"[PYTHON INFO] Contornos que parecem bolinhas (filtrados): {len(bubbles)}\n")

        if len(bubbles) < 15:
            # Se achou pouco, aborta e manda zerado pro professor digitar
            sys.stderr.write("[PYTHON AVISO] Poucas bolinhas encontradas. Abortando IA.\n")
            print(json.dumps({"success": False, "message": f"Apenas {len(bubbles)} bolinhas encontradas."}))
            return

        bubbles = sorted(bubbles, key=lambda b: b[1])

        mid_y = sum([b[1] for b in bubbles]) / len(bubbles)
        top_row = [b for b in bubbles if b[1] < mid_y]
        bottom_row = [b for b in bubbles if b[1] >= mid_y]

        sys.stderr.write(f"[PYTHON INFO] Bolinhas separadas: Linha de Cima = {len(top_row)}, Linha de Baixo = {len(bottom_row)}\n")

        top_row = sorted(top_row, key=lambda b: b[0])
        bottom_row = sorted(bottom_row, key=lambda b: b[0])

        def get_filled_index(row, row_name):
            if not row: return -1
            max_pixels = -1
            filled_idx = -1
            
            sys.stderr.write(f"[PYTHON INFO] Analisando pixels da linha: {row_name}\n")
            for i, (x, y, w_box, h_box, c) in enumerate(row):
                mask = np.zeros(thresh.shape, dtype="uint8")
                cv2.drawContours(mask, [c], -1, 255, -1)
                
                mask = cv2.bitwise_and(thresh, thresh, mask=mask)
                total = cv2.countNonZero(mask)
                
                # Descomente a linha abaixo se quiser ver a contagem de pixel de CADA bolinha
                # sys.stderr.write(f"  -> Bolinha {i} tem {total} pixels pintados\n")

                if total > max_pixels:
                    max_pixels = total
                    filled_idx = i
                    
            sys.stderr.write(f"[PYTHON RESULTADO] A bolinha mais pintada da {row_name} foi o índice {filled_idx} (com {max_pixels} pixels).\n")
            return filled_idx

        inteiro_val = get_filled_index(top_row, "Linha de Inteiros")
        decimal_val = get_filled_index(bottom_row, "Linha de Decimais")

        if inteiro_val == -1: inteiro_val = 0
        if decimal_val == -1: decimal_val = 0
        if inteiro_val > 10: inteiro_val = 10
        if decimal_val > 9: decimal_val = 9

        final_grade = float(f"{inteiro_val}.{decimal_val}")

        sys.stderr.write(f"[PYTHON SUCESSO] Nota final calculada: {final_grade}\n")

        print(json.dumps({
            "success": True, 
            "inteiro": inteiro_val, 
            "decimal": decimal_val, 
            "grade": final_grade,
            "debug": f"Lidas: Cima={len(top_row)}, Baixo={len(bottom_row)}"
        }))

    except Exception as e:
        sys.stderr.write(f"[PYTHON FATAL ERROR] {str(e)}\n")
        print(json.dumps({"success": False, "error": str(e)}))

if __name__ == "__main__":
    if len(sys.argv) > 1:
        process_image(sys.argv[1])
    else:
        print(json.dumps({"success": False, "error": "Caminho da imagem não fornecido"}))