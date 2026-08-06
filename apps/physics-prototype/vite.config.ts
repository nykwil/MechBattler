import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  // 5161 is the pm2-pinned MechBattler block port (mechbattler-3d-ik).
  // Avoid 5174: under WSL2 it has been observed to fail binding from Windows.
  server: { port: 5161 },
});
