// npm run skills: each Trick's skill.md (its instructions to Roomie, #35) -> a sibling skill.ts exporting the text, so
// Next, tsx, Mastra and the tests all load plain TypeScript instead of a .md import. src/toolkits/skills.test.ts fails
// when a skill.ts is missing or stale. Edit skill.md, never skill.ts.
//
// What goes into the prompt: everything from the first "## " section on. The title and the intro above it are for
// people reading the file. "## Rules" is dropped (the rules are the bullets); any other "## Heading" becomes "Heading:".
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOLKITS = join(process.cwd(), "src", "toolkits");

/** core and every Trick folder with a manifest. */
export const TRICK_DIRS: readonly string[] = readdirSync(TOOLKITS).filter((d) => statSync(join(TOOLKITS, d)).isDirectory() && existsSync(join(TOOLKITS, d, "manifest.ts")));

/** The prompt text of a skill.md (see the header). */
export function skillText(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const first = lines.findIndex((l) => l.startsWith("## "));
  if (first === -1) throw new Error("A skill.md needs at least one '## ' section (## Rules)");
  return lines
    .slice(first)
    .map((l) => (l.startsWith("## ") ? (/^##\s+rules\s*$/i.test(l) ? null : `${l.slice(3).trim()}:`) : l))
    .filter((l): l is string => l !== null)
    .join("\n")
    .trim();
}

/** The generated module for one skill.md. */
export function skillModule(md: string): string {
  return `// Generated from skill.md by \`npm run skills\`. Edit skill.md, not this file.\nexport const skill = ${JSON.stringify(skillText(md))};\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const d of TRICK_DIRS) {
    const md = join(TOOLKITS, d, "skill.md");
    if (!existsSync(md)) throw new Error(`${d}/skill.md is missing`);
    writeFileSync(join(TOOLKITS, d, "skill.ts"), skillModule(readFileSync(md, "utf8")));
    console.log(`skills: ${d}/skill.ts`);
  }
}
