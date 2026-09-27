# MySQL 事务隔离、MVCC 与并发控制学习笔记

> 学习主线：**事务隔离级别 → MVCC → Undo Log → Read View → 快照读 /
> 当前读 → Record / Gap / Next-Key Lock → 死锁 → 高并发事务设计**

本文整理当前对话中关于 MySQL
事务相关的内容，并按照面试学习链路重新组织。

------------------------------------------------------------------------

# 1. MySQL 事务隔离级别如何选择？

事务隔离级别的选择，本质是在：

-   一致性
-   并发性能
-   业务复杂度

之间做权衡。

实际项目中最常见的是：

-   **Repeatable Read（RR，可重复读）**
-   **Read Committed（RC，读已提交）**

MySQL InnoDB 默认使用 **Repeatable Read**。

------------------------------------------------------------------------

## 1.1 四种事务隔离级别

  ------------------------------------------------------------------------
  隔离级别          脏读      不可重复读          幻读          并发性能
  -------------- ----------- ------------ -------------------- -----------
  Read              可能         可能             可能            最高
  Uncommitted                                                  

  Read Committed    不会         可能             可能            较高

  Repeatable        不会         不会             SQL             中等
  Read                                     标准仍可能；InnoDB  
                                          在很多场景通过 MVCC  
                                          / Next-Key Lock 处理 

  Serializable      不会         不会             不会            最低
  ------------------------------------------------------------------------

------------------------------------------------------------------------

# 2. Read Uncommitted

Read Uncommitted 允许一个事务读取另一个事务**尚未提交的数据**。

例如：

``` text
事务 A：

UPDATE account
SET balance = 0;

还没有 COMMIT


事务 B：

SELECT balance
→ 读取到了 0


事务 A：

ROLLBACK
```

事务 B 读取到的：

``` text
balance = 0
```

实际上最终根本没有生效。

这就是：

> **脏读（Dirty Read）**

普通业务系统基本不会使用 Read Uncommitted。

------------------------------------------------------------------------

# 3. Read Committed

RC 的核心规则：

> 每一次普通快照读，都读取当前已经提交、且对该语句可见的数据。

例如：

``` text
事务 A：

SELECT price
→ 100


事务 B：

UPDATE product
SET price = 200;

COMMIT;


事务 A：

再次 SELECT price
→ 200
```

同一个事务中：

``` text
第一次 = 100
第二次 = 200
```

这就是：

> **不可重复读**

RC 的优势是：

-   通常锁范围相对更小
-   减少部分 Gap Lock 带来的冲突
-   高并发场景下比较常见

适合：

-   普通 CRUD
-   后台管理
-   大量查询
-   不要求事务内始终看到完全相同快照的业务

------------------------------------------------------------------------

# 4. Repeatable Read

RR 是 MySQL InnoDB 默认事务隔离级别。

核心目标：

> 同一个事务中的一致性快照读，可以保持稳定的读取视角。

例如：

``` text
事务 A：

BEGIN;

SELECT price
→ 100


事务 B：

UPDATE product
SET price = 200;

COMMIT;


事务 A：

再次 SELECT price
→ 100
```

虽然数据库最新值已经变成：

``` text
200
```

但事务 A 仍然可能读取：

``` text
100
```

背后的核心机制：

``` text
MVCC
+
Read View
+
Undo Log
```

------------------------------------------------------------------------

# 5. Serializable

Serializable 提供最高程度的事务隔离。

可以理解成：

> 宁愿牺牲并发性能，也要提供更严格的事务隔离。

可能出现：

``` text
事务 A
↓
读取 / 锁定某个范围

事务 B
↓
修改相关数据
↓
等待
```

因此可能导致：

-   锁等待增加
-   并发能力降低
-   吞吐量下降

一般只在极少数需要严格隔离且并发量可控的场景考虑。

普通 Web 系统通常不会默认使用 Serializable。

------------------------------------------------------------------------

# 6. 隔离级别不是越高越好

隔离级别提高，通常意味着更强的一致性约束，但也可能带来更多并发成本：

``` text
隔离程度 ↑

锁竞争可能 ↑
等待时间可能 ↑
死锁风险可能 ↑
吞吐量可能 ↓
```

所以不能简单认为：

``` text
Serializable > RR > RC
```

然后无脑选择最高级别。

真正应该根据业务选择。

------------------------------------------------------------------------

# 7. RC 和 RR 怎么选？

可以简单记忆：

## RC

适合：

``` text
高并发
+
普通 CRUD
+
可以接受同一事务中两次查询看到不同的已提交数据
```

------------------------------------------------------------------------

## RR

适合：

``` text
需要事务内一致性读取视角
+
希望减少不可重复读问题
```

也是 MySQL InnoDB 默认选择。

------------------------------------------------------------------------

## 面试回答

如果面试官问：

> MySQL 为什么默认 RR，而一些高并发互联网系统会选择 RC？

可以回答：

> MySQL 默认 RR，是因为它在一致性和性能之间比较均衡。InnoDB 可以通过
> MVCC 提供事务内稳定的一致性读取视角，并在加锁读和范围操作中结合
> Next-Key Lock 处理很多幻读问题。
>
> 但 RR 在一些范围更新、加锁读场景中可能涉及更多 Gap Lock
> 和锁竞争。如果业务并不要求一个事务内多次查询始终看到同一个快照，那么
> RC 可以减少部分锁冲突，因此一些高并发业务会选择 RC。

------------------------------------------------------------------------

# 8. 隔离级别不能替代业务并发控制

例如库存只剩：

``` text
stock = 1
```

两个请求：

``` text
事务 A：
SELECT stock → 1

事务 B：
SELECT stock → 1
```

如果应用层分别判断：

``` text
stock > 0
```

然后再修改：

``` text
A UPDATE stock = 0
B UPDATE stock = 0
```

业务逻辑可能产生并发问题。

更好的方式之一是直接使用条件原子 UPDATE：

``` sql
UPDATE product
SET stock = stock - 1
WHERE id = 1
  AND stock > 0;
```

然后判断：

``` text
affected_rows = 1
→ 扣减成功

affected_rows = 0
→ 库存不足 / 已被其他请求抢先扣减
```

所以：

> **隔离级别负责事务之间的数据可见性与隔离规则，但不能代替正确的业务并发设计。**

------------------------------------------------------------------------

# 9. MVCC 是什么？

MVCC：

> **Multi-Version Concurrency Control，多版本并发控制。**

先看它解决的问题。

假设：

``` text
user

id = 1
age = 20
```

两个事务：

``` text
事务 A                         事务 B

BEGIN;

SELECT age
→ 20

                               BEGIN;

                               UPDATE user
                               SET age = 30
                               WHERE id = 1;

                               COMMIT;

SELECT age
→ ?
```

如果事务 A 使用 RR，一致性快照读下第二次通常仍然可以看到：

``` text
20
```

问题：

> 数据库明明已经被事务 B 修改成 30，事务 A 为什么还能看到 20？

答案就是：

> **MVCC**

------------------------------------------------------------------------

# 10. 如果没有 MVCC 会怎么样？

一种最直接的方案是：

``` text
事务 A：
我要读 user:1
↓
加锁

事务 B：
我要修改 user:1
↓
等待事务 A
```

这样当然能够保证：

``` text
A 第一次读 = 20
A 第二次读 = 20
```

但是会造成大量：

``` text
读阻塞写
写阻塞读
```

并发性能会明显下降。

MVCC 的思路是：

> **你修改你的，我读取适合我的数据版本。**

通过保存历史版本，让普通读操作不必总是通过互斥锁来保证一致性。

------------------------------------------------------------------------

# 11. 什么叫"多版本"？

假设：

``` text
age = 20
```

事务 B：

``` sql
UPDATE user
SET age = 30
WHERE id = 1;
```

逻辑上可以理解成：

``` text
当前版本

age = 30
trx_id = B

   ↓

历史版本

age = 20
trx_id = ...
```

事务 A 查询时：

``` text
age = 30
↓
当前事务是否可见？
```

如果不可见：

``` text
30 ❌
↓
20 ✅
```

于是返回：

``` text
20
```

MVCC 最核心的思想：

> **通过多个数据版本，让不同事务读取对自己可见的数据版本，从而降低普通读与写之间的锁冲突。**

------------------------------------------------------------------------

# 12. 历史版本在哪里？

这就涉及：

``` text
MVCC
 ↓
Undo Log
```

可以先理解 InnoDB 记录中存在一些隐藏信息，其中两个关键概念是：

``` text
DB_TRX_ID
DB_ROLL_PTR
```

当前学习阶段不需要背内部占多少字节。

只需要理解：

``` text
DB_TRX_ID
→ 最后修改该记录的事务 ID

DB_ROLL_PTR
→ 指向相关 Undo 信息，用于找到之前的数据版本
```

逻辑结构：

``` text
当前记录

age = 30
trx_id = 200
roll_ptr
   │
   ↓

Undo Log

age = 20
trx_id = 100
roll_ptr
   │
   ↓

Undo Log

age = 18
trx_id = 50
```

由此形成：

> **版本链**

------------------------------------------------------------------------

# 13. Undo Log 有什么作用？

Undo Log 至少需要掌握两个核心用途。

## 13.1 事务回滚

例如：

``` sql
BEGIN;

UPDATE user
SET age = 30
WHERE id = 1;

ROLLBACK;
```

数据库必须知道：

``` text
30 之前是什么？
```

通过 Undo 信息可以恢复之前的数据状态。

逻辑上：

``` text
30
↓ ROLLBACK
20
```

------------------------------------------------------------------------

## 13.2 MVCC 历史版本读取

例如事务 A 判断：

``` text
age = 30
```

这个版本对自己不可见。

就可以沿版本链寻找：

``` text
30 ❌
↓
20 ✅
```

所以当前阶段可以先记：

``` text
MVCC
=
Read View
+
Undo Log 版本链
```

------------------------------------------------------------------------

# 14. Read View 是什么？

有了历史版本之后，还存在一个问题：

> 当前事务到底应该读取哪个版本？

这就需要：

> **Read View**

可以把 Read View 理解为：

> 事务进行一致性读取时，用于判断数据版本可见性的"事务状态快照"。

注意：

**Read View 不是把整个数据库复制一份。**

不是：

``` text
数据库 = 10 GB

BEGIN

复制 10 GB 数据
```

而是维护用于判断事务可见性的相关事务 ID / 活跃事务边界信息。

查询某个数据版本时：

``` text
数据版本
↓
对应修改事务 ID
↓
结合 Read View
↓
判断这个版本是否可见
```

如果不可见：

``` text
沿 Undo 版本链继续找
```

------------------------------------------------------------------------

# 15. RR 与 RC 的核心区别如何从 MVCC 理解？

这是理解隔离级别非常重要的一步。

------------------------------------------------------------------------

## 15.1 RR

可以理解成：

``` text
事务 A

BEGIN

第一次一致性快照读
↓
建立 / 使用一致性 Read View

第二次一致性快照读
↓
继续保持该事务的一致性读取视角

第三次一致性快照读
↓
继续保持一致性读取视角

COMMIT
```

因此：

``` text
第一次 SELECT → 20
```

事务 B：

``` text
UPDATE → 30
COMMIT
```

事务 A：

``` text
第二次 SELECT → 20
第三次 SELECT → 20
```

这就是：

> Repeatable Read

------------------------------------------------------------------------

## 15.2 RC

RC 下通常可以理解成：

> 每条一致性快照读语句使用新的 Read View。

例如：

``` text
事务 A：

SELECT
↓
Read View 1
↓
20


事务 B：

UPDATE → 30
COMMIT


事务 A：

SELECT
↓
Read View 2
↓
30
```

于是：

``` text
第一次 → 20
第二次 → 30
```

这就是：

> Read Committed 下可能出现不可重复读。

------------------------------------------------------------------------

# 16. RC vs RR 不应该只背定义

不要只记：

``` text
RC
→ 不可重复读

RR
→ 可重复读
```

应该进一步理解：

``` text
                  MVCC

                   │
          ┌────────┴────────┐
          ↓                 ↓
         RC                RR

每条快照读语句          事务的一致性读取
使用新的 Read View      保持稳定读取视角
          ↓                 ↓
可能看到新提交数据       通常继续看到原快照
          ↓                 ↓
不可重复读             可重复读
```

这才是完整的理解链路。

------------------------------------------------------------------------

# 17. 快照读与当前读

理解 MVCC 后，下一个非常关键的概念就是：

``` text
快照读
vs
当前读
```

------------------------------------------------------------------------

# 18. 快照读

普通 SELECT：

``` sql
SELECT *
FROM user
WHERE id = 1;
```

在 InnoDB 的普通一致性读取场景下，通常属于：

> **Snapshot Read（快照读）**

主要依赖：

``` text
MVCC
+
Read View
+
Undo Log
```

因此可以读取符合当前事务可见性规则的历史版本。

目的之一：

> 减少普通读和写之间的锁竞争。

------------------------------------------------------------------------

# 19. 当前读

例如：

``` sql
SELECT *
FROM user
WHERE id = 1
FOR UPDATE;
```

以及：

``` sql
UPDATE ...
DELETE ...
```

需要围绕当前记录进行并发控制。

例如：

``` text
数据库当前：

age = 30
```

如果事务准备修改这条数据，却只拿到：

``` text
历史版本 age = 20
```

显然可能产生问题。

因此：

``` text
我要操作当前数据
↓
不能只依赖历史快照
↓
读取当前版本
↓
必要时加锁
```

这就是：

> **Current Read（当前读）**

------------------------------------------------------------------------

# 20. 快照读 vs 当前读的核心区别

可以记：

``` text
快照读
→ MVCC
→ 主要解决：
“当前事务应该看到哪个版本？”


当前读
→ Lock
→ 主要解决：
“并发事务能不能同时修改相关数据？”
```

这是后续理解 MySQL 锁的关键分界点。

------------------------------------------------------------------------

# 21. SELECT ... FOR UPDATE

这是高并发业务和面试中的重点。

例如：

``` sql
BEGIN;

SELECT *
FROM task
WHERE id = 100
FOR UPDATE;

UPDATE task
SET status = 'running'
WHERE id = 100;

COMMIT;
```

普通：

``` sql
SELECT *
FROM task
WHERE id = 100;
```

通常属于：

``` text
快照读
↓
MVCC
↓
通常不需要给目标记录加排他锁
```

而：

``` sql
SELECT *
FROM task
WHERE id = 100
FOR UPDATE;
```

属于：

``` text
当前读
↓
需要进行锁定
↓
防止其他事务并发修改相关记录
```

------------------------------------------------------------------------

# 22. FOR UPDATE 是不是一定只锁一行？

不是。

锁定范围与多个因素有关：

``` text
索引
+
查询条件
+
隔离级别
```

例如：

``` sql
SELECT *
FROM orders
WHERE amount > 100
FOR UPDATE;
```

这类范围查询在 RR 等场景下可能涉及：

``` text
Record Lock
Gap Lock
Next-Key Lock
```

所以不能简单回答：

> FOR UPDATE 就是给查询结果加一把行锁。

更准确的理解是：

> InnoDB
> 会根据索引访问方式、查询条件和隔离级别确定实际锁定的索引记录及可能的范围。

------------------------------------------------------------------------

# 23. Record Lock、Gap Lock、Next-Key Lock

当前阶段需要知道概念和为什么存在，不需要研究所有极端边界 Case。

## Record Lock

锁住具体的索引记录。

可以简单理解成：

``` text
锁某条记录
```

------------------------------------------------------------------------

## Gap Lock

锁住索引记录之间的：

``` text
间隙
```

目的之一是阻止其他事务在某个范围内插入新记录。

------------------------------------------------------------------------

## Next-Key Lock

可以先理解为：

``` text
Next-Key Lock
=
Record Lock
+
Gap Lock
```

即：

> 既锁记录，也保护相关索引范围。

InnoDB 在 RR 下的某些加锁读和范围操作中，会使用 Next-Key Lock
来防止范围内出现新的记录，从而处理很多幻读场景。

------------------------------------------------------------------------

# 24. MVCC 和 Lock 分别解决什么？

这是整套知识最重要的理解之一：

``` text
                 MySQL 并发控制

                       │
             ┌─────────┴─────────┐
             ↓                   ↓

            MVCC                Lock
             ↓                   ↓
      Read View + Undo      Record / Gap /
          版本链             Next-Key
             ↓                   ↓
       我应该看到哪个版本？   别人能不能同时修改？
```

一句话：

> **MVCC
> 主要解决"读哪个版本"，锁主要解决"并发事务能不能修改相关数据"。**

------------------------------------------------------------------------

# 25. 高并发业务为什么不能只会 FOR UPDATE？

例如多个 Worker 同时抢一个 Agent Task。

数据库：

``` text
task:

id = 100
status = pending
```

多个 Worker：

``` text
Worker A
Worker B
Worker C
```

都想把：

``` text
pending
→
running
```

一种方案是：

``` sql
BEGIN;

SELECT *
FROM agent_task
WHERE id = 100
FOR UPDATE;

UPDATE agent_task
SET status = 'running'
WHERE id = 100;

COMMIT;
```

但是很多场景还可以通过更简单的：

> **条件 UPDATE / CAS**

解决。

例如：

``` sql
UPDATE agent_task
SET status = 'running',
    worker_id = ?
WHERE id = ?
  AND status = 'pending';
```

判断：

``` text
affected_rows = 1
↓
抢任务成功


affected_rows = 0
↓
任务已经被其他 Worker 抢走
```

这类思维对高并发业务非常重要。

------------------------------------------------------------------------

# 26. 乐观锁 / CAS

如果数据存在版本号：

``` text
id = 1
balance = 100
version = 5
```

读取：

``` text
version = 5
```

修改时：

``` sql
UPDATE account
SET balance = 80,
    version = version + 1
WHERE id = 1
  AND version = 5;
```

如果：

``` text
affected_rows = 1
```

说明：

``` text
期间没人修改
↓
更新成功
```

如果：

``` text
affected_rows = 0
```

说明：

``` text
version 已经变化
↓
发生并发修改
```

这就是典型：

> **Optimistic Lock / CAS 思维**

------------------------------------------------------------------------

# 27. 原子 UPDATE 为什么重要？

相比：

``` text
SELECT
↓
应用层判断
↓
UPDATE
```

高并发业务中通常更应该优先考虑：

``` text
条件直接写进 UPDATE
```

例如库存：

``` sql
UPDATE product
SET stock = stock - 1
WHERE id = ?
  AND stock > 0;
```

数据库原子执行：

``` text
判断 stock > 0
+
stock - 1
```

应用层只需要判断：

``` text
affected_rows
```

这可以显著减少很多"先查再改"产生的竞态窗口。

------------------------------------------------------------------------

# 28. MySQL 事务相关面试需要掌握到什么程度？

对于偏 AI 应用 / AI Agent / 全栈工程岗位，不需要深入到 DBA 或 InnoDB
源码级别。

重点是：

> **能解释核心原理 + 能处理真实高并发业务问题。**

建议掌握程度：

  知识点                     程度    应该能回答
  -------------------------- ------- --------------------------------
  ACID                       ★★★     四个特性
  四种隔离级别               ★★★★★   RU / RC / RR / Serializable
  脏读 / 不可重复读 / 幻读   ★★★★★   能举例
  RC vs RR                   ★★★★★   为什么选择 RC / RR
  MySQL 默认 RR              ★★★★    为什么
  MVCC                       ★★★★★   解决什么、基本原理
  Undo Log                   ★★★★    为什么需要历史版本
  Read View                  ★★★★    用来判断版本可见性
  快照读 / 当前读            ★★★★★   普通 SELECT vs FOR UPDATE
  Record Lock                ★★★★    基本作用
  Gap Lock                   ★★★★    为什么锁间隙
  Next-Key Lock              ★★★★    Record + Gap 基本思想
  SELECT FOR UPDATE          ★★★★★   什么时候使用
  乐观锁 / CAS               ★★★★★   version / 条件 UPDATE
  原子 UPDATE                ★★★★★   为什么比先 SELECT 再 UPDATE 好
  死锁                       ★★★★    为什么发生、怎么减少
  Redo Log / Binlog          ★★★     知道核心用途
  InnoDB 源码                ★       不需要
  MVCC 源码实现              ★       不需要

------------------------------------------------------------------------

# 29. 面试最容易形成的追问链

``` text
MySQL 有哪些事务隔离级别？
        ↓
默认是什么？
        ↓
为什么默认 RR？
        ↓
RR 怎么实现可重复读？
        ↓
MVCC
        ↓
MVCC 怎么知道读哪个版本？
        ↓
Undo Log + Read View
        ↓
普通 SELECT 会不会加锁？
        ↓
快照读 vs 当前读
        ↓
SELECT ... FOR UPDATE 呢？
        ↓
Record / Gap / Next-Key Lock
        ↓
为什么会发生死锁？
        ↓
实际高并发业务如何设计？
```

因此不要把这些知识点独立背诵。

应该把它们理解成：

> **一条完整的 MySQL 并发控制知识链。**

------------------------------------------------------------------------

# 30. 当前完整知识脑图

``` text
事务隔离级别
      │
      ├── RU
      ├── RC
      ├── RR
      └── Serializable
      │
      ↓
     MVCC
      │
      ├─────────────┐
      ↓             ↓
  Undo Log       Read View
      ↓             ↓
   版本链        可见性判断
      └──────┬──────┘
             ↓
           快照读
             ↓
         普通 SELECT
             ↓
        减少读写冲突


但是：

SELECT ... FOR UPDATE
UPDATE
DELETE
             ↓
           当前读
             ↓
            Lock
             ↓
      ┌──────┼──────┐
      ↓      ↓      ↓
   Record   Gap   Next-Key
    Lock   Lock     Lock
             ↓
          锁竞争
             ↓
           死锁
             ↓
       高并发事务设计
             ↓
    ┌────────┼────────┐
    ↓        ↓        ↓
FOR UPDATE  CAS   原子 UPDATE
```

------------------------------------------------------------------------

# 31. 学习边界

## 必须掌握

``` text
ACID
事务隔离级别
RC vs RR
脏读 / 不可重复读 / 幻读
MVCC
Undo Log
Read View
快照读 vs 当前读
SELECT ... FOR UPDATE
Record / Gap / Next-Key Lock
乐观锁 / CAS
原子 UPDATE
死锁基本处理
```

------------------------------------------------------------------------

## 了解即可

``` text
Redo Log
Binlog
两阶段提交
复杂锁边界规则
```

------------------------------------------------------------------------

## 暂时不用投入大量时间

``` text
InnoDB 源码
MVCC 源码
Buffer Pool 内部算法细节
各种极端 Gap Lock Case
```

------------------------------------------------------------------------

# 32. 推荐继续学习顺序

当前已经学习到：

``` text
事务隔离级别
      ↓
MVCC
      ↓
Undo Log
      ↓
Read View
      ↓
快照读 / 当前读
      ↓
SELECT ... FOR UPDATE
```

下一阶段继续：

``` text
SELECT ... FOR UPDATE
        ↓
Record Lock
        ↓
Gap Lock
        ↓
Next-Key Lock
        ↓
锁等待
        ↓
死锁
        ↓
如何排查死锁
        ↓
如何减少死锁
        ↓
高并发事务设计
        ↓
FOR UPDATE vs CAS vs 原子 UPDATE 如何选择
```

这条链掌握以后，MySQL
事务与并发控制相关的中高级工程面试知识就基本串起来了。

------------------------------------------------------------------------

# 33. SELECT ... FOR UPDATE 到底锁什么？

继续沿着：

``` text
MVCC
↓
快照读 / 当前读
↓
SELECT ... FOR UPDATE
↓
Record Lock
↓
Gap Lock
↓
Next-Key Lock
↓
死锁
↓
高并发事务设计
```

这一阶段最重要的问题是：

> **MySQL 为什么不能只锁查询结果里的那几行？**

假设订单表：

``` sql
CREATE TABLE orders (
  id BIGINT PRIMARY KEY,
  user_id BIGINT,
  amount INT,
  status VARCHAR(20),

  INDEX idx_amount(amount)
);
```

存在：

``` text
id    amount
--------------
1     10
2     20
3     30
4     40
5     50
```

事务 A：

``` sql
BEGIN;

SELECT *
FROM orders
WHERE id = 3
FOR UPDATE;
```

`id` 是主键，并且进行唯一等值查询，因此 InnoDB
可以非常明确地定位目标索引记录。

这种场景通常对应比较明确的：

> **Record Lock**

------------------------------------------------------------------------

# 34. Record Lock

Record Lock 可以先理解成：

> **锁住一条具体的索引记录。**

例如事务 A：

``` sql
BEGIN;

SELECT *
FROM orders
WHERE id = 3
FOR UPDATE;
```

事务 A 尚未提交。

事务 B：

``` sql
UPDATE orders
SET amount = 100
WHERE id = 3;
```

此时：

``` text
事务 A

id = 3 🔒


事务 B

UPDATE id = 3
↓
等待
```

直到事务 A：

``` sql
COMMIT;
```

事务 B 才能继续。

需要注意：

> **InnoDB 的行锁本质上是基于索引实现的。**

------------------------------------------------------------------------

# 35. 为什么范围查询不能只锁已有记录？

事务 A：

``` sql
SELECT *
FROM orders
WHERE amount >= 20
  AND amount <= 40
FOR UPDATE;
```

查询结果：

``` text
20
30
40
```

如果只锁：

``` text
10    20    30    40    50
      🔒    🔒    🔒
```

事务 B 仍然可能：

``` sql
INSERT INTO orders
VALUES (6, 2, 25, 'pending');
```

也就是向：

``` text
20 ~ 30
```

之间插入：

``` text
25
```

如果允许成功，那么范围结果中就会出现一条新的记录。

因此：

> **只锁已经存在的记录，并不能阻止其他事务向查询范围内插入新记录。**

这就是 Gap Lock 出现的重要原因。

------------------------------------------------------------------------

# 36. Gap Lock

索引：

``` text
10       20       30       40       50
   gap      gap      gap      gap
```

其中存在：

``` text
(10,20)
(20,30)
(30,40)
(40,50)
```

这些索引间隙。

Gap Lock：

> **锁定索引记录之间的间隙，主要用于阻止其他事务向相关间隙插入新的索引记录。**

例如锁住：

``` text
(20,30)
```

那么：

``` sql
INSERT ... amount = 25;
```

可能被阻塞。

Gap Lock 的重点不是：

``` text
禁止别人修改 amount=20
```

而是：

``` text
限制别人向 20~30 之间插入新的索引记录
```

因此可以记：

``` text
Record Lock
→ 防止已有索引记录被并发修改

Gap Lock
→ 防止相关索引范围出现新的记录
```

------------------------------------------------------------------------

# 37. Next-Key Lock

实际 InnoDB 中，Record Lock 和 Gap Lock 经常组合使用。

可以先理解：

``` text
Next-Key Lock
=
Record Lock
+
Gap Lock
```

例如索引：

``` text
10
20
30
```

可以粗略理解一个 Next-Key 区间为：

``` text
(10,20]
```

其中：

``` text
(10,20)
→ Gap

20
→ Record
```

组合起来就是 Next-Key Lock。

当前学习阶段不需要死背所有左右开闭边界。

真正需要掌握的是：

``` text
Record Lock
→ 锁已有索引记录

Gap Lock
→ 锁索引间隙

Next-Key Lock
→ Record + Gap 的组合思想
```

------------------------------------------------------------------------

# 38. 为什么普通 SELECT 不需要这样锁？

普通：

``` sql
SELECT *
FROM orders
WHERE amount BETWEEN 20 AND 40;
```

通常属于：

``` text
快照读
↓
MVCC
↓
Read View
↓
读取对当前事务可见的数据版本
```

在 RR 的一致性读取场景中，即使其他事务后来插入：

``` text
amount = 25
```

当前事务仍然可以通过 MVCC 保持自己的读取视角。

因此普通快照读通常不需要为了保持读取一致性，把整个查询范围都锁住。

而：

``` sql
SELECT ...
FOR UPDATE;
```

属于：

``` text
当前读
↓
读取并准备操作当前数据
↓
需要锁进行并发控制
```

------------------------------------------------------------------------

# 39. MySQL RR 如何处理幻读？

面试中经常会问：

> SQL 标准里的 RR 仍然可能有幻读，为什么 MySQL InnoDB
> 又经常说可以避免很多幻读场景？

需要区分：

## 快照读

例如：

``` sql
SELECT ...
```

主要依靠：

``` text
MVCC
+
Read View
```

维持事务的一致性读取视角。

## 当前读

例如：

``` sql
SELECT ... FOR UPDATE;

UPDATE ...;

DELETE ...;
```

在需要范围锁定的场景下，InnoDB 会通过：

``` text
Record Lock
+
Gap Lock
+
Next-Key Lock
```

限制其他事务向相关范围插入记录。

因此可以记：

``` text
             RR 下处理幻读

                   │
          ┌────────┴────────┐
          ↓                 ↓

        快照读              当前读
          ↓                 ↓
        MVCC          Next-Key Lock
```

这是一个非常适合面试表达的理解模型。

------------------------------------------------------------------------

# 40. 索引为什么会影响 FOR UPDATE 的锁范围？

InnoDB 行锁是：

> **基于索引实现的。**

例如：

``` sql
SELECT *
FROM orders
WHERE id = 100
FOR UPDATE;
```

`id` 是主键：

``` text
主键 B+Tree
↓
精确定位 id=100
↓
锁定相关索引记录
```

锁范围通常非常明确。

但如果：

``` sql
SELECT *
FROM orders
WHERE some_field = 'xxx'
FOR UPDATE;
```

而：

``` text
some_field 没有合适索引
```

数据库可能需要扫描大量记录。

这会导致：

``` text
扫描范围扩大
↓
锁影响范围可能扩大
↓
并发冲突增加
```

因此：

> **FOR UPDATE 并不意味着永远只锁一行。**

锁范围取决于：

``` text
索引
+
查询条件
+
隔离级别
+
实际执行计划
```

------------------------------------------------------------------------

# 41. 为什么主键 / 唯一索引等值查询更适合精确加锁？

例如：

``` sql
SELECT *
FROM user
WHERE id = 100
FOR UPDATE;
```

其中：

``` text
id = PRIMARY KEY
```

并且：

``` text
id=100 确实存在
```

数据库可以精确定位目标记录。

这种情况下通常能够形成比较明确的 Record
Lock，而不需要保护很大的索引范围。

所以高并发事务设计里，一个非常实用的原则是：

> **尽量通过主键或合适的唯一索引精确定位需要锁定的数据。**

------------------------------------------------------------------------

# 42. 什么是死锁？

假设：

``` text
id = 1
id = 2
```

事务 A：

``` sql
BEGIN;

UPDATE account
SET balance = balance - 100
WHERE id = 1;
```

A 持有：

``` text
id=1 🔒
```

事务 B：

``` sql
BEGIN;

UPDATE account
SET balance = balance - 100
WHERE id = 2;
```

B 持有：

``` text
id=2 🔒
```

接下来 A：

``` sql
UPDATE account
SET balance = balance + 100
WHERE id = 2;
```

A 等待 B。

与此同时 B：

``` sql
UPDATE account
SET balance = balance + 100
WHERE id = 1;
```

B 又等待 A。

形成：

``` text
事务 A
  │
  │ 等待 id=2
  ↓
事务 B
  │
  │ 等待 id=1
  ↓
事务 A
```

也就是：

``` text
A 等 B
B 等 A
```

形成资源等待环：

> **Deadlock（死锁）**

------------------------------------------------------------------------

# 43. InnoDB 遇到死锁怎么办？

InnoDB 具备死锁检测能力。

当发现事务之间形成等待环后，会选择其中一个事务作为 victim：

``` text
检测到死锁
↓
回滚其中一个事务
↓
释放它持有的锁
↓
另一个事务继续
```

应用可能收到类似错误：

``` text
Deadlock found when trying to get lock;
try restarting transaction
```

因此需要认识到：

> **在高并发数据库系统中，死锁不一定代表代码存在简单
> Bug，也可能是需要正常处理的并发现象。**

重要事务可以设计：

``` text
死锁
↓
事务回滚
↓
有限次数重试
```

当然，重试必须有次数限制，避免无限循环。

------------------------------------------------------------------------

# 44. 如何降低死锁概率？

## 44.1 统一加锁顺序

错误方式：

``` text
事务 A：
1 → 2

事务 B：
2 → 1
```

容易形成：

``` text
A 拿着 1 等 2
B 拿着 2 等 1
```

改成所有业务统一：

``` text
先锁较小 ID
↓
再锁较大 ID
```

例如：

``` text
A：1 → 2
B：1 → 2
```

这样 B 一开始就等待 A 的 1，而不是先拿着 2 再等待 1。

核心原则：

> **统一资源访问 / 加锁顺序。**

------------------------------------------------------------------------

## 44.2 事务尽量短

不要：

``` text
BEGIN
↓
查询并加锁
↓
调用 HTTP
↓
调用 LLM
↓
等待 20 秒
↓
更新 DB
↓
COMMIT
```

因为这意味着数据库锁可能被持有：

``` text
20 秒甚至更久
```

对于 Agent 系统尤其应该避免：

``` text
BEGIN

SELECT task
FOR UPDATE

调用 LLM
等待模型生成

UPDATE task

COMMIT
```

更好的思路：

``` text
短事务：
抢占任务
↓
COMMIT

事务外：
调用 LLM
执行 Agent

短事务：
更新任务结果
↓
COMMIT
```

核心原则：

> **不要把耗时外部调用包在数据库事务里。**

------------------------------------------------------------------------

## 44.3 正确设计索引

例如：

``` sql
UPDATE orders
SET status = 'done'
WHERE user_id = 100
  AND status = 'pending';
```

如果没有合适索引：

``` text
扫描范围扩大
↓
锁影响范围扩大
↓
锁竞争增加
↓
死锁概率增加
```

所以：

> **慢 SQL 有时候不仅是性能问题，也会演变成并发锁问题。**

------------------------------------------------------------------------

## 44.4 单个事务不要锁太多数据

例如一个事务一次更新：

``` text
100000 行
```

会导致：

-   锁数量增加
-   锁持有时间增加
-   冲突概率增加

如果业务允许，可以：

``` text
分批处理
+
缩短单次事务
```

------------------------------------------------------------------------

# 45. Agent 多 Worker 抢任务怎么设计？

假设：

``` text
agent_task

id      status
----------------
100     pending
```

现在：

``` text
Worker A
Worker B
Worker C
```

同时准备执行任务 100。

一种方案：

``` sql
BEGIN;

SELECT *
FROM agent_task
WHERE id = 100
FOR UPDATE;

UPDATE agent_task
SET status = 'running'
WHERE id = 100;

COMMIT;
```

这种方案可以工作。

但是如果业务只是简单地：

``` text
pending
↓
running
```

通常没必要先：

``` text
SELECT
↓
加锁
↓
UPDATE
```

可以直接使用：

``` sql
UPDATE agent_task
SET status = 'running',
    worker_id = ?
WHERE id = ?
  AND status = 'pending';
```

然后：

``` text
affected_rows = 1
→ 抢任务成功

affected_rows = 0
→ 任务已经被其他 Worker 抢走
```

这就是：

> **条件 UPDATE / CAS 思维**

------------------------------------------------------------------------

# 46. FOR UPDATE vs CAS / 条件 UPDATE 怎么选？

这是实际工程中非常重要的判断。

## 简单状态竞争

例如：

``` text
pending → running
```

业务条件可以直接写进一条 SQL：

``` sql
UPDATE agent_task
SET status = 'running'
WHERE id = ?
  AND status = 'pending';
```

优先考虑：

> **原子条件 UPDATE / CAS**

因为：

``` text
一次 SQL
↓
判断 + 修改
↓
完成
```

事务窗口很小。

------------------------------------------------------------------------

## 复杂"读取 → 判断 → 修改"

例如转账：

``` text
读取账户 A
↓
读取账户 B
↓
检查余额 / 状态
↓
执行复杂业务判断
↓
修改账户 A
↓
修改账户 B
```

这类业务可能需要：

``` text
数据库事务
+
SELECT ... FOR UPDATE
```

以保证业务判断期间相关数据不会被其他事务并发修改。

因此可以记：

``` text
简单状态竞争
↓
CAS / 条件 UPDATE


复杂读取 → 判断 → 修改
↓
事务 + FOR UPDATE
```

------------------------------------------------------------------------

# 47. 乐观锁 vs 悲观锁的初步理解

## 悲观锁

代表：

``` sql
SELECT ...
FOR UPDATE;
```

思想：

> 我认为并发冲突可能发生，因此先把相关数据锁住，再执行业务逻辑。

特点：

-   冲突高时比较直接
-   会产生锁等待
-   事务必须尽量短

------------------------------------------------------------------------

## 乐观锁

典型：

``` text
version
CAS
条件 UPDATE
```

例如：

``` sql
UPDATE account
SET balance = 80,
    version = version + 1
WHERE id = 1
  AND version = 5;
```

思想：

> 我先假设冲突不会发生，提交修改时再判断数据是否已经被其他事务修改。

特点：

-   不需要长时间持有悲观锁
-   冲突低时非常合适
-   冲突高时可能产生大量失败与重试

------------------------------------------------------------------------

# 48. 当前 MySQL 并发控制完整知识链

现在已经可以从隔离级别一路串到实际高并发设计：

``` text
事务隔离级别
       ↓
      MVCC
       ↓
┌──────┴──────┐
↓             ↓
Undo Log    Read View
↓             ↓
版本链       可见性判断
└──────┬──────┘
       ↓
     快照读
       ↓
普通 SELECT


需要操作当前数据
       ↓
     当前读
       ↓
SELECT ... FOR UPDATE
UPDATE / DELETE
       ↓
      Lock
       ↓
┌──────┼──────────┐
↓      ↓          ↓
Record Gap     Next-Key
Lock   Lock      Lock
       ↓
    锁竞争
       ↓
     死锁
       ↓
┌──────┴──────────────┐
↓                     ↓
减少锁冲突           正确业务设计
↓                     ↓
统一锁顺序           CAS
短事务               条件 UPDATE
正确索引             FOR UPDATE
分批处理             乐观锁
```

------------------------------------------------------------------------

# 49. 下一阶段学习路线：从单库事务走向分布式一致性

完成 MySQL 锁与死锁后，下一阶段建议进入：

``` text
库存扣减怎么做？
        ↓
账户转账怎么做？
        ↓
Agent Task 多 Worker 抢任务怎么做？
        ↓
CAS vs FOR UPDATE 怎么选？
        ↓
乐观锁 vs 悲观锁怎么选？
        ↓
数据库事务提交成功，但 MQ 发送失败怎么办？
        ↓
DB + MQ 一致性
        ↓
Outbox Pattern
```

这一步会把：

``` text
MySQL 本地事务
```

连接到：

``` text
消息队列
+
分布式系统
+
Agent 异步任务架构
```

也是从 MySQL 面试八股进入真实系统设计的重要过渡。

------------------------------------------------------------------------

# 50. 从 MySQL 本地事务进入分布式一致性

前面的学习主线已经走到：

``` text
MySQL 事务
→ 原子 UPDATE / CAS / FOR UPDATE
→ 高并发事务设计
```

下一步需要解决：

``` text
数据库事务提交成功
↓
但 MQ 消息发送失败怎么办？
```

这就进入：

``` text
DB + MQ 一致性
→ Transactional Outbox
→ At-Least-Once
→ 幂等消费
→ Inbox / 去重
→ Retry / DLQ
```

------------------------------------------------------------------------

# 51. 为什么 DB COMMIT → MQ SEND 有问题？

例如创建 Agent Task：

``` js
await db.transaction(async (tx) => {
  await tx.agentTask.create({
    id: 100,
    status: "pending",
  });
});

await mq.send({
  type: "AgentTaskCreated",
  taskId: 100,
});
```

正常流程：

``` text
INSERT task
↓
COMMIT
↓
MQ SEND
↓
Worker 执行
```

但如果：

``` text
DB COMMIT 成功
↓
服务进程崩溃
↓
MQ.send 没执行
```

最终：

``` text
DB：
task=100
status=pending

MQ：
没有消息
```

任务可能永久没人处理。

根本原因：

> **MySQL 和 MQ
> 是两个独立系统，本地数据库事务无法天然保证两个系统一起成功。**

------------------------------------------------------------------------

# 52. 为什么不能把 MQ SEND 放进数据库事务？

例如：

``` js
await db.transaction(async (tx) => {
  await tx.agentTask.create(...);

  await mq.send(...);
});
```

看起来：

``` text
BEGIN
↓
INSERT task
↓
MQ SEND
↓
COMMIT
```

但仍然存在：

``` text
MQ SEND 成功
↓
MQ 已经收到消息
↓
数据库 COMMIT 失败
```

最终：

``` text
MQ 有 AgentTaskCreated

但 DB 没有 task
```

仍然不一致。

而且还有一个严重工程问题：

``` text
数据库事务打开
↓
持有锁
↓
等待 MQ 网络请求
```

如果 MQ 卡住几秒，数据库事务也被拉长。

所以仍然遵循前面的原则：

> **HTTP、MQ、RPC、LLM 等耗时外部调用，不要放在数据库事务中等待。**

------------------------------------------------------------------------

# 53. Transactional Outbox Pattern

Outbox 的核心不是保证：

``` text
DB
+
MQ
```

直接原子提交。

而是保证：

``` text
业务数据
+
“需要发送 MQ”这件事
```

一起持久化。

例如建立：

``` sql
CREATE TABLE outbox_event (
    id BIGINT PRIMARY KEY,
    event_type VARCHAR(100),
    aggregate_id BIGINT,
    payload JSON,
    status VARCHAR(20),
    created_at DATETIME
);
```

创建 Agent Task：

``` sql
BEGIN;

INSERT INTO agent_task (
    id,
    status
)
VALUES (
    100,
    'pending'
);

INSERT INTO outbox_event (
    id,
    event_type,
    aggregate_id,
    payload,
    status
)
VALUES (
    10001,
    'AgentTaskCreated',
    100,
    '{"taskId":100}',
    'pending'
);

COMMIT;
```

这样 MySQL 可以保证：

``` text
agent_task
+
outbox_event
```

要么一起成功，要么一起失败。

也就是说：

> **不会出现任务创建成功，但系统完全忘记应该发送事件的情况。**

------------------------------------------------------------------------

# 54. Outbox Publisher

Outbox 记录还没有真正发送到 MQ，因此需要后台 Publisher：

``` text
扫描 outbox_event
↓
找到 pending
↓
发送 MQ
↓
成功后标记 sent
```

伪代码：

``` js
const events = await db.query(`
  SELECT *
  FROM outbox_event
  WHERE status = 'pending'
  LIMIT 100
`);

for (const event of events) {
  await mq.send(event);

  await db.execute(`
    UPDATE outbox_event
    SET status = 'sent'
    WHERE id = ?
  `, [event.id]);
}
```

如果业务服务崩溃：

``` text
Outbox Event 仍然存在于数据库
↓
Publisher 恢复后继续发送
```

这样可以大幅降低消息丢失风险。

------------------------------------------------------------------------

# 55. 为什么 Outbox 仍然可能重复发送？

假设：

``` text
Publisher
↓
读取 event 10001
↓
MQ.send 成功
```

但是就在：

``` text
UPDATE outbox_event
SET status='sent'
```

之前 Publisher 崩溃。

数据库里仍然：

``` text
status = pending
```

重启之后：

``` text
Publisher 再次扫描
↓
再次发送 event 10001
```

于是 MQ 收到两次相同消息。

因此 Outbox 通常带来的是：

> **At-Least-Once Delivery**

也就是：

``` text
消息至少送达一次
```

它可能到达：

``` text
1 次
2 次
3 次
```

因此不能假设消费者永远只收到一次。

------------------------------------------------------------------------

# 56. At-Least-Once 与幂等

工程思维应该从：

``` text
如何保证消息绝不重复？
```

转向：

> **即使重复，业务结果还能否保持正确？**

这就是：

> **Idempotency，幂等**

例如：

``` text
SET status = completed
```

重复执行通常仍然：

``` text
completed
```

但：

``` text
stock = stock - 1
```

执行两次就会扣两次库存，因此不是天然幂等。

------------------------------------------------------------------------

# 57. event_id + UNIQUE 实现消费者去重

消息可以带：

``` json
{
  "eventId": "evt-10001",
  "type": "OrderCreated",
  "orderId": 100
}
```

消费者维护：

``` text
processed_event

event_id
----------------
evt-10001
```

并对：

``` text
event_id
```

建立 UNIQUE。

但不能简单：

``` js
if (await hasProcessed(eventId)) return;

await handleBusiness();
await markProcessed(eventId);
```

因为：

``` text
handleBusiness 成功
↓
服务崩溃
↓
markProcessed 没执行
```

重启后仍然会重复执行业务。

------------------------------------------------------------------------

# 58. 消费记录 + 业务修改必须同事务

更可靠的方式：

``` sql
BEGIN;

INSERT INTO processed_event(event_id)
VALUES ('evt-10001');

UPDATE product
SET stock = stock - 1
WHERE id = 10
  AND stock > 0;

COMMIT;
```

第一次：

``` text
INSERT processed_event ✅
UPDATE business ✅
COMMIT ✅
```

第二次相同消息：

``` text
INSERT processed_event
↓
Duplicate Key
```

即可识别：

``` text
这条事件已经处理
```

这就是非常重要的原则：

> **记录"已消费"与真正的业务副作用，尽量放进同一个本地数据库事务。**

------------------------------------------------------------------------

# 59. Inbox Pattern

生产者：

``` text
业务数据
+
Outbox Event
↓
同一个本地事务
```

消费者：

``` text
Inbox / processed_event
+
业务修改
↓
同一个本地事务
```

可以画成：

``` text
        Producer

业务表 ───── Outbox
       本地事务
             ↓
         Publisher
             ↓
            MQ
             ↓
         Consumer
             ↓
Inbox ────── 业务表
       本地事务
```

Outbox 更偏：

``` text
保证事件不会因为中途崩溃而永久丢失
```

Inbox / 幂等更偏：

``` text
保证重复事件不会造成重复业务副作用
```

------------------------------------------------------------------------

# 60. 在 Agent Workflow 中如何使用 Outbox？

例如：

``` text
PRD Agent
↓
PRD 节点完成
↓
需要触发 RFC Agent
```

不要简单：

``` text
UPDATE PRD status=completed
↓
直接调用 RFC Agent
```

否则：

``` text
PRD completed 成功
↓
服务崩溃
↓
RFC Agent 没触发
```

可以：

``` sql
BEGIN;

UPDATE workspace_node
SET status = 'completed'
WHERE id = 'prd';

INSERT INTO outbox_event (
  event_id,
  event_type,
  payload
)
VALUES (
  'evt-001',
  'PRD_COMPLETED',
  '{...}'
);

COMMIT;
```

然后：

``` text
Outbox Publisher
↓
MQ
↓
RFC Agent Worker
```

这样业务状态变化与"需要触发下一节点"可以一起落库。

------------------------------------------------------------------------

# 61. Agent Worker 为什么也必须幂等？

MQ 可能重复：

``` text
PRD_COMPLETED
PRD_COMPLETED
```

如果 Worker 每次都：

``` text
启动 RFC Agent
```

可能生成两份 RFC。

可以再次使用前面学过的 CAS：

``` sql
UPDATE workspace_node
SET status = 'running'
WHERE id = 'rfc'
  AND status = 'pending';
```

判断：

``` text
affected_rows = 1
→ 获得执行权

affected_rows = 0
→ 已经有人执行或已经完成
```

因此知识形成闭环：

``` text
Outbox
↓
可能重复发送
↓
At-Least-Once
↓
消费者幂等
↓
UNIQUE / CAS
```

------------------------------------------------------------------------

# 62. Retry、Exponential Backoff 与 Jitter

如果 Agent 调用模型 API 出现：

``` text
Timeout
HTTP 429
HTTP 500
网络错误
```

通常属于可恢复错误，可以重试。

重试不应该：

``` text
失败
↓
立即疯狂重试
```

而应该采用：

``` text
第一次：1 秒
第二次：2 秒
第三次：4 秒
第四次：8 秒
第五次：16 秒
```

也就是：

> **Exponential Backoff**

可以理解：

``` text
delay ≈ base × 2^retry_count
```

再加：

> **Jitter**

让大量任务不要在同一毫秒一起恢复，例如：

``` text
7.4 秒
8.2 秒
9.0 秒
```

用于减少：

> Retry Storm / Thundering Herd

------------------------------------------------------------------------

# 63. Retryable Error vs Non-Retryable Error

不是所有错误都应该重试。

通常可以考虑重试：

``` text
网络超时
HTTP 429
HTTP 500
临时数据库连接异常
临时 MQ 异常
```

通常不应该机械重试：

``` text
参数格式错误
业务数据缺失
权限不足
模型名称错误
业务规则明确拒绝
```

因此生产系统应区分：

``` text
Retryable Error
vs
Non-Retryable Error
```

而不是简单：

``` text
所有错误统一重试 3 次
```

------------------------------------------------------------------------

# 64. DLQ / Failed State

重试必须存在上限：

``` text
max_retry = 5
```

超过上限：

``` text
failed
```

或者进入：

> **DLQ（Dead Letter Queue，死信队列）**

然后配合：

``` text
告警
人工处理
重新驱动
问题排查
```

完整流程：

``` text
消息 / Task
↓
Worker
↓
失败
↓
Retry #1
↓
Retry #2
↓
...
↓
超过 max_retry
↓
DLQ / failed
```

------------------------------------------------------------------------

# 65. DB + MQ 面试回答模板

## 问：DB 成功但 MQ 失败怎么办？

可以回答：

> 使用 Transactional Outbox。业务数据和 Outbox Event
> 在同一个本地数据库事务中提交，后台 Publisher 异步扫描 Outbox 并发送
> MQ。Publisher 发送过程允许重试，因此消息可能重复，所以消费者需要通过
> event_id、唯一键或 Inbox/processed_event 实现幂等消费。

## 问：MQ 重复消费怎么办？

可以回答：

> 我会按 At-Least-Once 来设计消费者，每条消息带唯一
> event_id，消费者通过唯一键或 Inbox
> 表判断是否处理过，并且尽量把"消费去重记录"和"实际业务修改"放在同一个本地数据库事务中，避免业务已经成功但消费记录没落库导致再次重复执行。

------------------------------------------------------------------------

# 66. 从 Outbox 进入可靠 Agent Worker

完成 DB + MQ 一致性之后，下一层问题变成：

``` text
Agent Task 已经被 Worker 拿到
↓
Worker 执行 2 分钟
↓
Worker 中途崩溃怎么办？
```

如果任务只有：

``` text
status = running
```

Worker 崩溃后任务会永久卡在 running。

因此需要：

``` text
Lease
Heartbeat
Timeout
Retry
Idempotency
Fencing Token
```

------------------------------------------------------------------------

# 67. 为什么 Agent 长任务不能一直持有数据库锁？

错误方案：

``` text
BEGIN
↓
SELECT task FOR UPDATE
↓
调用 LLM
↓
调用 Tool
↓
执行 5 分钟
↓
UPDATE result
↓
COMMIT
```

这意味着：

``` text
数据库锁可能持有 5 分钟
```

会严重影响并发能力。

正确思路：

``` text
短事务
↓
Claim Task
↓
COMMIT

----------------

事务外执行 Agent / LLM / Tool

----------------

短事务
↓
写入结果
↓
COMMIT
```

因此：

> **数据库事务只保护短时间的状态竞争，不负责保护整个长时间 Agent
> 执行过程。**

------------------------------------------------------------------------

# 68. Lease：临时执行权

Agent Task 表可以增加：

``` text
id
status
worker_id
lease_until
retry_count
next_retry_at
execution_version
result
error_message
```

例如：

``` text
id            100
status        running
worker_id     worker-A
lease_until   10:30:00
retry_count   0
```

含义：

> task 100 当前由 worker-A 执行，但只拥有到 10:30 的执行权。

如果：

``` text
NOW() > lease_until
```

可以认为执行权已经过期，允许其他 Worker 接管。

这就是：

> **Lease**

------------------------------------------------------------------------

# 69. Claim Task：抢任务仍然使用 CAS

简单状态抢占：

``` sql
UPDATE agent_task
SET status = 'running',
    worker_id = ?
WHERE id = ?
  AND status = 'pending';
```

判断：

``` text
affected_rows = 1
→ Claim 成功

affected_rows = 0
→ 已被其他 Worker 抢走
```

如果允许重新接管过期任务，可以把条件扩展成：

``` sql
UPDATE agent_task
SET
  status = 'running',
  worker_id = ?,
  lease_until = ?
WHERE id = ?
  AND (
    status = 'pending'
    OR (
      status = 'running'
      AND lease_until < NOW()
    )
  );
```

这样：

``` text
Worker A 崩溃
↓
Lease 过期
↓
Worker B 可以重新 Claim
```

------------------------------------------------------------------------

# 70. Heartbeat：执行中的 Worker 如何续租？

如果 Agent 执行需要：

``` text
10 分钟
```

而 Lease 只有：

``` text
30 秒
```

正常 Worker 还没完成，Lease 就会过期。

因此需要：

> **Heartbeat**

Worker 每隔一段时间续租：

``` sql
UPDATE agent_task
SET lease_until = NOW() + INTERVAL 30 SECOND
WHERE id = ?
  AND worker_id = ?
  AND status = 'running';
```

例如：

``` text
10:00:00 lease → 10:00:30

10:00:10 heartbeat
↓
lease → 10:00:40

10:00:20 heartbeat
↓
lease → 10:00:50
```

只要 Worker 正常运行：

``` text
Lease 持续延长
```

如果 Worker 崩溃：

``` text
Heartbeat 停止
↓
Lease 到期
↓
其他 Worker 接管
```

------------------------------------------------------------------------

# 71. Stale Worker / Split Brain 问题

可能出现：

``` text
Worker A 因网络抖动暂时失联
↓
Lease 过期
↓
Worker B 接管任务
↓
Worker A 又恢复
```

此时：

``` text
Worker A
Worker B
```

可能同时在执行。

因此旧 Worker 不能无条件提交结果。

------------------------------------------------------------------------

# 72. 提交结果时也要 CAS

Worker A 完成任务：

``` sql
UPDATE agent_task
SET
  status = 'completed',
  result = ?
WHERE id = 100
  AND worker_id = 'worker-A'
  AND status = 'running';
```

如果任务已经被 Worker B 接管：

``` text
worker_id = worker-B
```

那么 Worker A：

``` text
affected_rows = 0
```

旧 Worker 无法覆盖新 Worker 的执行状态。

因此必须记：

> **Claim 时需要 CAS，提交结果时同样需要验证执行权。**

------------------------------------------------------------------------

# 73. Fencing Token / execution_version

比单纯 worker_id 更稳的方式之一，是增加递增的：

``` text
execution_version
```

例如：

``` text
Worker A 首次 Claim
execution_version = 1
```

Lease 过期后 Worker B 接管：

``` text
execution_version = 2
```

Worker A 恢复后仍携带：

``` text
version = 1
```

写结果：

``` sql
UPDATE agent_task
SET status = 'completed'
WHERE id = 100
  AND execution_version = 1;
```

数据库当前已经：

``` text
execution_version = 2
```

所以更新失败。

这种递增执行令牌可以理解成：

> **Fencing Token**

作用：

> **拒绝已经失效的旧执行者继续污染新状态。**

------------------------------------------------------------------------

# 74. Agent Task Retry

Agent 执行失败后不能一概立即永久失败。

任务表可维护：

``` text
retry_count
max_retry
next_retry_at
```

可重试失败：

``` text
status = retry_wait
retry_count += 1
next_retry_at = backoff + jitter
```

到时间后重新进入可 Claim 状态。

不可重试失败：

``` text
status = failed
```

超过最大重试次数：

``` text
failed / DLQ
```

------------------------------------------------------------------------

# 75. 为什么重试必然要求副作用幂等？

假设任务是：

``` text
发送邮件
```

Worker A：

``` text
邮件发送成功
```

但是在：

``` text
UPDATE task
SET status='completed'
```

之前崩溃。

Lease 到期后 Worker B 重试：

``` text
再次发送邮件
```

用户会收到两封。

所以：

> **只要系统允许 Retry / Lease
> Recovery，就必须考虑重复执行副作用的问题。**

------------------------------------------------------------------------

# 76. Agent Tool Call 的 operation_id

对于有副作用的 Tool：

``` text
create_order
refund_order
send_email
create_ticket
```

应该尽量携带稳定的：

``` text
operation_id
```

例如：

``` text
operation_id =
task_id + node_id + logical_operation
```

调用：

``` json
{
  "operationId": "task100-refund",
  "orderId": "order888"
}
```

下游建立：

``` text
operation_id UNIQUE
```

如果重复请求到来：

``` text
已经执行过
↓
直接返回第一次执行结果
```

这就是：

> **业务层幂等**

系统即使是：

``` text
At-Least-Once Execution
```

也能尽量做到：

``` text
最终业务副作用只发生一次
```

------------------------------------------------------------------------

# 77. Workflow Node 也需要稳定身份

例如：

``` text
PRD Agent
↓
RFC Agent
↓
Frontend Agent
↓
Backend Agent
↓
Review Agent
```

如果 RFC Agent 已经生成 RFC，但节点状态还没成功写成
completed，就可能重新执行。

因此节点状态建议至少能标识：

``` text
workflow_id
node_id
execution_version
output_version
status
```

恢复时可以判断：

``` text
这个逻辑节点是否已经产生产物？
↓
是否应该复用？
↓
是否真的需要重新执行？
```

而不是无脑重新调用模型。

------------------------------------------------------------------------

# 78. 可靠 Agent Worker 状态机

一个比较完整的状态机：

``` text
                pending
                   │
                 claim
                   ↓
                running
               /       \
        success         temporary error
           ↓                   ↓
       completed           retry_wait
                               │
                         next_retry_at
                               ↓
                            pending

running
   │
lease expired
   ↓
允许重新 claim

permanent error
或超过 max_retry
   ↓
failed / DLQ
```

------------------------------------------------------------------------

# 79. 一个较完整的 Agent Task 表

示例：

``` sql
CREATE TABLE agent_task (
    id BIGINT PRIMARY KEY,

    workflow_id BIGINT,
    node_id VARCHAR(100),

    status VARCHAR(20),

    worker_id VARCHAR(100),

    execution_version BIGINT NOT NULL DEFAULT 0,

    lease_until DATETIME,

    retry_count INT NOT NULL DEFAULT 0,
    max_retry INT NOT NULL DEFAULT 5,
    next_retry_at DATETIME,

    input JSON,
    result JSON,

    error_code VARCHAR(100),
    error_message TEXT,

    created_at DATETIME,
    updated_at DATETIME
);
```

不要求实际项目完全照抄字段。

更重要的是理解每个字段在解决什么问题：

``` text
status
→ 当前任务状态

worker_id
→ 当前谁在执行

lease_until
→ 执行权什么时候过期

execution_version
→ 防止旧 Worker 写回

retry_count
→ 已重试几次

next_retry_at
→ 下次什么时候允许执行

result / error
→ 可观测和恢复
```

------------------------------------------------------------------------

# 80. Agent Worker 完整执行流程

``` text
1. 找候选任务

pending
retry_wait 到期
running 但 lease 已过期


2. CAS Claim

status = running
worker_id = A
execution_version += 1
lease_until = now + 30s


3. 执行期间

Heartbeat
↓
持续续租


4. 调用 LLM / Tool

副作用尽量携带 operation_id
保证幂等


5. 成功

CAS 更新 completed
并校验 worker_id / execution_version


6. 失败

判断 Retryable / Non-Retryable


7. 可重试

retry_count += 1
next_retry_at = backoff + jitter
status = retry_wait


8. 不可重试 / 超过上限

status = failed
或 DLQ
```

------------------------------------------------------------------------

# 81. DB 与 MQ 在 Agent 系统里的职责

可以这样分工：

``` text
MySQL / PostgreSQL
↓
Source of Truth
↓
任务状态
Workflow 状态
Lease
Retry 状态
执行结果
错误信息


MQ
↓
Delivery / Wake-up Mechanism
↓
告诉 Worker：
“有任务可以处理”
```

所以：

> **数据库保存事实状态，MQ 负责异步分发和解耦。**

不要简单把 MQ 当成唯一的任务状态存储。

------------------------------------------------------------------------

# 82. LangGraph 与 Worker 可靠性层的关系

可以理解：

``` text
LangGraph
↓
Workflow 编排层
↓
Graph
State
Checkpoint
Interrupt
Resume


Task Worker / DB / MQ
↓
执行可靠性层
↓
Claim
Lease
Heartbeat
Retry
Idempotency
Fencing
```

LangGraph 解决：

``` text
流程怎么走
状态怎么传
节点怎么恢复
```

可靠 Worker 层解决：

``` text
谁真正执行
Worker 挂了怎么办
任务重复怎么办
外部副作用怎么办
```

两者并不互相替代。

------------------------------------------------------------------------

# 83. Agent Worker 崩溃怎么办？面试回答

可以回答：

> Agent 长任务不能通过一直持有数据库锁来保证执行权。我会通过任务表中的
> status、worker_id、lease_until 建立租约机制，Worker Claim 时用 CAS
> 原子抢占，执行过程中 Heartbeat 续租。Worker 崩溃后 Lease
> 到期，允许其他 Worker 重新 Claim。为了防止旧 Worker
> 恢复后写回旧结果，还会通过 worker_id 或递增的 execution_version /
> fencing token 验证执行权。临时错误通过 Retry + Exponential Backoff +
> Jitter 处理，所有有副作用的 Tool 调用需要尽量支持 operation_id 幂等。

------------------------------------------------------------------------

# 84. 这一阶段必须掌握的核心概念

``` text
Transactional Outbox
→ DB 与“待发送事件”同事务


At-Least-Once
→ 消息可能重复，但尽量不能丢


Idempotency
→ 重复执行不能产生重复副作用


Inbox / processed_event
→ 消费去重


Retry + Backoff + Jitter
→ 处理临时故障


DLQ
→ 持续失败最终可观测


CAS
→ 原子抢任务


Lease
→ 执行权有期限


Heartbeat
→ 正常 Worker 续租


Fencing Token
→ 旧 Worker 不能覆盖新状态


operation_id
→ Tool 副作用幂等
```

------------------------------------------------------------------------

# 85. 当前完整学习链

``` text
事务隔离级别
      ↓
MVCC
      ↓
Undo Log + Read View
      ↓
快照读 / 当前读
      ↓
FOR UPDATE
      ↓
Record / Gap / Next-Key Lock
      ↓
死锁
      ↓
原子 UPDATE / CAS
      ↓
乐观锁 / 悲观锁
      ↓
短事务原则
      ↓
DB + MQ 一致性
      ↓
Transactional Outbox
      ↓
At-Least-Once
      ↓
Inbox / 幂等消费
      ↓
Retry / Backoff / DLQ
      ↓
Agent Task Claim
      ↓
Lease / Heartbeat
      ↓
Fencing Token
      ↓
Tool Idempotency
      ↓
可靠 Agent Worker
```

下一阶段可以继续：

``` text
可靠 Agent Worker
↓
Workflow Checkpoint
↓
Node State
↓
Resume
↓
Human-in-the-loop
↓
生产级 LangGraph / Workspace 编排
```

------------------------------------------------------------------------

# 86. 从可靠 Worker 进入 Durable Agent Workflow

前面的学习已经解决：

``` text
Agent Task
↓
CAS Claim
↓
Lease
↓
Heartbeat
↓
Retry
↓
Fencing Token
↓
Tool Idempotency
↓
可靠 Agent Worker
```

下一层需要解决：

> **整个 Workflow 执行到一半时服务中断，系统应该从哪里继续？**

例如：

``` text
用户需求
↓
PRD Agent
↓
RFC Agent
↓
Frontend Agent
↓
Backend Agent
↓
Review Agent
```

执行状态：

``` text
PRD       completed
RFC       completed
Frontend  completed
Backend   running
Review    pending
```

如果 Backend Agent 执行期间服务宕机，恢复后不应该重新执行整个 Workflow。

因此需要：

> **Checkpoint + Resume**

------------------------------------------------------------------------

# 87. Checkpoint 是什么？

Checkpoint 的本质：

> **持久化 Workflow 当前执行状态，使长生命周期 Workflow
> 可以在中断后恢复。**

例如：

``` json
{
  "workflowId": "wf-100",
  "currentNode": "backend",
  "state": {
    "prdId": "prd-001",
    "rfcId": "rfc-001",
    "frontendResult": "...",
    "backendResult": null
  }
}
```

服务恢复：

``` text
Load Checkpoint
↓
发现：

PRD completed
RFC completed
Frontend completed
Backend 未完成
↓
从 Backend 附近继续
```

而不是：

``` text
PRD
↓
RFC
↓
Frontend
↓
全部重新执行
```

------------------------------------------------------------------------

# 88. 为什么 Agent Workflow 特别需要 Checkpoint？

传统 HTTP 请求可能只有：

``` text
Request
↓
100ms
↓
Response
```

失败后重新请求即可。

但 Agent Workflow 可能：

``` text
PRD Agent        30s
↓
RFC Agent        60s
↓
Frontend Agent   3min
↓
Backend Agent    3min
↓
Review Agent     1min
```

整个流程可能持续：

``` text
几分钟
几十分钟
甚至几小时 / 几天
```

期间还可能：

``` text
等待人工审批
等待外部 API
等待异步任务
等待其他 Agent
```

因此不能假设：

> **整个 Workflow 一定会在同一个进程生命周期中一次执行到底。**

Checkpoint 是 Durable Workflow 的基础能力。

------------------------------------------------------------------------

# 89. Checkpoint 需要保存什么？

至少需要区分三类信息。

## 89.1 Workflow State

例如：

``` json
{
  "requirement": "...",
  "prdId": "prd-001",
  "rfcId": "rfc-001",
  "repo": "xxx",
  "branch": "feature/xxx"
}
```

它回答：

> **后续节点继续运行需要哪些上下文？**

------------------------------------------------------------------------

## 89.2 Node State

例如：

``` text
node_id = backend_agent
status = running
attempt = 2
started_at = ...
completed_at = null
```

它回答：

> **每个节点当前执行到什么状态？**

------------------------------------------------------------------------

## 89.3 Execution Metadata

例如：

``` text
workflow_id
execution_id
checkpoint_version
execution_version
```

主要用于：

``` text
恢复
并发控制
执行追踪
防止旧执行覆盖新执行
```

------------------------------------------------------------------------

# 90. Node 状态机

Agent Node 不应该只理解成一个函数调用。

更适合把它理解成一个小状态机：

``` text
              pending
                 │
              execute
                 ↓
              running
              /     \
             ↓       ↓
       completed    failed
                       │
                     retry
                       ↓
                    running
```

如果支持人工介入：

``` text
running
↓
waiting_human
↓
running
```

如果等待外部系统：

``` text
running
↓
waiting_external
↓
running
```

实际系统可能包含：

``` text
pending
running
completed
failed
retry_wait
waiting_human
waiting_external
cancelled
```

不要求所有项目都实现全部状态。

核心是：

> **Workflow Node 要有明确状态机，而不是只靠内存里的函数调用关系。**

------------------------------------------------------------------------

# 91. Checkpoint 并不能自动解决副作用重复

假设 Backend Agent：

``` text
1. 修改 Git 仓库代码
2. UPDATE node status = completed
```

执行过程：

``` text
Git 修改成功
↓
服务崩溃
↓
completed 没写入数据库
```

数据库仍然：

``` text
backend node = running
```

恢复以后系统可能认为：

``` text
Backend 没执行完
```

于是再次执行：

``` text
Backend Agent
↓
再次修改代码
```

因此：

> **Checkpoint ≠ Idempotency。**

Checkpoint 只能告诉系统：

``` text
最后可靠记录到哪里
```

但如果：

``` text
外部副作用成功
↓
Checkpoint 更新失败
```

仍然存在重复执行窗口。

------------------------------------------------------------------------

# 92. Node 必须尽量设计成幂等

例如：

``` text
generate_rfc
```

不要每次恢复都：

``` text
INSERT 一个新的 RFC
```

可以为逻辑节点建立稳定身份：

``` text
workflow_id
+
node_id
+
logical_execution_id
```

例如：

``` text
artifact_key = wf-100:rfc
```

第一次：

``` text
生成 RFC
↓
保存 artifact_key = wf-100:rfc
```

恢复后：

``` text
查询 artifact_key
↓
发现产物已经存在
↓
复用已有结果
```

而不是重新生成。

这就是：

> **Idempotent Node**

------------------------------------------------------------------------

# 93. execution_key 与 operation_id 是同一个思想

上一阶段 Tool Call 使用：

``` text
operation_id
```

例如：

``` text
task100-refund
```

Workflow Node 可以使用：

``` text
execution_key
```

例如：

``` text
wf100-rfc
```

它们本质都是：

``` text
一个逻辑动作
↓
拥有稳定唯一身份
↓
重复请求 / Retry / Resume
↓
识别是否已经执行
```

因此一个非常重要的 Agent 工程原则：

> **任何可能 Retry / Resume 的动作，都必须考虑重复执行是否安全。**

------------------------------------------------------------------------

# 94. Workflow Resume 如何工作？

假设：

``` text
PRD        completed
RFC        completed
Frontend   completed
Backend    running
Review     pending
```

系统恢复：

``` text
Load Checkpoint
↓
加载 Workflow State
↓
加载 Node State
```

发现：

``` text
Backend = running
```

但它原来的 Worker：

``` text
Lease 已过期
```

因此：

``` text
running
+
lease expired
↓
上一次执行权失效
```

然后：

``` text
检查 Backend execution_key / artifact
```

如果：

``` text
产物实际上已经存在
```

则：

``` text
恢复已有结果
↓
修正 Node State
↓
completed
```

如果：

``` text
产物不存在
```

则：

``` text
重新 Claim
↓
重新执行 Backend Node
```

完整恢复：

``` text
Load Checkpoint
       ↓
找到未完成 Node
       ↓
检查 Lease / Execution
       ↓
检查副作用 / Artifact
       ↓
┌──────┴──────┐
↓             ↓
已完成        未完成
↓             ↓
恢复结果      重新执行
↓             ↓
└──────┬──────┘
       ↓
继续 Workflow
```

------------------------------------------------------------------------

# 95. Checkpoint 什么时候保存？

最简单和常见的方式：

> **在 Node 边界保存 Checkpoint。**

例如：

``` text
PRD Agent
↓
completed
↓
Checkpoint
↓
RFC Agent
```

然后：

``` text
RFC Agent
↓
completed
↓
Checkpoint
↓
Frontend Agent
```

这样每个重要节点成功后，都有一个可靠恢复点。

------------------------------------------------------------------------

# 96. 长 Node 内部如何 Checkpoint？

例如 Backend Agent：

``` text
读取代码
↓
生成方案
↓
修改文件
↓
运行测试
↓
修复
↓
提交
```

整个 Node 可能执行 10 分钟。

如果只在 Node 最后 Checkpoint：

``` text
第 9 分钟服务挂掉
```

可能需要重新执行整个 Backend Node。

有两种主要设计。

## 方案 A：接受 Node 重跑

适合：

``` text
Node 足够幂等
+
重跑成本可以接受
```

优点：

``` text
架构简单
```

通常应该优先考虑。

## 方案 B：拆成更小的 Node

例如：

``` text
Analyze Code
↓
Checkpoint

Generate Patch
↓
Checkpoint

Run Tests
↓
Checkpoint

Fix
↓
Checkpoint
```

恢复粒度更细。

但代价：

``` text
Workflow 状态更多
编排更复杂
维护成本更高
```

所以原则：

> **Checkpoint 粒度是在恢复成本和系统复杂度之间取平衡。**

不要为了"绝不重跑一步"把 Workflow 无限拆碎。

------------------------------------------------------------------------

# 97. Human-in-the-loop 为什么依赖 Checkpoint？

例如：

``` text
PRD Agent
↓
生成 PRD
↓
等待产品经理确认
```

错误方式是：

``` text
Worker 一直运行
↓
等待用户几小时
```

正确方式：

``` text
PRD Agent
↓
生成结果
↓
Checkpoint
↓
status = waiting_human
↓
释放 Worker
```

Workflow 可以暂停：

``` text
10 分钟
1 小时
1 天
```

用户点击：

``` text
Approve
```

系统收到事件：

``` text
Human Event
↓
Load Checkpoint
↓
更新 Workflow State
↓
Resume
↓
继续 RFC Agent
```

这就是：

> **Durable Human-in-the-loop**

------------------------------------------------------------------------

# 98. Workspace 中的 Human-in-the-loop

例如 Workspace：

``` text
需求创建
↓
Product Agent
↓
PRD
↓
Human Review
↓
Full-stack Agent
↓
Code
↓
Test Agent
↓
Human Review
↓
Merge
```

可以设计：

``` text
Product Agent
↓
Checkpoint
↓
waiting_human
↓
产品确认
↓
Resume
↓
Full-stack Agent
↓
Checkpoint
↓
Test Agent
```

这样 Workflow 生命周期可以跨：

``` text
分钟
小时
甚至几天
```

而不需要一直占用一个 Worker 或进程。

------------------------------------------------------------------------

# 99. Checkpoint 应该放 Redis 吗？

如果 Checkpoint 是：

> **Workflow 恢复所依赖的事实状态**

通常不应该只存在 Redis。

Redis 更适合：

``` text
Cache
临时状态
Lease
分布式协调
高性能读取
```

而 Workflow Checkpoint 需要：

``` text
可靠持久化
恢复
审计
长期保存
```

因此通常更适合：

``` text
PostgreSQL / MySQL
```

作为 Source of Truth。

可以：

``` text
PostgreSQL / MySQL
↓
Workflow State
Checkpoint
Node State

Redis
↓
Cache
Lease
Coordination
```

仍然符合之前的原则：

> **DB 保存事实，Redis 负责性能和协调。**

------------------------------------------------------------------------

# 100. Workflow Runtime、Business Artifact、Knowledge 要分开

Workspace 中至少存在三类完全不同的数据。

## 100.1 Workflow Runtime State

例如：

``` text
Checkpoint
Node Status
Retry
Lease
Execution
Human Interrupt
```

解决：

``` text
流程现在运行到哪里？
```

------------------------------------------------------------------------

## 100.2 Business Artifact

例如：

``` text
PRD
Summary
生成代码
测试结果
业务文档
```

解决：

``` text
这个迭代真正产出了什么？
```

------------------------------------------------------------------------

## 100.3 Knowledge

例如：

``` text
归档 PRD
Summary
Embedding
Vector DB
```

解决：

``` text
未来 Agent 如何检索历史知识？
```

三者不要混在一起。

尤其：

> **Vector DB 不是 Workflow Checkpoint Store。**

------------------------------------------------------------------------

# 101. LangGraph Checkpoint 需要掌握到什么程度？

针对 AI Application / Agent 工程方向：

## 必须掌握

``` text
State
Checkpoint
Execution / Thread Identity
Node
Interrupt
Resume
```

并且能够回答：

``` text
为什么长 Workflow 需要持久化？
为什么不能失败后全部从头执行？
为什么 Node 需要幂等？
Human-in-the-loop 为什么需要持久化暂停？
Worker 崩溃与 Workflow Resume 是什么关系？
```

## 理解即可

``` text
LangGraph Checkpointer 的基本使用方式
Checkpoint Store 的可替换性
Thread / Run 的基本关系
```

## 暂时不用深挖

``` text
LangGraph Checkpointer 源码
内部序列化实现
底层调度源码
```

对于当前目标：

> **系统设计能力比背 LangGraph API 更重要。**

------------------------------------------------------------------------

# 102. Worker Recovery 与 Workflow Resume 不要混淆

这是非常重要的分层。

## Worker Recovery

解决：

``` text
某个 Task 正在执行
↓
Worker 挂了
↓
谁接手？
```

核心机制：

``` text
Lease
Heartbeat
Retry
Fencing Token
Idempotency
```

------------------------------------------------------------------------

## Workflow Resume

解决：

``` text
整个流程执行了一半
↓
服务中断 / 等待人工
↓
从哪个 Node 继续？
```

核心机制：

``` text
Checkpoint
Workflow State
Node State
Resume
Interrupt
```

所以：

``` text
            Production Agent

                  │
       ┌──────────┴──────────┐
       ↓                     ↓

 Worker Reliability     Workflow Durability

       ↓                     ↓

 Lease                  Checkpoint
 Heartbeat              State
 Retry                  Resume
 Fencing                Interrupt
 Idempotency            Human-in-loop
```

这两个层次不能混成一个概念。

------------------------------------------------------------------------

# 103. Durable Agent Workflow 完整架构

现在整个系统可以理解为：

``` text
                    API / User
                        │
                        ↓
                Workflow Engine
                   LangGraph
                        │
            ┌───────────┼───────────┐
            ↓           ↓           ↓
        Node State   Checkpoint    HITL
            │
            ↓
               Task Scheduler
                    │
                    ↓
                    MQ
                    │
          ┌─────────┼─────────┐
          ↓         ↓         ↓
       Worker A  Worker B  Worker C
          │
          ↓
     Lease / Heartbeat
     Retry / Fencing
     Idempotency
          │
          ↓
       LLM / Tools
          │
          ↓
     PostgreSQL / MySQL
          │
     Source of Truth
```

旁边还可以存在：

``` text
Redis
↓
Cache / Coordination / Lease


Vector DB
↓
RAG Knowledge


Git / Object Storage
↓
Code / Large Artifact
```

这样：

``` text
MySQL
Redis
MQ
LangGraph
Agent
RAG
```

不再是几个独立技术点，而是一套完整系统中的不同层。

------------------------------------------------------------------------

# 104. Checkpoint / Resume 面试回答

如果面试官问：

> Agent Workflow 执行到一半服务挂了怎么办？

可以回答：

> 对于长生命周期 Agent Workflow，我不会依赖进程内状态，而是持久化
> Workflow State 和 Node State，通过 Checkpoint
> 记录可靠执行点。服务恢复后加载 Checkpoint，找到未完成节点，并结合 Task
> Lease 判断上一次 Worker
> 是否已经失效。对于可能重复执行的节点，还需要通过稳定的 execution
> key、artifact key 或 Tool operation_id
> 做幂等，避免外部副作用已经成功但 Checkpoint
> 尚未更新时重复执行。如果流程需要人工审批，则在节点完成后持久化
> Checkpoint，将 Workflow 置为 waiting_human 并释放
> Worker，收到人工事件后再 Resume。

------------------------------------------------------------------------

# 105. 这一站必须记住的六句话

## 1. Checkpoint 的本质

> **持久化 Workflow 执行状态，使长流程能够断点恢复。**

## 2. Checkpoint 不等于幂等

> **外部副作用成功但 Checkpoint 写入失败时，仍然可能发生重复执行。**

## 3. 可重试 Node 必须考虑幂等

> **一个逻辑 Node / Tool Operation 最好拥有稳定 execution key /
> operation_id。**

## 4. Worker Recovery 与 Workflow Resume 是两层问题

> **Worker 用 Lease / Heartbeat / Retry；Workflow 用 State / Checkpoint
> / Resume。**

## 5. Human-in-the-loop 不应该一直占 Worker

> **Checkpoint → waiting_human → 释放 Worker → Human Event → Resume。**

## 6. DB 是 Runtime State 的 Source of Truth

> **Redis 可以辅助缓存与协调，但可靠 Workflow Checkpoint 应持久化。**

------------------------------------------------------------------------

# 106. 当前完整学习链

``` text
事务隔离级别
↓
MVCC
↓
Undo Log + Read View
↓
快照读 / 当前读
↓
SELECT ... FOR UPDATE
↓
Record / Gap / Next-Key Lock
↓
死锁
↓
原子 UPDATE / CAS
↓
乐观锁 / 悲观锁
↓
短事务原则
↓
DB + MQ 一致性
↓
Transactional Outbox
↓
At-Least-Once
↓
Inbox / 幂等消费
↓
Retry / Backoff / DLQ
↓
Agent Task Claim
↓
Lease / Heartbeat
↓
Fencing Token
↓
Tool Idempotency
↓
可靠 Agent Worker
↓
Workflow State
↓
Checkpoint
↓
Idempotent Node
↓
Resume
↓
Human-in-the-loop
↓
Durable Agent Workflow
```

下一阶段可以继续进入：

``` text
Durable Agent Workflow
↓
并发编排
↓
Fan-out / Fan-in
↓
Join
↓
部分成功 / 部分失败
↓
多 Agent 并行执行
```
