# 外部 AI 记忆导入

StrataGate 提供 `importExternalMemory()` 编排外部记忆迁移：

```text
外部 AI JSON
    ↓ extractor（候选 Event）
每个候选 Event → searchEvents()（确定性 BM25，Top-K）
    ↓ decider（ADD / MERGE / SUPERSEDE / CONFLICT / IGNORE）
写入新的规范 Event，保留来源和 supersedes/conflicts 关系
    ↓
只为新 Event 创建元素/知识图谱投影任务
```

## 最小接入

```ts
import {
  EXTERNAL_MEMORY_EXPORT_PROMPT_ZH_CN,
  StrataGate,
  externalMemoryJsonExtractor,
} from '@diqier/stratagate';

// 把 EXTERNAL_MEMORY_EXPORT_PROMPT_ZH_CN 交给外部 AI，并把它返回的 JSON 放入 text。
const result = await memory.importExternalMemory({
  text,
  extractor: externalMemoryJsonExtractor,
  topK: 5,
  decider: async ({ candidate, matches }) => {
    // 这里通常调用你的 LLM；它只能从 matches 中选择 existingEventIds。
    // 返回的 MERGE/SUPERSEDE 会创建新 Event，不会覆盖旧 Event。
    return {
      action: matches.length === 0 ? 'ADD' : 'MERGE',
      existingEventIds: matches.slice(0, 1).map(({ event }) => event.id),
      mergedCandidate: candidate,
    };
  },
});
```

`decider` 的 `matches` 已经被限制为 `topK` 条；即使模型返回其它事件 ID，库也会丢弃这些越界引用。`IGNORE` 只留下审计记录，不会写入 Event。`CONFLICT` 会在新旧事件两侧建立对称的 `conflictsWithEventIds`。

## 给外部 AI 的提示词

直接使用导出的 `EXTERNAL_MEMORY_EXPORT_PROMPT_ZH_CN`。它要求外部 AI 只输出 `stratagate.external-memory.v2` JSON，并区分 `memoryKind`（instruction/preference/fact/event）与 `category`，同时特别约束时间：

- `mentionedAt`（被提及时间）与 `happenedStart/happenedEnd`（实际发生/计划时间）分开；
- 没有明确时间或可靠参照时，不填写日期，不把当前时间、导出时间或聊天顺序当作事件时间；
- 保留 `originalText`，用 `precision` 和 `basis` 标记粒度与依据；
- “上周”等相对时间只有在能依据已知消息时间唯一换算时才转换，否则保持 `unknown`。

如果外部 AI 仍然返回 Markdown 代码块，`parseExternalMemoryExport()` 会自动去除围栏；其它非 JSON 文本会被拒绝，避免把模型解释误写进记忆。

用于第二阶段裁决的系统提示词可使用 `EXTERNAL_MEMORY_DECIDER_PROMPT_ZH_CN`。它明确规定了五种写入动作的边界，并要求模型只能引用本次 Top-K 结果中的事件 ID。

## 导出常量、格式与解析器

| 入口 | 用途 |
| --- | --- |
| `EXTERNAL_MEMORY_EXPORT_PROMPT_ZH_CN` | 交给外部 AI，要求生成 `stratagate.external-memory.v2` JSON |
| `parseExternalMemoryExport()` | 严格解析导出内容，允许去除 Markdown 代码围栏 |
| `externalMemoryJsonExtractor` | 将严格 JSON 解析包装为可直接传给核心导入 API 的 extractor |
| `EXTERNAL_MEMORY_DECIDER_PROMPT_ZH_CN` | 指导裁决模型从 ADD、MERGE、SUPERSEDE、CONFLICT、IGNORE 中选择动作 |

v2 将记忆性质 `memoryKind` 与内容分类 `category` 分开。决定如何导入时，应同时保留原始说法、来源和时间依据；未知日期不应由导出日期补齐。最小接入示例中的 `memory` 是已经打开的 StrataGate 实例，`text` 是外部 AI 返回的内容。

示例里的“有匹配就 MERGE”只展示回调结构，不应直接作为实际裁决策略。检索相关不代表两条记忆属于同一件事；实际接入应结合候选内容和匹配结果决定动作。

## DSH 界面：预览、恢复与确认

DSH 管理界面使用可持久化的导入任务，而不是只调用一次严格解析器：

1. **创建任务并解析。** 保存导入文本，尝试解析候选记忆。合法 JSON 进入逐条处理；解析失败的任务进入 `extracting` 状态，由运行时调用模型尝试恢复候选。
2. **逐条比较。** 每条候选只与有限数量的本地 Event 比较。核心任务默认 `topK=5`，限制在 1–20；与已有有效记忆或本批次较早候选完全重复的内容会确定性地选择 IGNORE。
3. **生成处理建议。** 模型决定新增、合并、取代、冲突或忽略。引用仅限本次匹配范围；需要既有目标却没有有效目标的建议会降低置信度。
4. **确认与提交。** 正常解析的候选在置信度达到当前阈值 0.85 时无需逐项确认；低置信度项需要确认。由不合格 JSON 恢复出来的候选会强制进入确认流程，不能仅凭高置信度自动放行。

严格的 `parseExternalMemoryExport()` / `externalMemoryJsonExtractor` 本身不会调用模型修复 JSON。模型兜底属于 DSH 运行时的任务编排；恢复不出候选时，任务失败并记录错误。

## 进度保存与失败重试

任务保存原始输入、候选列表、已处理数量、逐条决定及错误信息。关闭后重新打开页面可以继续查看任务，不需要重新粘贴原始内容。持久化使用需要通过 `StrataGate.open()` 打开数据库；内存模式不提供进程退出后的保留保证。

核心任务接口分别处理：

- `createExternalMemoryImportJob()`：创建任务并尝试严格解析。
- `completeExternalMemoryFallback()`：保存运行时模型恢复出的候选。
- `prepareNextExternalMemoryImport()` / `completeNextExternalMemoryImport()`：准备和保存单条裁决；模型调用在事务外执行。
- `retryExternalMemoryImportJob()`：将失败任务恢复到解析恢复或逐条处理阶段，保留已保存进度。

这些接口管理任务状态；自定义接入方仍需驱动模型调用和后续提交。重复提交已经完成的候选索引不会再推进一次进度。

## 来源保留与批次撤销

正常导入把原文保存为来源 Block，新 Event 引用该来源。MERGE / SUPERSEDE 创建新的 Event，并维护旧事件状态和关系，不直接覆盖旧事件正文。只为新写入的 Event 安排后续投影任务。

显式撤销是独立操作：`undoExternalMemoryImport(sourceBlockId)` 会移除该批次导入的 Event，清理相应来源关系与派生数据，并按剩余替代关系恢复受影响的旧事件状态。它不等同于权重衰减，也不能理解为仅隐藏导入结果。DSH 界面提供提交后的批次撤销入口。

实现入口：[核心导入与任务状态](../packages/core/src/store.ts)、[格式与提示词](../packages/core/src/external-memory.ts)、[DSH 运行时](../src/runtime.ts)。
