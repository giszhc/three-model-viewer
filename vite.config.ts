import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig(({ mode }) => {
  // Demo standalone web application build for GitHub Pages online deployment
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

  // SDK Library build for npm distribution
  return {
    plugins: [
      dts({
        include: ['src'],
        rollupTypes: true,
      }),
    ],
    build: {
      lib: {
        entry: resolve(import.meta.dirname, 'src/index.ts'),
        name: 'GiszhcThreeModelViewer',
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
          globals: {
            three: 'THREE',
            jszip: 'JSZip',
            'three-mesh-bvh': 'ThreeMeshBVH',
            '@tweenjs/tween.js': 'TWEEN',
          },
        },
      },
      sourcemap: true,
    },
  };
});
