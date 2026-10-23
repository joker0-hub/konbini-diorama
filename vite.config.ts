import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages 的项目页地址是 /<repo>/，用相对 base 后
  // 本地、用户主页、项目页都能直接加载 assets，不需要改仓库名。
  base: './',
  server: { host: '127.0.0.1', port: 5188 },
  preview: { host: '127.0.0.1', port: 5188 },
  build: { target: 'es2022' },
});
