# @saltify/milky-tea

[![CI](https://github.com/SaltifyDev/milky-ts/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/SaltifyDev/milky-ts/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FSaltifyDev%2Fmilky-ts%2Fbadges%2Fcoverage-badge.json)](https://github.com/SaltifyDev/milky-ts/actions/workflows/ci.yml)

Milky 的 TypeScript SDK，提供类型安全的 API 调用和事件流支持。

## 安装

```bash
npm i @saltify/milky-tea
```

如果运行环境不支持 EventSource（例如 Node.js 环境）且需要 SSE 支持，则需要安装 `eventsource`：

```bash
npm i eventsource
```

## 使用方法

### 调用 API

下面是一个使用 `createMilkyClient` 创建客户端并调用 API 的示例：

```ts
import { createMilkyClient } from '@saltify/milky-tea'

const client = createMilkyClient({
  baseURL: 'https://milky.example.com',
  token: process.env.MILKY_TOKEN,
})

const login = await client.system.getLoginInfo()
const friend = await client.system.getFriendInfo({ user_id: 10001 })

console.log(login.nickname)
console.log(friend.friend.nickname)
```

通过 `createMilkyClient` 创建一个客户端实例，传入 `baseURL` 和 `token`，之后就可以通过 `client.{category}.{endpoint}(params)` 的方式调用 API 了。例如，调用 `quit_group` API：

```ts
await client.group.quitGroup(
  { group_id: 10001 },
  { timeout: false },
)
```

在这里，第二个参数是可选的，可以覆盖默认的 `baseURL`、`token`、`timeout` 等设置。

### 监听事件

通过 `client.event()` 创建一个事件连接，支持 WebSocket 和 SSE 两种连接方式。连接模式有如下几种：

- `auto`：首先尝试 WebSocket，如果在连接打开之前失败，则回退到 SSE
- `websocket`：仅使用 WebSocket
- `sse`：仅使用 Server-Sent Events

```ts
const source = await client.event('auto', {
  reconnect: {
    interval: 1000,
    attempts: 'always',
  },
})

source.addEventListener('open', () => {
  console.log('connected')
})

source.addEventListener('message', (event) => {
  console.log(event.data)
})

source.addEventListener('error', (event) => {
  console.error(event.message)
})

source.close()
```

### `createMilkyFetch`

`createMilkyFetch` 提供了一个更底层的 fetch 封装，允许直接调用原始的 API endpoint。

```ts
import { createMilkyFetch } from '@saltify/milky-tea'

const milkyFetch = createMilkyFetch({
  baseURL: 'https://milky.example.com',
})

const login = await milkyFetch('get_login_info', undefined)
console.log(login.uin)
```

## 开发

```bash
pnpm install
pnpm generate-api
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
```
