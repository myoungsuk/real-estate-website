// 매물 광고 명시사항 채우기 칸(업무 도구 공용). 글 초안(P3, /admin/work/blog/)에 있던 칸 만들기·읽기·표시를 옮겨 매물 안내지(45번 D)와 함께 쓴다.
// 매물 종류별 규칙(ad-disclosure-rules.json)의 필수·선택 칸만 그리고, 읽은 값은 blog-checks.mjs validateBlogInputs()로 고른 뒤
// ad-disclosure.mjs buildDisclosure()로 빈 칸을 찾는다. 값은 화면 메모리에만 두고 저장·서버 전송·URL·브라우저 저장소에 넣지 않는다.
import { DISCLOSURE_FIELD_LABELS, FEE_ITEMIZE_FROM_WON, FEE_ITEM_KEYS, FEE_ITEM_LABELS, buildDisclosure, formatWon } from "./work/ad-disclosure.mjs";
import { validateBlogInputs } from "./work/blog-checks.mjs";
import { decimalFrom, intFrom } from "./work/blog-view.mjs";

export type Raw = Record<string, unknown>;
export interface DisclosureCategory { id: string; label: string; propertyTypes: string[]; kindChoices: string[]; directionBasisChoices: string[]; floorBandAllowed: boolean; required: string[]; optional: string[] }
// raw: 칸에서 읽은 그대로의 값(검사 전). inputs: validateBlogInputs()로 고른 값.
export interface FieldState { raw: Raw; inputs: Raw; missing: string[]; messages: Map<string, string>; unmapped: string[]; ok: boolean }
// blog-sources.mjs가 만드는 자료 모양(쓰는 칸만).
export interface DisclosureSource {
  type: string;
  id: string;
  title: string;
  category: string | null;
  facts: {
    propertyType?: string | null;
    exclusiveM2?: number | null;
    landM2?: number | null;
    floor?: number | null;
    floorBand?: string | null;
    totalFloors?: number | null;
    direction?: string | null;
  };
}

export const DISCLOSURE_DIRECTIONS = ["남향", "남동향", "남서향", "동향", "서향", "북향", "북동향", "북서향"];
// 검사가 돌려주는 칸 이름 → 화면 줄 이름
const ROW_OF: Record<string, string> = { floorMode: "floor", floorNumber: "floor", floorBand: "floor", directionBasis: "direction", area: "areaM2" };
const ERROR_TEXT: Record<string, string> = {
  areaM2: "㎡ 숫자를 확인합니다(소수 둘째 자리까지).",
  floor: "층 숫자를 확인합니다(지하는 -1처럼).",
  totalFloors: "1 ~ 100 사이 숫자를 넣습니다.",
  rooms: "0 ~ 20 사이 숫자를 넣습니다.",
  bathrooms: "0 ~ 20 사이 숫자를 넣습니다.",
  moveIn: "날짜, 또는 연월과 초순·중순·하순을 확인합니다.",
  parking: "대수를 확인합니다(세대당은 소수 둘째 자리까지).",
  managementFee: "금액과 포함 비목(월 평균), 또는 비목별 금액(정액)을 확인합니다.",
  approvalDate: "날짜를 확인합니다.",
};
// '빈 칸·고칠 칸' 줄처럼 칸 묶음 위에서 글이 줄어드는 줄: 지금까지 가장 높았던 높이를 최소 높이로 남겨 아래 칸이 올라가지 않게 한다.
// 다른 매물을 고르는 등 칸 묶음을 새로 만들 때는 releaseHeight()로 푼다.
export function keepHeight(line: HTMLElement) {
  const height = Math.max(line.getBoundingClientRect().height, Number(line.dataset.blKeepHeight) || 0);
  line.dataset.blKeepHeight = String(height);
  line.style.minHeight = height > 0 ? `${height}px` : "";
}
export function releaseHeight(line: HTMLElement) {
  delete line.dataset.blKeepHeight;
  line.style.minHeight = "";
}
export const disclosureFieldLabel = (key: string) => (key === "areaM2" ? "면적" : (DISCLOSURE_FIELD_LABELS as Record<string, string>)[key] ?? key);

interface Options {
  rules: unknown;
  office: unknown;
  officePhone: string;
  // 칸 id 앞글자(한 화면에 여러 벌을 둘 때 겹치지 않게).
  idPrefix?: string;
  // 소재지 칸을 고칠 때마다 부른다(화면이 메모리에만 들고 있게).
  onLocationInput?: (value: string) => void;
}

export function createDisclosureFields(fieldsBox: HTMLElement, { rules, office, officePhone, idPrefix = "bl", onLocationInput }: Options) {
  const categories = (rules as { categories: DisclosureCategory[] }).categories;
  let readers: ((raw: Raw) => void)[] = [];
  let refreshers: (() => void)[] = [];
  const rows = new Map<string, HTMLElement>();
  let picked: DisclosureSource | null = null;
  let uid = 0;
  const nextId = (prefix: string) => `${prefix}-${(uid += 1)}`;
  function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = "") {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function makeRow(key: string, label: string, { required = true, hint = "", group = false } = {}) {
    const row = el("div", "work-row bl-row");
    row.dataset.blRow = key;
    const id = nextId(`${idPrefix}-f`);
    const labelEl = group ? el("span", "work-row__label", label) : el("label", "work-row__label", label);
    if (group) {
      labelEl.id = `${id}-label`;
      row.setAttribute("role", "group");
      row.setAttribute("aria-labelledby", labelEl.id);
    } else {
      (labelEl as HTMLLabelElement).htmlFor = id;
    }
    if (required) labelEl.append(" ", el("span", "bl-need", "필수"));
    const control = el("div", "work-row__control");
    row.append(labelEl, control);
    rows.set(key, row);
    fieldsBox.append(row);
    return {
      row,
      control,
      id,
      finish() {
        if (hint) control.append(el("small", "", hint));
        const mark = el("small", "bl-empty-mark");
        mark.dataset.blMark = "";
        mark.hidden = true;
        control.append(mark);
      },
    };
  }
  function textField(id: string, { inputMode = "", maxLength = 0, placeholder = "", value = "", type = "text", label = "" } = {}) {
    const input = el("input");
    input.type = type;
    input.id = id;
    input.autocomplete = "off";
    if (inputMode) input.inputMode = inputMode;
    if (maxLength) input.maxLength = maxLength;
    if (placeholder) input.placeholder = placeholder;
    if (label) input.setAttribute("aria-label", label);
    input.value = value;
    return input;
  }
  function segmentField(options: [string, string][], checked = "", label = "") {
    const box = el("div", "work-segment bl-seg");
    const name = nextId(`${idPrefix}-r`);
    box.dataset.cols = String(Math.min(options.length, 4));
    box.setAttribute("role", "radiogroup");
    if (label) box.setAttribute("aria-label", label);
    for (const [value, text] of options) {
      const choice = el("label", "work-choice");
      const input = el("input");
      input.type = "radio";
      input.name = name;
      input.value = value;
      input.autocomplete = "off";
      input.checked = value === checked;
      choice.append(input, el("span", "", text));
      box.append(choice);
    }
    return { box, value: () => box.querySelector<HTMLInputElement>("input:checked")?.value ?? "" };
  }
  function checkField(text: string) {
    const label = el("label", "work-check");
    const input = el("input");
    input.type = "checkbox";
    input.autocomplete = "off";
    label.append(input, el("span", "", text));
    return { label, input };
  }
  const feeLabel = (key: string) => (FEE_ITEM_LABELS as Record<string, string>)[key] ?? key;

  // 고른 자료의 칸을 새로 그린다(null이면 비움). location은 소재지 칸의 처음 값(startLocation).
  function build(source: DisclosureSource | null, { location: startLocation = "" } = {}) {
    picked = source;
    readers = [];
    refreshers = [];
    rows.clear();
    fieldsBox.replaceChildren();
    if (!source) return;
    if (source.type === "complex") {
      fieldsBox.append(el("p", "bl-soft", "단지 소개 글은 사무소 명시사항 5항목만 붙습니다. 채울 칸이 없습니다."));
      return;
    }
    const category = categories.find((entry) => entry.id === source.category);
    if (!category) return;
    const facts = source.facts;
    const want = new Set([...category.required, ...category.optional]);
    const required = (key: string) => category.required.includes(key);
    const land = category.id === "land";

    {
      const r = makeRow("location", "소재지", { hint: "광고에 적는 주소(지번)까지 넣습니다. 호수는 넣지 않습니다. 저장하지 않습니다." });
      const input = textField(r.id, { maxLength: 100, placeholder: "예: 대전광역시 동구 ○○동 123", value: startLocation });
      input.addEventListener("input", () => {
        onLocationInput?.(input.value);
      });
      r.control.append(input);
      r.finish();
      readers.push((raw) => Object.assign(raw, { location: input.value }));
    }

    const knownArea = land ? facts.landM2 : facts.exclusiveM2;
    if (!Number.isFinite(knownArea)) {
      const r = makeRow("areaM2", land ? "토지 면적(㎡)" : "전용면적(㎡)", { hint: "공개 자료에 면적이 없어 직접 넣습니다. ㎡로 넣습니다(평 아님)." });
      const input = textField(r.id, { inputMode: "decimal", placeholder: "예: 84.97" });
      r.control.append(input);
      r.finish();
      readers.push((raw) => { raw.areaM2 = decimalFrom(input.value, 2); });
    }

    let kindValue = () => "";
    {
      const label = land ? "지목" : category.id === "non-residential" ? "건축물 용도" : "건물 종류";
      if (category.kindChoices.length > 0) {
        const r = makeRow("kind", label, { group: true, hint: "건축물대장의 용도로 고릅니다." });
        const preset = category.kindChoices.includes(facts.propertyType ?? "") ? facts.propertyType ?? "" : "";
        const segment = segmentField(category.kindChoices.map((choice): [string, string] => [choice, choice]), preset, label);
        r.control.append(segment.box);
        r.finish();
        kindValue = segment.value;
      } else {
        const r = makeRow("kind", label, { hint: land ? "토지대장의 지목을 넣습니다." : "건축물대장의 용도를 넣습니다." });
        const input = textField(r.id, { maxLength: 30, placeholder: land ? "예: 대" : "예: 제1종 근린생활시설" });
        r.control.append(input);
        r.finish();
        kindValue = () => input.value;
      }
      readers.push((raw) => { raw.kind = kindValue(); });
    }

    if (!land) {
      const r = makeRow("violation", "위반건축물·미등기", { group: true, hint: "건축물대장·등기부로 확인한 값을 고릅니다." });
      const segment = segmentField([["none", "해당 없음"], ["violation", "위반건축물"], ["unregistered", "미등기"]], "", "위반건축물·미등기");
      r.control.append(segment.box);
      r.finish();
      readers.push((raw) => { raw.violation = segment.value(); });
    }

    if (category.id === "multi-family" || category.id === "non-residential" || category.id === "detached") {
      const r = makeRow("floor", "층(소재지에 붙음)", { group: true, hint: category.floorBandAllowed ? "의뢰인이 원하면 저·중·고로 적을 수 있습니다." : "" });
      const startBand = !Number.isSafeInteger(facts.floor) && Boolean(facts.floorBand) && category.floorBandAllowed;
      const modeField = category.floorBandAllowed ? segmentField([["number", "층 그대로"], ["band", "저·중·고로"]], startBand ? "band" : "number", "층 적는 방식") : null;
      const number = textField(nextId(`${idPrefix}-f`), { inputMode: "numeric", value: Number.isSafeInteger(facts.floor) ? String(facts.floor) : "", placeholder: "예: 12 (지하는 -1)", label: "층 숫자" });
      const band = segmentField([["저", "저층"], ["중", "중층"], ["고", "고층"]], facts.floorBand ?? "", "저·중·고");
      if (modeField) r.control.append(modeField.box);
      r.control.append(number, band.box);
      r.finish();
      const floorMode = () => (modeField ? modeField.value() : "number");
      refreshers.push(() => {
        number.hidden = floorMode() !== "number";
        band.box.hidden = floorMode() !== "band";
        r.row.hidden = category.id === "detached" && kindValue() !== "다가구주택";
      });
      readers.push((raw) => {
        if (r.row.hidden) return;
        raw.floorMode = floorMode();
        if (floorMode() === "number") raw.floorNumber = intFrom(number.value);
        else raw.floorBand = band.value() || null;
      });
    }

    if (want.has("totalFloors")) {
      const r = makeRow("totalFloors", "총 층수", { required: required("totalFloors"), hint: Number.isSafeInteger(facts.totalFloors) ? "공개 자료에서 채웠습니다." : "" });
      const input = textField(r.id, { inputMode: "numeric", value: Number.isSafeInteger(facts.totalFloors) ? String(facts.totalFloors) : "", placeholder: "예: 25" });
      r.control.append(input);
      r.finish();
      readers.push((raw) => { raw.totalFloors = intFrom(input.value); });
    }

    if (want.has("moveIn")) {
      const r = makeRow("moveIn", "입주 가능일", { group: true, required: required("moveIn") });
      const type = segmentField([["now", "즉시 입주"], ["date", "날짜"], ["period", "시기"]], "", "입주 가능일 적는 방식");
      const date = textField(nextId(`${idPrefix}-f`), { type: "date", label: "입주 가능 날짜" });
      const month = textField(nextId(`${idPrefix}-f`), { type: "month", placeholder: "예: 2026-12", label: "입주 가능 연월" });
      const part = segmentField([["초순", "초순"], ["중순", "중순"], ["하순", "하순"]], "", "초순·중순·하순");
      r.control.append(type.box, date, month, part.box);
      r.finish();
      refreshers.push(() => {
        date.hidden = type.value() !== "date";
        month.hidden = type.value() !== "period";
        part.box.hidden = type.value() !== "period";
      });
      readers.push((raw) => {
        const value = type.value();
        if (value === "now") raw.moveIn = { type: "now" };
        else if (value === "date" && date.value) raw.moveIn = { type: "date", date: date.value };
        else if (value === "period" && (month.value || part.value())) raw.moveIn = { type: "period", month: month.value, part: part.value() };
      });
    }

    for (const [key, label] of [["rooms", "방 수"], ["bathrooms", category.id === "non-residential" ? "화장실 수" : "욕실 수"]] as const) {
      if (!want.has(key)) continue;
      const r = makeRow(key, label, { required: required(key) });
      const input = textField(r.id, { inputMode: "numeric", placeholder: "예: 2" });
      r.control.append(input);
      r.finish();
      readers.push((raw) => { raw[key] = intFrom(input.value); });
    }

    if (want.has("approvalDate")) {
      const r = makeRow("approvalDate", "사용승인일", { required: required("approvalDate"), hint: "건축물대장의 사용승인일(준공일)입니다." });
      const input = textField(r.id, { type: "date" });
      r.control.append(input);
      r.finish();
      readers.push((raw) => { raw.approvalDate = input.value; });
    }

    if (want.has("parking")) {
      const r = makeRow("parking", "주차", { group: true, required: required("parking"), hint: "세대당은 소수 둘째 자리까지(예: 1.2). 실제로 쓸 수 있는 대수가 다르면 함께 넣습니다." });
      const basis = segmentField([["perHousehold", "세대당"], ["total", "총 대수"]], "perHousehold", "주차 대수 기준");
      const value = textField(nextId(`${idPrefix}-f`), { inputMode: "decimal", placeholder: "예: 1.2", label: "주차 대수" });
      const actual = textField(nextId(`${idPrefix}-f`), { inputMode: "decimal", placeholder: "실제 사용 가능 대수(선택)", label: "실제 사용 가능 대수(선택)" });
      r.control.append(basis.box, value, actual);
      r.finish();
      readers.push((raw) => {
        const amount = basis.value() === "total" ? intFrom(value.value) : decimalFrom(value.value, 2);
        if (amount === null) return;
        const real = decimalFrom(actual.value, 2);
        raw.parking = { basis: basis.value(), value: amount, ...(real === null ? {} : { actual: real }) };
      });
    }

    if (want.has("managementFee")) {
      const must = required("managementFee");
      const r = makeRow("managementFee", "관리비", { group: true, required: must, hint: `월 ${formatWon(FEE_ITEMIZE_FROM_WON)} 이상 정액이면 비목별 금액이 필요합니다.` });
      const options: [string, string][] = [["average", "월 평균"], ["fixed", "정액"]];
      if (!must) options.push(["omit", "적지 않음"]);
      const type = segmentField(options, "", "관리비 방식");
      const won = textField(nextId(`${idPrefix}-f`), { inputMode: "numeric", placeholder: "예: 250000", label: "관리비(원)" });
      const wonHint = el("small", "work-amount-hint");
      const included = el("div", "work-checks bl-fee-items");
      included.setAttribute("role", "group");
      included.setAttribute("aria-label", "포함 비목");
      const includedChecks = (FEE_ITEM_KEYS as string[]).map((key) => {
        const check = checkField(feeLabel(key));
        check.input.value = key;
        included.append(check.label);
        return check.input;
      });
      const fixedBox = el("div", "bl-fee-fixed");
      const unknown = checkField("세부내역을 받지 못함(비목별 금액 확인 불가로 적음)");
      const itemsGrid = el("div", "bl-fee-grid");
      const itemInputs = (FEE_ITEM_KEYS as string[]).map((key) => {
        const input = textField(nextId(`${idPrefix}-f`), { inputMode: "numeric", placeholder: "0", label: `${feeLabel(key)}(원)` });
        const wrap = el("div", "bl-fee-item");
        wrap.append(el("span", "", feeLabel(key)), input);
        itemsGrid.append(wrap);
        return input;
      });
      fixedBox.append(unknown.label, itemsGrid);
      r.control.append(type.box, won, wonHint, included, fixedBox);
      r.finish();
      refreshers.push(() => {
        const monthly = intFrom(won.value);
        won.hidden = type.value() === "omit" || type.value() === "";
        wonHint.textContent = won.hidden || monthly === null || Number.isNaN(monthly) ? "" : formatWon(monthly);
        included.hidden = type.value() !== "average";
        fixedBox.hidden = !(type.value() === "fixed" && monthly !== null && monthly >= FEE_ITEMIZE_FROM_WON);
        itemsGrid.hidden = unknown.input.checked;
      });
      readers.push((raw) => {
        const value = type.value();
        if (value === "omit") {
          raw.managementFee = { type: "omit" };
          return;
        }
        const monthly = intFrom(won.value);
        if (!value || monthly === null) return;
        if (value === "average") {
          raw.managementFee = { type: "average", monthlyWon: monthly, included: includedChecks.filter((input) => input.checked).map((input) => input.value) };
          return;
        }
        const fee: Raw = { type: "fixed", monthlyWon: monthly };
        if (monthly >= FEE_ITEMIZE_FROM_WON) {
          if (unknown.input.checked) fee.itemsUnknown = true;
          else if (itemInputs.some((input) => input.value.trim())) fee.items = Object.fromEntries((FEE_ITEM_KEYS as string[]).map((key, index) => [key, intFrom(itemInputs[index].value) ?? Number.NaN]));
        }
        raw.managementFee = fee;
      });
    }

    if (want.has("direction")) {
      const r = makeRow("direction", "방향", { group: true, required: required("direction") });
      const select = el("select");
      select.autocomplete = "off";
      select.setAttribute("aria-label", "방향");
      select.append(new Option("방향 고르기", ""), ...DISCLOSURE_DIRECTIONS.map((direction) => new Option(direction, direction)));
      select.value = DISCLOSURE_DIRECTIONS.includes(facts.direction ?? "") ? facts.direction ?? "" : "";
      const choices = category.directionBasisChoices;
      const basis = segmentField(choices.map((choice): [string, string] => [choice, `${choice} 기준`]), choices.length === 1 ? choices[0] : "", "방향 기준");
      r.control.append(select, basis.box);
      r.finish();
      readers.push((raw) => {
        raw.direction = select.value || null;
        raw.directionBasis = basis.value() || null;
      });
    }
    refresh();
  }

  // 날짜·시기·정액처럼 고른 방식에 따라 보이는 칸을 다시 맞춘다.
  function refresh() {
    for (const run of refreshers) run();
  }

  function evaluate(): FieldState {
    const raw: Raw = {};
    for (const read of readers) read(raw);
    const source = picked;
    if (!source) return { raw, inputs: {}, missing: [], messages: new Map(), unmapped: [], ok: false };
    const checked = validateBlogInputs(raw, { officePhone });
    const disclosure = buildDisclosure({ source, inputs: checked.inputs, office, rules });
    const missing = disclosure.missing as string[];
    const errors = checked.errors as string[];
    const messages = new Map<string, string>();
    const rowOf = (key: string) => ROW_OF[key] ?? key;
    for (const key of missing) {
      const row = rowOf(key);
      if (!rows.has(row) || messages.has(row)) continue;
      messages.set(row, key === "directionBasis" ? "방향 기준을 고릅니다." : key === "violation" ? "확인해 고릅니다." : "비어 있음 · 비면 만들 수 없습니다.");
    }
    for (const key of errors) messages.set(rowOf(key), ERROR_TEXT[rowOf(key)] ?? "형식이 맞지 않습니다.");
    const fee = raw.managementFee as { type?: string } | undefined;
    if (missing.includes("managementFee") && fee?.type === "fixed") {
      messages.set("managementFee", `월 ${formatWon(FEE_ITEMIZE_FROM_WON)} 이상 정액이면 비목별 금액을 모두 넣거나 '세부내역을 받지 못함'을 고릅니다.`);
    }
    for (const key of checked.personal as string[]) messages.set(key, "주민등록번호·전화번호·이메일·호수처럼 보이는 글자는 넣을 수 없습니다.");
    const unmapped = [...missing, ...errors].filter((key) => !rows.has(rowOf(key)));
    return { raw, inputs: checked.inputs as unknown as Raw, missing, messages, unmapped, ok: messages.size === 0 && unmapped.length === 0 };
  }

  // 줄마다 빨간 테두리·안내 글자(touched가 거짓이면 모두 지움).
  // 한 번 보인 안내 글은 칸을 채워도 자리를 남겨(글은 보이지 않게) 아래 칸이 올라가지 않게 한다.
  function renderMarks(state: FieldState, touched: boolean) {
    for (const [key, row] of rows) {
      const message = touched ? state.messages.get(key) : undefined;
      row.classList.toggle("bl-row--empty", Boolean(message));
      const mark = row.querySelector<HTMLElement>("[data-bl-mark]");
      if (!mark) continue;
      if (message) {
        mark.textContent = message;
        mark.hidden = false;
        delete mark.dataset.blHeld;
      } else if (touched && !mark.hidden) {
        mark.dataset.blHeld = "";
      } else if (!touched) {
        mark.textContent = "";
        mark.hidden = true;
        delete mark.dataset.blHeld;
      }
    }
  }

  return { build, refresh, evaluate, renderMarks, rows };
}
