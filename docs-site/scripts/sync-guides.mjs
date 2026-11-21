import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const sourceDir = path.join(repoRoot, 'Architecture & Internals');
const siteRoot = path.resolve(scriptDir, '..');
const guidesDir = path.join(siteRoot, 'guides');

if (!fs.existsSync(sourceDir)) {
  throw new Error(`Terraform source directory not found: ${sourceDir}`);
}

const files = fs.readdirSync(sourceDir)
  .filter((name) => name.toLowerCase().endsWith('.md'))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

if (files.length === 0) {
  throw new Error('No Markdown guides found in Architecture & Internals.');
}

fs.rmSync(guidesDir, { recursive: true, force: true });
fs.mkdirSync(guidesDir, { recursive: true });

const guides = files.map((name, index) => {
  const sourcePath = path.join(sourceDir, name);
  const destinationPath = path.join(guidesDir, name);
  const content = fs.readFileSync(sourcePath, 'utf8');
  fs.copyFileSync(sourcePath, destinationPath);

  const heading = content.match(/^#\s+(.+)$/m);
  const title = heading?.[1]?.trim() ?? name.replace(/\.md$/i, '');
  const slug = name.replace(/\.md$/i, '');

  return { number: index + 1, name, title, slug };
});

const guideLinks = guides.map(({ number, title, slug }) =>
  `<div class="guide-index-item"><span class="guide-index-number">${String(number).padStart(2, '0')}</span><a href="./guides/${slug}.html">${title}</a><span class="guide-index-arrow">↗</span></div>`
).join('\n');

const homePage = `---
layout: home
title: Terraform Engineering
titleTemplate: Terraform Engineering | Architecture, Internals & Production
hero:
  name: Terraform,<br>under the hood.
  text: Understand the engine behind your infrastructure.
  tagline: A practical, deep technical learning path through Terraform architecture, execution, state, providers and production engineering.
  actions:
    - theme: brand
      text: Start learning
      link: /guides/${guides[0].slug}
    - theme: alt
      text: View source on GitHub
      link: https://github.com/aditya-tanwar/Terraform/tree/main/Architecture%20%26%20Internals
features:
  - icon:
      src: /icons/architecture.svg
    title: Understand the internals
    details: Go beyond commands and HCL. Explore Terraform Core, providers, RPC, graph execution and state.
  - icon:
      src: /icons/learning-path.svg
    title: A guided learning path
    details: Follow the original numbered guides in sequence, from foundational architecture to advanced production concepts.
  - icon:
      src: /icons/source.svg
    title: Markdown-first documentation
    details: The repository's Architecture & Internals folder remains the single source of truth. The site is generated from it.
---

<div class="home-section">
  <div class="section-eyebrow">THE LEARNING PATH</div>
  <h2>Explore the guides</h2>
  <p class="section-intro">A structured walkthrough of how Terraform works, how it manages infrastructure, and how to operate it reliably.</p>
  <div class="guide-index">
    ${guideLinks}
  </div>
</div>

<div class="home-note">
  <span class="home-note-mark">i</span>
  <div><strong>Scope of this site</strong><p>Only the Markdown guides from <code>Architecture & Internals/</code> are included. The <code>Modules/</code> directory is intentionally excluded.</p></div>
</div>
`;

fs.writeFileSync(path.join(siteRoot, 'index.md'), homePage, 'utf8');
console.log(`Synced ${guides.length} Terraform guides from Architecture & Internals in numeric order.`);
