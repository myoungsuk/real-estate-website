// 업무 도구 단계 2 할 일·반복 할 일 API(설계서 6.13·8.2·8.7·8.8·10.2절 후보, 기획서 WT-2-12, 0006 tasks). 모든 SQL은 준비된 문장(고정 문자열 + bind)만 쓴다.
// 반복은 끝낼 때 같은 batch에서 다음 줄 하나를 새로 만든다(끝낸 줄은 반복을 '없음'으로, 0006 CHECK가 두 번 만들기를 막음).
// 할 일 삭제는 지금 다른 자료처럼 즉시 실제 삭제다(휴지통 PR에서 바꿈). 거래·손님 삭제 때 그 거래의 할 일 지우기는 work-deals·work-customers의 batch가 한다.
// 감사 기록에는 할 일 제목을 남기지 않는다(손님 이름이 들어갈 수 있음).
import { nextTaskDueOn } from "../src/lib/work/task-repeat.mjs";
import { WorkApiError } from "./work-security.mjs";
import { auditStatement, loadThenAudit, runBatch } from "./work-audit.mjs";
import { encodeCursor, encodeTaskCursor, invalid, isUuid, koreaDate, parseTaskCreate, parseTaskPatch, parseTaskQuery, taskRepeatDay } from "./work-input.mjs";
import { all, auditBase, maskReason, methodNotAllowed, notFound } from "./work-customers.mjs";
import { loadDeal } from "./work-deals.mjs";

// 목록 줄의 거래는 { id, title, status }만 싣는다(손님 이름은 싣지 않음).
const TASK_SELECT =
  "SELECT t.id, t.title, t.deal_id, t.due_on, t.repeat_rule, t.repeat_day, t.done_at, t.next_task_id, t.version, t.created_at, t.updated_at,"
  + " d.title AS deal_title, d.status AS deal_status FROM tasks t LEFT JOIN deals d ON d.id = t.deal_id ";

const SQL = Object.freeze({
  taskById: TASK_SELECT + "WHERE t.id = ?",
  // 열린 할 일: 날짜 빠른 순, 날짜 없는 줄은 맨 뒤, 같은 날은 만든 순(만든 시각·id). 커서는 (날짜 없음 여부, 날짜, 만든 시각, id).
  // ? 순서: until, until, 거래, 거래, 커서 id(있는지), 날짜 없음 여부(0/1), 날짜(없으면 ''), 만든 시각, id, limit.
  listOpen:
    TASK_SELECT + "WHERE t.done_at IS NULL AND (? IS NULL OR t.due_on <= ?) AND (? IS NULL OR t.deal_id = ?)"
    + " AND (? IS NULL OR ((t.due_on IS NULL), coalesce(t.due_on, ''), t.created_at, t.id) > (?, ?, ?, ?))"
    + " ORDER BY (t.due_on IS NULL), coalesce(t.due_on, ''), t.created_at, t.id LIMIT ?",
  // 끝낸 할 일: 끝낸 때 최근 순·id 내림차순. 커서는 (끝낸 시각, id).
  listDone:
    TASK_SELECT + "WHERE t.done_at IS NOT NULL AND (? IS NULL OR t.deal_id = ?)"
    + " AND (? IS NULL OR t.done_at < ? OR (t.done_at = ? AND t.id < ?)) ORDER BY t.done_at DESC, t.id DESC LIMIT ?",
  // batch 첫 문장(guard): 조건이 깨졌으면 json('guard')(잘못된 JSON)로 batch 전체를 되돌린다(설계서 8.5절).
  // 만들기: 붙일 거래가 그사이 지워졌으면 되돌린다(장부 dealGuard와 같음).
  dealGuard: "SELECT CASE WHEN ? IS NOT NULL AND NOT EXISTS (SELECT 1 FROM deals WHERE id = ?) THEN json('guard') ELSE 1 END AS ok",
  // 고치기·끝내기: version이 그대로이고, 붙어 있을(또는 새로 붙일) 거래가 아직 있어야 한다. 통과하면 UPDATE가 반드시 들어가므로
  // 다음 줄 INSERT·감사에 따로 조건을 걸지 않는다(같은 끝내기 요청이 두 번 오면 두 번째는 version이 달라 여기서 막힘).
  taskUpdateGuard:
    "SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM tasks WHERE id = ? AND version = ?)"
    + " OR (? IS NOT NULL AND NOT EXISTS (SELECT 1 FROM deals WHERE id = ?)) THEN json('guard') ELSE 1 END AS ok",
  taskExistsGuard: "SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM tasks WHERE id = ?) THEN json('guard') ELSE 1 END AS ok",
  taskInsert:
    "INSERT INTO tasks (id, title, deal_id, due_on, repeat_rule, repeat_day, done_at, version, created_at, updated_at)"
    + " VALUES (?, ?, ?, ?, ?, ?, NULL, 1, ?, ?)",
  // 고치기는 합친 최종 상태를 통째로 쓴다(끝내기면 done_at = 지금, 반복 '없음'·기준일 NULL, 반복이었으면 next_task_id = 새 줄 id).
  taskUpdate:
    "UPDATE tasks SET title = ?, deal_id = ?, due_on = ?, repeat_rule = ?, repeat_day = ?, done_at = ?, next_task_id = ?,"
    + " version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
  taskDelete: "DELETE FROM tasks WHERE id = ?",
});

function taskView(row) {
  return {
    id: row.id,
    title: row.title,
    dueOn: row.due_on,
    repeat: row.repeat_rule,
    repeatDay: row.repeat_day,
    doneAt: row.done_at,
    version: row.version,
    deal: row.deal_id === null ? null : { id: row.deal_id, title: row.deal_title, status: row.deal_status },
  };
}

async function loadTask(db, id) {
  return (await db.prepare(SQL.taskById).bind(id).first()) ?? null;
}

function versionConflict() {
  return new WorkApiError("VERSION_CONFLICT", "다른 화면에서 먼저 고쳤습니다. 다시 불러온 뒤 고쳐 주세요.", 409);
}

function dealGone() {
  return new WorkApiError("VERSION_CONFLICT", "다른 화면에서 거래가 지워졌습니다. 다시 불러온 뒤 저장해 주세요.", 409);
}

// 감사 reason: 처리 메모 코드만(끝냄·다음 줄 만듦·주민번호 가림 수). 제목은 넣지 않는다.
function taskReason(parts) {
  const reason = parts.filter(Boolean).join(" ");
  return reason === "" ? null : reason;
}

async function listTasks(ctx) {
  const query = parseTaskQuery(ctx.url.searchParams);
  return loadThenAudit(ctx.db, async () => {
    let statement;
    if (query.status === "open") {
      const cursor = query.cursor;
      statement = ctx.db.prepare(SQL.listOpen).bind(
        query.until, query.until, query.dealId, query.dealId,
        cursor?.id ?? null, cursor ? (cursor.dueOn === null ? 1 : 0) : null, cursor ? (cursor.dueOn ?? "") : null, cursor?.createdAt ?? null, cursor?.id ?? null,
        query.limit + 1,
      );
    } else {
      statement = ctx.db.prepare(SQL.listDone).bind(
        query.dealId, query.dealId,
        query.cursor?.time ?? null, query.cursor?.time ?? null, query.cursor?.time ?? null, query.cursor?.id ?? null,
        query.limit + 1,
      );
    }
    const rows = await all(statement);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    let nextCursor = null;
    if (rows.length > query.limit && last) {
      nextCursor = query.status === "open" ? encodeTaskCursor(last.due_on, last.created_at, last.id) : encodeCursor(last.done_at, last.id);
    }
    return { items: page.map(taskView), nextCursor };
  }, (data) => auditBase(ctx, "task.list", { reason: `result_count=${data.items.length}` }));
}

async function createTask(ctx) {
  const { task, rrnMasked } = parseTaskCreate(ctx.body);
  if (task.dealId && !(await loadDeal(ctx.db, task.dealId))) throw invalid(["dealId"]);
  const id = ctx.randomUUID();
  const at = new Date(ctx.now).toISOString();
  try {
    await runBatch(ctx.db, [
      ctx.db.prepare(SQL.dealGuard).bind(task.dealId, task.dealId),
      ctx.db.prepare(SQL.taskInsert).bind(id, task.title, task.dealId, task.dueOn, task.repeat, task.repeatDay, at, at),
      auditStatement(ctx.db, { ...auditBase(ctx, "task.create", { targetType: "task", targetId: id, reason: maskReason(rrnMasked) }), outcome: "ok" }),
    ]);
  } catch (error) {
    // guard가 되돌렸으면 그사이 거래가 지워진 것(409). 그 밖에는 저장소 오류 그대로.
    if (task.dealId && !(await loadDeal(ctx.db, task.dealId))) throw dealGone();
    throw error;
  }
  return { status: 201, data: { task: taskView(await loadTask(ctx.db, id)) } };
}

// 고치기·끝내기·다시 열기(PATCH 하나). 보낸 칸만이 아니라 저장된 줄 + 고칠 값의 최종 상태로 검사한다(0006 CHECK 위반이 500이 아니라 400이 되게).
// - 끝내기(열린 줄 → done: true): 그 줄은 done_at = 지금, 반복 '없음'. 반복이었으면 같은 제목·거래·반복으로 다음 날짜 줄을 같은 batch에서 넣는다.
//   다음 날짜는 같은 요청의 다른 칸 고침까지 합친 최종 날짜·반복·기준일로 nextTaskDueOn이 정한다(오늘 = 한국 날짜).
// - 다시 열기(done: false): done_at만 비운다. 반복은 되살리지 않는다(같은 요청에 repeat가 있으면 열린 뒤 값으로 받음).
//   next_task_id는 그대로 두고, 응답 next에 그 다음 줄(아직 있으면)을 실어 "다음 할 일은 따로 남아 있습니다"를 보이게 한다.
//   반복 없이 다시 끝내면 next_task_id도 그대로다(반복으로 다시 끝내면 새 다음 줄 id로 바뀜).
// - 끝낸 채로 남는 줄에 반복('없음' 밖)을 주면 400(repeat). 반복이 있는데 날짜가 없으면 400(dueOn).
// - 매월 기준일은 날짜를 고치거나 매월로 바꾸면 새 날짜의 '일'로, 그 밖에는 그대로(2/28로 당겨진 줄도 31일을 기억, T-6).
async function updateTask(ctx, id) {
  const input = parseTaskPatch(ctx.body);
  const changes = input.changes;
  const current = await loadTask(ctx.db, id);
  if (!current) throw notFound();
  if (current.version !== input.version) throw versionConflict();
  const wasDone = current.done_at !== null;
  const done = changes.done ?? wasDone;
  const merged = {
    title: changes.title ?? current.title,
    dealId: "dealId" in changes ? changes.dealId : current.deal_id,
    dueOn: "dueOn" in changes ? changes.dueOn : current.due_on,
    repeat: changes.repeat ?? current.repeat_rule,
  };
  const keepDay = merged.repeat === "monthly" && current.repeat_rule === "monthly" && !("dueOn" in changes) && current.repeat_day !== null;
  const repeatDay = keepDay ? current.repeat_day : taskRepeatDay(merged.repeat, merged.dueOn);
  const wrong = [];
  if (merged.repeat !== "none" && merged.dueOn === null) wrong.push("dueOn");
  if (wasDone && done && merged.repeat !== "none") wrong.push("repeat");
  if (wrong.length > 0) throw invalid(wrong);
  if ("dealId" in changes && changes.dealId !== null && !(await loadDeal(ctx.db, changes.dealId))) throw invalid(["dealId"]);

  const at = new Date(ctx.now).toISOString();
  const completing = !wasDone && done;
  let nextDueOn = null;
  if (completing && merged.repeat !== "none") {
    nextDueOn = nextTaskDueOn({ dueOn: merged.dueOn, rule: merged.repeat, day: repeatDay, today: koreaDate(ctx.now) });
    if (nextDueOn === null) throw invalid(["dueOn"]); // 네 자리 해를 넘는 날짜
  }
  const nextId = nextDueOn === null ? null : ctx.randomUUID();
  const statements = [
    ctx.db.prepare(SQL.taskUpdateGuard).bind(id, input.version, merged.dealId, merged.dealId),
    ctx.db.prepare(SQL.taskUpdate).bind(
      merged.title, merged.dealId, merged.dueOn,
      done ? "none" : merged.repeat, done ? null : repeatDay,
      done ? (wasDone ? current.done_at : at) : null,
      nextId ?? current.next_task_id,
      at, id, input.version,
    ),
  ];
  if (nextId) {
    statements.push(ctx.db.prepare(SQL.taskInsert).bind(nextId, merged.title, merged.dealId, nextDueOn, merged.repeat, repeatDay, at, at));
  }
  const reason = taskReason([completing ? (nextId ? "done repeat_next" : "done") : null, maskReason(input.rrnMasked)]);
  statements.push(auditStatement(ctx.db, { ...auditBase(ctx, "task.update", { targetType: "task", targetId: id, reason }), outcome: "ok" }));
  try {
    await runBatch(ctx.db, statements);
  } catch (error) {
    // guard가 되돌렸으면 할 일 없음 404, 다른 화면이 먼저 고침(거래 삭제로 지워짐 포함) 409, 붙일 거래가 그사이 지워짐 409.
    const latest = await loadTask(ctx.db, id);
    if (!latest) throw notFound();
    if (latest.version !== input.version) throw versionConflict();
    if (merged.dealId && !(await loadDeal(ctx.db, merged.dealId))) throw dealGone();
    throw error;
  }
  // next: 끝내며 만든 다음 줄, 또는 다시 열 때 그 줄이 전에 만든 다음 줄(지워졌거나 없으면 null). 그 밖의 고치기는 null.
  const reopening = wasDone && !done;
  const nextRowId = nextId ?? (reopening ? current.next_task_id : null);
  const nextRow = nextRowId ? await loadTask(ctx.db, nextRowId) : null;
  return { data: { task: taskView(await loadTask(ctx.db, id)), next: nextRow ? taskView(nextRow) : null } };
}

async function deleteTask(ctx, id) {
  if (ctx.body && Object.keys(ctx.body).length > 0) throw invalid(Object.keys(ctx.body).slice(0, 5));
  if (!(await loadTask(ctx.db, id))) throw notFound();
  try {
    await runBatch(ctx.db, [
      ctx.db.prepare(SQL.taskExistsGuard).bind(id),
      ctx.db.prepare(SQL.taskDelete).bind(id),
      auditStatement(ctx.db, { ...auditBase(ctx, "task.delete", { targetType: "task", targetId: id }), outcome: "ok" }),
    ]);
  } catch (error) {
    if (!(await loadTask(ctx.db, id))) throw notFound();
    throw error;
  }
  return { data: { deleted: true } };
}

// 경로가 할 일(/tasks, /tasks/:id)이면 { status?, data }를, 아니면 null을 돌려준다.
export async function routeWorkTasks(ctx) {
  const [collection, id, extra] = ctx.route.split("/").filter(Boolean);
  if (collection !== "tasks" || extra !== undefined) return null;
  if (id === undefined) {
    if (ctx.method === "GET") return { data: await listTasks(ctx) };
    if (ctx.method === "POST") return createTask(ctx);
    throw methodNotAllowed("GET, POST");
  }
  if (!isUuid(id)) throw notFound();
  if (ctx.method === "PATCH") return updateTask(ctx, id);
  if (ctx.method === "DELETE") return deleteTask(ctx, id);
  throw methodNotAllowed("PATCH, DELETE");
}
