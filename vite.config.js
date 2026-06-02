import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs'
import path from 'path'

const pkg = JSON.parse(fs.readFileSync(path.resolve('./package.json'), 'utf-8'))

const postBuildPlugin = {
  name: 'post-build',
  closeBundle() {
    const buildPkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf-8'))
    fs.writeFileSync(
      path.resolve('dist/version.json'),
      JSON.stringify({ version: buildPkg.version })
    )
    const swPath = path.resolve('dist/sw.js')
    if (fs.existsSync(swPath)) {
      const stamp = `/* build:${buildPkg.version}-${Date.now()} */\n`
      fs.writeFileSync(swPath, stamp + fs.readFileSync(swPath, 'utf-8'))
    }
  },
}

export default defineConfig({
  plugins: [react(), tailwindcss(), postBuildPlugin],
  build: {
    sourcemap: false,
    minify: 'terser',
    terserOptions: {
      compress: { drop_console: true, drop_debugger: true },
    },
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('react-router')) return 'react-vendor'
          if (id.includes('@supabase')) return 'supabase'
          if (id.includes('tesseract')) return 'ocr'
          if (id.includes('jszip')) return 'zip'
          if (id.includes('xlsx')) return 'spreadsheet'
          if (id.includes('lucide-react')) return 'icons'
          return 'vendor'
        },
      },
    },
  },
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
  },
  server: {
    port: 3457,
    host: true,
  },
})
