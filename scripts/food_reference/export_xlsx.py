#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["typer>=0.12,<1"]
# ///
# ─── How to run ───
# 1. Install uv: curl -LsSf https://astral.sh/uv/install.sh | sh
# 2. Run: uv run scripts/food_reference/export_xlsx.py SOURCE.xlsx OUTPUT.csv
# ──────────────────
from __future__ import annotations

import csv
import hashlib
import json
import re
import time
from collections import Counter
from collections.abc import Callable
from datetime import date, timedelta
from decimal import Decimal, ROUND_CEILING
from pathlib import Path
from typing import BinaryIO, Final
from xml.parsers import expat
from zipfile import ZipFile

import typer

NULL: Final = r"\N"
COLUMNS: Final = ("food_code", "name", "major_category_code", "major_category", "representative_name", "subcategory", "manufacturer", "importer", "distributor", "imported", "origin_country", "food_weight", "weight_grams", "nutrition_basis", "report_number", "source_name", "generated_date", "reference_date", "source_data")
INDICES: Final = (0, 1, 6, 7, 9, 13, 156, 157, 158, 159, 161, 154, 16, 155, 152, 164, 165)
EXPECTED: Final = {0: "식품코드", 1: "식품명", 6: "식품대분류코드", 7: "식품대분류명", 9: "대표식품명", 13: "식품소분류명", 16: "영양성분함량기준량", 152: "출처명", 154: "식품중량", 155: "품목제조보고번호", 156: "제조사명", 157: "수입업체명", 158: "유통업체명", 159: "수입여부", 161: "원산지국명", 164: "데이터생성일자", 165: "데이터기준일자"}
MASS: Final = re.compile(r"([0-9]+(?:\.[0-9]+)?)\s*(kg|mg|g)", re.IGNORECASE)
CELL_COLUMN: Final = re.compile(r"([A-Z]+)[0-9]+\Z")

class ConversionError(Exception):
    """A source value or workbook structure violates the conversion contract."""


def clean(value: str) -> str:
    return value.strip().strip("\ufeff").strip()


def mass_grams(value: str) -> str:
    match = MASS.fullmatch(clean(value))
    if not match:
        return NULL
    number = Decimal(match.group(1))
    factors = {"g": Decimal(1), "kg": Decimal(1000), "mg": Decimal("0.001")}
    grams = number * factors[match.group(2).lower()]
    if grams <= 0 or grams > 2_147_483_647:
        return NULL
    return str(int(grams.to_integral_value(rounding=ROUND_CEILING)))


def normalize_date(value: str) -> str:
    value = clean(value)
    if not value:
        return NULL
    try:
        if re.fullmatch(r"[0-9]+", value):
            serial = int(value)
            if serial < 1 or serial == 60:
                raise ConversionError(f"Invalid Excel date serial: {value}")
            return (date(1899, 12, 31) + timedelta(days=serial - (serial > 60))).isoformat()
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            raise ConversionError(f"Invalid date: {value!r}")
        return date.fromisoformat(value).isoformat()
    except (ValueError, OverflowError) as error:
        raise ConversionError(f"Invalid date: {value!r}") from error


def imported(value: str) -> str:
    value = clean(value).upper()
    if value == "Y":
        return "true"
    if value == "N":
        return "false"
    if value in ("", "해당없음"):
        return NULL
    raise ConversionError(f"Invalid imported flag: {value!r}")


def column_number(reference: str) -> int:
    match = CELL_COLUMN.fullmatch(reference)
    if match is None:
        raise ConversionError(f"Invalid cell reference: {reference!r}")
    result = 0
    for char in match.group(1):
        result = result * 26 + ord(char) - 64
    return result - 1


def parse_xml(
    stream: BinaryIO,
    start: Callable[[str, dict[str, str]], None],
    end: Callable[[str], None],
    chars: Callable[[str], None],
) -> None:
    parser = expat.ParserCreate(namespace_separator="}")
    parser.StartElementHandler = start
    parser.EndElementHandler = end
    parser.CharacterDataHandler = chars
    while chunk := stream.read(1024 * 1024):
        parser.Parse(chunk, False)
    parser.Parse(b"", True)


def shared_strings(archive: ZipFile) -> list[str]:
    values: list[str] = []
    parts: list[str] = []
    in_text = False
    def start(name: str, attrs: dict[str, str]) -> None:
        nonlocal in_text
        if name.endswith("}si"):
            parts.clear()
        if name.endswith("}t"):
            in_text = True
    def end(name: str) -> None:
        nonlocal in_text
        if name.endswith("}t"):
            in_text = False
        if name.endswith("}si"):
            values.append("".join(parts))
    def chars(value: str) -> None:
        if in_text:
            parts.append(value)
    with archive.open("xl/sharedStrings.xml") as stream:
        parse_xml(stream, start, end, chars)
    return values


def validate_header(headers: list[str]) -> None:
    if len(headers) != 166 or len(set(headers)) != 166 or any(not h for h in headers):
        raise ConversionError("Expected 166 distinct nonempty headers")
    for index, expected in EXPECTED.items():
        if headers[index] != expected:
            raise ConversionError(f"Header {index + 1}: expected {expected!r}, got {headers[index]!r}")


def export(source: Path, output: Path) -> None:
    started = time.time()
    digest = hashlib.sha256()
    with source.open("rb") as file:
        while chunk := file.read(1024 * 1024):
            digest.update(chunk)
    output.parent.mkdir(parents=True, exist_ok=True)
    partial = output.with_name(output.name + ".partial")
    manifest_path = output.with_suffix(".manifest.json")
    profile_path = output.with_suffix(".profile.json")
    categories: Counter[str] = Counter()
    category_codes: Counter[str] = Counter()
    sources: Counter[str] = Counter()
    codes: Counter[str] = Counter()
    missing: Counter[str] = Counter()
    count = 0
    headers: list[str] = []
    row: list[str] = []
    current_column = 0
    cell_type = ""
    cell_value: list[str] = []
    in_value = False
    with ZipFile(source) as archive, partial.open("w", encoding="utf-8", newline="") as target:
        strings = shared_strings(archive)
        writer = csv.writer(target, lineterminator="\n")
        writer.writerow(COLUMNS)
        def start(name: str, attrs: dict[str, str]) -> None:
            nonlocal row, current_column, cell_type, in_value
            if name.endswith("}row"):
                row = [""] * 166
            elif name.endswith("}c"):
                current_column = column_number(attrs["r"])
                if current_column >= 166:
                    raise ConversionError(f"Unexpected column: {attrs['r']}")
                cell_type = attrs.get("t", "n")
                cell_value.clear()
            elif name.endswith("}v") or (name.endswith("}t") and cell_type == "inlineStr"):
                in_value = True
        def chars(value: str) -> None:
            if in_value:
                cell_value.append(value)
        def end(name: str) -> None:
            nonlocal in_value, count, headers
            if name.endswith("}v") or name.endswith("}t"):
                in_value = False
            elif name.endswith("}c"):
                raw = "".join(cell_value)
                if cell_type == "s" and raw:
                    raw = strings[int(raw)]
                row[current_column] = raw
            elif name.endswith("}row"):
                if not headers:
                    headers = [clean(value) for value in row]
                    validate_header(headers)
                    return
                count += 1
                values = [clean(row[index]) for index in INDICES]
                weight = mass_grams(values[11])
                raw_data = {header: value for header, value in zip(headers, row, strict=True) if value != ""}
                writer.writerow((*values[:9], imported(values[9]), values[10], values[11], weight, values[12], values[13], values[14], normalize_date(values[15]), normalize_date(values[16]), json.dumps(raw_data, ensure_ascii=False, separators=(",", ":"))))
                codes[values[0]] += 1
                categories[values[3]] += 1
                category_codes[values[2]] += 1
                sources[values[14]] += 1
                for key, absent in (("food_code", not values[0]), ("name", not values[1]), ("major_category_code", not values[2]), ("major_category", not values[3]), ("source_name", not values[14]), ("food_weight", not values[11]), ("weight_grams", weight == NULL)):
                    missing[key] += int(absent)
        with archive.open("xl/worksheets/sheet1.xml") as stream:
            parse_xml(stream, start, end, chars)
    if not headers:
        raise ConversionError("Workbook has no header")
    elapsed = round(time.time() - started, 3)
    profile = {"row_count": count, "unique_food_codes": len(codes), "duplicate_food_code_rows": sum(n - 1 for n in codes.values()), "missing": dict(missing), "major_categories": dict(sorted(categories.items())), "major_category_codes": dict(sorted(category_codes.items())), "source_names": dict(sorted(sources.items())), "source_columns": headers, "absent_columns": ["photo", "barcode", "price", "stock"], "source_comparison": "The workbook contains no photo, barcode, price, or stock columns. Food code and report number are identifiers, not barcodes; nutrition basis is not package mass."}
    manifest = {"format_version": 1, "source_filename": source.name, "source_sha256": digest.hexdigest(), "dataset_date": "2026-08-28", "row_count": count, "columns": COLUMNS, "conversion_seconds": elapsed}
    for path, data in ((manifest_path, manifest), (profile_path, profile)):
        temp = path.with_name(path.name + ".partial")
        temp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temp.replace(path)
    partial.replace(output)
    print(json.dumps({"csv": str(output), "manifest": str(manifest_path), "profile": str(profile_path), "row_count": count, "unique_food_codes": len(codes), "conversion_seconds": elapsed}, ensure_ascii=False))


def main(source: Path, output: Path) -> None:
    """Stream an MFDS workbook into the food reference CSV contract."""
    export(source, output)


if __name__ == "__main__":
    typer.run(main)
