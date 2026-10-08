/**
 * Token-accurate source facts for the verification scripts.
 *
 * The security and compatibility checks used to ask `file.includes("literal")`,
 * which a comment or a reformat can fool and which breaks whenever code moves.
 * These helpers parse the file instead, so a check is about code that exists —
 * an identifier, a call, an object property, a string literal — rather than
 * about bytes on a line.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import YAML from "yaml";

function parse(filePath, text) {
  return ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function collect(sourceFile) {
  const identifiers = new Set();
  const memberPaths = new Set();
  const calls = new Set();
  const strings = new Set();
  const properties = new Map();
  const imports = new Map();
  const assignments = new Map();
  const callCounts = new Map();
  const positions = new Map();

  const countCall = (key) => callCounts.set(key, (callCounts.get(key) ?? 0) + 1);

  const note = (key, node) => {
    if (!positions.has(key)) positions.set(key, node.getStart(sourceFile));
  };

  const recordMemberPath = (node) => {
    if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return null;
    const parts = [];
    let current = node;
    while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
      if (ts.isPropertyAccessExpression(current)) {
        parts.unshift(current.name.text);
        current = current.expression;
      } else {
        const argument = current.argumentExpression;
        if (argument && ts.isStringLiteral(argument)) parts.unshift(argument.text);
        else return null;
        current = current.expression;
      }
    }
    if (ts.isIdentifier(current)) {
      parts.unshift(current.text);
      return { path: parts.join("."), root: current.text, node };
    }
    if (current.kind === ts.SyntaxKind.ThisKeyword) {
      parts.unshift("this");
      return { path: parts.join("."), root: "this", node };
    }
    return null;
  };

  const visit = (node) => {
    if (ts.isIdentifier(node)) {
      identifiers.add(node.text);
      note(node.text, node);
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      strings.add(node.text);
    } else if (ts.isTemplateExpression(node)) {
      // A URL built from a template still states its fixed parts.
      strings.add(node.head.text);
      for (const span of node.templateSpans) strings.add(span.literal.text);
    } else if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const names = imports.get(node.moduleSpecifier.text) ?? new Set();
      const clause = node.importClause;
      if (clause?.name) names.add("default");
      if (clause?.namedBindings) {
        if (ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) names.add(element.name.text);
        } else if (ts.isNamespaceImport(clause.namedBindings)) {
          names.add("*");
        }
      }
      imports.set(node.moduleSpecifier.text, names);
    }

    const member = recordMemberPath(node);
    if (member) {
      memberPaths.add(member.path);
      note(member.path, member.node);
    }

    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee)) {
        calls.add(callee.text);
        countCall(callee.text);
        note(callee.text, callee);
      } else {
        const called = recordMemberPath(callee);
        if (called) {
          calls.add(called.path);
          countCall(called.path);
          note(called.path, called.node);
        }
      }
    }

    // `target = value` (also `target ??= value`), for settings applied after
    // construction, which object literals cannot express.
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const target = recordMemberPath(node.left);
      if (target) {
        const values = assignments.get(target.path) ?? new Set();
        values.add(node.right.getText(sourceFile));
        assignments.set(target.path, values);
      }
    }

    if (ts.isPropertyAssignment(node) && node.name) {
      const name = ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : null;
      if (name) {
        const values = properties.get(name) ?? new Set();
        values.add(node.initializer.getText(sourceFile));
        properties.set(name, values);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { identifiers, memberPaths, calls, callCounts, strings, properties, imports, assignments, positions };
}

/**
 * Build a facts view over one file, or over several files treated as one module
 * layer (so a split module can still be checked as a whole).
 */
export function sourceFacts(root, files) {
  const paths = Array.isArray(files) ? files : [files];
  const texts = paths.map((file) => fs.readFileSync(path.join(root, file), "utf8"));
  const text = texts.join("\n");
  const merged = {
    identifiers: new Set(),
    memberPaths: new Set(),
    calls: new Set(),
    callCounts: new Map(),
    strings: new Set(),
    properties: new Map(),
    imports: new Map(),
    assignments: new Map(),
    positions: new Map(),
  };

  for (let index = 0; index < paths.length; index += 1) {
    const facts = collect(parse(paths[index], texts[index]));
    for (const value of facts.identifiers) merged.identifiers.add(value);
    for (const value of facts.memberPaths) merged.memberPaths.add(value);
    for (const value of facts.calls) merged.calls.add(value);
    for (const [key, value] of facts.callCounts) merged.callCounts.set(key, (merged.callCounts.get(key) ?? 0) + value);
    for (const value of facts.strings) merged.strings.add(value);
    for (const [name, values] of facts.properties) {
      const target = merged.properties.get(name) ?? new Set();
      for (const value of values) target.add(value);
      merged.properties.set(name, target);
    }
    for (const [name, values] of facts.assignments) {
      const target = merged.assignments.get(name) ?? new Set();
      for (const value of values) target.add(value);
      merged.assignments.set(name, target);
    }
    for (const [module, names] of facts.imports) {
      const target = merged.imports.get(module) ?? new Set();
      for (const name of names) target.add(name);
      merged.imports.set(module, target);
    }
    // Positions only make sense inside a single file; keep them per file.
    if (paths.length === 1) for (const [key, at] of facts.positions) merged.positions.set(key, at);
  }

  return {
    files: paths,
    text,
    /**
     * The identifier appears, or some member path ends with it — so a call on
     * `client.im.v1.messageResource.get` satisfies `uses("im.v1.messageResource.get")`.
     */
    uses: (name) => {
      if (merged.identifiers.has(name) || merged.memberPaths.has(name)) return true;
      const suffix = `.${name}`;
      for (const candidate of merged.memberPaths) if (candidate.endsWith(suffix)) return true;
      return false;
    },
    /** Every listed name appears. */
    usesAll: (...names) => names.every((name) => merged.identifiers.has(name) || merged.memberPaths.has(name)),
    /** The identifier or dotted member path is called (a suffix matches too). */
    calls: (name) => {
      if (merged.calls.has(name)) return true;
      const suffix = `.${name}`;
      for (const candidate of merged.calls) if (candidate.endsWith(suffix)) return true;
      return false;
    },
    /** An object literal declares this property, optionally with this exact initializer. */
    hasProperty: (name, value) => {
      const values = merged.properties.get(name);
      if (!values) return false;
      if (value === undefined) return true;
      return values.has(value);
    },
    /** A member path is assigned, optionally to this exact value. */
    assigns: (name, value) => {
      const values = merged.assignments.get(name);
      if (!values) return false;
      return value === undefined || values.has(value);
    },
    /** The exact string literal appears. */
    hasString: (value) => merged.strings.has(value),
    /** Some string literal contains this text. */
    hasStringContaining: (value) => {
      for (const candidate of merged.strings) if (candidate.includes(value)) return true;
      return false;
    },
    /** The module is imported (optionally with a specific imported name). */
    importsFrom: (module, name) => {
      const names = merged.imports.get(module);
      if (!names) return false;
      return name === undefined || names.has(name);
    },
    /** How many times this identifier or member path is called. */
    countCalls: (name) => {
      let count = merged.callCounts.get(name) ?? 0;
      const suffix = `.${name}`;
      for (const [candidate, occurrences] of merged.callCounts) {
        if (candidate !== name && candidate.endsWith(suffix)) count += occurrences;
      }
      return count;
    },
    /** Raw text fallback, for checks that are about syntax (CSP, HTML, YAML). */
    matches: (pattern) => pattern.test(text),
    /** Source order, for "X must happen before Y" invariants. */
    before: (first, second) => {
      const a = merged.positions.get(first);
      const b = merged.positions.get(second);
      if (a === undefined || b === undefined) return false;
      return a < b;
    },
  };
}

/**
 * Facts for configuration files that are not TypeScript: YAML and JSON are
 * parsed, so a check can assert the shape rather than a line of text.
 */
export function configFacts(root, file) {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  let data = null;
  try {
    data = file.endsWith(".json") ? JSON.parse(text) : YAML.parse(text);
  } catch {
    data = null;
  }

  const paths = new Set();
  const collectPaths = (value, prefix) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => collectPaths(entry, prefix));
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) {
        paths.add(prefix ? `${prefix}.${key}` : key);
        collectPaths(entry, prefix ? `${prefix}.${key}` : key);
      }
    }
  };
  if (data !== null) collectPaths(data, "");

  const texts = new Set();
  const collectValues = (value) => {
    if (typeof value === "string") texts.add(value);
    else if (Array.isArray(value)) value.forEach(collectValues);
    else if (value && typeof value === "object") Object.values(value).forEach(collectValues);
  };
  collectValues(data);

  return {
    file,
    parsed: data !== null,
    data,
    /** A dotted key path exists (e.g. "linux.executableName"). */
    hasPath: (dotted) => paths.has(dotted),
    /** The value at a dotted key path (e.g. "linux.executableName" -> "pi-worktable"). */
    valueAt: (dotted) =>
      dotted
        .split(".")
        .reduce((current, key) => (current && typeof current === "object" ? current[key] : undefined), data),
    /** Somewhere in the document this exact value appears. */
    hasValue: (value) => texts.has(value),
    /** Some string value contains this substring (paths in CI commands). */
    hasValueMatching: (pattern) => [...texts].some((value) => pattern.test(value)),
    /** Raw text fallback for comments and formatting that YAML drops. */
    matches: (pattern) => pattern.test(text),
    before: (first, second) => {
      const a = text.indexOf(first);
      const b = text.indexOf(second);
      return a >= 0 && b >= 0 && a < b;
    },
  };
}
