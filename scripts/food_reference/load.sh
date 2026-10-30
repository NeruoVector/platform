#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 2 ]]; then
  echo "Usage: $0 CSV MANIFEST" >&2
  exit 2
fi
csv=$1
manifest=$2
header='food_code,name,major_category_code,major_category,representative_name,subcategory,manufacturer,importer,distributor,imported,origin_country,food_weight,weight_grams,nutrition_basis,report_number,source_name,generated_date,reference_date,source_data'
IFS= read -r actual_header < "$csv"
[[ "$actual_header" == "$header" ]] || { echo 'Unexpected CSV header' >&2; exit 1; }
jq -e --arg header "$header" '.format_version == 1 and (.row_count | type == "number" and . > 0 and floor == .) and (.source_sha256 | type == "string" and test("^[0-9a-f]{64}$")) and (.dataset_date | type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}$")) and (.columns == ($header | split(",")))' "$manifest" >/dev/null
count=$(jq -r '.row_count' "$manifest")
sha=$(jq -r '.source_sha256' "$manifest")
date=$(jq -r '.dataset_date' "$manifest")
db_option=()
if [[ -n ${FOOD_REFERENCE_DATABASE:-} ]]; then db_option=(-e "PGDATABASE=$FOOD_REFERENCE_DATABASE"); fi
{
  cat <<'SQL'
BEGIN;
SELECT pg_advisory_xact_lock(7811660011);
CREATE TEMP TABLE food_reference_stage (LIKE neurovector.food_reference INCLUDING CONSTRAINTS) ON COMMIT DROP;
\copy food_reference_stage FROM STDIN WITH (FORMAT csv, HEADER true, NULL '\N')
SQL
  cat "$csv"
  printf '\\.\n'
  cat <<'SQL'
DO $$ BEGIN
  IF (SELECT count(*) FROM food_reference_stage) <> current_setting('food_import.expected_count')::bigint THEN
    RAISE EXCEPTION 'CSV row count does not match manifest';
  END IF;
  IF EXISTS (SELECT food_code FROM food_reference_stage GROUP BY food_code HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'CSV contains duplicate food codes';
  END IF;
END $$;
TRUNCATE neurovector.food_reference;
INSERT INTO neurovector.food_reference SELECT * FROM food_reference_stage;
INSERT INTO neurovector.food_reference_dataset (singleton, name, dataset_date, record_count, source_url, sha256)
VALUES (true, '식약처 가공식품DB', :'dataset_date'::date, :'row_count'::bigint,
        'https://various.foodsafetykorea.go.kr/nutrient/general/down/historyList.do', :'source_sha')
ON CONFLICT (singleton) DO UPDATE SET name = EXCLUDED.name, dataset_date = EXCLUDED.dataset_date,
  record_count = EXCLUDED.record_count, source_url = EXCLUDED.source_url, sha256 = EXCLUDED.sha256;
COMMIT;
ANALYZE neurovector.food_reference;
SQL
} | docker compose exec -T "${db_option[@]}" -e "PGOPTIONS=-c food_import.expected_count=$count" postgres sh -c 'exec psql -U "$POSTGRES_USER" -d "${PGDATABASE:-$POSTGRES_DB}" "$@"' sh -X -v ON_ERROR_STOP=1 -v "dataset_date=$date" -v "row_count=$count" -v "source_sha=$sha"
