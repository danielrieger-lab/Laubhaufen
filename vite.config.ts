import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => ({
  root: 'src',
  publicDir: '../public',
  envDir: '..',
  base: mode === 'production' ? '/Laubhaufen/' : '/',
  build: {
    outDir: '../dist',
    emptyOutDir: true
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Laubhaufen',
        short_name: 'Laubhaufen',
        description: 'Gemeinsame Offline-PWA für Rezepte, Wochenplanung und Einkaufslisten.',
        theme_color: '#40312F',
        background_color: '#40312F',
        lang: 'de',
        display: 'standalone',
        start_url: '.',
        icons: [
          {
            src: 'icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ]
}));
