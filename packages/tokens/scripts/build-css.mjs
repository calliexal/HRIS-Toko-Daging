// Membangkitkan src/tokens.css dari tokens.json (sumber: Design System DagingPeople).
// Jalankan ulang setiap kali tokens.json berubah: `npm run tokens`.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tokens = JSON.parse(readFileSync(join(root, 'tokens.json'), 'utf8'));

const colorVars = (themeId) =>
  tokens.color.tokens
    .map((t) => {
      const value = typeof t.value === 'string' ? t.value : t.value[themeId] ?? t.value.light;
      return `  --${t.name}: ${value};`;
    })
    .join('\n');

const listVars = (family) => (tokens[family]?.tokens ?? []).map((t) => `  --${t.name}: ${t.value};`).join('\n');

const typeClasses = tokens.type.groups
  .flatMap((group) => group.styles)
  .map(
    (s) =>
      `.t-${s.name} { font-size: ${s.fontSize}; line-height: ${s.lineHeight}; font-weight: ${s.fontWeight}; }`,
  )
  .join('\n');

const css = `/* DIBANGKITKAN OTOMATIS dari tokens.json. Jangan edit manual: jalankan \`npm run tokens\`. */
:root {
${colorVars('light')}
${listVars('spacing')}
${listVars('size')}
${listVars('radius')}
${listVars('shadow')}
  --font-sans: ${tokens.type.families.sans};
  color-scheme: light;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
${colorVars('dark').replace(/^/gm, '  ')}
    color-scheme: dark;
  }
}

:root[data-theme="dark"] {
${colorVars('dark')}
  color-scheme: dark;
}

${typeClasses}
.t-clock, .t-amount-lg { font-variant-numeric: tabular-nums; }
`;

writeFileSync(join(root, 'src', 'tokens.css'), css);
console.log('tokens.css ditulis:', tokens.color.tokens.length, 'warna');
