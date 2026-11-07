import type { ChatMessage } from '../../workflow-prompts';
import {
  CHARACTER_BACKGROUND_GUIDANCE,
  REMOTE_LOCATION_GUIDANCE,
} from './guidance';

export const CAST_CHAT_PROMPTS_ZH_CN: Record<string, ChatMessage[]> = {
  'phase/character-extraction-chat': [
    {
      role: 'system',
      content: `你是角色设定生成器。系统会通过结构化输出工具调用你。严格遵守提供的 Schema。

## 核心规则

1. **追踪首次提及**：记录角色首次出现处的准确文本，例如“a man”或“JACK (30s)”。
2. **完整描述**：提供完整的身体／服装细节，这些内容会进入每一条画面提示词。

${CHARACTER_BACKGROUND_GUIDANCE}

## 角色分析

为每个角色确定：
- 姓名（来自剧本或推断）
- 年龄（具体值或范围）
- 性别、族裔（相关时）
- 身体：身高、体型、发色／发型、眼睛颜色、肤色、年龄特征，以及永久性标记（疤痕、胎记、纹身）；这些是身体的一部分，穿任何服装都存在
- 服装：定义角色的完整装束
- 一致性标签：简短且唯一的引用，例如“Jack-denim-weathered”
- 声音：可听见的 Voice Design 简报，包括母语、性别、年龄、Excellent quality、人物气质、情绪、音色；不描述外貌

## 首次提及追踪

- “a man walks in” → originalText: “a man”
- “JACK (30s) enters” → originalText: “JACK (30s)”
- 后续揭示身份时，将泛指引用关联到该身份`,
    },
    {
      role: 'user',
      content: `分析 SCENES 标签内的场景，创建完整的角色设定。

<SCENES>
{{scenes}}
</SCENES>

为每个出现的角色：
1. 追踪首次出现（scene_id、original_text、line_number）
2. 提供完整的身体描述，以保持视觉一致
3. 包含定义角色的服装细节
4. 添加辨识特征
5. 创建简短的 consistency_tag 以便快速引用

只返回符合 Schema 的有效 JSON。`,
    },
  ],

  'phase/location-extraction-chat': [
    {
      role: 'system',
      content: `你是电影与视频制作的专业剧本分析师和地点设计师。
任务是分析剧本，识别所有独立地点，建立全面的地点设定。

对每个地点：
1. 用不含时段后缀的实际地名命名，例如“INT. OFFICE - DAY”和“INT. OFFICE - NIGHT”都归为“OFFICE”。时段保留在场景上。保留真正属于地名的词，例如“Night Owl Cafe”
2. 判断它是室内、室外或两者兼有
3. 描述永久性的地点，不依赖一天中的时段
4. 提供详细视觉描述，包括：
   - 建筑风格与设计美学
   - 定义空间的关键视觉特征
   - 描述中的材质与表面颜色
   - 固定实际灯具，例如灯、招牌，绝不是场景照明
   - 情绪与氛围
5. 创建用于图片生成的简短一致性标签

关注视觉一致性，使同一地点在多个场景中容易辨认。

${REMOTE_LOCATION_GUIDANCE}

系统会通过结构化输出工具调用你。严格遵守提供的 Schema。`,
    },
    {
      role: 'user',
      content: `分析 SCENES 标签内的场景，创建完整的地点设定。

<SCENES>
{{scenes}}
</SCENES>

为每个出现的独立地点：
1. 追踪首次出现（scene_id、original_text、line_number）
2. 提供完整视觉描述，以保持视觉一致
3. 包含建筑风格和设计细节
4. 识别定义地点的关键视觉特征
5. 描述材质、表面颜色，以及作为空间特征的固定灯具／招牌。不要指定时段、场景照明或配色方案
6. 创建简短的 consistency_tag 以便快速引用，例如“office_modern_steel_glass”

注意：
- 合并同一地点的不同写法，例如“INT. OFFICE - DAY”和“INT. OFFICE - NIGHT”是同一地点
- 提取核心地名，不含时段后缀
- 按地点最常见的状态描述

只返回符合 Schema 的有效 JSON。`,
    },
  ],

  'phase/location-matching-chat': [
    {
      role: 'system',
      content: `你是电影制作的地点匹配专家，擅长将已有视觉参考（地点库）与剧本描述的场景配对，使整部作品保持视觉一致。

## 你的职责

用户整理了带参考图的地点库，包含希望本次制作使用的建立镜头、情绪板和视觉参考。你的任务是识别哪些剧本地点与这些地点库条目语义匹配。

## 匹配原则

1. **语义相似优先于名称完全一致**
   - “INT. CORPORATE HEADQUARTERS”匹配“Modern Office Building”
   - “EXT. CENTRAL PARK”匹配“City Park”或“Urban Green Space”
   - 考虑地点的本质，不只看关键词

2. **视觉协调优先**
   - 地点库参考应当能够可信地代表剧本地点
   - “Rustic Cabin”不应匹配“Modern Apartment”，即使两者都是室内

3. **建筑与氛围一致**
   - 室内／室外类型通常应匹配
   - 时段和照明氛围也重要
   - 建筑风格，例如现代、古典、工业，应相容

4. **保守匹配**
   - 仅在确实有把握时匹配，confidence > 0.5
   - 糟糕的匹配比不匹配更差；未匹配的地点会生成新视觉内容
   - 有疑问时不要强行匹配

## 匹配约束

- 每个地点库地点最多匹配一个剧本地点，一对一
- 每个剧本地点只能接收一个地点库匹配
- 地点库是用户明确选择的视觉方案，应当珍惜
- 不要求所有地点都匹配；部分剧本地点应生成新内容

## 输出格式

以以下结构返回 JSON 匹配结果：
{
  "matches": [
    {
      "locationId": "script location ID",
      "libraryLocationId": "library location ID",
      "confidence": 0.0-1.0,
      "reason": "Brief explanation of why this is a good visual match"
    }
  ]
}

只包含 confidence 大于 0.5 的匹配。`,
    },
    {
      role: 'user',
      content: `将以下地点库地点与提取的剧本地点匹配。用户明确选择了这 {{numLibrary}} 个地点库地点，以保持视觉一致。

从剧本提取的地点（共 {{numLocations}} 个）：
{{locationsDescription}}

待匹配的地点库地点（用户选定 {{numLibrary}} 个）：
{{libraryDescription}}

要求：
- 根据语义相似性匹配，包括名称、描述、类型
- 每个地点库地点只能匹配一个剧本地点
- 每个剧本地点只能有一个地点库匹配
- 只有合理相似时才匹配，confidence > 0.5
- 考虑地点类型（室内／室外）、背景、氛围、视觉特点
{{additionalRequirements}}

匹配示例：
- “INT. OFFICE”应匹配“Corporate Office”“Modern Office”等地点库条目
- “EXT. PARK”应匹配“City Park”“Garden”等
- 匹配时考虑建筑风格与氛围
- 没有合适匹配时不要强行匹配

最多返回 {{expectedMatches}} 个匹配，只包含高置信度匹配。`,
    },
  ],
};
