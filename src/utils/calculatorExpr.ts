/**
 * Safe arithmetic expression evaluator for the toolbar calculator.
 * No eval / Function — tokenize + shunting-yard + RPN only.
 */

const MAX_EXPR_LEN = 200;
const MAX_RPN = 128;
const PREC: Record<string, number> = {
  "^": 4,
  u: 3,
  "*": 2,
  "/": 2,
  "+": 1,
  "-": 1,
};
const RIGHT_ASSOC = new Set(["u", "^"]);

export type CalcEval =
  | { ok: true; value: number; formatted: string }
  | { ok: false; error: string };

type Tok =
  | { t: "num"; v: number }
  | { t: "op"; v: "+" | "-" | "*" | "/" | "^" }
  | { t: "u" }
  | { t: "pct" }
  | { t: "(" }
  | { t: ")" };

function normalizeExpr(src: string): string {
  return src
    .replace(/\s+/g, "")
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/−/g, "-")
    .replace(/\*\*/g, "^");
}

function tokenize(src: string): Tok[] | string {
  const s = normalizeExpr(src);
  if (!s) return [];
  if (s.length > MAX_EXPR_LEN) return "Expression is too long";
  const out: Tok[] = [];
  let i = 0;

  const last = () => out[out.length - 1];
  const unaryContext = () => {
    if (out.length === 0) return true;
    const t = last();
    return t.t === "op" || t.t === "u" || t.t === "(";
  };

  while (i < s.length) {
    const c = s[i];
    if ((c >= "0" && c <= "9") || c === ".") {
      let j = i;
      let dots = 0;
      while (j < s.length && ((s[j] >= "0" && s[j] <= "9") || s[j] === ".")) {
        if (s[j] === ".") dots += 1;
        j += 1;
      }
      const raw = s.slice(i, j);
      if (dots > 1 || raw === ".") return "Invalid number";
      const v = Number(raw);
      if (!Number.isFinite(v)) return "Invalid number";
      out.push({ t: "num", v });
      i = j;
      continue;
    }
    if (c === "(") {
      out.push({ t: "(" });
      i += 1;
      continue;
    }
    if (c === ")") {
      out.push({ t: ")" });
      i += 1;
      continue;
    }
    if (c === "%") {
      out.push({ t: "pct" });
      i += 1;
      continue;
    }
    if (c === "+" || c === "*" || c === "/" || c === "^") {
      if (c === "+" && unaryContext()) {
        i += 1;
        continue;
      }
      out.push({ t: "op", v: c });
      i += 1;
      continue;
    }
    if (c === "-") {
      out.push(unaryContext() ? { t: "u" } : { t: "op", v: "-" });
      i += 1;
      continue;
    }
    return "Invalid character";
  }

  return insertImplicitMul(out);
}

function insertImplicitMul(tokens: Tok[]): Tok[] {
  const out: Tok[] = [];
  for (const tok of tokens) {
    const prev = out[out.length - 1];
    const left = prev && (prev.t === "num" || prev.t === ")" || prev.t === "pct");
    const right = tok.t === "num" || tok.t === "(";
    if (left && right) out.push({ t: "op", v: "*" });
    out.push(tok);
  }
  return out;
}

function toRpn(tokens: Tok[]): Tok[] | string {
  const output: Tok[] = [];
  const ops: Tok[] = [];
  const peek = () => ops[ops.length - 1];

  for (const tok of tokens) {
    if (tok.t === "num") {
      output.push(tok);
      continue;
    }
    if (tok.t === "pct") {
      output.push(tok);
      continue;
    }
    if (tok.t === "u") {
      ops.push(tok);
      continue;
    }
    if (tok.t === "op") {
      while (ops.length) {
        const top = peek();
        if (top.t !== "op" && top.t !== "u") break;
        const topKey = top.t === "u" ? "u" : top.v;
        const tokPrec = PREC[tok.v];
        const topPrec = PREC[topKey];
        const shouldPop = RIGHT_ASSOC.has(tok.v)
          ? topPrec > tokPrec
          : topPrec >= tokPrec;
        if (!shouldPop) break;
        output.push(ops.pop()!);
      }
      ops.push(tok);
      continue;
    }
    if (tok.t === "(") {
      ops.push(tok);
      continue;
    }
    if (tok.t === ")") {
      while (ops.length && peek().t !== "(") {
        output.push(ops.pop()!);
      }
      if (!ops.length) return "Mismatched parentheses";
      ops.pop();
      continue;
    }
  }

  while (ops.length) {
    const top = ops.pop()!;
    if (top.t === "(" || top.t === ")") return "Mismatched parentheses";
    output.push(top);
  }
  if (output.length > MAX_RPN) return "Expression is too long";
  return output;
}

function evalRpn(rpn: Tok[]): number | string {
  const stack: number[] = [];
  for (const tok of rpn) {
    if (tok.t === "num") {
      stack.push(tok.v);
      continue;
    }
    if (tok.t === "pct") {
      if (stack.length < 1) return "Incomplete expression";
      stack.push(stack.pop()! / 100);
      continue;
    }
    if (tok.t === "u") {
      if (stack.length < 1) return "Incomplete expression";
      stack.push(-stack.pop()!);
      continue;
    }
    if (tok.t === "op") {
      if (stack.length < 2) return "Incomplete expression";
      const b = stack.pop()!;
      const a = stack.pop()!;
      let v: number;
      switch (tok.v) {
        case "+":
          v = a + b;
          break;
        case "-":
          v = a - b;
          break;
        case "*":
          v = a * b;
          break;
        case "/":
          if (b === 0) return "Division by zero";
          v = a / b;
          break;
        case "^":
          v = a ** b;
          break;
        default:
          return "Invalid operator";
      }
      if (!Number.isFinite(v)) return "Result is not a finite number";
      stack.push(v);
    }
  }
  if (stack.length !== 1) return "Incomplete expression";
  return stack[0];
}

export function formatCalcNumber(n: number): string {
  if (!Number.isFinite(n)) return "Error";
  const abs = Math.abs(n);
  if (n === 0) return "0";
  if (abs >= 1e12 || abs < 1e-10) {
    return n.toExponential(6).replace(/\.?0+e/, "e");
  }
  const rounded = Math.round(n * 1e12) / 1e12;
  return String(rounded);
}

export function evaluateExpression(src: string): CalcEval {
  const tokens = tokenize(src);
  if (typeof tokens === "string") return { ok: false, error: tokens };
  if (tokens.length === 0) return { ok: false, error: "" };
  const rpn = toRpn(tokens);
  if (typeof rpn === "string") return { ok: false, error: rpn };
  const value = evalRpn(rpn);
  if (typeof value === "string") return { ok: false, error: value };
  return { ok: true, value, formatted: formatCalcNumber(value) };
}

export function looksLikeCalcExpression(src: string): boolean {
  const s = normalizeExpr(src);
  if (!s || s.length > MAX_EXPR_LEN) return false;
  return /^[0-9.+*/^%()×÷−\-]+$/.test(s);
}

/** Negate the last number (or wrap the expression if there isn't a trailing number). */
export function negateLastNumber(expr: string): string {
  const s = expr.trimEnd();
  if (!s) return "-";
  const m = /^(.*?)(\d+\.?\d*|\.\d+)$/.exec(s);
  if (!m) return `-(${s})`;
  const head = m[1];
  const num = m[2];
  if (head.endsWith("-") || head.endsWith("−")) {
    const before = head.slice(0, -1);
    const unary = before === "" || /[+\-*/^×÷−(]$/.test(before);
    if (unary) return before + num;
    return `${head}(-${num})`;
  }
  return `${head}-${num}`;
}
