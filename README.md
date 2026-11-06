# ホシノマート · 日式便利店街角

一个可以在浏览器里探索的日式便利店微缩场景。便利店、货架和街道道具都用代码搭建，配上三渲二的光影，像一座会下雨、会亮灯的街角模型。

**[在线体验](https://joker0-hub.github.io/konbini-diorama/)** · [直接看雨夜](https://joker0-hub.github.io/konbini-diorama/?time=night&weather=rain&instant=1)

![雨中的便利店、自动售货机和斑马线](docs/hero.webp)

## 怎么玩

- 拖动旋转视角，滚轮缩放。手机上单指旋转、双指缩放。
- 在底部自由组合白天、黄昏、夜晚和晴、雨、雪。雨滴会激起涟漪，雪会慢慢盖住屋顶。
- 点击自动售货机选一瓶饮料，等它掉进取货口，再长按拖进回收桶。
- 点击樱花树调整落樱，或用右上角的声音按钮调节环境音和背景音乐。

## 本地运行

需要 Node.js 22.12 或更新版本，以及支持 WebGL 2 的浏览器。

```bash
git clone https://github.com/joker0-hub/konbini-diorama.git
cd konbini-diorama
npm ci
npm run dev
```

打开终端显示的地址，默认是 `http://127.0.0.1:5188/`。运行 `npm run build` 可以生成生产构建。

## 许可

项目声明使用 MIT 许可；仓库目前尚未附独立的 `LICENSE` 文件。

<div align="center">
<sub>Built with Three.js · TypeScript · Vite · cannon-es — 所有风景都是代码。</sub>
</div>
