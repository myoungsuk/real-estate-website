// 실거래가 대전 5개 구 넓히기(0008, 2026-11-25 사용자 결정 "대전만 하면 될 것 같아") 시험.
// 진짜 SQLite(node:sqlite)에 migrations/work 0001 ~ 0007을 적용하고 가상 자료를 넣은 뒤 0008을 적용해 본다. 원격 D1·외부 요청은 쓰지 않는다.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  REALPRICE_BASE_LAWD, REALPRICE_LAWD_CODES, REALPRICE_REGIONS, isRealpriceLawd, lawdOfAptSeq, regionFullName, regionName,
} from "../src/lib/work/realprice-regions.mjs";
import { allMigrationSql, migrationFiles, rows } from "./work-test-kit.mjs";

const INDEX_0008 = migrationFiles.indexOf("0008_realprice_regions.sql");
const sql0008 = allMigrationSql[INDEX_0008];

test("TK-141 구 목록 한 곳(realprice-regions.mjs)과 0008의 CHECK 두 곳이 글자까지 같고, 동구가 맨 앞(기존 거래 ID 기준 구)", () => {
  assert.equal(INDEX_0008, 7, "0008은 0007 바로 뒤 새 파일");
  const checks = [...sql0008.matchAll(/lawd_cd IN \(([^)]*)\)/gu)].map((match) => match[1].split(",").map((item) => item.trim().replace(/^'|'$/gu, "")));
  assert.equal(checks.length, 2, "rt_trades 칸과 rt_fetch_months 칸");
  for (const list of checks) assert.deepEqual(list, [...REALPRICE_LAWD_CODES]);
  assert.deepEqual(REALPRICE_REGIONS.map((region) => [region.code, region.name]), [["30110", "동구"], ["30140", "중구"], ["30170", "서구"], ["30200", "유성구"], ["30230", "대덕구"]]);
  assert.equal(REALPRICE_BASE_LAWD, REALPRICE_LAWD_CODES[0]);
  for (const region of REALPRICE_REGIONS) {
    assert.ok(region.umdNames.length > 0, region.name);
    assert.deepEqual([...region.umdNames], [...new Set(region.umdNames)], `${region.name} 법정동 중복 없음`);
    for (const name of region.umdNames) assert.match(name, /^[가-힣]+동$/u, `${region.name} ${name}`);
  }
  assert.deepEqual([regionName("30170"), regionFullName("30170"), regionName("11110"), regionFullName("11110")], ["서구", "대전 서구", "", "대전"]);
  assert.deepEqual(["30170-1234", "30110-1", "11110-1", "A1", "", null, undefined, "30170"].map(lawdOfAptSeq), ["30170", "30110", null, null, null, null, null, "30170"]);
  assert.deepEqual(["30110", "30230", "30111", " 30110", 30110, null].map(isRealpriceLawd), [true, true, false, false, false, false]);
});

// 0001 ~ 0007을 적용하고 동구 가상 자료를 넣는다(지금 운영 D1과 같은 모양, 행 수는 작게).
function before0008() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON;");
  for (const sql of allMigrationSql.slice(0, INDEX_0008)) database.exec(sql);
  const trade = database.prepare(`INSERT INTO rt_trades (trade_key, kind, deal_ymd, deal_date, umd_nm, jibun, apt_seq, cmp_seq, apt_nm, area_x100, floor, build_year,
    price_won, deposit_won, monthly_rent_won, dealing_gbn, cancelled, cancelled_on, registered_on, apt_dong, extra_json, is_backfill, first_seen_at, updated_at)
    VALUES (?, ?, ?, ?, '가상동', '1', '30110-1', '30110-1', '가상숲', 8497, 3, 2020, ?, ?, ?, ?, 0, NULL, NULL, NULL, '{}', 1, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')`);
  const kinds = ["sale", "presale", "rent"];
  for (let index = 0; index < 300; index += 1) {
    const kind = kinds[index % 3];
    const ymd = `20${String(10 + (index % 16)).padStart(2, "0")}0${1 + (index % 9)}`;
    trade.run(`${kind}:${ymd}:${String(index).padStart(20, "0")}:1`, kind, ymd, `${ymd.slice(0, 4)}-${ymd.slice(4)}-01`,
      kind === "rent" ? null : 300_000_000 + index, kind === "rent" ? 100_000_000 : null, kind === "rent" ? 0 : null, kind === "rent" ? null : "broker");
  }
  const month = database.prepare(`INSERT INTO rt_fetch_months (kind, deal_ymd, status, row_count, dropped_count, held_count, attempts, last_error, last_success_at, next_due_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  month.run("sale", "202611", "ok", 12, 1, null, 0, null, "2026-11-24T00:00:00.000Z", "2026-11-25T00:00:00.000Z");
  month.run("rent", "202610", "held", 3, 0, 40, 2, null, "2026-11-20T00:00:00.000Z", "2026-11-24T00:00:00.000Z");
  month.run("presale", "202609", "failed", 0, 0, null, 3, "RT_TIMEOUT", null, "2026-11-24T01:00:00.000Z");
  database.prepare(`INSERT INTO trash_batches (id, kind, target_id, label, schema_version, deleted_at, deleted_by, request_id, purge_after)
    VALUES ('b7', 'task', 't', '가상 할 일', 7, '2026-11-24T00:00:00.000Z', 'owner@example.com', 'r', '2026-12-01T00:00:00.000Z')`).run();
  database.prepare(`INSERT INTO trash_batches (id, kind, target_id, label, schema_version, deleted_at, deleted_by, request_id, purge_after)
    VALUES ('b6', 'task', 't2', '가상 옛 할 일', 6, '2026-11-20T00:00:00.000Z', 'owner@example.com', 'r', '2026-11-27T00:00:00.000Z')`).run();
  return database;
}

const indexes = (database) => rows(database, "SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name");

test("TK-142 0008: 동구 거래 행·ID는 그대로 30110으로 읽히고, 받은 달 기록은 30110으로 옮겨지며 칸 값이 같고, 색인은 늘지 않고, 7번 휴지통 묶음만 8로 옮긴다", () => {
  const database = before0008();
  const tradesBefore = rows(database, "SELECT * FROM rt_trades ORDER BY trade_key");
  const monthsBefore = rows(database, "SELECT * FROM rt_fetch_months ORDER BY kind, deal_ymd");
  const indexesBefore = indexes(database);
  database.exec(sql0008);

  const tradesAfter = rows(database, "SELECT * FROM rt_trades ORDER BY trade_key");
  assert.equal(tradesAfter.length, tradesBefore.length, "거래 행 수 그대로");
  assert.deepEqual(tradesAfter.map(({ lawd_cd, ...rest }) => rest), tradesBefore, "거래 ID·칸 값 그대로");
  assert.deepEqual([...new Set(tradesAfter.map((row) => row.lawd_cd))], ["30110"]);

  const monthsAfter = rows(database, "SELECT * FROM rt_fetch_months ORDER BY kind, deal_ymd");
  assert.deepEqual(monthsAfter, monthsBefore.map((row) => ({ lawd_cd: "30110", ...row })), "받은 달 기록 칸 값 그대로 + 구 30110");
  assert.deepEqual(rows(database, "PRAGMA table_info(rt_fetch_months)").filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk).map((column) => column.name), ["lawd_cd", "kind", "deal_ymd"]);

  assert.deepEqual(indexes(database), indexesBefore, "색인은 더하거나 빼지 않음");
  assert.deepEqual(rows(database, "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'rt_fetch_months%'").map((row) => row.name), ["rt_fetch_months"], "옮길 때 쓴 표는 남지 않음");
  assert.equal(rows(database, "SELECT value_json FROM settings WHERE key = 'schema_version'")[0].value_json, "8");
  assert.deepEqual(rows(database, "SELECT id, schema_version FROM trash_batches ORDER BY id").map((row) => [row.id, row.schema_version]), [["b6", 6], ["b7", 8]], "7번 묶음은 되살릴 수 있게 8로, 그보다 옛 묶음은 그대로");
  assert.deepEqual(rows(database, "PRAGMA foreign_key_check"), []);
  assert.equal(rows(database, "PRAGMA integrity_check")[0].integrity_check, "ok");
});

test("TK-143 0008 뒤: 5개 구 밖 구 코드는 두 표 모두 CHECK로 막고, 같은 종류·같은 달을 구마다 따로 적을 수 있다", () => {
  const database = before0008();
  database.exec(sql0008);
  const insertMonth = database.prepare("INSERT INTO rt_fetch_months (lawd_cd, kind, deal_ymd, next_due_at) VALUES (?, 'sale', '202611', '2026-11-25T00:00:00.000Z')");
  for (const code of REALPRICE_LAWD_CODES.slice(1)) insertMonth.run(code);
  assert.equal(rows(database, "SELECT COUNT(*) AS n FROM rt_fetch_months WHERE kind = 'sale' AND deal_ymd = '202611'")[0].n, 5);
  assert.throws(() => insertMonth.run("11110"), /CHECK constraint failed/u);
  assert.throws(() => insertMonth.run("30170"), /UNIQUE|PRIMARY KEY/u, "같은 구·종류·달은 한 줄");
  assert.throws(() => database.exec("INSERT INTO rt_fetch_months (kind, deal_ymd, next_due_at) VALUES ('sale', '202612', 'x')"), /NOT NULL/u, "받은 달 기록은 구를 반드시 적음");
  assert.throws(() => database.exec("UPDATE rt_trades SET lawd_cd = '11110'"), /CHECK constraint failed/u);
});
