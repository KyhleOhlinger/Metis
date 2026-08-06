import { lintGutter } from "@codemirror/lint";
import { spellcheckLinter } from "../spellcheck";

export function makeSpellcheckExt(enabled: boolean, language: string) {
  return enabled ? [spellcheckLinter(language), lintGutter()] : [];
}
