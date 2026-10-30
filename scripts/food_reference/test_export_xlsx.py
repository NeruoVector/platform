from __future__ import annotations

import csv
import json
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZipFile

import pytest

from export_xlsx import COLUMNS, EXPECTED, NULL, ConversionError, export, mass_grams, normalize_date, validate_header


@pytest.mark.parametrize(("value", "expected"), [("500g", "500"), ("1.0001 kg", "1001"), ("0.1mg", "1"), ("0g", NULL), ("-1g", NULL), ("2147483646.1g", "2147483647"), ("2147483647g", "2147483647"), ("2147483647.001g", NULL), ("2147483.648kg", NULL), ("500ml", NULL), ("100g x 3", NULL), ("", NULL)])
def test_mass_when_explicit_or_ambiguous(value: str, expected: str) -> None:
    assert mass_grams(value) == expected


@pytest.mark.parametrize(("value", "expected"), [("46262", "2026-08-28"), ("2025-08-27", "2025-08-27"), ("", NULL), ("59", "1900-02-28"), ("61", "1900-03-01")])
def test_date_when_valid(value: str, expected: str) -> None:
    assert normalize_date(value) == expected


@pytest.mark.parametrize("value", ["60", "0", "2025-02-30", "2025/08/27", "46262.5"])
def test_date_rejects_invalid_values(value: str) -> None:
    with pytest.raises(ConversionError):
        normalize_date(value)


def make_xlsx(path: Path, headers: list[str]) -> None:
    namespace = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    def column(index: int) -> str:
        result = ""
        index += 1
        while index:
            index, remainder = divmod(index - 1, 26)
            result = chr(65 + remainder) + result
        return result
    def row_xml(number: int, cells: list[str]) -> str:
        return f'<row r="{number}">' + "".join(f'<c r="{column(i)}{number}" t="s"><v>{i if number == 1 else len(headers) + i}</v></c>' for i, value in enumerate(cells) if value) + '</row>'
    row = [""] * 166
    row[0], row[1], row[6], row[7] = "P001", "\ufeff 식품 ", "01", "과자"
    row[16], row[154], row[159], row[164], row[165] = "100g", "500ml", "N", "2025-08-27", "46262"
    strings = headers + row
    with ZipFile(path, "w") as archive:
        archive.writestr("xl/sharedStrings.xml", f'<sst {namespace}>' + "".join(f'<si><t>{escape(value)}</t></si>' for value in strings) + '</sst>')
        archive.writestr("xl/worksheets/sheet1.xml", f'<worksheet {namespace}><sheetData>' + row_xml(1, headers) + row_xml(2, row) + '</sheetData></worksheet>')


def test_export_preserves_source_and_does_not_treat_basis_or_volume_as_mass(tmp_path: Path) -> None:
    headers = [f"header{i}" for i in range(166)]
    for index, value in EXPECTED.items():
        headers[index] = value
    source, output = tmp_path / "source.xlsx", tmp_path / "output.csv"
    make_xlsx(source, headers)
    export(source, output)
    with output.open(encoding="utf-8", newline="") as file:
        reader = csv.DictReader(file)
        assert tuple(reader.fieldnames or ()) == COLUMNS
        result = list(reader)[0]
    assert result["major_category_code"] == "01"
    assert result["name"] == "식품"
    assert result["weight_grams"] == NULL
    assert result["nutrition_basis"] == "100g"
    assert result["reference_date"] == "2026-08-28"
    assert json.loads(result["source_data"])["식품명"] == "\ufeff 식품 "
    assert json.loads(output.with_suffix(".manifest.json").read_text())["row_count"] == 1


def test_header_rejects_changed_column() -> None:
    headers = [f"header{i}" for i in range(166)]
    for index, value in EXPECTED.items():
        headers[index] = value
    headers[154] = "other"
    with pytest.raises(ConversionError):
        validate_header(headers)
