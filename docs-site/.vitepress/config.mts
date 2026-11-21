import { defineConfig } from 'vitepress';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const configDir = path.dirname(fileURLToPath(import.meta.url));
const guidesDir = path.resolve(configDir, '../guides');

const guideFiles = fs.existsSync(guidesDir)
  ? fs.readdirSync(guidesDir)
      .filter((name) => name.toLowerCase().endsWith('.md'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
  : [];

const guideItems = guideFiles.map((name) => {
  const content = fs.readFileSync(path.join(guidesDir, name), 'utf8');
  const heading = content.match(/^#\s+(.+)$/m);
  return {
    text: heading?.[1]?.trim() ?? name.replace(/\.md$/i, ''),
    link: `/guides/${name.replace(/\.md$/i, '')}`
  };
});

export default defineConfig({
  lang: 'en-US',
  title: 'Terraform Engineering',
  description: 'A deep technical learning path through Terraform architecture, internals and production engineering.',
  base: '/Terraform/',
  cleanUrls: true,
  lastUpdated: false,
  markdown: {
    lineNumbers: true,
    theme: {
      light: 'github-light',
      dark: 'github-dark'
    }
  },
  head: [
    ['meta', { name: 'theme-color', content: '#101827' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'Terraform Engineering' }],
    ['meta', { property: 'og:description', content: 'Understand the engine behind your infrastructure.' }]
  ],
  themeConfig: {
    siteTitle: 'Terraform Engineering',
    logo: '/brand-mark.svg',
    nav: [
      { text: 'Learning path', link: '/' },
      { text: 'Architecture & Internals', link: '/guides/1-terraform-architecture-and-execution-model' },
      { text: 'GitHub', link: 'https://github.com/aditya-tanwar/Terraform' }
    ],
    sidebar: [
      {
        text: 'Terraform Architecture & Internals',
        items: guideItems
      }
    ],
    outline: {
      label: 'On this page',
      level: [2, 3]
    },
    search: {
      provider: 'local',
      options: {
        miniSearch: {
          searchOptions: {
            fuzzy: 0.2,
            prefix: true
          }
        }
      }
    },
    docFooter: {
      prev: 'Previous guide',
      next: 'Continue learning'
    },
    returnToTopLabel: 'Back to top',
    sidebarMenuLabel: 'Guide navigation',
    darkModeSwitchLabel: 'Appearance'
  }
});
