import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? '/Laubhaufen/' : '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Laubhaufen',
        short_name: 'Laubhaufen',
        description: 'Offline-first collaborative meal planning with shared recipes and shopping lists.',
        theme_color: '#214234',
        background_color: '#f4efe8',
        display: 'standalone',
        start_url: '.',
        icons: [
          {
            src: '/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ]
}));
