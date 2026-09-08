# W1 验收清单（编排闭环 + 写路径可观测）

更新时间：2026-02-27  
适用范围：`W1-01`、`W1-02`、`W1-03`

---

## 1. 配置语法检查

```bash
docker compose -f docker-compose.yaml config -q
docker compose -f backend/docker-compose.yml config -q
```

通过标准：
1. 命令返回码为 0。  
2. 无 compose 语法错误。  

---

## 2. 启动与运行检查（根目录编排）

```bash
docker compose up -d outbox-relay projection-worker
docker compose ps outbox-relay projection-worker
docker compose logs --tail=100 outbox-relay projection-worker
```

通过标准：
1. 两个服务状态为 `Up`。  
2. 日志中无持续崩溃重启。  
3. 可见 worker 主循环日志。  

---

## 3. 启动与运行检查（backend 编排）

```bash
docker compose -f backend/docker-compose.yml up -d outbox-relay projection-worker
docker compose -f backend/docker-compose.yml ps outbox-relay projection-worker
docker compose -f backend/docker-compose.yml logs --tail=100 outbox-relay projection-worker
```

通过标准：
1. 两个服务可独立启动。  
2. 与根目录编排行为一致。  

---

## 4. Canvas 写路径日志检查

说明：发起一次 `/apply` 或 `/update` 请求后，检查 backend 日志。

建议关键字：
1. `Canvas apply write path selected`  
2. `Canvas update write path selected`  
3. `path_source=realtime|legacy`  

通过标准：
1. 每次写请求都有一条“路径选择日志”。  
2. 日志带有 `request_id`, `path_source`, `canvas_id`。  

---

## 5. 验收记录模板（复制即用）

```txt
[W1 验收记录]
日期:
执行人:

1) 配置语法检查:
- root compose:
- backend compose:

2) 运行检查:
- root outbox-relay:
- root projection-worker:
- backend outbox-relay:
- backend projection-worker:

3) 日志抽样:
- apply request_id:
- apply path_source:
- update request_id:
- update path_source:

4) 结论:
- 是否通过:
- 未通过项:
- 处理计划:
```

