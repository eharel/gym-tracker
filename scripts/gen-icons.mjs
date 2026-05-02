import sharp from 'sharp'
import { readFileSync } from 'fs'

const svg = readFileSync('public/pwa-icon.svg')

await Promise.all([
  sharp(svg).resize(192, 192).png().toFile('public/pwa-192.png'),
  sharp(svg).resize(512, 512).png().toFile('public/pwa-512.png'),
  sharp(svg).resize(180, 180).png().toFile('public/apple-touch-icon.png'),
])

console.log('✓ PWA icons generated')
