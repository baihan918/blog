# RAG 中 Semantic Dedup 与 MMR 的生产实践

## 1. 问题背景

RAG 使用 Vector Search / BM25 / Hybrid Search 召回 Top-K 后，经常会出现大量“相关但冗余”的 Chunk。

例如查询：

> 退款规则是什么？

召回结果可能是：

```text
Chunk A：用户可以在订单详情页申请退款。
Chunk B：用户完成支付后，可以通过订单详情页发起退款申请。
Chunk C：退款申请提交后，需要经过商家审核。
Chunk D：退款审核通过后，款项将在 1～3 个工作日到账。
```

A 和 B 高度重复。如果直接把 Top-K 全部交给 LLM，会造成：

- Context Token 浪费
- 有效信息密度降低
- 真正有价值的 Chunk 被重复内容挤出 Top-K
- Reranker 计算资源浪费
- LLM 更容易受到重复证据影响

但解决这个问题时，不能简单认为“加 Semantic Dedup 就行”。生产环境需要同时考虑：

- 是否会误删真正有价值的信息
- 是否增加检索延迟
- 与 MMR 是否功能重叠
- 是否应该在 Indexing 阶段解决，而不是 Query 阶段解决

---

## 2. Semantic Dedup 是什么

Semantic Dedup（语义去重）用于识别语义高度相似的 Chunk，并删除 Near-Duplicate 内容。

最简单的实现方式是计算 Chunk 之间的 Embedding Cosine Similarity。

```python
selected = []

for chunk in candidates:
    redundant = False

    for item in selected:
        similarity = cosine_similarity(
            chunk.embedding,
            item.embedding
        )

        if similarity > threshold:
            redundant = True
            break

    if not redundant:
        selected.append(chunk)
```

例如：

```text
A ↔ B = 0.96 → 认为高度重复
A ↔ C = 0.72 → 保留
```

Semantic Dedup 是真实存在的工程手段，但：

> “Chunk 相似度超过 0.9 就删除”不是 RAG 的统一生产标准，只是一种 Near-Duplicate Heuristic。

阈值不能拍脑袋确定，需要根据具体 Embedding 模型、Chunk 粒度、数据分布和 Eval Dataset 调整。

---

## 3. Semantic Dedup 最大的问题：误删

例如：

```text
Query：退款需要多久？

Chunk A：普通订单退款将在 3 天内到账。
Chunk B：跨境订单退款将在 7 天内到账。
```

A 和 B 的文本结构非常接近，Embedding Similarity 可能达到：

```text
cosine(A, B) = 0.94
```

但两者包含不同的业务条件：

```text
普通订单 → 3 天
跨境订单 → 7 天
```

如果使用：

```text
similarity > 0.92 → 删除
```

就可能把真正有价值的信息删除。

因此：

> Chunk ↔ Chunk 的 Embedding Similarity 只能说明语义接近，不能证明两个 Chunk 携带完全相同的事实。

### 降低误删的方法

可以结合：

```text
Semantic Similarity
        +
Metadata Consistency
        +
Entity Consistency
        +
Version Consistency
        +
关键业务条件检测
```

但随着规则增加，Semantic Dedup 会越来越复杂。

这也是为什么普通 RAG 场景下，不应该默认增加 Semantic Dedup。

---

## 4. MMR 是什么

MMR（Maximal Marginal Relevance）解决的是：

> 如何在“与 Query 相关”和“与已经选择的 Chunk 不重复”之间取得平衡。

经典思想：

```text
MMR(d) =
λ × Sim(Query, d)
-
(1 - λ) × max Sim(d, Selected)
```

其中：

- `Sim(Query, d)`：候选 Chunk 与 Query 的相关性
- `Sim(d, Selected)`：候选 Chunk 与已经选择 Chunk 的相似度
- `λ`：相关性与多样性的权衡参数

例如：

```text
Query：退款规则

A：普通订单退款时间       relevance = 0.95
B：普通订单退款到账时间   relevance = 0.93
C：跨境订单退款时间       relevance = 0.91
D：退款审核规则           relevance = 0.88
```

选择 A 后：

```text
B 与 A 非常相似 → MMR Score 被降低
C 与 A 有差异   → 更容易进入最终结果
D 提供新的信息 → 更容易进入最终结果
```

---

## 5. Semantic Dedup 与 MMR 的核心区别

最重要的区别是：

> Semantic Dedup 更接近 Hard Filtering；MMR 更接近 Soft Penalty / Diversified Selection。

Semantic Dedup：

```text
A 与 B similarity > threshold

→ B 删除
```

MMR：

```text
B 与 A 非常相似

→ B 的选择优先级降低
→ 但并不是直接认为 B 没有价值
```

因此 MMR 在 Retrieval 阶段通常更加安全。

| 能力 | Semantic Dedup | MMR |
|---|---|---|
| 去除完全/近似重复 | 强 | 间接实现 |
| 保证结果多样性 | 一般 | 强 |
| 是否 Hard Delete | 是 | 否 |
| 误删风险 | 较高 | 较低 |
| 参数 | Similarity Threshold | λ / Fetch K / Top K |
| 普通 RAG 是否必需 | 否 | 更值得优先考虑 |

---

## 6. 已经有 MMR，还需要 Semantic Dedup 吗？

答案是：

> 不一定。默认情况下可以先不上 Semantic Dedup。

对于普通生产 RAG，可以优先：

```text
Retrieval
    ↓
MMR
    ↓
Reranker
    ↓
Top-K
```

如果 MMR 已经能够有效降低重复率，再增加 Semantic Dedup 只会增加：

- 系统复杂度
- 参数数量
- 检索延迟
- 误删风险
- Debug 难度

因此 Semantic Dedup 应该是一个由 Eval 驱动引入的优化，而不是默认组件。

---

## 7. 什么情况下值得增加 Semantic Dedup

### 7.1 Chunk Overlap 导致大量重复

例如 Chunking：

```text
Chunk 1：AAAA BBBB CCCC DDDD
Chunk 2：          CCCC DDDD EEEE FFFF
Chunk 3：                    EEEE FFFF GGGG
```

召回后可能大量出现：

```text
A
A'
A''
B
B'
B''
C
```

这种场景 Semantic Dedup 有价值。

### 7.2 多数据源存在大量复制内容

例如：

```text
PRD：
退款申请需要经过商家审核。

FAQ：
退款申请需要经过商家审核。

帮助中心：
用户退款申请需要经过商家审核。
```

如果大量知识源存在这种复制，Near-Duplicate Removal 可以减少候选池污染。

### 7.3 Reranker 成本较高

例如：

```text
Retrieval Top100
       ↓
Semantic Dedup
       ↓
40 candidates
       ↓
Cross Encoder Reranker
```

虽然 Semantic Dedup 本身增加计算，但把 Reranker 输入从 100 降到 40 后，整体延迟和成本反而可能降低。

是否真的降低延迟，需要通过 Profiling 验证。

---

## 8. 能在 Indexing 阶段去重，就不要每次 Query 都重新去重

更推荐：

```text
Document Ingestion
      ↓
Exact Duplicate Detection
      ↓
Near-Duplicate Detection
      ↓
合理 Chunking
      ↓
Version Governance
      ↓
Embedding
      ↓
Vector DB
```

而不是：

```text
重复数据全部进入 Vector DB
      ↓
每次 Query
      ↓
重新做 Semantic Dedup
```

原则：

> 能在数据治理阶段解决的重复问题，尽量不要转移到在线 Retrieval 阶段解决。

这样可以减少：

- Vector DB 存储
- Embedding 成本
- Retrieval 噪声
- Query-Time 计算量

---

## 9. 多版本知识不能依赖 Semantic Dedup

对于 Workspace / 企业知识库尤其重要。

例如：

```text
PRD 1.0：退款审核时间 3～5 天
PRD 1.1：退款审核时间 1～3 天
PRD 1.2：退款审核时间 24 小时
```

这三个 Chunk 的 Embedding Similarity 很可能非常高。

但是它们不是重复数据，而是：

> 同一个知识实体发生了版本演进。

因此不能：

```text
similarity > threshold
→ 删除旧/新 Chunk
```

应该通过 Metadata / Version Governance 解决：

```text
workspace_id
business_domain
doc_type
version
status
effective_from
```

Retrieval Pipeline：

```text
Retrieval
    ↓
Version Resolution
    ↓
选择当前有效版本
    ↓
MMR
    ↓
Reranker
```

Semantic Similarity 不应该承担版本治理职责。

---

## 10. 推荐的生产 Retrieval Pipeline

对于普通企业级 RAG，可以先从：

```text
                 Query
                   │
             Query Rewrite
                   │
          ┌────────┴────────┐
          ↓                 ↓
     Vector Search         BM25
          │                 │
          └────────┬────────┘
                   ↓
              RRF / Fusion
                   ↓
              Top 30~50
                   ↓
         Metadata Filtering
                   ↓
          Version Resolution
                   ↓
                  MMR
                   ↓
             Top 10~20
                   ↓
               Reranker
                   ↓
              Top 5~8
                   ↓
            Context Builder
                   ↓
                  LLM
```

第一版：

> 不默认增加 Semantic Dedup。

---

## 11. 什么时候升级为 Semantic Dedup + MMR

通过 Retrieval Eval 发现：

```text
Top30：

退款入口
退款入口
退款入口
退款入口
退款入口
退款审核
退款到账
...
```

并且：

- Duplicate Ratio 很高
- MMR 后仍存在明显重复
- 重复 Chunk 大量消耗 Reranker 计算
- Context 中重复 Evidence 依然严重

再升级：

```text
Hybrid Retrieval
       ↓
Top 50~100
       ↓
Version / Metadata Resolution
       ↓
Exact Dedup
       ↓
Near-Duplicate / Semantic Dedup
       ↓
MMR
       ↓
Reranker
       ↓
Top-K
```

Semantic Dedup 此时承担的是：

> Candidate Pool Cleaner

而不是主要的 Retrieval Ranking 算法。

---

## 12. 如何通过 Eval 决定是否需要 Semantic Dedup

建议监控：

```text
Recall@K
MRR
NDCG
Context Precision
Context Recall
Duplicate Ratio
Retrieval Latency
Rerank Latency
End-to-End Latency
```

重点关注：

### Duplicate Ratio

最终 Context 中重复 Evidence 的比例。

### Recall@K

Semantic Dedup 是否把真正正确的答案删除。

### Context Precision

进入 LLM 的 Context 中，有多少是真正有价值的信息。

### Latency

比较：

```text
方案 A：
Retrieval → MMR → Reranker

方案 B：
Retrieval → Semantic Dedup → MMR → Reranker
```

只有当方案 B 在：

```text
质量 ↑
或者
成本 ↓
或者
延迟 ↓
```

至少一个维度产生明显收益，同时没有严重影响 Recall，才值得增加这一层。

---

## 13. 最终工程原则

不要设计成：

```text
“Semantic Dedup 是生产级技术”
        ↓
“所以生产 RAG 必须加”
```

正确思路是：

```text
发现 Retrieval 问题
        ↓
确定问题类型
        ↓
选择最简单的解决方案
        ↓
Eval
        ↓
确认收益
        ↓
再决定是否进入生产 Pipeline
```

对于相似但冗余的召回结果：

```text
优先级建议：

1. 数据源去重 / 数据治理
2. 合理 Chunking
3. Metadata / Version Resolution
4. MMR
5. Reranker
6. 如果仍存在严重 Near-Duplicate，再增加 Semantic Dedup
```

核心原则：

> 不要因为某个技术“生产可用”，就把它加入生产架构；应该让 Eval 数据决定系统是否真的需要它。

---

## 14. 面试回答模板

如果面试官问：

> RAG 如何减少相似但冗余的召回片段？

可以回答：

> 我不会直接把 Vector Search 的 Top-K 全部交给 LLM。首先会通过合理 Chunking 和 Ingestion-Time Dedup 尽量从数据源减少重复；Retrieval 阶段会 Over-Fetch，然后通过 Metadata 和 Version Resolution 处理版本冲突，再通过 MMR 在 Query Relevance 和 Evidence Diversity 之间做平衡，之后使用 Reranker 得到最终 Top-K。
>
> Semantic Dedup 也可以通过 Chunk Embedding Similarity 删除 Near-Duplicate，但它属于 Hard Filtering，存在误删“语义相似但事实条件不同”的 Chunk 的风险，同时会增加在线计算。所以如果 MMR 已经能够解决重复问题，我不会默认增加 Semantic Dedup。只有 Retrieval Eval 发现 Duplicate Ratio 仍然很高，或者大量重复 Chunk 正在浪费 Reranker 计算时，才会增加这一层，并通过 Recall@K、Context Precision 和 Latency 验证收益。

一句话总结：

> **MMR 是默认更安全的 Diversity Selection；Semantic Dedup 是针对严重 Near-Duplicate 问题的可选 Candidate Pool Cleaner，而不是生产 RAG 的必选组件。**

