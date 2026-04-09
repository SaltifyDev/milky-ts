# Milky Tea

[![CI](https://github.com/SaltifyDev/milky-tea/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/SaltifyDev/milky-tea/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FSaltifyDev%2Fmilky-tea%2Fbadges%2Fcoverage-badge.json)](https://github.com/SaltifyDev/milky-tea/actions/workflows/ci.yml)

Milky 的 TypeScript SDK，提供类型安全的 API 调用和事件流支持。

## 安装

```bash
npm i @saltify/milky-tea @saltify/milky-types
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
const source = client.event('auto', {
  reconnect: {
    interval: 1000,
    attempts: 'always',
  },
})

// 监听连接打开
source.on('open', () => {
  console.log('connected')
})

// 监听所有事件
source.on('push', (event) => {
  console.log(event.event_type, event)
})

// 监听特定类型的事件
source.on('private_message_created', (event) => {
  console.log('收到私聊消息:', event.message.content)
})

// 监听错误
source.on('error', (event) => {
  console.error(event.message)
})

// 使用 async iteration
for await (const event of source) {
  console.log(event.event_type)
  if (shouldStop)
    break
}

source.close()
```

**注意**: 事件对象是深度只读的（immutable），所有嵌套属性都被冻结，无法修改。

### `createMilkyEventSource`

如果需要更底层的事件源控制，可以使用 `createMilkyEventSource` 直接创建事件源。

```ts
import { createMilkyEventSource } from '@saltify/milky-tea'

// 使用连接类型和选项
const source = createMilkyEventSource('websocket', {
  baseURL: 'https://milky.example.com',
  token: process.env.MILKY_TOKEN,
  timeout: 15000,
  reconnect: {
    interval: 1000,
    attempts: 5,
  },
})

// 或使用自定义传输工厂
const source = createMilkyEventSource(async (options, signal) => {
  // 返回 WebSocket 或 EventSource 实例
  return new WebSocket('wss://milky.example.com/event')
}, {
  timeout: 10000,
})

source.on('open', () => console.log('Connected'))
source.on('push', event => console.log(event))
source.close()
```

**参数**:
- `kind`: 连接类型 (`'auto'` | `'websocket'` | `'sse'`)
- `factory`: 自定义传输工厂函数
- `options`:
  - `baseURL`: 服务器地址（使用 kind 时必需）
  - `token`: 访问令牌
  - `timeout`: 连接超时时间（默认 15000ms）
  - `reconnect`: 重连配置
    - `interval`: 重连间隔（毫秒）
    - `attempts`: 重连次数（`'always'` 或数字）

### `createMilkyFetch`

`createMilkyFetch` 提供了一个更底层的 fetch 封装，允许直接调用原始的 API endpoint。

```ts
import { createMilkyFetch } from '@saltify/milky-tea'

const milkyFetch = createMilkyFetch({
  baseURL: 'https://milky.example.com',
  strict: false,
})

const login = await milkyFetch('get_login_info', undefined)
console.log(login.uin)
```

`strict` 默认为 `true`。关闭后会跳过请求参数和响应数据的 zod 校验；也可以在单次请求的 override 里单独设置。

## 开发

```bash
pnpm install
pnpm generate-api
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
```
