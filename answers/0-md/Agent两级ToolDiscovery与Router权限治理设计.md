# Agent 两级 Tool Discovery 与 Router 权限治理设计

## 1. 背景

Workspace Agent 中，不同 Agent 共享统一的 Tool
Infrastructure，但职责和权限不同：

-   Workflow Agent：围绕 Workflow Node 完成任务和流程推进。
-   Node Conversation Agent：围绕当前 Node 已生成的 Artifact
    进行开放式对话、修改和迭代。
-   每个 Agent 都有独立的 ReAct Loop。
-   多个 Agent 复用同一套 Tool Catalog / Tool Router / Tool
    Runtime，但可见和可执行的 Tool 范围不同。

如果把所有 Tool Schema 一次性暴露给 LLM，会带来 Tool Schema 占用
Context、Tool Selection 搜索空间过大、多 Agent 权限边界不清等问题。

因此采用：

> **Source 权限过滤 + 两级 Tool Discovery + Agent Reasoning + Router
> 执行时兜底校验**

## 2. 核心职责

### Agent Reasoning

负责回答：

> **当前应该使用什么能力，以及具体调用哪个 Tool？**

Capability Group Selection 和 Concrete Tool Selection 都属于 Agent ReAct
/ Reasoning，不再单独设计 Capability Planning。

### Tool Catalog / Tool Client

负责：

-   根据当前 Agent Source 获取允许使用的 Capability Groups。
-   根据 Agent 选择的 Group 按需展开 Concrete Tools。
-   向 Agent 提供 Tool Name、Description、Input Schema。
-   避免一次性把全部 Tool Schema 放入 LLM Context。

### Tool Router

负责：

> **当前来源是否允许执行这次 Tool Call？**

主要承担 Source/Tool 权限校验、参数校验、Risk Policy、Audit
等执行治理。Router 不负责替 Agent 做语义层面的 Tool Selection。

### Tool Runtime

负责：

> **已经允许执行的 Tool Call 具体怎么执行？**

Runtime 屏蔽 MCP、Function Tool、RAG 等不同 Provider 的执行差异。

## 3. Agent Source 与权限配置

每个 Agent 初始化时绑定自己的 Source，例如：

``` text
workspace_workflow_agent
prd_conversation_agent
rfc_conversation_agent
```

权限配置维护在 Tool Router 侧，并通过 Apollo 管理，而不是写死在 Agent
Prompt 中。

``` text
Apollo

workspace_workflow_agent
  ├─ repository_search
  ├─ artifact
  ├─ workflow
  └─ rag

prd_conversation_agent
  ├─ repository_search
  ├─ artifact
  └─ rag
```

### Source 不由 LLM 生成

Source 属于 Agent Runtime 身份信息：

``` python
tool_client = ToolClient(
    source="prd_conversation_agent"
)
```

后续 Tool Call 由 Tool Client / Runtime 自动携带 Source，而不是让 LLM
自由填写。

> **LLM 负责产生 Tool 决策，Agent Runtime 负责提供可信身份。**

## 4. 第一阶段：获取 Allowed Capability Groups

Agent 初始化 Tool Client 后，不直接获取所有 Concrete Tools，而是先根据
Source 获取当前 Agent 有权限的能力分组：

``` python
tool_groups = tool_client.get_allowed_tool_groups()
```

例如返回：

``` text
repository_search
code_read
artifact
rag
```

提供给 LLM 的只是轻量能力描述：

``` json
[
  {
    "name": "repository_search",
    "description": "检索当前 Workspace Repository 中的相关代码和文件"
  },
  {
    "name": "artifact",
    "description": "读取或修改当前 Workflow Artifact"
  },
  {
    "name": "rag",
    "description": "检索 Workspace 业务知识"
  }
]
```

此时不暴露各 Group 下所有 Tool 的完整 Schema。

## 5. 第二阶段：Agent Reasoning 选择 Capability Group

用户任务进入 Agent 后开始 ReAct。

例如：

``` text
根据 Figma 把商品详情页按钮样式调整一下。
```

Agent 根据 Query、State、Context 和 Observation 判断当前需要：

``` text
design_read
repository_search
```

这里发生的是 **Capability Group Selection**，仍属于 Agent
Reasoning，而不是独立 Capability Planning Agent。

## 6. 第三阶段：按需展开 Concrete Tools

确定 Capability Group 后，通过 Tool Client 获取该 Group 下当前 Source
有权限的 Concrete Tools：

``` python
design_tools = tool_client.get_tools("design_read")
repo_tools = tool_client.get_tools("repository_search")
```

例如：

``` text
design_read
  ├─ figma_get_node
  └─ figma_get_styles

repository_search
  ├─ search_file
  ├─ search_symbol
  └─ search_code
```

此时才把具体 Tool 的 Name、Description、Input Schema 和必要约束提供给
LLM。

``` text
Capability Groups
        ↓
Agent Reasoning
        ↓
选择相关 Group
        ↓
展开 Concrete Tools
        ↓
Agent Reasoning
        ↓
选择具体 Tool
```

## 7. 第四阶段：LLM 产生 Tool Call

拿到 Concrete Tool Schema 后，LLM 在当前 ReAct 中选择具体 Tool：

``` json
{
  "name": "search_code",
  "arguments": {
    "query": "ProductDetail Button"
  }
}
```

模型只关心：

``` text
toolName + arguments
```

不需要知道 Router、Apollo、MCP 或 Runtime 的内部实现。

## 8. 第五阶段：Tool Client 调用 Router

Agent Runtime 拿到 Tool Call 后：

``` python
result = await tool_client.call(
    tool_name=tool_call.name,
    arguments=tool_call.arguments
)
```

Tool Client 自动补充 Runtime Context：

``` json
{
  "source": "prd_conversation_agent",
  "workspaceId": "workspace_123",
  "traceId": "trace_456",
  "toolCallId": "call_789",
  "toolName": "search_code",
  "arguments": {
    "query": "ProductDetail Button"
  }
}
```

其中 Source 来自 Agent 初始化，不来自 LLM。

## 9. Router：执行时权限兜底

初始化阶段已经根据 Source 过滤过 Capability Groups 和 Concrete
Tools，因此正常情况下 Agent 看不到无权限 Tool。

但真正执行时 Router 仍需二次校验：

``` text
Agent 初始化
      ↓
根据 Source 获取 Allowed Capability Groups
      ↓
只向 LLM 暴露允许的能力
      ↓
按 Group 获取 Allowed Concrete Tools
      ↓
LLM 产生 Tool Call
      ↓
Tool Router
      ↓
根据 Source 再次校验权限
      ↓
Tool Runtime
```

两层控制职责不同：

-   **初始化阶段：控制 Agent 能看到什么。**
-   **Router 执行阶段：控制 Agent 最终能执行什么。**

Router 仍需兜底，因为 Apollo 权限可能动态变化、Tool
可能被下线，也可能存在绕过正常 Catalog 流程直接构造请求的情况。

## 10. Router 与 Apollo

权限关系通过 Apollo 动态配置，例如：

``` text
source: prd_conversation_agent

allowed_groups:
  - repository_search
  - artifact
  - rag

allowed_tools:
  - repository_search.search_code
  - repository_search.read_file
  - artifact.read
  - artifact.update
  - rag.search
```

Router 的校验流程：

``` text
Source 是否有效？
        ↓
Group / Tool 是否允许？
        ↓
Tool 是否 Enabled？
        ↓
Arguments 是否符合 Schema？
        ↓
Risk Policy 是否允许？
        ↓
通过
        ↓
Tool Runtime
```

使用 Apollo 的核心价值是：

> **权限策略和 Router 执行逻辑解耦。**

新增 Agent、开放 Tool 或调整权限时，不需要把权限关系硬编码进 Agent
Prompt 或 Router 业务代码。

## 11. Tool Runtime 执行

Router 校验通过后交给 Tool Runtime。

Runtime 根据 Tool Registry 找到实际 Provider：

``` text
search_code
   ↓
Tool Registry
   ↓
provider = Function

figma_get_node
   ↓
Tool Registry
   ↓
provider = MCP

rag_search
   ↓
Tool Registry
   ↓
provider = RAG
```

因此：

> **Router 解决"能不能执行"，Runtime 解决"怎么执行"。**

## 12. Tool Result 回到 ReAct

Runtime 执行后返回标准化 Tool Result：

``` json
{
  "toolCallId": "call_789",
  "status": "success",
  "data": {
    "files": []
  },
  "error": null
}
```

Agent Runtime 将结果转换成 Observation / ToolMessage：

``` text
Agent Reasoning
      ↓
选择 Capability Group
      ↓
展开 Concrete Tools
      ↓
选择 Tool
      ↓
Tool Call
      ↓
Router
      ↓
Runtime
      ↓
Tool Result
      ↓
Observation
      ↓
下一轮 Agent Reasoning
```

下一轮 Agent 根据 Observation 决定继续调用 Tool、展开新的 Capability
Group、调整 Plan、生成结果或结束当前 ReAct。

## 13. Capability Group 在 ReAct 中动态变化

Capability Group 不是任务开始时一次确定后固定：

``` text
第一轮：repository_search
        ↓
第二轮：code_read
        ↓
第三轮：design_read
        ↓
第四轮：code_edit
        ↓
第五轮：code_validation
```

> **Tool Discovery 本身也是 ReAct 的一部分。**

Agent 每一轮都可以根据最新 Observation 决定是否需要新的 Capability
Group。

## 14. Tool 调用的异步模型

Tool Client 底层适合采用异步 I/O：

``` python
result = await tool_client.call(
    tool_name=tool_call.name,
    arguments=tool_call.arguments
)
```

但 async 不代表 Agent 不等待结果。

有数据依赖时：

``` text
Tool A
  ↓
await Result A
  ↓
Observation
  ↓
Tool B
```

没有数据依赖的 Tool 可以并发：

``` python
results = await asyncio.gather(
    tool_client.call("tool_a", args_a),
    tool_client.call("tool_b", args_b)
)
```

> **底层 I/O 可以异步；Tool 是否并行由任务依赖关系决定，而不是由 async
> 本身决定。**

## 15. 完整架构

``` text
                    Agent Runtime
                         │
                         │ source
                         ▼
                    Tool Client
                         │
             get_allowed_tool_groups()
                         │
                         ▼
                Capability Groups
                         │
                         ▼
                  Agent Reasoning
                    / ReAct Loop
                         │
                 选择 Capability
                         │
                         ▼
              get_tools(capability)
                         │
                         ▼
               Concrete Tool Schema
                         │
                         ▼
                  Agent Reasoning
                         │
              toolName + arguments
                         │
                         ▼
                    Tool Client
                         │
          自动注入 source / trace context
                         │
                         ▼
                    Tool Router
                         │
               Apollo Permission
                         │
          Auth / Schema / Risk / Audit
                         │
                         ▼
                    Tool Runtime
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
             MCP      Function     RAG
              │          │          │
              └──────────┼──────────┘
                         ▼
                    Tool Result
                         │
                         ▼
              Observation / ToolMessage
                         │
                         ▼
                  Agent Reasoning
```

## 16. 为什么不需要独立 Capability Planning

Capability 判断已经包含在 Agent Reasoning / ReAct 中。

每轮根据：

``` text
Goal
+ Current State
+ Current Context
+ Previous Observation
```

判断：

``` text
当前需要什么 Capability Group？
        ↓
需要哪个 Concrete Tool？
        ↓
调用后得到什么 Observation？
        ↓
下一步做什么？
```

因此不需要额外增加 Capability Planning Agent。

职责可以固定为：

``` text
Agent Reasoning
    = 当前应该使用什么能力 / 什么 Tool

Tool Catalog
    = 不要一次把所有 Tool 暴露给模型

Tool Router
    = 当前 Source 是否允许执行这次调用

Tool Runtime
    = 具体如何执行这个 Tool
```

## 17. 设计收益

1.  **降低 Tool Schema Context 消耗**：先暴露 Capability
    Groups，需要时再展开 Tool。
2.  **降低 Tool Selection 难度**：避免模型一次从几十甚至上百个 Tool
    中选择。
3.  **支持多 Agent 共用 Tool
    Infrastructure**：共享基础设施，同时保持不同权限。
4.  **权限不依赖 Prompt**：真正的权限由确定性系统层执行。
5.  **Tool Provider 与 Agent 解耦**：Agent 不需要知道底层来自
    MCP、Function 还是 RAG。
6.  **支持动态扩展**：新增 Agent、Tool、Group 或调整权限，不需要重构整个
    Reasoning 链路。

## 18. 面试总结

> 我们没有把所有 Tool Schema 一次性注册给 LLM。每个 Agent
> 初始化时会绑定自己的 Source，通过 Tool Client 根据 Source
> 权限先获取当前 Agent 可用的 Capability Groups，只把能力分组提供给
> LLM。Agent 在 ReAct 中先判断当前需要哪个 Capability，再通过 Tool
> Client 按需展开这个 Group 下有权限的 Concrete Tool Schema，交给 LLM
> 做具体 Tool Selection。模型生成 `toolName + arguments` 后，由 Runtime
> 自动补充 Source、Trace 等可信执行上下文，请求 Tool Router。Router 根据
> Apollo 中维护的 Source 权限做执行时二次校验，通过后再交给 Tool Runtime
> 调用 MCP、Function、RAG 等实际 Provider。Tool Result 最终转换成
> Observation 回到当前 Agent 的 ReAct Loop。

一句话总结：

> **初始化阶段控制 Agent 能看到什么，Agent Reasoning
> 决定当前想调用什么，Router 控制最终能不能执行，Runtime
> 负责具体怎么执行。**
