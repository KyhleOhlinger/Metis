import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useStore } from "@/store/useStore";

export function applyEditorNavigation(
  view: EditorView,
  offset: number,
  matchEnd?: number,
): void {
  const docLen = view.state.doc.length;
  const from = Math.max(0, Math.min(offset, docLen));
  const to =
    matchEnd !== undefined ? Math.max(from, Math.min(matchEnd, docLen)) : from;
  const selection =
    to > from ? EditorSelection.range(from, to) : EditorSelection.cursor(from);
  view.dispatch({
    selection,
    effects: EditorView.scrollIntoView(from, { y: "center" }),
  });
  useStore.getState().setCursorOffset(from);
  view.focus();
}
