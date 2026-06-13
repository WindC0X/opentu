# 多 CDN 智能部署方案

## 概述

本文档描述 Opentu 的多 CDN 智能部署策略，实现：

1. **Service Worker 缓存优先** - 最快加载速度
2. **npm CDN 发布 + 运行时 jsDelivr 主链路** - 静态资源发布到 npm，运行时关键资源以 jsDelivr 为主链路，服务器保留完整兜底副本
3. **本地服务器兜底** - 最终保障
4. **零服务器流量成本** - 利用免费 CDN
5. **安全混合部署** - HTML 在自有服务器，静态资源在 CDN

## 安全混合部署（推荐）

### 为什么需要混合部署？

- **HTML 文件**可能包含用户配置、API 密钥等敏感信息
- CDN 是公开的，任何人都可以访问
- 将 HTML 保留在自有服务器，只将静态资源放到 CDN

### 架构

```
用户访问 your-domain.com
         ↓
    自有服务器（完整副本）
    ├── HTML 文件（安全）
    └── 全部静态资源（兜底）
         ↓
   HTML 加载资源（路径指向 CDN）
         ↓
   ┌──────┼──────┐
   ↓      ↓      ↓
 jsdelivr  npm包/服务器
 (主链路)  (发布源/兜底)
```

### 使用方法

```bash
# 一键部署：构建 + 发布 CDN + 部署服务器
pnpm run release -- --otp=123456

# 预览模式（不实际执行）
pnpm run release:dry

# 只发布到 CDN（跳过服务器部署）
pnpm run release -- --skip-server --otp=123456

# 只部署到服务器（跳过 npm 发布）
pnpm run release -- --skip-npm

# 跳过构建/E2E/npm/manual，仅复用现有部署包执行快速发布
pnpm run release:skip

# 仅上传已有部署包或 nginx 配置
pnpm run deploy:upload
pnpm run deploy:nginx
```

### 服务器配置

在 `.env` 文件中添加：

```bash
# 服务器信息
DEPLOY_HOST=your-server.com
DEPLOY_USER=username
DEPLOY_PORT=22
DEPLOY_WEB_DIR=/var/www/aitu

# SSH 认证（二选一）
DEPLOY_SSH_KEY=~/.ssh/id_rsa
# 或
DEPLOY_SSH_PASSWORD=your-password
```

### 文件分布

| 文件类型 | CDN | 服务器 | 说明 |
|---------|:---:|:------:|------|
| `*.html` | ❌ | ✅ | HTML 文档 origin-first；不做 CDN-first preload/rewrite |
| `sw.js` | ❌ | ✅ | Service Worker 必须同源 |
| `init.json` | ❌ | ✅ | 初始化配置 |
| `assets/*.js` | ✅ | ✅ | CDN 优先，服务器兜底 |
| `assets/*.css` | ✅ | ✅ | CDN 优先，服务器兜底 |
| `icons/*` / `logo/*` / `favicon.ico` | ✅ | ✅ | 公共静态资源可 CDN 优先，服务器兜底 |
| `manifest.json` / `version.json` / `precache-manifest.json` / `idle-prefetch-manifest.json` | 可选静态副本 | ✅ | release metadata 运行时 origin-first；npm/CDN 副本不能作为 rewrite 目标 |
| `/creative/api/*` / `/creative/relay/v1/*` | ❌ | ✅ | `new-api` 同源会话接口，禁止 CDN 缓存/重写 |

### 加载顺序（仅针对可 CDN 化的静态资源）

1. **Service Worker 缓存** - 最快，离线可用
2. **CDN jsDelivr** - 当前运行时主 CDN，节约服务器流量
3. **npm 包 CDN 地址** - unpkg/jsDelivr 均可访问已发布包；运行时关键资源检查以 jsDelivr 为准
4. **自有服务器** - 所有 CDN 失败时兜底；HTML / `sw.js` / release metadata / Creative API/relay 始终 origin-first


## Creative Embed 注意事项

当 Opentu 作为 `new-api` 的 Creative 嵌入前端使用时，HTML、`sw.js`、`init.json`、运行时配置以及 `/creative/api/*`、`/creative/relay/v1/*` 必须保持同源，由 `new-api` 处理浏览器会话、CSRF/nonce 和 `private, no-store` 响应。只允许将 hashed `assets/*.js` / `assets/*.css` 等纯静态资源改写到 CDN。详细矩阵见 [Creative 嵌入部署说明](./CREATIVE_EMBED_DEPLOYMENT.md)。

## 架构图

```
用户请求
    ↓
┌─────────────────────────────────────────────────┐
│              Service Worker                      │
│  ┌─────────────────────────────────────────┐    │
│  │ 1. 检查本地缓存 (Cache Storage)          │    │
│  │    ↓ 缓存命中 → 直接返回                 │    │
│  │    ↓ 缓存未命中                          │    │
│  │                                          │    │
│  │ 2. 尝试运行时主 CDN: jsdelivr.net       │    │
│  │    ↓ 成功 → 缓存并返回                   │    │
│  │    ↓ 失败                                │    │
│  │                                          │    │
│  │ 3. 回退本地服务器                        │    │
│  │    ↓ 成功 → 缓存并返回                   │    │
│  │    ↓ 失败 → 显示离线页面                 │    │
│  └─────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

## CDN 源对比

| CDN | 免费额度 | 特点 | 访问地址 |
|-----|----------|------|----------|
| jsDelivr | 无限 | 当前运行时主链路，发布后关键资源就绪检查以此为准 | `cdn.jsdelivr.net/npm/aitu-app@{version}/` |
| unpkg | 无限 | npm 包公开访问地址，可作为人工排障/备用访问来源 | `unpkg.com/aitu-app@{version}/` |
| 本地服务器 | 自有流量 | 完全可控，最终兜底 | 自有域名 |

## 部署流程

### 方式 1：安全混合部署（推荐）

```bash
# 步骤 1：升级版本
pnpm run version:patch

# 步骤 2：构建、拆分 CDN/Server 包、发布静态资源并部署服务器
pnpm run release -- --otp=123456

# 可选：只发布 npm CDN 静态资源，不部署服务器
pnpm run release -- --skip-server --otp=123456

# 可选：只部署服务器，不发布 npm CDN
pnpm run release -- --skip-npm
```

**CDN 上没有 HTML 文件**，用户信息安全。

### 方式 2：发布 npm 静态资源包

```bash
# 升级版本并发布
pnpm run version:patch
pnpm run npm:publish --otp=123456
```

发布后，CDN 自动可用：
- jsDelivr: `https://cdn.jsdelivr.net/npm/aitu-app@{version}/assets/<asset-file>.js`
- unpkg: `https://unpkg.com/aitu-app@{version}/assets/<asset-file>.js`

> 注意：npm 包仍只包含静态资源和清单，不包含 HTML、`sw.js` 或运行时 `init.json`。

### 2. 配置自有域名（可选）

#### 方案 A：Cloudflare Pages（推荐）

1. 登录 [Cloudflare Pages](https://dash.cloudflare.com/pages)
2. 创建项目，连接 GitHub 仓库
3. 配置构建：
   ```
   Build command: pnpm run build:web
   Output directory: dist/apps/web
   Environment: NODE_VERSION=20
   ```
4. 添加自定义域名

#### 方案 B：自有服务器 + CDN 代理

1. 部署到自有服务器（使用现有脚本）：
   ```bash
   pnpm run package
   pnpm run deploy:upload
   ```

2. 配置 Cloudflare CDN 代理：
   - 将域名 DNS 指向 Cloudflare
   - 开启橙色云朵（代理模式）
   - 静态资源自动缓存

### 3. Service Worker 配置

项目已内置多 CDN 回退逻辑，关键文件：

- `apps/web/src/sw/cdn-fallback.ts` - CDN 回退策略
- `apps/web/public/cdn-config.js` - CDN 选择器（可选）

## 核心代码说明

### CDN 回退策略 (`cdn-fallback.ts`)

```typescript
// CDN 源配置
const CDN_SOURCES = [
  {
    name: 'jsdelivr',
    urlTemplate: 'https://cdn.jsdelivr.net/npm/aitu-app@{version}/{path}',
    priority: 1,
  },
  {
    name: 'unpkg',
    urlTemplate: 'https://unpkg.com/aitu-app@{version}/{path}',
    priority: 2,
  },
];

// 智能回退逻辑
async function fetchFromCDNWithFallback(resourcePath, version, localOrigin) {
  // 1. 尝试所有 CDN
  for (const cdn of getAvailableCDNs()) {
    const response = await tryFetch(cdn, resourcePath, version);
    if (response.ok) return response;
  }
  
  // 2. 回退本地服务器
  return fetch(localOrigin + resourcePath);
}
```

### 健康检测机制

- 自动检测 CDN 可用性
- 失败超过 3 次自动降级
- 1 分钟后自动恢复尝试

```typescript
// 标记 CDN 失败
markCDNFailure(cdnName);

// 检查 CDN 是否可用
if (isCDNAvailable(cdnName)) {
  // 尝试使用
}
```

## 缓存策略

| 资源类型 | 策略 | Cache-Control |
|----------|------|---------------|
| HTML | Network First | max-age=0, must-revalidate |
| JS/CSS | Cache First | max-age=31536000, immutable |
| 图片 | Cache First | max-age=31536000, immutable |
| Service Worker | Network First | max-age=0, must-revalidate |
| version.json | Network First | max-age=0, must-revalidate |

## 使用场景

### 场景 1：正常访问（CDN 可用）

```
用户 → SW 缓存（命中）→ 立即返回
用户 → SW 缓存（未命中）→ jsDelivr → 缓存 → 返回
```

### 场景 2：jsDelivr 不可用

```
用户 → SW 缓存（未命中）→ jsDelivr（失败）→ unpkg/本地服务器 → 缓存 → 返回
```

### 场景 3：所有 CDN 不可用

```
用户 → SW 缓存（未命中）→ jsDelivr（失败）→ unpkg（失败）→ 本地服务器 → 返回
```

### 场景 4：完全离线

```
用户 → SW 缓存（命中）→ 返回（离线可用）
```

## 调试命令

```javascript
// 在浏览器控制台执行

// 查看 CDN 状态
__OPENTU_CDN_API__.sources

// 强制重新选择 CDN
__OPENTU_CDN_API__.reselectCDN()

// 清除 CDN 缓存
__OPENTU_CDN_API__.clearCDNCache()

> 兼容说明：运行时仍保留 `__AITU_CDN__` / `__AITU_CDN_API__` 旧别名读取能力，用于兼容历史缓存与调试入口，但新代码应统一使用 `__OPENTU_CDN__` / `__OPENTU_CDN_API__`。
```

## 监控与告警

建议接入监控：

1. **CDN 可用性监控**：定期检测各 CDN 节点
2. **加载性能监控**：记录资源加载时间
3. **错误率监控**：统计各源失败率

可通过 PostHog 自定义事件实现：

```typescript
// 记录 CDN 加载事件
posthog.capture('cdn_load', {
  source: 'unpkg',
  resource: 'index.js',
  latency: 150,
  success: true,
});
```

## 成本对比

| 方案 | 月流量成本 | 可用性 | 速度 |
|------|-----------|--------|------|
| 纯自有服务器 | ~$50-200/100GB | 99.9% | 一般 |
| Cloudflare Pages | $0 | 99.99% | 快 |
| npm CDN 回退 | $0 | 99.999% | 快 |
| 本方案（组合） | ~$0 | 99.999%+ | 最快 |

## 开发模式

本地开发时（`localhost` / `127.0.0.1`），CDN 逻辑会自动跳过：

### 自动跳过的逻辑

| 组件 | 开发模式行为 |
|------|-------------|
| `cdn-config.js` | 跳过 CDN 检测，直接设置 `cdn: 'local'` |
| `cdn-fallback.ts` | `fetchFromCDNWithFallback()` 直接返回 `null` |
| Service Worker | 跳过 CDN 回退，直接使用本地服务器 |

### 开发模式判断

```javascript
// 以下情况被识别为开发模式：
const isDevelopment = 
  location.hostname === 'localhost' || 
  location.hostname === '127.0.0.1' ||
  location.hostname.endsWith('.localhost');
```

### 开发时的资源加载流程

```
开发模式：
用户请求 → SW 缓存（可选）→ 本地 Vite 服务器 → 返回
                    ↓ 失败
               显示错误（不尝试 CDN）
```

### 强制测试 CDN 回退

如果需要在本地测试 CDN 回退逻辑，可以：

1. **使用 `ngrok` 或类似工具**：将本地服务暴露为公网域名
2. **修改 hosts 文件**：将测试域名指向 127.0.0.1
3. **构建后预览**：`pnpm run build:web && pnpm run preview`（preview 模式不被识别为开发模式）

## 常见问题

### Q: CDN 缓存更新延迟怎么办？

A: 
- unpkg：通常 1-5 分钟
- jsdelivr：可能需要手动刷新缓存
- 使用版本号指定（`@<version>`）确保获取正确版本

### Q: 如何强制刷新 CDN 缓存？

A:
```bash
# jsdelivr 刷新
curl -X PURGE https://purge.jsdelivr.net/npm/aitu-app@<version>/

# unpkg 自动同步，无需手动刷新
```

### Q: 国内访问慢怎么办？

A:
1. jsdelivr 通常国内访问较快
2. 考虑添加国内 CDN 源（如 bootcdn、cdnjs）
3. 使用 Cloudflare 中国节点

## 相关文件

- `/scripts/publish-npm.js` - npm 发布脚本
- `/apps/web/src/sw/cdn-fallback.ts` - CDN 回退策略
- `/apps/web/public/cdn-config.js` - CDN 选择器
- `/apps/web/public/_headers` - 缓存头配置
- `/docs/CFPAGE-DEPLOY.md` - Cloudflare Pages 部署
- `/docs/NPM_CDN_DEPLOY.md` - npm CDN 部署详情
