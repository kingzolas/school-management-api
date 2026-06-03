from dataclasses import dataclass
from typing import Dict, List, Optional


@dataclass
class BubbleSpec:
    question: int
    option: str
    x: float
    y: float
    r: float


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
    bubbles: List[BubbleSpec]
    bubble_map: Dict[int, Dict[str, BubbleSpec]]
    anchor_points: Dict[str, List[float]]
    expected_machine_ratio: float
    debug: Dict

    def bubbles_for_question(self, question_number: int) -> Dict[str, BubbleSpec]:
        return self.bubble_map.get(int(question_number), {})


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
    def build(
        cls,
        questions_count: int,
        layout_data: Optional[Dict] = None,
    ) -> BubbleSheetLayout:
        if questions_count < 1:
            raise ValueError("questions_count deve ser >= 1")

        if questions_count > 20:
            raise ValueError(
                "V1 suporta apenas até 20 questões. "
                "Depois expandimos para 2 colunas."
            )

        explicit_layout = cls._build_from_explicit_layout(
            questions_count=questions_count,
            layout_data=layout_data,
        )
        if explicit_layout is not None:
            return explicit_layout

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

        bubbles: List[BubbleSpec] = []
        bubble_map: Dict[int, Dict[str, BubbleSpec]] = {}
        for q_idx, cy in enumerate(row_centers_y):
            question_number = q_idx + 1
            bubble_map[question_number] = {}
            for choice, cx in zip(["A", "B", "C", "D", "E"], bubble_centers_x):
                spec = BubbleSpec(
                    question=question_number,
                    option=choice,
                    x=float(cx),
                    y=float(cy),
                    r=float(bubble_radius),
                )
                bubbles.append(spec)
                bubble_map[question_number][choice] = spec

        anchor_center = anchor_offset + (anchor_size / 2.0)
        anchor_points = {
            "topLeft": [anchor_center, anchor_center],
            "topRight": [machine_width - anchor_center, anchor_center],
            "bottomRight": [machine_width - anchor_center, machine_height - anchor_center],
            "bottomLeft": [anchor_center, machine_height - anchor_center],
        }

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
            bubbles=bubbles,
            bubble_map=bubble_map,
            anchor_points=anchor_points,
            expected_machine_ratio=machine_width / float(machine_height),
            debug={
                "source": "generated_adapter_v1",
                "machine_height_pdf": machine_height_pdf,
                "scale": scale,
                "first_row_center_y_pdf": first_row_center_y_pdf,
                "row_pitch_pdf": row_pitch_pdf,
                "bubble_centers_x_pdf": bubble_centers_x_pdf,
                "row_center_y_offset_pdf": cls.ROW_CENTER_Y_OFFSET_PDF,
                "bubble_center_x_offset_pdf": cls.BUBBLE_CENTER_X_OFFSET_PDF,
            },
        )

    @classmethod
    def _build_from_explicit_layout(
        cls,
        questions_count: int,
        layout_data: Optional[Dict],
    ) -> Optional[BubbleSheetLayout]:
        if not isinstance(layout_data, dict):
            return None

        raw_bubbles = layout_data.get("bubbles")
        if not isinstance(raw_bubbles, list) or not raw_bubbles:
            return None

        machine_width = cls._positive_int(layout_data.get("canonicalWidth"))
        machine_height = cls._positive_int(layout_data.get("canonicalHeight"))
        if not machine_width or not machine_height:
            return None

        choices = layout_data.get("choices")
        if not isinstance(choices, list) or not choices:
            choices = ["A", "B", "C", "D", "E"]
        choices = [str(choice).strip().upper() for choice in choices if str(choice).strip()]

        default_radius = cls._positive_float(layout_data.get("bubbleRadius")) or 12.0
        bubbles: List[BubbleSpec] = []
        bubble_map: Dict[int, Dict[str, BubbleSpec]] = {}

        for raw in raw_bubbles:
            if not isinstance(raw, dict):
                continue

            question = cls._positive_int(raw.get("question"))
            option = str(raw.get("option") or "").strip().upper()
            x = cls._positive_float(raw.get("x"))
            y = cls._positive_float(raw.get("y"))
            radius = cls._positive_float(raw.get("r")) or default_radius

            if not question or question < 1 or question > questions_count:
                continue
            if option not in choices or x is None or y is None:
                continue

            spec = BubbleSpec(
                question=question,
                option=option,
                x=float(x),
                y=float(y),
                r=float(radius),
            )
            bubbles.append(spec)
            bubble_map.setdefault(question, {})[option] = spec

        expected_bubble_count = questions_count * len(choices)
        if len(bubbles) < expected_bubble_count:
            return None

        bubbles.sort(key=lambda b: (b.question, choices.index(b.option)))
        bubble_centers_x = [
            bubble_map[1][choice].x
            for choice in choices
            if 1 in bubble_map and choice in bubble_map[1]
        ]
        row_centers_y = [
            bubble_map[q][choices[0]].y
            for q in range(1, questions_count + 1)
            if q in bubble_map and choices[0] in bubble_map[q]
        ]

        anchor_points = cls._parse_anchor_points(
            layout_data.get("anchors"),
            machine_width=machine_width,
            machine_height=machine_height,
        )

        anchor_size = 0.0
        anchor_offset = 0.0
        if anchor_points:
            anchor_offset = float(anchor_points["topLeft"][0])
            anchor_size = default_radius * 2.0

        return BubbleSheetLayout(
            questions_count=questions_count,
            choices=choices,
            machine_width=machine_width,
            machine_height=machine_height,
            anchor_offset=anchor_offset,
            anchor_size=anchor_size,
            bubble_diameter=default_radius * 2.0,
            bubble_radius=default_radius,
            bubble_centers_x=bubble_centers_x,
            row_centers_y=row_centers_y,
            bubbles=bubbles,
            bubble_map=bubble_map,
            anchor_points=anchor_points,
            expected_machine_ratio=machine_width / float(machine_height),
            debug={
                "source": "explicit_omr_layout",
                "version": layout_data.get("version"),
                "canonicalWidth": machine_width,
                "canonicalHeight": machine_height,
                "bubblesCount": len(bubbles),
                "expectedBubblesCount": expected_bubble_count,
                "bubbleRadius": default_radius,
                "anchorPoints": anchor_points,
            },
        )

    @staticmethod
    def _positive_int(value) -> Optional[int]:
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return None
        return parsed if parsed > 0 else None

    @staticmethod
    def _positive_float(value) -> Optional[float]:
        try:
            parsed = float(value)
        except (TypeError, ValueError):
            return None
        return parsed if parsed >= 0 else None

    @classmethod
    def _parse_anchor_points(
        cls,
        anchors,
        machine_width: int,
        machine_height: int,
    ) -> Dict[str, List[float]]:
        fallback = {
            "topLeft": [60.0, 60.0],
            "topRight": [float(machine_width) - 60.0, 60.0],
            "bottomRight": [float(machine_width) - 60.0, float(machine_height) - 60.0],
            "bottomLeft": [60.0, float(machine_height) - 60.0],
        }

        if not isinstance(anchors, dict):
            return fallback

        parsed = {}
        for key in ("topLeft", "topRight", "bottomRight", "bottomLeft"):
            point = anchors.get(key)
            if not isinstance(point, dict):
                return fallback
            x = cls._positive_float(point.get("x"))
            y = cls._positive_float(point.get("y"))
            if x is None or y is None:
                return fallback
            parsed[key] = [float(x), float(y)]

        return parsed
