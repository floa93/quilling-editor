// Generates icons/icon.svg (and maskable variant) from the teardrop template.
// PNG versions are rendered from these SVGs once and committed (see README).
import { writeFileSync, mkdirSync } from 'node:fs';
import { templatePath } from '../src/templates.js';

mkdirSync('icons', { recursive: true });
const icon = (pad, rounded) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" ${rounded ? 'rx="112"' : ''} fill="#2f4858"/>
  <g transform="translate(256 262) scale(${pad})">
    <path d="${templatePath('teardrop')}" fill="none" stroke="#f26a4b" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${templatePath('teardrop')}" fill="none" stroke="#ffd2c4" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>
`;
writeFileSync('icons/icon.svg', icon(4.2, true));
writeFileSync('icons/icon-maskable.svg', icon(3.2, false));
console.log('icons written');
