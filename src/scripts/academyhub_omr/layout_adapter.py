from dataclasses import dataclass
from typing import Dict, List


@dataclass
class BubbleSheetLayout:
    questions_count: int
    choices: List[str]
    machine_width: int
    machine_height: int
    anchor_offset: float
    anchor_size: float
    bubble_diameter: float
    bubble_radius: float
    bubble_centers_x: List[float]
    row_centers_y: List[float]
    expected_machine_ratio: float
    debug: Dict


class AcademyHubLayoutAdapter:
    """
    Converte a lógica do PDF do AcademyHub em coordenadas previsíveis
    para o motor de leitura.

    V1:
    - 1 a 20 questões
    - 1 coluna
    - alternativas A-E
    """

    CARD_WIDTH_PDF = 265.0
    ROW_CENTER_Y_OFFSET_PDF = 1.8
    BUBBLE_CENTER_X_OFFSET_PDF = 0.0

    @classmethod
    def build(cls, questions_count: int) -> BubbleSheetLayout:
        if questions_count < 1:
            raise ValueError("questions_count deve ser >= 1")

        if questions_count > 20:
            raise ValueError(
                "V1 suporta apenas até 20 questões. "
                "Depois expandimos para 2 colunas."
            )

        row_height_formula = 17.0
        column_header_height_formula = 18.0
        machine_top_padding = 18.0
        machine_bottom_padding = 16.0
        machine_internal_margin = 28.0
        safety_buffer = 20.0

        machine_height_pdf = (
            machine_top_padding
            + column_header_height_formula
            + (questions_count * row_height_formula)
            + machine_bottom_padding
            + machine_internal_margin
            + safety_buffer
        )

        if machine_height_pdf < 160.0:
            machine_height_pdf = 160.0

        machine_width = 1000
        scale = machine_width / cls.CARD_WIDTH_PDF
        machine_height = int(round(machine_height_pdf * scale))

        anchor_offset = 7.0 * scale
        anchor_size = 22.0 * scale

        bubble_diameter = 11.0 * scale
        bubble_radius = bubble_diameter / 2.0

        row_width_pdf = 122.0
        column_x0 = (cls.CARD_WIDTH_PDF - row_width_pdf) / 2.0

        bubble_centers_x_pdf = [
            column_x0 + 39.0 + cls.BUBBLE_CENTER_X_OFFSET_PDF,
            column_x0 + 55.0 + cls.BUBBLE_CENTER_X_OFFSET_PDF,
            column_x0 + 71.0 + cls.BUBBLE_CENTER_X_OFFSET_PDF,
            column_x0 + 87.0 + cls.BUBBLE_CENTER_X_OFFSET_PDF,
            column_x0 + 103.0 + cls.BUBBLE_CENTER_X_OFFSET_PDF,
        ]
        bubble_centers_x = [x * scale for x in bubble_centers_x_pdf]

        header_visual_pdf = 16.0
        row_pitch_pdf = 15.0
        footer_visual_pdf = 6.0
        outer_vertical_margin_pdf = 24.0

        content_height_pdf = (
            header_visual_pdf
            + (questions_count * row_pitch_pdf)
            + footer_visual_pdf
        )

        available_height_pdf = max(
            0.0, machine_height_pdf - (2.0 * outer_vertical_margin_pdf)
        )

        free_space_pdf = max(0.0, available_height_pdf - content_height_pdf)
        top_inside_centered_block_pdf = (
            outer_vertical_margin_pdf + (free_space_pdf / 2.0)
        )

        first_row_center_y_pdf = (
            top_inside_centered_block_pdf
            + header_visual_pdf
            + (11.0 / 2.0)
            + cls.ROW_CENTER_Y_OFFSET_PDF
        )

        row_centers_y = [
            (first_row_center_y_pdf + (i * row_pitch_pdf)) * scale
            for i in range(questions_count)
        ]

        return BubbleSheetLayout(
            questions_count=questions_count,
            choices=["A", "B", "C", "D", "E"],
            machine_width=machine_width,
            machine_height=machine_height,
            anchor_offset=anchor_offset,
            anchor_size=anchor_size,
            bubble_diameter=bubble_diameter,
            bubble_radius=bubble_radius,
            bubble_centers_x=bubble_centers_x,
            row_centers_y=row_centers_y,
            expected_machine_ratio=machine_width / float(machine_height),
            debug={
                "machine_height_pdf": machine_height_pdf,
                "scale": scale,
                "first_row_center_y_pdf": first_row_center_y_pdf,
                "row_pitch_pdf": row_pitch_pdf,
                "bubble_centers_x_pdf": bubble_centers_x_pdf,
                "row_center_y_offset_pdf": cls.ROW_CENTER_Y_OFFSET_PDF,
                "bubble_center_x_offset_pdf": cls.BUBBLE_CENTER_X_OFFSET_PDF,
            },
        )