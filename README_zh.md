# @saltify/milky-tea

[English](./README.md)

[![CI](https://github.com/SaltifyDev/milky-ts/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/SaltifyDev/milky-ts/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FSaltifyDev%2Fmilky-ts%2Fbadges%2Fcoverage-badge.json)](https://github.com/SaltifyDev/milky-ts/actions/workflows/ci.yml)

Milky Protocol 的类型安全 JavaScript SDK，提供分组 API、基于运行时校验的请求/响应处理，以及基于 WebSocket 或 SSE 的实时事件订阅。

## 安装

```bash
pnpm add @saltify/milky-tea
```

如果运行时没有原生 `EventSource`，但你需要 SSE 支持，请额外安装可选 peer 依赖：

```bash
pnpm add eventsource
```

## 快速开始

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

`createMilkyClient` 会把接口分到 `system`、`message`、`friend`、`group`、`file` 五个分组下。每个方法的最后一个参数还可以传入单次请求覆盖配置。

```ts
await client.group.quitGroup(
  { group_id: 10001 },
  { timeout: false },
)
```

## 核心 API

### `createMilkyClient`

高层客户端入口。适合统一配置 `baseURL`、`token`、`timeout`、自定义请求头或自定义 `fetch` 实现，并通过分组后的类型化方法调用接口。

### `createMilkyFetch`

底层请求封装。适合按原始 endpoint 名称直接调用。

```ts
import { createMilkyFetch } from '@saltify/milky-tea'

const milkyFetch = createMilkyFetch({
  baseURL: 'https://milky.example.com',
})

const login = await milkyFetch('get_login_info', undefined)
console.log(login.uin)
```

### `createMilkyEventSource`

实时事件入口，直接从根导出使用即可。如果你已经在使用客户端封装，也可以直接通过 `client.event(...)` 调用。

```ts
import { createMilkyClient } from '@saltify/milky-tea'

const client = createMilkyClient({
  baseURL: 'https://milky.example.com',
  token: process.env.MILKY_TOKEN,
})

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

连接模式：

- `auto`：优先 WebSocket，若在建立成功前失败则回退到 SSE
- `websocket`：仅使用 WebSocket
- `sse`：仅使用 Server-Sent Events

## 运行时说明

- 所有请求都会以 JSON `POST` 发送到 `${baseURL}/api/{endpoint}`。
- 入参与响应都会按 `@saltify/milky-types` 生成的 schema 做运行时校验。
- `createMilkyFetch` 默认使用 `globalThis.fetch`；如果运行时没有提供，需要手动传入 `fetch`。
- 请求超时时间默认是 `30000ms`，可通过 `timeout: false` 为单次请求关闭。
- 事件连接超时时间默认是 `15000ms`。
- SSE 鉴权会通过 `token` 查询参数附加到事件地址上。

## 开发

```bash
pnpm install
pnpm generate-api
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
```
