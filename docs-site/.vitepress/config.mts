import { defineConfig } from 'vitepress';
import fs from 'node:fs';
import path from 'node:path';

const guidesDir = path.resolve(__dirname, '../guides');
const guideFiles = fs.existsSync(guidesDir)
  ? fs.readdirSync(guidesDir)
      .filter((name) => name.toLowerCase().endsWith('.md'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
  : [];

const sidebar = guideFiles.map((name) => {
  const content = fs.readFileSync(path.join(guidesDir, name), 'utf8');
  const heading = content.match(/^#\\s+(.+)$/m);
  return {
    text: heading?.[1]?.trim() ?? name.replace(/\\.md$/i, ''),
    link: `/guides/${name.replace(/\\.md$/i, '')}`
  };
});

export default defineConfig({
  lang: 'en-US',
  title: 'Terraform Engineering',
  description: 'A sequential Terraform Architecture & Internals engineering handbook.',
  base: '/Terraform/',
  cleanUrls: true,
  lastUpdated: false,
  themeConfig: {
    siteTitle: 'Terraform Engineering',
    nav: [
      { text: 'Learning path', link: '/' },
      { text: 'GitHub repository', link: 'https://github.com/aditya-tanwar/Terraform' }
    ],
    sidebar: [{ text: 'Architecture & Internals', collapsed: false, items: sidebar }],
    outline: { label: 'On this page', level: [2, 3] },
    search: { provider: 'local' },
    docFooter: { prev: 'Previous guide', next: 'Next guide' },
    returnToTopLabel: 'Back to top',
    sidebarMenuLabel: 'Guide navigation',
    darkModeSwitchLabel: 'Appearance'
  }
});
