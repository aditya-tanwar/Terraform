import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const sourceDir = path.join(repoRoot, 'Architecture & Internals');
const siteRoot = path.resolve(scriptDir, '..');
const guidesDir = path.join(siteRoot, 'guides');

if (!fs.existsSync(sourceDir)) throw new Error(`Source directory not found: ${sourceDir}`);

const files = fs.readdirSync(sourceDir)
  .filter((name) => name.toLowerCase().endsWith('.md'))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

if (files.length === 0) throw new Error('No Markdown guides were found in Architecture & Internals.');

fs.rmSync(guidesDir, { recursive: true, force: true });
fs.mkdirSync(guidesDir, { recursive: true });

const entries = files.map((name) => {
  fs.copyFileSync(path.join(sourceDir, name), path.join(guidesDir, name));
  const content = fs.readFileSync(path.join(sourceDir, name), 'utf8');
  const heading = content.match(/^#\\s+(.+)$/m);
  return {
    title: heading?.[1]?.trim() ?? name.replace(/\\.md$/i, ''),
    slug: name.replace(/\\.md$/i, '')
  };
});

const guideLinks = entries.map(({ title, slug }, index) =>
  `${index + 1}. [${title}](./guides/${slug}.md)`
).join('\\n');

const homePage = `---
layout: home
title: Terraform Engineering
titleTemplate: Learn the internals. Engineer with confidence.
hero:
  name: Terraform Engineering
  text: From execution model to production-grade infrastructure
  tagline: A sequential engineering handbook built from the Architecture & Internals guides in this repository.
  actions:
    - theme: brand
      text: Start with Guide 1
      link: /guides/${entries[0].slug}
    - theme: alt
      text: Browse the repository
      link: https://github.com/aditya-tanwar/Terraform/tree/main/Architecture%20%26%20Internals
features:
  - title: Follow the original sequence
    details: The guide order and numbering match the Markdown files in Architecture & Internals.
  - title: Original Markdown stays canonical
    details: Website pages are synced from the repository guides during development and builds. There is no second manually maintained copy.
  - title: Focused technical reading
    details: Read long-form explanations with syntax highlighting, a table of contents, and quick navigation.
---

## Learning path

${guideLinks}

---

The website includes only the \`Architecture & Internals/\` Markdown guides. Module examples and the \`Modules/\` folder are intentionally excluded.
`;

fs.writeFileSync(path.join(siteRoot, 'index.md'), homePage, 'utf8');
console.log(`Synced ${entries.length} guides in repository order.`);
