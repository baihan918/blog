# RAG 检索置信度：Evidence Sufficiency Judge 落地方案

## 1. 核心定位

在生产级 RAG 中，检索完成并不意味着"可以回答"。

Reranker 主要解决的是：

> **哪些检索结果与 Query 更相关？**

而 Evidence Sufficiency Judge 要解决的是：

> **当前检索出来的这些证据，是否足以支撑回答当前用户的问题？**

因此 Judge 不应该简单地让 LLM 输出一个"0～100
的置信度分数"，而应该承担一个明确、窄化的验证任务。

典型链路：

``` text
Query
  ↓
Retrieve
  ↓
Rerank
  ↓
Top-K Evidence
  ↓
Evidence Sufficiency Judge
  ├─ sufficient = true  → Generate
  └─ sufficient = false → 根据 missing_information 补充检索
```

------------------------------------------------------------------------

## 2. 为什么 Judge 可以使用小模型

Evidence Sufficiency Judge 是一个典型的：

-   高频任务
-   窄任务
-   输入输出边界明确
-   结构化输出任务

它通常不需要主 Generator 那么强的开放式生成能力。

Judge 的输入主要是：

``` text
Question + Top-K Evidence
```

输出则可以严格限制为：

``` json
{
  "sufficient": true,
  "missing_information": [],
  "conflicts": []
}
```

因此第一版完全可以从本地 7B / 8B Instruct 模型开始，而不是直接使用几十 B
参数的大模型。

------------------------------------------------------------------------

## 3. Judge Prompt 示例

``` text
Question:
{query}

Evidence:
{top_k}

任务：
仅根据 Evidence 判断当前证据是否有足够信息回答 Question。

要求：
1. 禁止使用模型自身知识补充答案。
2. 如果证据不能直接支撑答案，必须判定为 insufficient。
3. 如果信息不足，请指出缺少什么信息。
4. 如果证据之间存在冲突，请明确指出。

输出 JSON：

{
  "sufficient": true/false,
  "missing_information": [],
  "conflicts": []
}
```

Judge 最重要的并不只是返回：

``` text
sufficient = false
```

而是进一步返回：

``` text
missing_information
```

因为它可以直接驱动下一轮 Query Rewrite 和 Retrieval。

------------------------------------------------------------------------

## 4. 推荐的 V1 → V4 演进路线

``` text
V1
规则
+
本地 7B/8B LLM Judge
+
结构化输出

        ↓

V2
建立 Judge Eval Dataset
测试 3B / 7B / 14B
找到质量-延迟最佳点

        ↓

V3
线上 badcase 回流
优化 Prompt / Few-shot

        ↓

V4
如果特定业务 Judge 仍然不准
才考虑 LoRA/SFT 一个专用 Verifier
```

### V1：先把系统跑起来

第一阶段：

-   规则负责确定性判断
-   本地 7B / 8B Instruct 模型负责 Evidence Sufficiency
-   Judge 强制结构化输出
-   Judge 与 Generator 解耦

例如：

``` text
                RAG
                 │
          Retrieve + Rerank
                 ↓
               Top-K
                 │
                 ↓
        Local Judge Model
          7B / 8B Instruct
                 │
       ┌─────────┴─────────┐
       ↓                   ↓
 sufficient=true     sufficient=false
       ↓                   ↓
   Generate           missing_info
                           ↓
                    Retrieve Again
```

这一阶段的目标不是追求最强模型，而是先验证整个 Judge
机制是否真正能降低"证据不足却强行回答"的问题。

------------------------------------------------------------------------

### V2：建立 Judge Eval Dataset

不要凭感觉判断：

> "7B 应该够了。"

而应该通过 Eval 证明：

> "7B 在这个业务场景下确实够了。"

可以人工构造或标注一批数据：

``` text
Query
+
Retrieved Top-K
+
Ground Truth:
  sufficient / insufficient
```

然后分别测试：

``` text
3B
7B / 8B
14B
更强模型/API（作为能力上限参考）
```

关注：

-   Accuracy
-   Precision / Recall
-   F1
-   False Positive Rate
-   Latency
-   Token Cost

其中尤其要关注 **False Positive**：

``` text
实际上证据不足
       ↓
Judge 却判断 sufficient
       ↓
进入 Generate
       ↓
Generator 被迫基于残缺证据回答
       ↓
Hallucination 风险增加
```

因此 Evidence Sufficiency Judge 通常应该适当偏保守。

最终目标是：

> **找到 Judge 质量、Latency 和 Cost
> 的最佳平衡点，而不是选择参数量最大的模型。**

------------------------------------------------------------------------

### V3：线上 Badcase 回流

上线以后，把 Judge 判断错误的 Case 收集起来：

``` text
Online Traffic
      ↓
Judge
      ↓
Badcase
      ↓
Evaluation Dataset
      ↓
Prompt / Few-shot 优化
```

例如发现模型经常把：

``` text
“跨门店订单可以查询”
```

错误理解成：

``` text
“支持跨门店退款”
```

就可以把这种 Case 加入 Few-shot，让 Judge 学会：

> 语义相关不代表证据足以支撑结论。

因此这一阶段优先做：

``` text
Badcase Analysis
        ↓
Prompt 优化
        ↓
Few-shot
        ↓
重新 Eval
```

而不是立即进行模型微调。

------------------------------------------------------------------------

### V4：确实解决不了，再考虑微调

只有当你已经做过：

``` text
Prompt Engineering
        ↓
Few-shot
        ↓
规则约束
        ↓
Eval
        ↓
Badcase 回流
```

仍然发现：

> 通用 Instruct Model 在特定业务的 Evidence Sufficiency
> 判断上长期存在稳定错误模式。

这时候才值得考虑：

``` text
Business Eval Dataset
        ↓
LoRA / SFT
        ↓
Domain-specific Verifier
```

也就是说：

> **不要一开始就微调。**

对于这个任务，先部署一个小 Instruct 模型，把 Evidence Sufficiency Judge
跑起来，再用 Eval 决定是否需要换大模型或者微调。

------------------------------------------------------------------------

## 5. 为什么不直接让主 LLM 同时做 Judge？

面试中这是一个很好的追问。

可以回答：

> Judge 是一个高频、窄任务、结构化输出节点，小模型通常就可以完成。将
> Judge 与 Generator 解耦，可以降低 Latency 和 Token
> Cost，同时能够独立进行 Eval、扩缩容和模型替换。具体使用 3B、7B、14B
> 还是更大的模型，不应该根据参数量拍脑袋决定，而应该通过 Judge Eval
> Dataset 选择质量和延迟的最佳平衡点。

架构上：

``` text
                    RAG Pipeline
                         │
                 Retrieve + Rerank
                         ↓
                       Top-K
                         ↓
               Small Judge Model
                    7B / 8B
                         │
              ┌──────────┴──────────┐
              ↓                     ↓
          sufficient            insufficient
              ↓                     ↓
      Generator Model       Retrieve Again
```

Judge 和 Generator 的职责不同：

``` text
Judge
→ 判断“现有证据够不够”

Generator
→ 基于已经验证过的证据生成最终答案
```

------------------------------------------------------------------------

## 6. 最终设计原则

可以把整套方案记成一句话：

> **先用小模型把 Judge 跑起来，用 Eval 决定模型尺寸，用 Badcase 驱动
> Prompt/Few-shot
> 优化，只有当这些手段仍无法解决稳定的业务错误模式时，才考虑 LoRA/SFT
> 专用 Verifier。**

演进顺序：

``` text
规则 + Small LLM Judge
          ↓
       Eval
          ↓
 Prompt / Few-shot
          ↓
   Badcase Feedback
          ↓
必要时再 Fine-tuning
```

核心思想不是：

> "我要不要微调一个 Judge？"

而是：

> **"最小成本的模型能不能满足我的 Judge Eval 指标？"**

只有 Eval 告诉你"小模型 + Prompt + Few-shot"不够，微调才真正有工程价值。


---

## 7. Eval Case 到底是什么？

可以把一条 **Eval Case** 理解成：

> **一道给 RAG Judge 做的考试题，而且评估系统提前保存了标准答案。**

例如：

```json
{
  "question": "公司是否支持跨门店退款？",
  "evidence": [
    "退款支持原路退款和余额退款。",
    "跨门店订单支持查询。"
  ],
  "expected": {
    "sufficient": false,
    "missing_information": "缺少跨门店退款规则"
  }
}
```

这条数据里包含两部分：

```text
输入 Input
├─ question
└─ evidence

标准答案 Expected
├─ sufficient
└─ missing_information
```

### 7.1 真正提供给 RAG Judge 的是什么？

Judge **只能看到问题和检索资料**：

```text
Question
+
Retrieved Evidence
```

例如：

```text
Question：
公司是否支持跨门店退款？

Evidence：
1. 退款支持原路退款和余额退款。
2. 跨门店订单支持查询。
```

然后 Judge 自己进行判断：

```json
{
  "sufficient": false,
  "missing_information": "缺少跨门店退款规则"
}
```

这里非常重要：

> **Expected / 参考答案不能提供给 Judge。**

否则就相当于考试的时候把标准答案同时给了模型，Eval 就失去了意义。

---

### 7.2 Expected 是给谁看的？

`expected` 是给 **Evaluator（评估系统）** 使用的。

完整流程：

```text
                 Eval Case
                     │
          ┌──────────┴──────────┐
          ↓                     ↓
        Input                Expected
          │                     │
 Question + Evidence             │
          ↓                     │
      RAG Judge                  │
          ↓                     │
        Actual                   │
          │                     │
          └──────────┬──────────┘
                     ↓
                 Evaluator
                     ↓
             Actual vs Expected
                     ↓
                 Pass / Fail
```

例如人工标准答案：

```text
Expected：

sufficient = false
```

但 7B Judge 输出：

```text
Actual：

sufficient = true
```

Evaluator 比较：

```text
Expected = false
Actual   = true

→ ❌ FAIL
```

这就是一条 Judge Badcase。

如果 14B Judge 对同一道题输出：

```text
Actual：

sufficient = false
```

则：

```text
Expected = false
Actual   = false

→ ✅ PASS
```

---

### 7.3 为什么 question + evidence 是“题目”？

因为我们真正想测试的不是模型是否知道业务知识，而是：

> **模型能不能仅根据当前 RAG 检索结果，正确判断这些 Evidence 是否足以回答 Question。**

例如：

```text
Question：
公司是否支持跨门店退款？

Evidence：
退款支持原路退款。
跨门店订单支持查询。
```

正确判断应该是：

```text
insufficient
```

因为：

```text
退款支持原路退款
+
跨门店订单支持查询

≠

支持跨门店退款
```

缺失的信息是：

```text
跨门店退款规则
```

所以人工提前标注：

```json
{
  "sufficient": false,
  "missing_information": "缺少跨门店退款规则"
}
```

---

### 7.4 Eval Dataset 就是一套 Judge 题库

一条 Eval Case 是一道题。

大量 Eval Case 组成：

```text
Judge Eval Dataset
```

例如：

```text
Case 001
Question + Evidence
Expected = insufficient

Case 002
Question + Evidence
Expected = sufficient

Case 003
Question + Evidence
Expected = insufficient

...

Case 500
```

然后让不同模型做完全相同的一套题：

```text
                  500 条 Eval Cases
                         │
             ┌───────────┼───────────┐
             ↓           ↓           ↓
           3B Judge    7B Judge    14B Judge
             ↓           ↓           ↓
            做题         做题         做题
             │           │           │
             └───────────┼───────────┘
                         ↓
                     Evaluator
                         ↓
              Accuracy / FPR / F1
              Latency / Cost
```

这才可以客观判断：

```text
7B 是否已经够用？
14B 是否明显更好？
Prompt 优化有没有效果？
是否真的需要微调？
```

---

### 7.5 sufficient 和 missing_information 的评估方式不同

`sufficient` 是明确的布尔值：

```text
Expected = false
Actual   = false

→ 可以直接程序比较
```

但 `missing_information` 属于自然语言，不能简单进行字符串相等比较。

例如标准答案：

```text
缺少跨门店退款规则
```

Judge 输出：

```text
现有证据没有说明消费者能否在非原订单门店办理退款
```

两句话文字不同，但语义实际上相同。

因此可以采用：

```text
sufficient
→ 程序直接比较 true / false

missing_information
→ 语义评估 / LLM-as-a-Judge / 人工抽查
```

第一版甚至可以把：

```text
sufficient
```

作为最核心的 Judge Eval 指标，先把问题做简单。

---

## 8. 一句话理解整个 Eval 体系

可以用考试来类比：

```text
RAG Judge
= 考生

Eval Dataset
= 题库

Question + Evidence
= 考试题目

Expected
= 标准答案

Judge Actual Output
= 考生答案

Evaluator
= 阅卷老师

Badcase
= 做错的题
```

所以整个流程就是：

```text
准备题库
   ↓
不同 Judge 做同一套题
   ↓
Evaluator 对答案
   ↓
统计指标
   ↓
Badcase Analysis
   ↓
决定：
Prompt 优化？
换大模型？
还是微调？
```

**核心原则：**

> RAG Judge 只接收 `Question + Retrieved Evidence`；参考答案 `Expected` 只属于 Eval 系统，用于在模型输出后与 `Actual` 进行比对，绝不能作为 Judge 的输入。
