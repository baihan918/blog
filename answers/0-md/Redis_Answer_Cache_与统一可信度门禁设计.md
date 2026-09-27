# AI 问答系统中的 Redis Answer Cache 与统一可信度门禁设计

## 1. 核心结论

在已经存在统一 **Confidence Gate（可信度门禁）** 的 AI
问答系统中，不建议在 Semantic Cache 层额外增加一套 LLM Judge。

更合理的职责划分是：

-   **Cache / RAG / Tool / API**：负责高效地产生 Candidate。
-   **Confidence Gate**：统一判断 Candidate 是否可信、是否可以最终交付给用户。
-   **Semantic Cache**：只判断"是否存在足够相似、可能可以复用的历史结果"，不承担最终事实可信度判断。
-   Cache Hit 后仍然经过统一 Confidence Gate。
-   Cache Miss 才进入完整 Retrieval + Generation 流程。

可以抽象为：

``` text
Cache / RAG / Tool / API
        ↓
Candidate Producer
        ↓
Unified Confidence Gate
        ↓
      Response
```

这种设计避免在不同链路中维护多套
Judge，并使缓存真正承担"跳过昂贵计算链路"的作用。

------------------------------------------------------------------------

## 2. 为什么不应该在 Semantic Cache 中再放一个独立 Judge

一种常见设计是：

``` text
Query
 ↓
Embedding
 ↓
Semantic Cache Search
 ↓
Similarity Threshold
 ↓
Small LLM Judge
 ↓
Cache Hit / Miss
```

如果 Cache Hit 之后系统最终仍然需要经过一个统一 Confidence
Gate，那么这里的小模型 Judge 会造成职责重复：

``` text
Semantic Cache Judge
        ↓
Confidence Gate
```

问题包括：

1.  增加额外 LLM 调用延迟。
2.  增加 Token 和模型调用成本。
3.  Cache 层越来越重，削弱缓存本身的性能收益。
4.  Cache Judge 与最终 Gate 可能采用不同 Prompt、阈值和评价标准。
5.  后续 Eval、Trace 和问题定位变复杂。

因此更合理的原则是：

> Cache 层负责"能不能找到候选"，统一 Gate 负责"候选能不能交付"。

------------------------------------------------------------------------

## 3. 推荐的整体链路

``` text
                         Query
                           ↓
                     Exact Cache
                       /       \
                    Hit         Miss
                     ↓            ↓
                     │       Semantic Cache
                     │         /       \
                     │      Hit         Miss
                     │       ↓            ↓
                     │       │        Retrieval
                     │       │            ↓
                     │       │       BM25 + Dense
                     │       │            ↓
                     │       │           RRF
                     │       │            ↓
                     │       │        Reranker
                     │       │            ↓
                     │       │      Context Builder
                     │       │            ↓
                     │       │         Generation
                     │       │            ↓
                     │       └──────┬─────┘
                     │              ↓
                     └──────────────┤
                                    ↓
                            Confidence Gate
                              /           \
                           PASS           FAIL
                            ↓               ↓
                         Return       Retry / RAG /
                                      Fallback / Abstain
```

这里 Exact Cache、Semantic Cache 和 RAG 都只是不同的 Candidate Source。

最终输出必须经过同一个 Confidence Gate。

------------------------------------------------------------------------

## 4. Semantic Cache 到底负责什么

Semantic Cache 只回答：

> 当前 Query 是否存在一个足够相似的历史 Query，可以把其历史 Answer 作为
> Candidate？

基本流程：

``` text
Query
 ↓
Embedding
 ↓
Metadata Filter
 ↓
Redis Vector Search
 ↓
Top-1 / Top-K
 ↓
Similarity >= Threshold ?
 ↓
YES → Cached Candidate
NO  → Cache Miss
```

例如：

``` text
历史 Query：
公司退款多久到账？

当前 Query：
退款一般几天能到账？
```

如果 Embedding 相似度达到经过 Eval 校准后的阈值，则得到一个 Cached
Candidate。

注意：

``` text
Similarity 高
≠
最终答案一定可信
```

Similarity 只决定是否值得复用这个 Candidate。

最终可信度仍然由 Confidence Gate 判断。

------------------------------------------------------------------------

## 5. Metadata Filter 必须在相似度搜索之前参与约束

不能只根据 Query Embedding 相似度命中缓存。

例如：

``` text
Workspace A：
退款自动处理

Workspace B：
退款需要人工审核
```

两个用户都问：

``` text
退款怎么处理？
```

Embedding 几乎完全一致。

如果 Semantic Cache 只看相似度，就可能发生跨 Workspace 错误命中。

因此 Semantic Cache 至少应该考虑：

``` text
workspace_id / tenant_id
knowledge_version
ACL / permission_scope
language
业务域（必要时）
```

推荐：

``` text
Query
 ↓
workspace_id = product-a
AND
knowledge_version = 1.5
AND
ACL = current_user_scope
 ↓
Vector Search
 ↓
Similarity
```

核心原则：

> Metadata 是硬过滤条件，Similarity 是软匹配条件。

------------------------------------------------------------------------

## 6. Cache Hit 后为什么仍然需要经过 Confidence Gate

Semantic Similarity 解决的是：

``` text
“这两个问题像不像？”
```

但 Confidence Gate 解决的是：

``` text
“这个答案现在还能不能可信地回答当前问题？”
```

两者不是同一个问题。

例如：

``` text
历史 Query：
退款多久到账？

Cached Answer：
退款通常 3 个工作日到账。
```

当前 Query：

``` text
退款现在一般多久到账？
```

Semantic Cache 可能正确命中。

但如果知识库已经发生变化：

``` text
旧版本：3 个工作日
新版本：1 个工作日
```

缓存答案已经失效。

因此缓存命中并不意味着可以直接绕过最终质量控制。

------------------------------------------------------------------------

## 7. Answer Cache 不应该只缓存 Answer

如果 Confidence Gate 只拿到：

``` text
Question
+
Cached Answer
```

它实际上很难判断 Answer 是否有事实依据。

因此 Answer Cache 最好同时保存生成答案时使用的 Evidence 和 Citation。

推荐 Cache Entry：

``` json
{
  "normalized_query": "退款一般多久到账",
  "query_embedding": "...",
  "answer": "退款通常会在 3 个工作日内到账。",
  "evidence": [
    "退款将在审核完成后的 3 个工作日内原路退回。"
  ],
  "citations": [
    "doc_123#chunk_4"
  ],
  "workspace_id": "product-a",
  "knowledge_version": "1.5",
  "permission_scope": "internal",
  "created_at": 1790123456,
  "model_version": "model-x",
  "prompt_version": "qa-v3"
}
```

Cache Hit 后：

``` text
Current Query
      +
Cached Answer
      +
Cached Evidence
      +
Citation
      +
Knowledge Version
      +
Cache Similarity
      ↓
Confidence Gate
```

这样 Gate 才拥有足够的信息进行判断。

------------------------------------------------------------------------

## 8. Knowledge Version 与缓存失效

假设：

``` text
v1.0：
退款需要人工审核
```

产生缓存：

``` text
Q：退款需要审核吗？
A：需要人工审核。
```

后来 PRD 更新：

``` text
v1.5：
退款已经支持自动退款。
```

如果 Semantic Cache 继续搜索 v1.0 的历史 Query，就可能产生错误命中。

因此 Cache 必须和 Knowledge Version 绑定。

可以使用 Namespace：

``` text
qa:{workspace_id}:{knowledge_version}:{query_hash}
```

例如：

``` text
qa:product-a:v1.0:xxx
qa:product-a:v1.5:xxx
```

Semantic Cache 同样需要：

``` text
FILTER
workspace_id = product-a
AND
knowledge_version = 1.5
```

这样知识版本升级后，旧缓存不会参与当前版本检索。

旧 Cache 可以异步清理，不需要在知识更新时同步执行大规模删除。

------------------------------------------------------------------------

## 9. Cache Hit 与 Cache Miss 的完整流程

### Cache Hit

``` text
Query
 ↓
Normalize
 ↓
Exact Cache Miss
 ↓
Embedding
 ↓
Semantic Cache Search
 ↓
Metadata Filter
 ↓
Similarity >= Threshold
 ↓
Cached Answer + Evidence
 ↓
Confidence Gate
 ↓
PASS
 ↓
Return
```

这里直接跳过：

``` text
BM25
Dense Retrieval
RRF
Reranker
Context Builder
LLM Generation
```

因此 Answer Cache
的收益并不仅仅是省掉一次向量检索，而是可以省掉后面的整个 RAG +
Generation Pipeline。

------------------------------------------------------------------------

### Cache Hit 但 Gate Fail

``` text
Semantic Cache Hit
 ↓
Cached Candidate
 ↓
Confidence Gate
 ↓
FAIL
 ↓
完整 RAG Retrieval
 ↓
Generation
 ↓
Confidence Gate
 ↓
PASS
 ↓
更新 Cache
 ↓
Return
```

也就是说：

> Cache Hit 只是 Candidate Hit，不代表最终 Response Hit。

------------------------------------------------------------------------

### Cache Miss

``` text
Query
 ↓
Semantic Cache Miss
 ↓
BM25 + Dense
 ↓
RRF
 ↓
Reranker
 ↓
Context Builder
 ↓
LLM Generation
 ↓
Confidence Gate
 ↓
PASS
 ↓
Write Answer Cache
 ↓
Return
```

------------------------------------------------------------------------

## 10. Exact Cache 与 Semantic Cache

推荐两级缓存：

``` text
Query
 ↓
Exact Cache
 ↓ MISS
Semantic Cache
 ↓ MISS
RAG
```

### Exact Cache

通过标准化 Query + Hash：

``` text
normalize(query)
 ↓
hash
 ↓
Redis GET
```

例如：

``` text
qa:product-a:v1.5:a8f93c...
```

优势：

-   O(1) 查询。
-   延迟极低。
-   几乎不存在 Semantic False Hit。
-   实现简单。

缺点：

-   "退款多久到账"和"退款一般几天到账"无法直接共享缓存。

------------------------------------------------------------------------

### Semantic Cache

通过：

``` text
Query Embedding
 ↓
Redis Vector Search
 ↓
Similarity Threshold
```

解决语义相同但表达不同的问题。

优势：

-   Cache Hit Rate 更高。
-   可以跳过完整 RAG + Generation。

缺点：

-   存在 False Hit。
-   需要 Embedding 和 ANN Search。
-   Threshold 需要通过 Eval 校准。

因此推荐：

``` text
Exact Cache
    ↓ MISS
Semantic Cache
    ↓ MISS
RAG
```

------------------------------------------------------------------------

## 11. Similarity Threshold 如何确定

不要直接拍脑袋设置：

``` text
threshold = 0.9
```

应该建立 Cache Eval Dataset：

``` text
Query A：
退款多久到账？

Query B：
退款一般几天到账？

should_hit = true
```

以及：

``` text
Query A：
退款多久到账？

Query B：
退款不到账怎么办？

should_hit = false
```

测试不同 Threshold：

``` text
Threshold    Precision    Recall

0.80           82%         95%
0.85           89%         91%
0.90           96%         84%
0.93           98%         72%
```

Semantic Cache 通常应该：

``` text
Precision > Recall
```

因为：

``` text
False Negative
→ Cache Miss
→ 多执行一次 RAG
→ 增加延迟和成本
```

而：

``` text
False Positive
→ 错误 Cache Hit
→ 可能直接产生错误 Candidate
```

因此宁可少命中，也不要大量错误命中。

------------------------------------------------------------------------

## 12. 为什么统一 Confidence Gate 更适合扩展

未来系统可能不仅有 RAG：

``` text
             Candidate Sources

      ┌──────────┬──────────┬─────────┐
      ↓          ↓          ↓         ↓
    Cache       RAG       SQL/API    MCP
      │          │          │         │
      └──────────┴────┬─────┴─────────┘
                      ↓
              Unified Candidate
                      ↓
             Confidence Gate
                      ↓
                   Response
```

这时每个数据源都不需要重新实现自己的最终质量判断。

所有上游组件只需要负责：

> 尽可能高效地产生高质量 Candidate。

统一 Gate 负责：

> Candidate 是否满足最终交付标准。

因此可以把系统职责抽象为：

``` text
Candidate Producer
        +
Candidate Validator
```

其中：

``` text
Candidate Producer
├── Exact Cache
├── Semantic Cache
├── RAG
├── SQL
├── API
├── MCP
└── Web Search

Candidate Validator
└── Unified Confidence Gate
```

这是比"每个链路自己维护一个 Judge"更容易维护和扩展的架构。

------------------------------------------------------------------------

## 13. 延迟收益应该怎么理解

如果没有缓存：

``` text
Embedding
 ↓
BM25 + Dense
 ↓
RRF
 ↓
Reranker
 ↓
Context Builder
 ↓
LLM Generation
 ↓
Confidence Gate
```

Semantic Answer Cache Hit：

``` text
Embedding
 ↓
Redis Vector Search
 ↓
Cached Answer + Evidence
 ↓
Confidence Gate
```

两条链路都经过 Confidence Gate，因此 Gate 不属于 Cache 的额外开销。

Cache 真正节省的是：

``` text
BM25 + Dense Retrieval
RRF
Reranker
Context Builder
LLM Generation
```

尤其最终 LLM Generation 往往是延迟和成本的重要来源，因此 Answer Cache
的收益不仅是 Retrieval Cache。

------------------------------------------------------------------------

## 14. 最终架构原则

整个设计可以总结为四句话：

### 1. Cache 负责候选复用，不负责最终事实判断

``` text
Semantic Similarity
→ Candidate Selection
```

而不是：

``` text
Semantic Similarity
→ Final Truth
```

### 2. 所有 Candidate 统一经过 Confidence Gate

``` text
Cache
RAG
Tool
API
 ↓
Unified Confidence Gate
```

避免多套 Judge。

### 3. Answer Cache 必须带 Evidence

不要只缓存：

``` text
Query → Answer
```

而应该：

``` text
Query
→ Answer
→ Evidence
→ Citation
→ Knowledge Version
→ ACL
```

让 Gate 有足够的信息判断答案可信度。

### 4. Cache Hit 是 Candidate Hit，不等于 Response Hit

完整状态应该理解为：

``` text
Cache Candidate Hit
        ↓
Confidence Gate
   /           \
PASS           FAIL
 ↓              ↓
Return          RAG
```

因此：

> **Cache / RAG / Tool 是 Candidate Producer，Confidence Gate 是统一的
> Candidate Validator。**

这也是整个架构最核心的职责边界。
