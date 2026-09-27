# Python 异步编程：进程、线程、协程、async/await、yield 与 Agent 流式输出

## 1. 进程、线程和协程的核心差异

可以先用一个简单类比理解：

-   **进程（Process）**：多个人，各自拥有一套独立办公室。
-   **线程（Thread）**：一个办公室里的多个人，共享办公室资源。
-   **协程（Coroutine）**：一个人同时维护很多任务，一个任务需要等待时，就先去处理其他任务。

  对比项       进程 Process      线程 Thread          协程 Coroutine
  ------------ ----------------- -------------------- -------------------
  调度者       操作系统          操作系统             程序 / Event Loop
  内存         独立              共享进程内存         共享线程内存
  切换成本     高                中                   很低
  创建成本     高                中                   很低
  Python GIL   多进程可绕开      CPU 密集场景受影响   本身不解决 GIL
  典型场景     CPU 密集          阻塞式 I/O           高并发 I/O
  常见 API     multiprocessing   threading            asyncio

### 选择原则

``` text
任务
 │
 ├── CPU 密集
 │      ↓
 │   多进程
 │
 └── I/O 密集
        │
        ├── 阻塞式库 / 普通并发
        │      ↓
        │    多线程
        │
        └── 大量网络 I/O / 高并发
               ↓
             协程
```

Agent、RAG、LLM、数据库、MCP、HTTP API 等场景通常存在大量网络
I/O，因此协程非常常见。

------------------------------------------------------------------------

## 2. Python 协程和 JS 微任务是什么关系？

**Python 协程不能直接理解为 JS 微任务。**

更准确的类比：

``` text
JavaScript                     Python asyncio

async function        ≈        async def
Promise               ≈        Future / Task
await                 ≈        await
Event Loop            ≈        asyncio Event Loop
异步函数执行过程       ≈        Coroutine
Microtask Queue       ≠        Coroutine
```

Python：

``` python
async def task():
    result = await fetch_data()
    print(result)
```

JavaScript：

``` javascript
async function task() {
    const result = await fetchData()
    console.log(result)
}
```

两者的核心心智模型类似：

``` text
开始执行
   ↓
遇到 await
   ↓
当前任务暂停
   ↓
执行权交还 Event Loop
   ↓
Event Loop 执行其他任务
   ↓
异步操作完成
   ↓
恢复之前的任务
```

JS 中 `await` 后续执行基于 Promise 调度，通常会进入微任务机制；因此
**async function 可以类比 Python 协程，但 Coroutine 本身不能等同于
Microtask。**

------------------------------------------------------------------------

## 3. async / await 如何暂停和恢复协程？

核心：

> `await` 遇到未完成的异步操作时，会挂起当前协程，将控制权交还 Event
> Loop；异步操作完成后，Event Loop 再重新调度该协程，从 `await`
> 后继续执行。

例如：

``` python
async def fetch_data():
    print("1. 开始")

    result = await request()

    print("2. 请求完成")
    return result
```

执行过程：

``` text
fetch_data 开始
       ↓
执行 request()
       ↓
结果没有准备好
       ↓
await 挂起 fetch_data
       ↓
保存当前执行状态
       ↓
控制权交还 Event Loop
       ↓
Event Loop 执行其他 Task
       ↓
request 完成
       ↓
Event Loop 重新调度 fetch_data
       ↓
从 await 后恢复
       ↓
继续执行
```

这里暂停的是 **Coroutine**，不是整个线程。

因此一个线程中的 Event Loop 可以同时维护大量等待 I/O 的协程。

------------------------------------------------------------------------

## 4. await 和 yield 有什么区别？

两者共同点：

> 都可以暂停当前执行，并保存执行现场，之后再从暂停的位置继续。

但目的不同。

  对比项       yield                         await
  ------------ ----------------------------- -------------------------------
  主要对象     Generator / Async Generator   Coroutine
  暂停目的     产生一个值                    等待异步结果
  数据给谁     调用者                        获取异步操作结果
  谁驱动恢复   next() / for / async for      Event Loop
  常见场景     惰性迭代、流式生产数据        HTTP、数据库、LLM、RAG 等 I/O
  核心思想     生产一个给一个                等待期间让出执行权

可以记成：

``` text
yield：

“我先给你一个值。
我暂停一下，
你下次再要数据时我继续。”


await：

“这个异步结果还没回来。
我先暂停，
Event Loop 你先执行别人，
结果好了再恢复我。”
```

------------------------------------------------------------------------

## 5. yield 为什么可以用于流式输出？

首先要明确：

> **yield 本身不负责网络传输。**

它解决的是：

> **数据不需要全部准备完成，可以生产一个就交给调用方一个。**

普通 `return`：

``` python
def get_data():
    return 1
```

执行 `return` 后函数直接结束。

而：

``` python
def get_data():
    yield 1
    yield 2
    yield 3
```

会产生 Generator：

``` python
gen = get_data()

print(next(gen))  # 1
print(next(gen))  # 2
print(next(gen))  # 3
```

执行过程：

``` text
第一次 next()
    ↓
yield 1
    ↓
返回 1
    ↓
函数暂停

第二次 next()
    ↓
从 yield 1 后继续
    ↓
yield 2
    ↓
返回 2
    ↓
再次暂停
```

因此：

``` text
return：
等所有数据准备完成 → 一次返回

yield：
生产 A → 给出去
生产 B → 给出去
生产 C → 给出去
```

这就是流式处理的基础能力。

------------------------------------------------------------------------

## 6. Agent 中 yield 是怎么工作的？

Agent 中最常见的是异步生成器：

``` python
async def agent():
    yield "开始"

    result = await rag_search()
    yield result

    result = await call_tool()
    yield result
```

Agent 可以不断产生阶段性数据。

调用方：

``` python
async for chunk in agent():
    print(chunk)
```

会依次得到每一次 `yield` 的内容。

``` text
agent
  │
  ├── yield "开始"
  │        ↓
  │   async for 收到
  │
  ├── await rag_search()
  │
  ├── yield rag_result
  │        ↓
  │   async for 收到
  │
  ├── await call_tool()
  │
  └── yield tool_result
           ↓
      async for 收到
```

所以可以记：

> **yield = 生产一个。**\
> **async for = 消费一个。**

------------------------------------------------------------------------

## 7. async for 为什么可以一直等 yield？

假设：

``` python
async def agent():
    yield "A"

    await asyncio.sleep(5)

    yield "B"

    await asyncio.sleep(10)

    yield "C"
```

消费：

``` python
async for chunk in agent():
    print(chunk)
```

输出时间大致是：

``` text
立即：A

等待 5 秒

B

等待 10 秒

C
```

`async for` 不会因为暂时没有新的 `yield` 就结束。

只要：

-   异步生成器没有执行结束；
-   没有抛出异常；
-   没有被取消；

它就会继续等待下一个值。

------------------------------------------------------------------------

## 8. async for 到底是怎么"等"的？

这是理解整个机制最关键的一步。

`async for` **本身不是一个协程**，它是一种异步迭代语法，一般运行在
`async def` 协程内部。

例如：

``` python
async def main():
    async for chunk in agent():
        print(chunk)
```

可以把：

``` python
async for chunk in agent():
    print(chunk)
```

粗略理解成：

``` python
iterator = agent()

while True:
    chunk = await iterator.__anext__()
    print(chunk)
```

关键就在：

``` python
await iterator.__anext__()
```

也就是说：

> **async for 本质上是在不断异步等待"下一个值"。**

------------------------------------------------------------------------

## 9. yield 出现后为什么 async for 会继续？

完整流程：

``` text
main 协程
   │
   │ async for 想获取下一个值
   ▼
await agent.__anext__()
   │
   ▼
agent 开始 / 恢复执行
   │
   ├── await 某个异步操作
   │
   │       ↓
   │   agent 暂停
   │       ↓
   │   Event Loop 执行其他任务
   │       ↓
   │   异步操作完成
   │       ↓
   │   agent 恢复
   │
   └── yield "A"
            │
            ▼
     __anext__() 得到结果
            │
            ▼
       main 协程恢复
            │
            ▼
       chunk = "A"
            │
            ▼
        print("A")
            │
            ▼
 async for 再请求下一个值
```

因此更准确地说：

> 不是 `yield` 像事件一样"触发 async for"。

而是：

> **async for 正在 `await` 下一个值；当生成器执行到 `yield`
> 时，这次等待得到结果，因此消费者协程可以继续执行。**

------------------------------------------------------------------------

## 10. Agent 中 await + yield 的完整配合

这是 Agent Streaming 最值得掌握的模型：

``` python
async def agent():

    result1 = await rag_search()
    yield result1

    result2 = await call_tool()
    yield result2

    async for token in llm.astream():
        yield token
```

消费者：

``` python
async for chunk in agent():
    print(chunk)
```

整体过程：

``` text
async for：给我下一个
        ↓
agent：开始执行
        ↓
await rag_search()
        ↓
RAG 没返回
        ↓
agent 暂停
        ↓
Event Loop 执行其他任务
        ↓
RAG 返回
        ↓
agent 恢复
        ↓
yield result1
        ↓
async for 等待完成
        ↓
处理 result1
        ↓
async for：再给我下一个
        ↓
agent 从上一次 yield 后继续
        ↓
await call_tool()
        ↓
……
```

一句话：

> **await：没结果时先等。**\
> **yield：有阶段性结果时先往外给。**

------------------------------------------------------------------------

## 11. 从 LLM 到浏览器的真正流式链路

`yield` 只是 Python 内部的数据生产机制。

真正发到浏览器还需要 SSE、WebSocket 或 HTTP Streaming。

例如：

``` python
async def agent():
    async for chunk in llm.astream("介绍一下 RAG"):
        yield chunk
```

上层：

``` python
async def stream():
    async for chunk in agent():
        yield f"data: {chunk}\n\n"
```

完整链路：

``` text
LLM
 │
 │ 产生 token / chunk
 ▼
Agent
 │
 │ yield chunk
 ▼
async for
 │
 │ 消费 chunk
 ▼
SSE / WebSocket / StreamingResponse
 │
 │ 网络发送
 ▼
浏览器
 │
 │ 收到一个 chunk
 ▼
立即渲染
```

因此三个职责要分清：

``` text
yield
 ↓
生产一个给一个

async for
 ↓
消费一个拿一个

SSE / WebSocket
 ↓
拿到一个往浏览器发送一个
```

------------------------------------------------------------------------

## 12. yield 间隔很久会不会丢数据？

正常不会。

例如：

``` python
async def agent():
    yield "A"

    await very_slow_tool()   # 30 秒

    yield "B"
```

消费者：

``` python
async for chunk in agent():
    print(chunk)
```

仍然会：

``` text
A

等待 30 秒

B
```

Python 异步迭代层面没有问题。

但是工程上还有一个额外问题：

``` text
Agent
 ↓
SSE
 ↓
Nginx
 ↓
Load Balancer
 ↓
Browser
```

如果长时间完全没有网络数据，一些网关或代理可能因为超时关闭连接。

所以真实系统可能需要：

-   heartbeat
-   keepalive
-   SSE ping
-   合理设置代理超时时间

例如 SSE 定期发送：

``` text
: ping
```

这是**网络连接保活问题**，不是 `yield` / `async for` 本身的问题。

------------------------------------------------------------------------

## 13. 什么情况下 async for 拿不到后续 yield？

主要包括：

1.  `agent()` 执行结束；
2.  `agent()` 抛出异常；
3.  Task 被取消；
4.  用户点击"停止生成"导致任务取消；
5.  如果涉及网络 Streaming，SSE / WebSocket / HTTP 连接被断开。

否则异步生成器会继续被消费。

------------------------------------------------------------------------

## 14. 最终心智模型

把整个 Python Agent 异步流式机制压缩成下面这张图：

``` text
                    Event Loop
                        │
             ┌──────────┴──────────┐
             │                     │
        消费者协程              Agent
             │                     │
      async for chunk              │
             │                     │
      await __anext__() ───────→ 开始执行
             │                     │
             │               await RAG / Tool
             │                     │
             │                 暂停等待
             │                     │
             │                I/O 完成恢复
             │                     │
             │                yield chunk
             │                     │
             └──── 得到 chunk ←────┘
             │
        处理 / SSE 发送
             │
      再 await __anext__()
             │
             └──────────────→ Agent 从上次
                              yield 后继续
```

------------------------------------------------------------------------

## 15. 面试记忆版

### 进程、线程、协程

> CPU 密集型任务通常使用多进程利用多核；传统阻塞式 I/O
> 可以使用多线程；大量网络 I/O、高并发任务适合 asyncio 协程。

### await

> `await` 遇到未完成的异步操作时挂起当前协程，把控制权交还 Event
> Loop；异步操作完成后再恢复当前协程。

### yield

> `yield`
> 会产出一个值并暂停生成器，调用方获取这个值后，下一次请求数据时再从上次暂停的位置继续执行。

### await 与 yield

> `await` 主要解决"异步等待"，`yield` 主要解决"逐步产出"。

### async for

> `async for` 用于消费异步迭代器，可以粗略理解为不断执行
> `await iterator.__anext__()`，因此它能够异步等待下一次 `yield`
> 的结果。

### Agent Streaming

> Agent 中通常通过 `await` 非阻塞地等待 LLM、RAG、Tool 等 I/O，通过
> `yield` 将已经得到的阶段性结果逐步交给上层，再由 SSE、WebSocket 或
> HTTP Streaming 推送给前端。

------------------------------------------------------------------------

## 16. 最值得记住的几句话

``` text
await = 没结果，我先等，让别人跑。

yield = 有一个结果，我先给出去。

async for = 我不断异步等你下一个结果。

Event Loop = 谁可以继续执行，我来调度。

SSE / WebSocket = 把 yield 出来的结果真正传给浏览器。
```

最终：

``` text
await 解决等待
      ↓
yield 解决生产
      ↓
async for 解决消费
      ↓
SSE / WebSocket 解决网络传输
      ↓
前端解决实时渲染
```
