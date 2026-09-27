# Self-Attention 与 Multi-Head Attention：计算流程、设计动机与面试重点

## 1. Self-Attention 要解决什么问题？

Self-Attention 的核心目标是：

> 让序列中的每个 Token，根据当前上下文，动态决定应该关注其他哪些 Token。

例如：

`小明把苹果给了小红，因为她很饿。`

理解"她"时，模型需要结合上下文判断它与"小红"的关系更强。

因此 Self-Attention 本质上是在做两件事：

1.  计算当前 Token 与其他 Token 的相关程度。
2.  根据相关程度，对其他 Token 携带的信息进行加权聚合。

------------------------------------------------------------------------

## 2. Self-Attention 的完整计算流程

假设输入为：

$$
X \in R^{n \times d_{model}}
$$

首先通过三个可学习的线性投影得到 Q、K、V：

$$
Q=XW_Q
$$

$$
K=XW_K
$$

$$
V=XW_V
$$

可以这样理解：

-   **Q（Query）**：当前 Token 想寻找什么信息。
-   **K（Key）**：当前 Token 可以如何被其他 Token 匹配。
-   **V（Value）**：如果其他 Token 关注我，我真正提供什么信息。

### 2.1 计算 Scores

$$
Scores = QK^T
$$

这是一个矩阵乘法。

如果一句话有 4 个 Token，并且每个 Q/K 向量都是 3 维：

$$
Q \in R^{4\times3}
$$

$$
K \in R^{4\times3}
$$

那么：

$$
K^T \in R^{3\times4}
$$

因此：

$$
QK^T:(4\times3)(3\times4)\rightarrow4\times4
$$

最终 Scores 是一个 Token × Token 的矩阵。

其中：

> `Scores[i][j]` 表示第 i 个 Token 的 Query 与第 j 个 Token 的 Key
> 的点积匹配分数。

也就是一次矩阵运算同时计算所有 Token 两两之间的注意力匹配程度。

------------------------------------------------------------------------

## 3. 为什么维度越高，QK 点积的数值波动越大？

对于一个 Query 和 Key：

$$
q\cdot k=q_1k_1+q_2k_2+\cdots+q_{d_k}k_{d_k}
$$

维度越高，参与累加的项越多。

如果假设每个 $q_i$、$k_i$ 都近似均值为 0、方差为 1，那么：

$$
Var(q\cdot k)\approx d_k
$$

因此标准差约为：

$$
Std(q\cdot k)\approx\sqrt{d_k}
$$

所以更准确的说法不是"维度越高，Scores 按 $d_k$ 放大"，而是：

> QK 点积的**方差随 $d_k$ 增长，典型波动尺度（标准差）随 $\sqrt{d_k}$
> 增长**。

------------------------------------------------------------------------

## 4. $d_k$ 和 $\sqrt{d_k}$ 分别是什么？

$d_k$ 指的是每个 Query / Key 向量的维度。

例如：

``` text
Q = [q1, q2, q3, ..., q64]
K = [k1, k2, k3, ..., k64]
```

那么：

$$
d_k=64
$$

缩放因子：

$$
\sqrt{d_k}=\sqrt{64}=8
$$

所以 Attention 中会计算：

$$
QK^T / 8
$$

需要区分：

> **$d_k$ 是维度；$\sqrt{d_k}$
> 不是维度，而是根据这个维度计算出来的缩放因子。**

------------------------------------------------------------------------

## 5. 为什么除以 $\sqrt{d_k}$，而不是除以 $d_k$？

因为 QK 点积的典型波动大小按照 $\sqrt{d_k}$ 增长。

前面已经得到：

$$
Var(QK^T)\approx d_k
$$

所以：

$$
Std(QK^T)\approx\sqrt{d_k}
$$

除以 $\sqrt{d_k}$ 后：

$$
Var\left(\frac{QK^T}{\sqrt{d_k}}\right)
\approx
\frac{d_k}{d_k}
=1
$$

这样可以把 Scores 的数值尺度稳定在合理范围。

例如：

$$
d_k=64
$$

那么：

$$
\sqrt{d_k}=8
$$

QK 点积的典型波动尺度大约为 8：

``` text
QK ≈ 8

8 / √64
= 8 / 8
≈ 1
```

如果直接除以 $d_k$：

``` text
8 / 64
= 0.125
```

就会缩得过度，使 Scores 更接近 0，Softmax 容易变得过于平均，从而削弱
Attention 区分"应该重点关注谁"的能力。

因此：

> **除以 $\sqrt{d_k}$ 的本质，是按照 QK
> 点积实际增长的标准差尺度进行归一化。**

------------------------------------------------------------------------

## 6. Scaled Dot-Product Attention 完整公式

最终公式：

$$
Attention(Q,K,V)
=
Softmax\left(\frac{QK^T}{\sqrt{d_k}}\right)V
$$

流程可以记成：

``` text
输入 X
  ↓
线性投影
  ↓
Q / K / V
  ↓
Q × Kᵀ
  ↓
Scores：Token 两两匹配分数
  ↓
÷ √d_k
  ↓
Softmax
  ↓
Attention 权重
  ↓
× V
  ↓
输出
```

------------------------------------------------------------------------

## 7. 为什么需要 Q / K / V？

如果直接使用：

$$
XX^T
$$

也可以计算 Token 之间的相似程度。

但这样意味着：

> 判断"应该关注谁"的表示，与最终"提供什么信息"的表示完全相同。

Q/K/V 将这几个职责拆开：

``` text
Q：我需要什么
      ↓
Q × Kᵀ：我应该关注谁
      ↓
Softmax：关注多少
      ↓
权重 × V：从这些 Token 获取什么信息
```

通过不同的可学习线性投影，模型可以学习更丰富的关系。

------------------------------------------------------------------------

## 8. Self-Attention 相比 RNN 的优势

### 8.1 长距离依赖更加直接

RNN：

``` text
Token1 → Token2 → Token3 → ... → Token100
```

前面的信息需要经过很多时间步才能影响后面的 Token。

Self-Attention：

``` text
Token1 ─────────────────→ Token100
```

任意两个 Token 都可以直接建立注意力关系。

### 8.2 可以高度并行

RNN 的时间步之间存在顺序依赖。

Self-Attention 可以通过：

$$
QK^T
$$

一次矩阵运算并行计算 Token 之间的关系，因此非常适合 GPU。

### 8.3 缺点：标准 Attention 是 $O(n^2)$

如果序列长度是 n，Attention Scores 矩阵大小就是：

$$
n\times n
$$

因此标准 Self-Attention 的时间和显存开销会随着序列长度快速增长。

------------------------------------------------------------------------

# 9. Multi-Head Attention 与 Self-Attention 的区别

一句话：

> **Self-Attention 描述一次注意力如何计算；Multi-Head Attention
> 则并行执行多组 Attention，让模型可以在多个不同的表示子空间中学习 Token
> 关系。**

单个 Head 仍然使用同样的公式：

$$
head_i =
Attention(Q_i,K_i,V_i)
$$

而 Multi-Head Attention：

$$
MultiHead =
Concat(head_1,\ldots,head_h)W_O
$$

------------------------------------------------------------------------

## 10. 为什么需要 Multi-Head Attention？

一句话中可能同时存在多种关系，例如：

``` text
人物之间的关系
语法关系
动作与对象的关系
指代关系
位置关系
```

如果只有一套 Q/K/V，模型主要是在一个表示空间里计算 Attention。

Multi-Head Attention 使用多套独立的投影参数：

$$
W_Q^i,\quad W_K^i,\quad W_V^i
$$

让不同 Head 可以把同一个输入映射到不同的表示子空间，再分别计算
Attention。

为了帮助理解，可以想象：

``` text
Head 1：可能更关注语法关系
Head 2：可能更关注人物关系
Head 3：可能更关注指代关系
Head 4：可能更关注位置关系
```

但需要注意：

> 这些只是帮助理解的例子。训练过程中并没有人为规定每个 Head
> 必须学习什么，不同 Head
> 学到的模式是模型训练得到的，也可能存在一定冗余。

------------------------------------------------------------------------

## 11. Multi-Head Attention 的维度变化

假设：

$$
d_{model}=512
$$

有 8 个 Head：

$$
h=8
$$

通常每个 Head 的维度为：

$$
d_k=\frac{d_{model}}{h}
=\frac{512}{8}
=64
$$

因此每个 Head 内部计算：

$$
Softmax\left(\frac{Q_iK_i^T}{\sqrt{64}}\right)V_i
$$

每个 Head 输出 64 维：

``` text
Head 1 → 64
Head 2 → 64
...
Head 8 → 64
```

然后拼接：

$$
Concat(head_1,\ldots,head_8)
$$

维度重新变成：

$$
8\times64=512
$$

最后经过输出投影：

$$
W_O
$$

得到最终的 512 维输出。

------------------------------------------------------------------------

## 12. "把 d_model 拆成多个 Head"更严格的理解

可以简单记成：

> 将 $d_{model}$ 拆成多个 Head，每个 Head 在较小的维度中做 Attention。

但更严格地说：

> **并不是先把输入 X 的 512 个维度机械切成 8 份，然后每份各算各的。**

而是每个 Head 都从同一个输入 X 出发，通过自己独立的：

$$
W_Q^i,\quad W_K^i,\quad W_V^i
$$

把输入**投影到不同的 64 维表示子空间**。

可以理解为：

``` text
                    输入 X：512维
                         │
        ┌────────────────┼────────────────┐
        ↓                ↓                ↓
     Head 1           Head 2          ... Head 8
        ↓                ↓                ↓
   独立 WQ/WK/WV     独立 WQ/WK/WV     独立 WQ/WK/WV
        ↓                ↓                ↓
     64维子空间        64维子空间         64维子空间
        ↓                ↓                ↓
 Self-Attention     Self-Attention     Self-Attention
        └────────────────┼────────────────┘
                         ↓
                       Concat
                         ↓
                        512维
                         ↓
                        W_O
                         ↓
                       Output
```

所以最准确的总结是：

> **Multi-Head Attention 将 $d_{model}$ 映射到多个 Head，每个 Head
> 通过独立的 Q/K/V 投影，在不同的表示子空间中学习 Token
> 之间的关系，最后将各 Head 的结果拼接并进行输出投影。**

------------------------------------------------------------------------

# 13. Self-Attention vs Multi-Head Attention

  对比        Self-Attention        Multi-Head Attention
  ----------- --------------------- --------------------------
  Q/K/V       一组                  多组独立投影
  Attention   一次                  多个 Head 并行计算
  表示空间    一个                  多个表示子空间
  结果处理    得到 Attention 输出   Concat + 输出投影
  表达能力    相对有限              可以从多个子空间建模关系

Multi-Head 并没有改变 Self-Attention 的核心计算。

每个 Head 内仍然是：

``` text
QKᵀ
 ↓
÷ √d_k
 ↓
Softmax
 ↓
× V
```

Multi-Head 只是在外层增加：

``` text
多组独立 Q/K/V
        ↓
多个 Attention 并行计算
        ↓
Concat
        ↓
输出投影 W_O
```

------------------------------------------------------------------------

# 14. 面试回答模板

## Self-Attention

> Self-Attention 的核心目的是让序列中的每个 Token 动态关注其他
> Token，从而建立上下文关系。
>
> 计算时首先将输入 X 分别线性映射成 Q、K、V，然后通过 $QK^T$ 计算 Token
> 之间的匹配分数，再除以 $\sqrt{d_k}$
> 防止点积随着维度增加导致数值波动过大，之后经过 Softmax
> 得到注意力权重，最后使用这些权重对 V 做加权求和。
>
> 核心公式是：
>
> $Attention(Q,K,V)=Softmax(QK^T/\sqrt{d_k})V$。
>
> 相比 RNN，它可以直接建立长距离 Token
> 之间的依赖，并且能够通过矩阵运算高度并行；缺点是标准 Attention
> 对序列长度具有 $O(n^2)$ 的复杂度。

## Multi-Head Attention

> Multi-Head Attention 本质上是并行执行多组 Attention。每个 Head
> 都有独立的 Q/K/V
> 投影参数，将同一个输入映射到不同的表示子空间，因此不同 Head
> 可以学习不同类型的 Token 关系。最后将多个 Head 的输出进行
> Concat，再经过一个线性输出投影得到最终结果。
>
> 严格来说，不是简单把输入维度机械切成几份，而是通过不同的可学习投影矩阵，把同一个输入映射到多个低维子空间。

------------------------------------------------------------------------

# 15. 最终记忆版

### Self-Attention

``` text
Q：我想找什么
K：我能如何被匹配
V：我真正提供什么

QKᵀ
→ Token 两两匹配分数
→ ÷ √d_k 稳定数值尺度
→ Softmax 得到注意力权重
→ × V 聚合信息
```

### 为什么是 √d_k？

``` text
QK 点积包含 d_k 项累加
        ↓
方差 ≈ d_k
        ↓
标准差 ≈ √d_k
        ↓
所以除以 √d_k
```

### Multi-Head Attention

``` text
同一个输入 X
     ↓
多组独立 Q/K/V 投影
     ↓
多个不同表示子空间
     ↓
各自做 Self-Attention
     ↓
Concat
     ↓
W_O 输出投影
```

一句话记忆：

> **Self-Attention 解决"一个 Token
> 应该关注谁以及获取什么信息"；Multi-Head Attention
> 则让模型同时从多个不同表示子空间去做这件事。**
