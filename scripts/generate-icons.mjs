import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('public', { recursive: true });

const icon192 = 'iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAYAAABS...';
const icon512 = 'iVBORw0KGgoAAAANSUhEUgAAAgAAAAIACAYAAAD0eNT6...';

await writeFile('public/app-icon-192.png', Buffer.from(icon192, 'base64'));
await writeFile('public/app-icon-512.png', Buffer.from(icon512, 'base64'));
console.log('Generated PWA icons: 192x192 and 512x512');
