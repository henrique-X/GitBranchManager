# Git Branch Manager（Git 分支管理工具）

Windows 10/11 单机桌面端 Git 分支管理工具，支持 GitHub / Gitee / 自建 GitLab。

- 需求文档: docs/开发文档.md
- 开发计划: docs/开发计划.md

## 技术栈

Tauri 2 (Rust) + React + TypeScript + Vite + Tailwind CSS

## 开发环境要求

- Node.js 18+（已确认 v22）
- Rust stable（rustup，MSVC 工具链）
- Visual Studio Build Tools（C++ 工作负载）
- Git for Windows（已确认 2.20.1）

## 常用命令

```powershell
npm install          # 安装前端依赖
npm run tauri dev    # 开发模式运行桌面应用
npm run tauri build  # 打包 NSIS 安装包
npm run build        # 仅构建前端
```

## 目录结构

- `src/` React 前端
- `src-tauri/` Rust 后端（平台 API 适配、本地 Git、SQLite、凭据管理）
- `docs/` 需求与计划文档
