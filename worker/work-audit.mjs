// 업무 도구 감사 기록(설계서 8.8절). 작업자는 서명 검증된 Access JWT 이메일(소문자)만 쓰고,
// 손님 이름·전화번호·메모 본문·검색어는 남기지 않는다. reason에는 거부·실패 이유 코드 또는 처리 메모 코드
// (예: rrn_masked=2, result_count=7)를 넣는다. 거부 행은 action(request.denied)과 outcome(denied)으로 구분한다.
import { WorkApiError } from "./work-security.mjs";

const AUDIT_INSERT = "INSERT INTO audit_events (at, actor_email, action, target_type, target_id, request_id, outcome, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
// 수정 감사: 그 수정이 실제로 적용됐을 때(새 version·updated_at이 들어갔을 때)만 기록이 남게 같은 batch 안에서 조건을 건다.
const AUDIT_IF_CUSTOMER_UPDATED = "INSERT INTO audit_events (at, actor_email, action, target_type, target_id, request_id, outcome, reason) SELECT ?, ?, ?, ?, ?, ?, 'ok', ? WHERE EXISTS (SELECT 1 FROM customers WHERE id = ? AND version = ? AND updated_at = ?)";
const AUDIT_IF_NOTE_UPDATED = "INSERT INTO audit_events (at, actor_email, action, target_type, target_id, request_id, outcome, reason) SELECT ?, ?, ?, ?, ?, ?, 'ok', ? WHERE EXISTS (SELECT 1 FROM notes WHERE id = ? AND version = ? AND updated_at = ?)";

export function auditStatement(db, entry) {
  return db.prepare(AUDIT_INSERT).bind(
    entry.at,
    entry.actorEmail.toLowerCase(),
    entry.action,
    entry.targetType ?? null,
    entry.targetId ?? null,
    entry.requestId,
    entry.outcome,
    entry.reason ?? null,
  );
}

export function auditIfUpdatedStatement(db, table, entry, { id, version, updatedAt }) {
  const sql = table === "customers" ? AUDIT_IF_CUSTOMER_UPDATED : table === "notes" ? AUDIT_IF_NOTE_UPDATED : null;
  if (!sql) throw new Error("unknown audit table");
  return db.prepare(sql).bind(
    entry.at,
    entry.actorEmail.toLowerCase(),
    entry.action,
    entry.targetType ?? null,
    entry.targetId ?? null,
    entry.requestId,
    entry.reason ?? null,
    id,
    version,
    updatedAt,
  );
}

// 보기 요청: 감사 기록을 먼저 쓰고 성공해야 자료를 돌려준다. 기록이 실패하면 503 AUDIT_UNAVAILABLE로 끝낸다(설계서 8.8절).
export async function withViewAudit(db, entry, load) {
  try {
    await auditStatement(db, { ...entry, outcome: "ok" }).run();
  } catch {
    throw new WorkApiError("AUDIT_UNAVAILABLE", "작업 기록을 남기지 못해 자료를 보여 드리지 않았습니다.", 503, true);
  }
  return load();
}

// 목록·검색·한 건 보기: 자료를 읽은 뒤(결과 개수·대상이 있는지 알아야 하므로) 감사 기록을 쓰고, 기록이 성공해야만 돌려준다.
// 대상이 없으면(null) 기록하지 않고 그대로 돌려준다(호출한 쪽이 404로 처리).
export async function loadThenAudit(db, load, entryFor) {
  const data = await load();
  if (data === null) return null;
  try {
    await auditStatement(db, { ...entryFor(data), outcome: "ok" }).run();
  } catch {
    throw new WorkApiError("AUDIT_UNAVAILABLE", "작업 기록을 남기지 못해 자료를 보여 드리지 않았습니다.", 503, true);
  }
  return data;
}

// 수정·삭제: 같은 D1 batch 안에 감사 기록을 넣어 함께 성공·실패하게 한다.
export async function writeBatchWithAudit(db, statements, entry) {
  try {
    return await db.batch([...statements, auditStatement(db, { ...entry, outcome: "ok" })]);
  } catch {
    throw new WorkApiError("STORAGE_UNAVAILABLE", "업무 자료를 저장하지 못했습니다.", 503, true);
  }
}

export async function runBatch(db, statements) {
  try {
    return await db.batch(statements);
  } catch {
    throw new WorkApiError("STORAGE_UNAVAILABLE", "업무 자료를 저장하지 못했습니다.", 503, true);
  }
}

// D1 batch 결과(meta.changes)와 node:sqlite 결과(changes)를 같은 숫자로 읽는다.
export function changesOf(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}
