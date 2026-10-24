import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig(({ mode }) => {
  // 1. Demo standalone web application build for GitHub Pages online deployment
  if (mode === 'demo') {
    return {
      base: './', // Ensures assets load correctly on GitHub Pages under any repository path
      build: {
        outDir: 'dist-demo',
        emptyOutDir: true,
        sourcemap: false,
      },
    };
  }

  // 2. CDN standalone bundle build (Self-contained UMD package for unpkg / jsDelivr / browser script tag)
  if (mode === 'cdn') {
    return {
      build: {
        outDir: 'dist',
        emptyOutDir: false, // Preserve ESM, CJS and .d.ts in dist
        lib: {
          entry: resolve(import.meta.dirname, 'src/index.ts'),
          name: 'ThreeModelViewer',
          fileName: () => 'index.umd.js',
          formats: ['umd'],
        },
        rollupOptions: {
          output: {
            assetFileNames: 'style.[ext]',
            exports: 'named',
          },
        },
        sourcemap: true,
      },
    };
  }

  // 3. SDK Library build for npm distribution (ESM & CJS with externalized dependencies)
  return {
    plugins: [
      dts({
        include: ['src'],
        rollupTypes: true,
      }),
    ],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      lib: {
        entry: resolve(import.meta.dirname, 'src/index.ts'),
        name: 'ThreeModelViewer',
        fileName: (format) => (format === 'es' ? 'index.js' : 'index.cjs'),
        formats: ['es', 'cjs'],
      },
      rollupOptions: {
        external: [
          'three',
          /^three\/.*/,
          'jszip',
          'three-mesh-bvh',
          '@tweenjs/tween.js',
        ],
        output: {
          assetFileNames: 'style.[ext]',
          exports: 'named',
        },
      },
      sourcemap: true,
    },
  };
});
