# 双塔检索、向量归一化、Norm 与 LayerNorm

## 核心结论：为什么双塔检索通常要做向量归一化？

这是理解整篇内容最关键的一句话：

> **因为 Dot Product 同时受到「方向」和「向量长度（Norm）」影响。**

两个向量 \(q\) 和 \(d\) 的点积可以写成：

\[
q \cdot d = ||q|| \, ||d|| \cos\theta
\]

因此 Dot Product 的大小实际上由两部分共同决定：

1. **方向是否接近**：由 \(\cos\theta\) 决定。两个向量夹角越小，通常表示语义越相似。
2. **向量本身有多长**：由 \(||q||\) 和 \(||d||\) 决定。即使方向没有那么接近，只要某个向量的 Norm 很大，也可能把 Dot Product 放大。

例如：

\[
q=[3,4],\quad d_1=[6,8],\quad d_2=[100,0]
\]

\(d_1\) 与 \(q\) 方向完全一致：

\[
q \cdot d_1 = 3\times6+4\times8=50
\]

而 \(d_2\) 与 \(q\) 的方向明显不同：

\[
q \cdot d_2 = 3\times100+4\times0=300
\]

如果只看未经归一化的 Dot Product，\(d_2\) 反而排在 \(d_1\) 前面。原因并不是它的语义方向更接近，而是：

> **\(d_2\) 的向量长度太大，把 Dot Product 放大了。**

因此，在希望“向量方向代表语义相似度”的 Embedding 模型中，通常先进行 L2 Normalize：

\[
\hat q=\frac{q}{||q||}, \qquad
\hat d=\frac{d}{||d||}
\]

归一化后：

\[
||\hat q||=||\hat d||=1
\]

于是：

\[
\hat q\cdot\hat d
=
1\times1\times\cos\theta
=
\cos\theta
\]

所以整篇内容最核心的因果链是：

```text
Dot Product
    ↓
同时受到方向 + 向量长度影响
    ↓
向量长度可能干扰语义相似度排序
    ↓
L2 Normalize
    ↓
所有向量 Norm = 1
    ↓
消除向量长度的影响
    ↓
Dot Product = Cosine Similarity
    ↓
主要比较向量方向
```

> **L2 Normalize 的本质，就是消除向量长度（Norm）对 Dot Product 的影响，让相似度主要由两个向量的方向决定。**

需要特别注意：

> 这里的“长度”是 **Embedding 向量的模长（Norm）**，不是 Query 文本有多少个字或多少个 Token。

## 1. 什么是双塔检索（Two-Tower / Dual Encoder）

双塔检索的核心是：**Query 和 Document 分别编码成向量，再计算向量之间的相似度。**

```text
Query ──→ Query Encoder ──→ q
                              \
                               similarity
                              /
Doc   ──→ Doc Encoder   ──→ d
```

数学表示：

\[
q=f_{query}(query)
\]

\[
d=f_{doc}(document)
\]

然后计算：

\[
score(q,d)
\]

常见相似度包括：

- Cosine Similarity
- Dot Product（内积）
- L2 Distance（欧氏距离）

### 双塔为什么适合大规模检索？

因为 Document 和 Query 是独立编码的，所以 Document Embedding 可以提前离线计算并存入 Vector DB。

在线查询时只需要：

```text
用户 Query
   ↓
Query Encoder
   ↓
Query Vector
   ↓
ANN 向量检索
   ↓
TopK Documents
```

因此双塔非常适合作为 RAG 的第一阶段召回。

---

## 2. 双塔检索和混合检索中的向量检索是什么关系？

在 RAG 场景里，可以把双塔理解为 **Dense Retrieval（稠密向量检索）常用的一种实现架构**。

但严格来说：

> 双塔是一种模型/编码架构；向量相似度检索是一种检索方式。

典型 Hybrid Search：

```text
                     Query
                       │
             ┌─────────┴─────────┐
             ↓                   ↓
        Sparse Search       Dense Search
          BM25 等             向量检索
             │                   │
             │              双塔 Embedding
             │                   │
             ↓                   ↓
           TopK                TopK
             └─────────┬─────────┘
                       ↓
                 Fusion / RRF
                       ↓
                    Rerank
                       ↓
                    TopN
```

生产级 RAG 常见链路可以记成：

```text
BM25 + 双塔 Dense Retrieval
          ↓
      RRF / Fusion
          ↓
       Reranker
          ↓
        Top N
          ↓
         LLM
```

### 向量归一化和混合检索的分数归一化，不是同一步

本页讨论的 **L2 Normalize** 作用于 Query / Document 的 Embedding：把向量模长变为 1，使单位向量的点积等于余弦相似度。它发生在 Dense 检索计算相似度时，是否使用要遵循 Embedding 模型与向量索引的度量约定。

混合检索中的**分数归一化**作用于各路召回产生的分数，例如 BM25 分数与 Dense 相似度分数。两路分数的量纲、范围和分布可能不同；即使 Dense Embedding 已做 L2 Normalize，也不能因此认为 BM25 分数与 Dense 分数可以直接相加。

| 融合方法 | 使用什么信息 | 融合前是否需要分数归一化 |
| --- | --- | --- |
| RRF | 各路结果的名次：\(\sum_i 1/(k+rank_i(d))\) | 不需要；它不使用原始检索分数 |
| 加权 RRF | 各路名次和权重：\(\sum_i w_i/(k+rank_i(d))\) | 不需要；权重乘的是排名贡献，不是原始分数 |
| 分数加权融合 | 各路分数和权重：\(\sum_i w_i\,\tilde{s}_i(d)\) | 通常需要先把各路分数转换到可比较的尺度，再加权求和 |

例如 BM25 得分为 12、Dense 余弦相似度为 0.8，直接各乘 0.5 后相加，BM25 一项贡献 6，Dense 一项贡献 0.4；相同权重并不意味着两路影响相当。分数加权融合可先在各路候选结果上做 Min-Max 等归一化，或用经过验证的分数校准方法。注意统一分数方向（分数越高越相关），并处理候选集外文档及分数全相同的情况。

> **记忆点：L2 Normalize 管 Embedding 的模长；RRF / 加权 RRF 管排名，无须融合前的分数归一化；分数加权融合管跨路分数，通常要先做分数归一化或校准。**

### 几个概念不要混淆

```text
双塔模型
↓
负责把 Query / Document 编码成向量

Embedding
↓
得到 q、d 等高维向量

Similarity Metric
↓
定义两个向量如何计算相似度
例如 Cosine / Dot Product / L2

ANN
↓
负责从海量向量中快速寻找 TopK

Vector DB
↓
负责向量存储、索引和检索
```

---

## 3. 为什么双塔检索经常需要做向量归一化？

首先要区分一个容易混淆的概念：

> 这里说的“长度”不是 Query 文本有多少个 Token，而是 **Embedding 向量的模长（Norm）**。

例如：

\[
q=[3,4]
\]

它的长度是：

\[
||q||_2=\sqrt{3^2+4^2}=5
\]

如果使用 Dot Product：

\[
q \cdot d
\]

它实际上可以写成：

\[
q\cdot d=||q||\,||d||\cos\theta
\]

因此 Dot Product 同时受到两个因素影响：

```text
Dot Product
    │
    ├── 向量方向：cosθ
    │
    └── 向量模长：||q|| × ||d||
```

> 因为 **Dot Product 同时受到「方向」和「向量长度」影响。**

在很多语义检索模型中，我们更关心两个 Embedding 的**方向是否接近**，而不希望不同向量的模长干扰排序。

---

## 4. 什么是 L2 Normalize？

L2 Normalize 的计算方式：

\[
\hat{x}=\frac{x}{||x||_2}
\]

例如：

\[
x=[3,4]
\]

它的 L2 Norm：

\[
||x||_2=5
\]

归一化后：

\[
\hat{x}=[0.6,0.8]
\]

此时：

\[
||\hat{x}||_2=1
\]

关键特点：

> **L2 Normalize 改变向量长度，但不改变向量方向。**

可以理解成：

```text
原始向量：

        ● [3,4]
       /
      /
     /
O

长度 = 5

Normalize 后：

  ● [0.6,0.8]
 /
O

长度 = 1
方向不变
```

因此所有 Embedding 都被投影到单位球面上。

---

## 5. 为什么 Normalize 后 Dot Product 等价于 Cosine Similarity？

Cosine Similarity：

\[
cos(q,d)=\frac{q\cdot d}{||q||||d||}
\]

如果 q 和 d 都经过 L2 Normalize：

\[
||q||=1,\quad ||d||=1
\]

那么：

\[
cos(q,d)=q\cdot d
\]

所以：

> **当两个向量都经过 L2 Normalize 后，Dot Product = Cosine Similarity。**

代码中经常看到：

```python
q = F.normalize(query_embedding, p=2, dim=-1)
d = F.normalize(doc_embedding, p=2, dim=-1)

score = q @ d.T
```

虽然最后执行的是矩阵乘法 / Dot Product，但由于向量已经归一化，它实际上等价于计算 Cosine Similarity。

---

## 6. Norm 到底是什么？

对于我们讨论的 L2 Norm，可以直接理解成：

> **向量从原点到终点的长度（magnitude）。**

二维向量：

\[
x=[3,4]
\]

就是勾股定理：

\[
||x||_2=\sqrt{3^2+4^2}=5
\]

```text
y
↑
│
│        ● (3,4)
│       /
│      /  ← 这条线就是向量
│     /      长度 = Norm = 5
│    /
│   /
0────────────────→ x
```

所以可以认为：

```text
Vector
  │
  ├── Direction：方向
  │
  └── Magnitude / Norm：长度
```

到了高维空间概念完全相同。

例如一个 768 维 Embedding：

\[
x=[x_1,x_2,...,x_{768}]
\]

它的 L2 Norm：

\[
||x||_2=\sqrt{x_1^2+x_2^2+...+x_{768}^2}
\]

只是我们无法像二维、三维那样直接画出来。

---

## 7. Norm 和 LayerNorm 是一回事吗？

不是。

虽然名字里都有 `Norm`，但它们解决的问题不同。

### L2 Normalize

核心：

\[
\hat{x}=\frac{x}{||x||_2}
\]

目的：

> 把向量模长变成 1，同时保持方向不变。

典型应用：

- Embedding
- 双塔检索
- Cosine Similarity
- 向量数据库检索

---

### LayerNorm

LayerNorm 主要用于 Transformer 等神经网络内部。

它不是简单地计算：

\[
x/||x||
\]

而是先计算一组 hidden features 的均值和方差。

均值：

\[
\mu=\frac{1}{d}\sum_i x_i
\]

方差：

\[
\sigma^2=\frac{1}{d}\sum_i(x_i-\mu)^2
\]

标准化：

\[
\hat{x_i}=\frac{x_i-\mu}{\sqrt{\sigma^2+\epsilon}}
\]

实际 LayerNorm 通常还有两个可学习参数：

\[
y_i=\gamma_i\hat{x_i}+\beta_i
\]

其中：

- `γ`：learnable scale
- `β`：learnable bias

LayerNorm 的核心目的不是让向量长度变成 1，而是**稳定神经网络内部特征的尺度与分布，从而帮助训练**。

---

## 8. L2 Normalize 和 LayerNorm 对比

| 对比项 | L2 Normalize | LayerNorm |
|---|---|---|
| 主要目的 | 统一向量模长 | 稳定神经网络内部特征分布 |
| 核心计算 | L2 Norm | Mean + Variance |
| 公式核心 | `x / ‖x‖` | `(x - μ) / sqrt(σ² + ε)` |
| 结果 | 向量长度 = 1 | affine 前均值约 0、方差约 1 |
| 是否保持原方向 | 是 | 通常不是 |
| 可学习参数 | 通常没有 | 通常有 γ、β |
| 常见位置 | Embedding / Retrieval | Transformer 内部 |

可以直接这样区分：

```text
双塔向量检索
    ↓
Embedding
    ↓
L2 Normalize
    ↓
||x|| = 1
    ↓
Dot Product = Cosine Similarity


Transformer 内部
    ↓
Attention / FFN
    ↓
LayerNorm / RMSNorm
    ↓
稳定内部特征尺度
```

---

## 9. Normalize 不是双塔检索的强制要求

不要记成：

```text
双塔 → 必须 Normalize
```

更准确的是：

> **是否做 L2 Normalize，要和 Embedding 模型训练时定义的 Similarity Metric 保持一致。**

如果模型训练目标就是让向量模长携带一部分有效信息，而线上强制 Normalize，就可能损失模型原本学习到的信息。

工程上应该考虑：

```text
Embedding Model
      ↓
训练时使用什么 similarity？
      ↓
Cosine → 通常需要 Normalize
Dot Product → 根据模型定义决定
      ↓
Vector DB Metric 与模型保持一致
```

---

## 10. 一条完整的知识链路

把这次讨论串起来：

```text
                RAG Hybrid Retrieval
                         │
              ┌──────────┴──────────┐
              ↓                     ↓
            BM25             Dense Retrieval
                                     │
                                  双塔模型
                                     │
                        ┌────────────┴────────────┐
                        ↓                         ↓
                  Query Encoder             Doc Encoder
                        ↓                         ↓
                        q                         d
                        │                         │
                        └────────────┬────────────┘
                                     ↓
                               L2 Normalize
                                     ↓
                             ||q|| = ||d|| = 1
                                     ↓
                      Dot Product = Cosine
                                     ↓
                              ANN TopK Retrieval
                                     ↓
                       与 BM25 结果 Fusion / RRF
                                     ↓
                                  Reranker
                                     ↓
                                   TopN
                                     ↓
                                    LLM
```

---

## 11. 面试回答版本

### 什么是双塔检索？

双塔检索分别使用 Query Encoder 和 Document Encoder 将 Query 和 Document 编码成向量，然后通过 Cosine Similarity、Dot Product 等方式计算相似度。因为 Document Embedding 可以提前离线计算并建立 ANN 索引，所以非常适合大规模检索，通常用于 RAG 的第一阶段召回。

### 为什么双塔经常做向量归一化？

未经归一化的 Dot Product 可以表示为：

\[
q\cdot d=||q||||d||cos\theta
\]

因此它同时受到向量模长和方向影响。很多语义检索任务更关心向量方向，所以会使用 L2 Normalize 将 Embedding 的模长统一为 1。归一化以后 Dot Product 就等价于 Cosine Similarity，从而消除模长对相似度排序的影响。

这里的“长度”不是 Query 的 Token 数，而是 Embedding 向量的 Norm。

### Norm 是什么？

L2 Norm 可以理解成向量的长度，本质上就是勾股定理在高维空间中的推广。例如 `[3,4]` 的 L2 Norm 是 5。

### Norm 和 LayerNorm 有什么区别？

L2 Norm / L2 Normalize 主要描述和调整向量长度；LayerNorm 则通过均值和方差对神经网络内部特征进行标准化，主要用于稳定模型训练。两者虽然名字都有 Norm，但不是同一个操作。
