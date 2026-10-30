# MFDS food reference export

Convert the official 2026-08-28 processed-food XLSX with Python 3.11+ and [uv](https://docs.astral.sh/uv/):

```sh
uv run scripts/food_reference/export_xlsx.py '.orca/drops/20260828_가공식품DB_316734건.xlsx' infra/data/korean-food-reference.csv
PYTHONDONTWRITEBYTECODE=1 uv run --with pytest --with 'typer>=0.12,<1' pytest -q -p no:cacheprovider scripts/food_reference/test_export_xlsx.py
```

The export streams worksheet XML, retaining only shared strings and the current row; it does not load the sheet as a table. It validates the 166 distinct headers and the positions of all mapped fields, preserves nonempty original values in `source_data`, and writes the CSV through a sibling `.partial` followed by an atomic rename. The sibling `.manifest.json` records the source SHA-256, date, row count, columns and elapsed conversion time; `.profile.json` records code uniqueness and coverage, category/source distributions, and all source headers. Generated files under `infra/data` are ignored.

`weight_grams` comes only from a single explicit `g`, `kg`, or `mg` value in 식품중량; fractional grams round up, and only values from 1 through 2,147,483,647 grams are accepted. Volumes, multi-packs and other ambiguous labels remain null, as does an absent mass; 영양성분함량기준량 is a nutrition basis, not package weight. Dates accept ISO dates or integer Excel 1900-system serials (excluding the fictitious 1900-02-29); invalid values abort conversion. The source has no photo, barcode, price, or stock column; 식품코드 and 품목제조보고번호 are not barcodes.
