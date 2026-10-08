/**
 * Frontmatter editing for agent definition files.
 *
 * The SDK parses frontmatter but does not serialize it, and these files belong
 * to the user, so the edit is deliberately narrow: rewrite the leading `---`
 * block in place and leave the body byte-for-byte alone.
 */
const FRONTMATTER_BLOCK = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const MODEL_LINE = /^model\s*:/;
const SAFE_VALUE = /^[A-Za-z0-9._/-]+$/;

/** Quote a value when it contains anything YAML would otherwise reinterpret. */
function yamlValue(value: string): string {
  return SAFE_VALUE.test(value) ? value : JSON.stringify(value);
}

/**
 * Set (or clear, with `undefined`) the `model` key in an agent's frontmatter.
 *
 * A value containing a newline is rejected: it would let a caller inject
 * arbitrary frontmatter keys into someone's agent file.
 */
export function setFrontmatterModel(content: string, model: string | undefined): string {
  const value = model?.trim();
  if (value && /[\r\n]/.test(value)) {
    throw new Error("A model reference cannot contain a line break");
  }

  const match = FRONTMATTER_BLOCK.exec(content);
  if (!match) {
    return value ? `---\nmodel: ${yamlValue(value)}\n---\n\n${content}` : content;
  }

  const lines = match[1].split(/\r?\n/);
  const index = lines.findIndex((line) => MODEL_LINE.test(line));
  if (value) {
    if (index >= 0) lines[index] = `model: ${yamlValue(value)}`;
    else lines.push(`model: ${yamlValue(value)}`);
  } else if (index >= 0) {
    lines.splice(index, 1);
  }

  const body = content.slice(match[0].length).replace(/^\r?\n+/, "");
  return `---\n${lines.join("\n")}\n---\n\n${body}`;
}
