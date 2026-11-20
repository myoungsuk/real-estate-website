// 실거래가·실거래가 설정 화면(P1-d)이 함께 쓰는 화면 조각. 서버 값은 모두 textContent로 넣는다(HTML로 해석하지 않음).
import { backfillBars } from "./work/realprice-view.mjs";

// 과거 채우기 막대 3개(매매 → 분양권 → 전월세)를 target 끝에 다시 그린다. target 안의 다른 것(제목 등)은 그대로 둔다.
export function renderBackfillBars(target: HTMLElement, status: unknown) {
  target.querySelectorAll(".rt-progress").forEach((bar) => bar.remove());
  for (const bar of backfillBars(status)) {
    const box = document.createElement("div");
    box.className = "rt-progress";
    const head = document.createElement("div");
    head.className = "rt-progress__head";
    const label = document.createElement("span");
    label.textContent = bar.label;
    const percent = document.createElement("strong");
    percent.textContent = `${bar.percent}%`;
    head.append(label, percent);
    const track = document.createElement("div");
    track.className = "rt-progress__bar";
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-label", `${bar.label} 과거 자료 채우기`);
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", String(bar.total));
    track.setAttribute("aria-valuenow", String(bar.done));
    const fill = document.createElement("span");
    fill.style.width = `${bar.percent}%`;
    track.append(fill);
    const note = document.createElement("small");
    note.textContent = `${bar.done.toLocaleString("ko-KR")} / ${bar.total.toLocaleString("ko-KR")}개 달${bar.note ? ` · ${bar.note}` : ""}`;
    box.append(head, track, note);
    target.append(box);
  }
}
