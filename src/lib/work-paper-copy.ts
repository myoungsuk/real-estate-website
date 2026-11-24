// '문구 고치기' 칸 묶기(보드 20번 2판). 칸은 PaperCopyFields.astro가 모양마다 그려 두고, 여기서는 보이기·값 읽기·처음 문구로만 한다.
// 고친 글은 칸(화면 메모리)에만 있고 저장·서버 전송·URL·브라우저 저장소에 넣지 않는다. 검사는 src/lib/work/paper-copy.mjs checkPaperCopy().
export type CopyFields = {
  show: (shape: string) => void;
  values: (shape: string) => Record<string, string>;
  resetAll: () => void;
};

export function bindCopyFields(root: ParentNode, tool: string, onChange: () => void, current: () => string): CopyFields | null {
  const box = root.querySelector<HTMLDetailsElement>(`[data-copy-tool="${tool}"]`);
  if (!box) return null;
  const sets = [...box.querySelectorAll<HTMLElement>("[data-copy-set]")];
  const inputs = (shape: string) => [...(sets.find((set) => set.dataset.copySet === shape)?.querySelectorAll<HTMLInputElement>("[data-copy-key]") ?? [])];
  const show = (shape: string) => { for (const set of sets) set.hidden = set.dataset.copySet !== shape; };
  const values = (shape: string) => Object.fromEntries(inputs(shape).map((input) => [input.dataset.copyKey ?? "", input.value]));
  for (const input of box.querySelectorAll<HTMLInputElement>("[data-copy-key]")) input.addEventListener("input", onChange);
  // '처음 문구로': 보이는 모양의 칸만 처음 값(value 속성)으로 되돌린다.
  box.querySelector<HTMLButtonElement>("[data-copy-reset]")?.addEventListener("click", () => {
    for (const input of inputs(current())) input.value = input.defaultValue;
    onChange();
  });
  const resetAll = () => {
    for (const input of box.querySelectorAll<HTMLInputElement>("[data-copy-key]")) input.value = input.defaultValue;
    box.open = false;
    show(current());
  };
  return { show, values, resetAll };
}
