// utils/checkParser.ts

// Parse a JS-like boolean expression into a PostgreSQL-compatible boolean expression.
// Supports: identifiers, function calls, numbers, strings, booleans, null, parentheses,
// operators: === == !== != > >= < <= && || AND OR !

// ------------------------------------------------------
// TOKEN TYPES
// ------------------------------------------------------
type Token =
  | { type: "num"; value: string }
  | { type: "str"; value: string }
  | { type: "ident"; value: string }
  | { type: "op"; value: string }
  | { type: "punc"; value: string }
  | { type: "eof"; value: null };

// ------------------------------------------------------
// CHARACTER HELPERS (safe for undefined)
// ------------------------------------------------------
function isWhitespace(ch: string | undefined): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && /[0-9]/.test(ch);
}

function isIdentStart(ch: string | undefined): boolean {
  return ch !== undefined && /[a-zA-Z_]/.test(ch);
}

function isIdentPart(ch: string | undefined): boolean {
  return ch !== undefined && /[a-zA-Z0-9_.$]/.test(ch);
}

function escapeSqlString(s: string) {
  return s.replace(/'/g, "''");
}

// ------------------------------------------------------
// TOKENIZER
// ------------------------------------------------------
function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    const ch: string | undefined = input[i];

    if (isWhitespace(ch)) {
      i++;
      continue;
    }

    // punctuation
    if (ch === "(" || ch === ")" || ch === "," || ch === "[" || ch === "]") {
      tokens.push({ type: "punc", value: ch });
      i++;
      continue;
    }

    const two = input.slice(i, i + 2);
    const three = input.slice(i, i + 3);

    // operators
    if (three === "===" || three === "!==") {
      tokens.push({ type: "op", value: three });
      i += 3;
      continue;
    }

    if (
      two === "==" ||
      two === "!=" ||
      two === ">=" ||
      two === "<=" ||
      two === "&&" ||
      two === "||"
    ) {
      tokens.push({ type: "op", value: two });
      i += 2;
      continue;
    }

    if (
      ch === ">" ||
      ch === "<" ||
      ch === "!" ||
      ch === "+" ||
      ch === "-" ||
      ch === "*" ||
      ch === "/"
    ) {
      tokens.push({ type: "op", value: ch });
      i++;
      continue;
    }

    // strings
    if (ch === "'" || ch === '"') {
      const quote = ch;
      let j = i + 1;
      let buf = "";
      let closed = false;

      while (j < len) {
        const cj = input[j];
        if (cj === "\\") {
          if (j + 1 < len) {
            buf += input[j + 1];
            j += 2;
            continue;
          }
        }
        if (cj === quote) {
          closed = true;
          j++;
          break;
        }
        buf += cj;
        j++;
      }

      if (!closed) {
        throw new SyntaxError(
          "Unterminated string literal in check expression"
        );
      }

      tokens.push({ type: "str", value: buf });
      i = j;
      continue;
    }

    // numbers
    if (isDigit(ch) || (ch === "-" && isDigit(input[i + 1]))) {
      let j = i;
      let seenDot = false;

      if (input[j] === "-") j++;

      while (j < len) {
        const cj = input[j];
        if (cj === ".") {
          if (seenDot) break;
          seenDot = true;
          j++;
          continue;
        }
        if (!isDigit(cj)) break;
        j++;
      }

      tokens.push({ type: "num", value: input.slice(i, j) });
      i = j;
      continue;
    }

    // identifiers / keywords
    if (isIdentStart(ch)) {
      let j = i + 1;
      while (j < len && isIdentPart(input[j])) j++;

      const raw = input.slice(i, j);
      const upper = raw.toUpperCase();

      // SQL operators
      if (upper === "AND") {
        tokens.push({ type: "op", value: "&&" });
        i = j;
        continue;
      }
      if (upper === "OR") {
        tokens.push({ type: "op", value: "||" });
        i = j;
        continue;
      }

      tokens.push({ type: "ident", value: raw });
      i = j;
      continue;
    }

    throw new SyntaxError(`Unexpected character "${ch}" in check expression`);
  }

  tokens.push({ type: "eof", value: null });
  return tokens;
}

// ------------------------------------------------------
// AST NODE TYPES
// ------------------------------------------------------
type ASTNode =
  | { type: "Literal"; value: string | number | boolean | null }
  | { type: "Identifier"; name: string }
  | { type: "FunctionCall"; name: string; args: ASTNode[] }
  | { type: "UnaryOp"; op: string; expr: ASTNode }
  | { type: "BinaryOp"; op: string; left: ASTNode; right: ASTNode }
  | { type: "ArrayLit"; items: ASTNode[] };

// ------------------------------------------------------
// PARSER (SAFE peek/next)
// ------------------------------------------------------
function parse(tokens: Token[]) {
  let idx = 0;

  function peek(): Token {
    return tokens[idx] ?? { type: "eof", value: null };
  }

  function next(): Token {
    return tokens[idx++] ?? { type: "eof", value: null };
  }

  function expectPunc(ch: string) {
    const t = peek();
    if (t.type === "punc" && t.value === ch) {
      next();
      return;
    }
    throw new SyntaxError(`Expected "${ch}" in check expression`);
  }

  // Grammar
  function parseExpression(): ASTNode {
    return parseOr();
  }

  function parseOr(): ASTNode {
    let node = parseAnd();
    while (peek().type === "op" && peek().value === "||") {
      next();
      node = { type: "BinaryOp", op: "||", left: node, right: parseAnd() };
    }
    return node;
  }

  function parseAnd(): ASTNode {
    let node = parseNot();
    while (peek().type === "op" && peek().value === "&&") {
      next();
      node = { type: "BinaryOp", op: "&&", left: node, right: parseNot() };
    }
    return node;
  }

  function parseNot(): ASTNode {
    if (peek().type === "op" && peek().value === "!") {
      next();
      return { type: "UnaryOp", op: "!", expr: parseNot() };
    }
    return parseComparison();
  }

  function parseComparison(): ASTNode {
    let left = parseAdd();
    const t = peek();

    if (t.type === "op" && /^(===|==|!==|!=|>=|<=|>|<)$/.test(t.value)) {
      const op = next().value!;
      return { type: "BinaryOp", op, left, right: parseAdd() };
    }

    return left;
  }

  function parseAdd(): ASTNode {
    let node = parsePrimary();
    while (
      peek().type === "op" &&
      ["+", "-", "*", "/"].includes(peek().value!)
    ) {
      const op = next().value!;
      node = { type: "BinaryOp", op, left: node, right: parsePrimary() };
    }
    return node;
  }

  function parsePrimary(): ASTNode {
    const t = peek();

    if (t.type === "num") {
      next();
      return { type: "Literal", value: Number(t.value) };
    }

    if (t.type === "str") {
      next();
      return { type: "Literal", value: t.value };
    }

    // true/false/null literals (DO NOT CONSUME OTHER IDENTIFIERS)
    if (t.type === "ident") {
      const raw = t.value.toLowerCase();
      if (raw === "true") {
        next();
        return { type: "Literal", value: true };
      }
      if (raw === "false") {
        next();
        return { type: "Literal", value: false };
      }
      if (raw === "null") {
        next();
        return { type: "Literal", value: null };
      }
    }

    // identifier or function call
    if (t.type === "ident") {
      const id = next().value!;

      // function call
      if (peek().type === "punc" && peek().value === "(") {
        next(); // (
        const args: ASTNode[] = [];
        if (!(peek().type === "punc" && peek().value === ")")) {
          while (true) {
            args.push(parseExpression());
            if (peek().type === "punc" && peek().value === ",") {
              next();
              continue;
            }
            break;
          }
        }
        expectPunc(")");
        return { type: "FunctionCall", name: id, args };
      }

      // array literal (simple)
      if (peek().type === "punc" && peek().value === "[") {
        next(); // [
        const items: ASTNode[] = [];
        if (!(peek().type === "punc" && peek().value === "]")) {
          while (true) {
            items.push(parseExpression());
            if (peek().type === "punc" && peek().value === ",") {
              next();
              continue;
            }
            break;
          }
        }
        expectPunc("]");
        return { type: "ArrayLit", items };
      }

      return { type: "Identifier", name: id };
    }

    if (t.type === "punc" && t.value === "(") {
      next();
      const node = parseExpression();
      expectPunc(")");
      return node;
    }

    throw new SyntaxError("Unexpected token in check expression");
  }

  const ast = parseExpression();

  if (peek().type !== "eof") {
    throw new SyntaxError("Unexpected content after end of expression");
  }

  return ast;
}

// ------------------------------------------------------
// AST → SQL
// ------------------------------------------------------
function astToSql(node: ASTNode): string {
  switch (node.type) {
    case "Literal": {
      const v = node.value;
      if (v === null) return "NULL";
      if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
      if (typeof v === "number") return String(v);
      return `'${escapeSqlString(String(v))}'`;
    }

    case "Identifier":
      return node.name;

    case "FunctionCall":
      return `${node.name}(${node.args.map(astToSql).join(", ")})`;

    case "ArrayLit":
      return `ARRAY[${node.items.map(astToSql).join(", ")}]`;

    case "UnaryOp":
      return `NOT (${astToSql(node.expr)})`;

    case "BinaryOp": {
      const opMap: Record<string, string> = {
        "||": "OR",
        "&&": "AND",
        "===": "=",
        "==": "=",
        "!==": "<>",
        "!=": "<>",
      };

      const op = opMap[node.op] ?? node.op;
      return `(${astToSql(node.left)} ${op} ${astToSql(node.right)})`;
    }
  }

  throw new Error("Unsupported AST node");
}

// ------------------------------------------------------
// PUBLIC API
// ------------------------------------------------------
export function parseCheck(input: string): string {
  const tokens = tokenize(input);
  const ast = parse(tokens);
  return astToSql(ast);
}
