# 算法题 01：手写快速排序的 partition 函数并分析复杂度

## 1. 题目要求

给定一个数组 `nums` 和待处理区间 `[left, right]`，请手写快速排序的 `partition` 函数。

`partition` 执行完成后，需要返回基准值 `pivot` 的最终下标，并满足：

- 基准值已经位于它在当前区间中的最终位置。
- 基准值左边的元素都小于或等于它。
- 基准值右边的元素都大于它。

> 这道题最重要的不是背代码，而是能说清楚：`i` 和 `j` 分别表示什么，交换后什么性质始终不变。

## 2. 先理解 partition 在做什么

本页使用 **Lomuto partition**，把区间最右边的元素作为基准值：

``` text
[ 待处理区间............................ ]
  left                                  right
                                          ↑
                                        pivot
```

扫描过程中，数组被逻辑上分成四段：

``` text
[≤ pivot 的区间][> pivot 的区间][还未检查][pivot]
 left          i          j             right
```

- `j` 是扫描指针，从 `left` 走到 `right - 1`。
- `i` 是“小于等于 pivot 区间”的右边界。
- 当 `nums[j] <= pivot` 时，把它交换到 `i` 所在位置，然后让 `i` 右移。
- 扫描结束后，把 `pivot` 与 `nums[i]` 交换，`i` 就是基准值的最终下标。

### 循环不变量

在每一轮扫描开始时，始终保证：

- `[left, i - 1]` 中的元素都 `<= pivot`。
- `[i, j - 1]` 中的元素都 `> pivot`。
- `[j, right - 1]` 还没有被检查。
- `nums[right]` 始终是本轮的 `pivot`。

能把这四句说出来，基本就真正理解了这段代码。

## 3. Python 解法

### partition 函数

``` python
def partition(nums: list[int], left: int, right: int) -> int:
    """
    使用 nums[right] 作为 pivot，就地完成分区。
    返回 pivot 的最终下标。
    """
    pivot = nums[right]
    i = left

    for j in range(left, right):
        if nums[j] <= pivot:
            nums[i], nums[j] = nums[j], nums[i]
            i += 1

    nums[i], nums[right] = nums[right], nums[i]
    return i
```

### 配合完整快速排序

``` python
def quick_sort(nums: list[int], left: int, right: int) -> None:
    if left >= right:
        return

    pivot_index = partition(nums, left, right)
    quick_sort(nums, left, pivot_index - 1)
    quick_sort(nums, pivot_index + 1, right)


nums = [4, 2, 7, 3, 1, 6]
quick_sort(nums, 0, len(nums) - 1)
print(nums)  # [1, 2, 3, 4, 6, 7]
```

### Python 版逐行理解

- `pivot = nums[right]`：保存基准值，扫描时不动它。
- `i = left`：初始时“小于等于区间”是空的，`i` 指向该区间下一个可写位置。
- `range(left, right)`：只扫描到 `right - 1`，不要把 pivot 自己也扫进去。
- `nums[j] <= pivot`：找到一个应该放在 pivot 左边的值。
- `nums[i], nums[j] = ...`：把这个值放入左区间。`i == j` 时只是自交换，不影响正确性。
- `i += 1`：左区间扩大一格。
- 最后一次交换：把 pivot 放在两个分区之间。

## 4. JavaScript 解法

### partition 函数

``` javascript
function partition(nums, left, right) {
  const pivot = nums[right];
  let i = left;

  for (let j = left; j < right; j += 1) {
    if (nums[j] <= pivot) {
      [nums[i], nums[j]] = [nums[j], nums[i]];
      i += 1;
    }
  }

  [nums[i], nums[right]] = [nums[right], nums[i]];
  return i;
}
```

### 配合完整快速排序

``` javascript
function quickSort(nums, left = 0, right = nums.length - 1) {
  if (left >= right) {
    return nums;
  }

  const pivotIndex = partition(nums, left, right);
  quickSort(nums, left, pivotIndex - 1);
  quickSort(nums, pivotIndex + 1, right);
  return nums;
}

const nums = [4, 2, 7, 3, 1, 6];
console.log(quickSort(nums)); // [1, 2, 3, 4, 6, 7]
```

### Python 和 JavaScript 写法对照

  含义          Python                         JavaScript
  ------------- ------------------------------ ------------------------------
  遍历区间      `range(left, right)`           `j < right`
  交换元素      `a[i], a[j] = a[j], a[i]`      `[a[i], a[j]] = [a[j], a[i]]`
  数组长度      `len(nums)`                    `nums.length`
  默认参数      通常由调用处传入              `left = 0`

两个版本的算法和指针含义完全一致，只是语言语法不同。

## 5. 手动跑一遍

以 `[4, 2, 7, 3, 1, 6]` 为例，`pivot = 6`。

  j   nums[j]   与 pivot 的关系   操作                  操作后数组            i
  --- --------- ----------------- --------------------- --------------------- ---
  0   4         `4 <= 6`          交换 `nums[0]` 和自身  `[4, 2, 7, 3, 1, 6]`  1
  1   2         `2 <= 6`          交换 `nums[1]` 和自身  `[4, 2, 7, 3, 1, 6]`  2
  2   7         `7 > 6`           不交换                `[4, 2, 7, 3, 1, 6]`  2
  3   3         `3 <= 6`          交换下标 `2` 和 `3`   `[4, 2, 3, 7, 1, 6]`  3
  4   1         `1 <= 6`          交换下标 `3` 和 `4`   `[4, 2, 3, 1, 7, 6]`  4

扫描结束后，交换 `nums[4]` 和 `nums[5]`：

``` text
[4, 2, 3, 1, 6, 7]
             ↑
       pivot 最终下标为 4
```

此时只能说 **pivot 6 已经就位**，左侧 `[4, 2, 3, 1]` 并没有完全有序。快速排序还需要递归处理左右两个子区间。

## 6. 复杂度分析

### 单次 partition

设当前区间长度为 `n`。

- **时间复杂度：O(n)**。`j` 对区间中除 pivot 外的元素扫描一次。
- **额外空间复杂度：O(1)**。只使用了 `pivot`、`i`、`j` 等常数个变量，交换在原数组上完成。

> 面试时要区分“单次 partition 的复杂度”和“完整快速排序的复杂度”。前者始终是 O(n)，后者还取决于每次分区是否均衡。

### 完整快速排序

  情况       时间复杂度   原因
  ---------- -------------- ------------------------------------
  最好情况   O(n log n)     每次 pivot 都把数组大致分成两半
  平均情况   O(n log n)     递归树平均高度是 O(log n)
  最坏情况   O(n²)          每次只少一个元素，递归树退化成链

使用最右元素作为 pivot 时，已经有序或逆序的数组很容易触发最坏情况。例如 `[1, 2, 3, 4, 5]`，每轮选到的 pivot 都是当前最大值。

### 递归栈空间

- 分区均衡时，递归深度是 O(log n)，因此栈空间是 **O(log n)**。
- 分区极度不均衡时，递归深度是 O(n)，因此栈空间是 **O(n)**。

`partition` 本身是原地算法，但递归版快排不能简单说成整体空间 O(1)，因为还要计算递归调用栈。

## 7. 常见错误与边界情况

### 常见错误

- 把循环写成扫描到 `right`，导致 pivot 本身提前参与分区。
- 遇到小元素后只交换，忘记执行 `i += 1`。
- 扫描完忘记把 pivot 交换到 `i` 的位置。
- 递归时再次包含 `pivot_index`，导致区间无法缩小。
- 忘记 `left >= right` 这个递归终止条件。
- 误以为 partition 执行一次后，左右两侧已经各自有序。

### 应该自测的输入

``` text
[]                 空数组，不应调用 partition
[1]                只有一个元素，快排直接返回
[1, 2, 3, 4]       已经升序
[4, 3, 2, 1]       完全逆序
[2, 2, 2, 2]       全是重复值
[3, -1, 0, -1, 2]  包含负数和重复值
```

本页的 `quick_sort` / `quickSort` 在空数组上会得到 `left = 0`、`right = -1`，立即命中 `left >= right`，因此不会调用 `partition`。

## 8. 面试时的标准表达

> 我使用 Lomuto 分区。先选取区间最右元素作为 pivot，`i` 指向小于等于 pivot 区间的下一个位置，`j` 负责扫描。遇到小于等于 pivot 的值，就交换到 `i` 位置并右移 `i`。扫描结束后把 pivot 与 `nums[i]` 交换，并返回 `i`。单次 partition 只扫描一遍，时间是 O(n)，额外空间是 O(1)。完整快排平均时间是 O(n log n)，最坏是 O(n²)；递归栈平均 O(log n)，最坏 O(n)。

### 进阶追问：如何降低最坏情况出现的概率？

可以在 `[left, right]` 中随机选择一个下标，先把该元素与 `nums[right]` 交换，再执行原有 partition。这不会改变最坏时间复杂度 O(n²)，但可以降低固定特殊输入持续产生极度不均衡分区的概率。

``` python
import random


def randomized_partition(nums: list[int], left: int, right: int) -> int:
    random_index = random.randint(left, right)
    nums[random_index], nums[right] = nums[right], nums[random_index]
    return partition(nums, left, right)
```

``` javascript
function randomizedPartition(nums, left, right) {
  const randomIndex = left + Math.floor(Math.random() * (right - left + 1));
  [nums[randomIndex], nums[right]] = [nums[right], nums[randomIndex]];
  return partition(nums, left, right);
}
```
