# clipboard-h5

一个给自己用的极简 H5 剪贴板页：

- 文本先发到服务器
- 服务器端 `AES-256-GCM` 加密存储
- 默认 `60` 秒过期
- 读取一次后立即删除
- 发送端生成 `4` 位临时码
- 接收端输入 `4` 位临时码取回文本
- 无数据库、无第三方依赖，部署简单

## 启动

1. 复制环境变量：

```bash
cp .env.example .env
```

2. 修改 `.env`：

```bash
PORT=8788
APP_BASE_URL=https://your-domain.example
CLIPBOARD_MASTER_KEY=换成一段足够长的随机字符串
TTL_SECONDS=60
MAX_TEXT_BYTES=65536
```

3. 启动：

```bash
npm start
```

打开 `http://localhost:8788`

## 接口

### 创建

`POST /api/clips`

```json
{
  "text": "hello"
}
```

返回：

```json
{
  "id": "xxxxx",
  "expiresAt": 1760000000000,
  "ttlSeconds": 60,
  "url": "https://your-domain.example/clip/xxxxx"
}
```

### 读取

`POST /api/clips/read`

```json
{
  "code": "1234"
}
```

成功读取后会立即销毁该内容。

## 部署建议

- 用 `Caddy` / `Nginx` 反代到这个 Node 进程
- 必须走 `HTTPS`
- 因为当前是内存存储，进程重启后内容会消失
- 这正好适合“临时剪贴板”场景，不适合长期存储

## 安全边界

- 服务端存的是密文，不是明文
- 但服务端进程持有解密密钥，所以这是“服务端加密临时存储”，不是端到端加密
- 如果你下一步想做更强的版本，可以再加：
  - 客户端口令二次加密
  - IP/UA 绑定
  - 访问次数限制
  - rate limit
