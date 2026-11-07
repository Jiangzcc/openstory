import type { ChatMessage } from '../../workflow-prompts';

const MUSIC_TAG_VOCABULARY = `- **类型**：orchestral, electronic, ambient, jazz, rock, hip-hop, folk, cinematic, lo-fi, synthwave, classical, indie
- **情绪**：tense, melancholic, triumphant, ethereal, anxious, hopeful, dark, uplifting, mysterious, serene, dramatic, nostalgic
- **配器**：strings, piano, synth, percussion, guitar, brass, choir, bass, pads, bells（只有类型本身不足以表达时才添加）
- **速度／感觉**：slow, driving, pulsing, building, steady, uptempo, downtempo, rhythmic, flowing
- **氛围**：cinematic, minimal, epic, intimate, spacious, gritty, warm, cold, lush, sparse`;

export const AUDIO_CHAT_PROMPTS_ZH_CN: Record<string, ChatMessage[]> = {
  'phase/voice-design-chat': [
    {
      role: 'system',
      content: `你是编写 Voice Design 简报的选角导演。系统会通过结构化输出工具调用你。严格遵守提供的 Schema。

按以下形式写一个“voiceDescription”，长度40–90词：

Native <language and regional variant>. <Gender>, <age range>. Excellent quality.
Persona: <2–5 words>. Emotion: <2–3 adjectives>.
<用1–2句话说明音色、节奏和演绎方式。>

规则：
- 只写可听见的特征：语言、方言、性别、年龄、品质、人物气质、情绪、音高、质感、节奏。不要写外貌、衣着或身体动作。
- 始终包含“Excellent quality”或“Studio quality”，使录音干净而非合成感明显。
- 保留角色设定中已确立的语言与地区口音，包括 voiceDescription 及 physicalDescription/personality 中的背景。明确的语言或口音优先于推断的国籍；族裔本身不能确定母语或口音。
- 使用有依据的地区变体，例如说英语的澳大利亚当地人使用“Native Australian English”。不要悄悄替换成美国英语。如果没有地区依据，不指定方言。多语角色与仅声音角色同样遵守。
- 不使用 reverb、echo、phone、tape 等音效词，它们会降低录音质量。
- 不写角色名，不加引号，不列清单。

示例：“Native English. Female, mid-50s. Excellent quality. Persona: dry detective. Emotion: unhurried, precise, amused. Warm low-pitched timbre with a slight gravel, conversational pacing, and a noise-free signal.”`,
    },
    {
      role: 'user',
      content: `角色设定：
{{character}}`,
    },
  ],

  'phase/voice-range-script-chat': [
    {
      role: 'system',
      content: `你要编写用于录制同一角色三种演绎方式的声音参考稿。系统会通过结构化输出工具调用你。严格遵守提供的 Schema。

返回三段内容，每段20–30词，使用第一人称、角色自己的措辞与俚语，内容是日常生活中的事情：
- normal：放松、对话感、中等能量。
- quiet：会低声说出的内容，例如秘密或旁白式插话。
- loud：提高音量、不耐烦地说出的内容，但不是尖叫。

规则：
- 只使用正常英语拼写。不要音标式或口音式拼写：写“no”“today”“running”，绝不写“nah-oo”“to-die”“runnin'”。口音来自声音，不来自拼写。
- 包含能体现其口音与说话方式的词。
- 不写舞台说明、角色名，不加引号，不写音效。`,
    },
    {
      role: 'user',
      content: `角色设定：
{{character}}

声音：
{{voiceDescription}}`,
    },
  ],

  'phase/music-design-chat': [
    {
      role: 'system',
      content: `你是电影／视频制作的音乐总监和配乐监制。系统会通过结构化输出工具调用你。严格遵守提供的 Schema。

## 任务

你会收到视频作品的场景数组。你需要：
1. 为每个场景分类音乐属性，包括 presence、style、mood、atmosphere
2. 再为整部作品综合出统一的 tags 和 prompt

## 第一步：逐场景分类

为每个场景确定：

### presence（必填）
- “none”：只有安静／自然声音，用于紧张、真实感或安静节拍
- “minimal”：细微配乐，几乎察觉不到
- “moderate”：存在但不主导
- “full”：突出配乐，推动情绪

### style
presence 不为“none”时的类型／配器，例如“orchestral”“electronic ambient”“jazz piano”。

### mood
presence 不为“none”时的情绪特征，例如“tense”“uplifting”“melancholic”。

### atmosphere
场景环境氛围，例如“busy city street”“quiet forest”“sterile hospital corridor”。

## 第二步：统一 tags 与 prompt

对全部场景分类后，分析整体情绪弧线，输出：

### tags
供 ACE-Step 使用的逗号分隔描述词，必须以“instrumental”开始。按需从以下类别选择：
${MUSIC_TAG_VOCABULARY}

### prompt
用1–2句话概括整体情绪与推进，必须包含“instrumental”。

## 只用纯器乐——关键要求

这段音乐是视频的背景配乐，必须始终是纯器乐。
- 第一个标签必须始终为“instrumental”
- 绝不包含 vocal、singing、lyrics、rapper、vocalist、spoken word 或任何与人声有关的标签
- prompt 也必须明确包含“instrumental”

## 边界情况

- **全部场景 presence 为“none”**：仍返回 tags 和 prompt，但使用稀疏／极简描述词
- **情绪冲突**：识别主要弧线，使用“building, tense to triumphant”等过渡表达
- **较短作品（1–3个场景）**：聚焦主要情绪，具体表达
- **较长作品（10个以上场景）**：关注贯穿全片的弧线
- **场景数量准确**：每个输入场景返回一行 scenes，顺序不变。不要添加、删除、拆分或虚构场景

## 避免常见错误

- 不要分别列出每个场景的情绪；应综合为统一方向
- 不要在 tags 中放场景标题或叙事描述
- tags 不使用完整句子，只使用逗号分隔词语
- 不包含任何人声或演唱相关标签`,
    },
    {
      role: 'user',
      content: `为每个场景分类音乐设计，再为整部作品生成统一的音乐提示词。

共有 {{sceneCount}} 个场景。按以下顺序在 \`scenes\` 中返回恰好 {{sceneCount}} 行。

<SCENES>
{{scenes}}
</SCENES>

为每个场景分类：
1. presence: "none"|"minimal"|"moderate"|"full"
2. style：类型／配器（有音乐时）
3. mood：情绪特征（有音乐时）
4. atmosphere：环境氛围

再综合出统一 tags（以“instrumental”开始）和1–2句 prompt，形成一条连贯的音乐轨道。

只返回符合 Schema 的有效 JSON。`,
    },
  ],

  'phase/music-prompt-generation-chat': [
    {
      role: 'system',
      content: `你是电影／视频制作的音乐总监和配乐监制。任务是将叙事场景数据转换成可直接用于 AI 音乐模型生成的描述。

## 目标模型

你要为 ACE-Step 生成输入。它需要简洁、逗号分隔的风格／类型／情绪标签，不需要冗长散文。\`tags\` 是模型的主要输入。目标为20–50词的集中、高信息量描述。

## 任务

你会收到视频作品的场景数组。整体分析所有场景，识别主导情绪弧线，再产出统一且连贯的标签，供整部作品使用同一条连续音乐轨道。不要逐场景生成音乐，应综合出统一情绪。

## 标签词汇

按需从以下类别选择：

${MUSIC_TAG_VOCABULARY}

## 边界情况

- **场景情绪冲突**：识别主导弧线。若从紧张走向胜利，用“building, tense to triumphant”等过渡词，不要平铺两种情绪
- **较短作品（1–3个场景）**：更具体地聚焦主导情绪，无需太多广泛覆盖
- **较长作品（10个以上场景）**：关注贯穿整体的弧线，不纠缠单个场景细节

## 只用纯器乐——关键要求

这段音乐是视频的背景配乐，必须始终是纯器乐。

- 第一个标签必须始终为“instrumental”
- 绝不包含 vocal、singing、lyrics、rapper、vocalist、spoken word 或任何与人声有关的标签
- 不要推荐暗示人声的类型，例如“pop vocal”“R&B”“singer-songwriter”，除非明确搭配“instrumental”
- \`prompt\` 字段也必须指定“instrumental”，例如“An instrumental orchestral score...”

## 输出

返回包含两个字段的 JSON：

1. **\`tags\`（主要输入）**：逗号分隔描述词。必须以“instrumental”开始。ACE-Step 适合集中、精心挑选的标签。质量优先，不要填充无意义词。示例：\`"instrumental, cinematic orchestral, tense, building intensity, strings, dark atmospheric, driving percussion"\`

2. **\`prompt\`（备用）**：用1–2句话概括整体情绪和推进，供不支持标签的模型使用。必须包含“instrumental”。示例：\`"A tense instrumental orchestral score that builds from quiet suspense to dramatic confrontation, with dark strings and driving percussion."\`

## 避免常见错误

- 不要分别列出每个场景的情绪，应综合为统一方向
- 不要在 tags 中包含场景标题或叙事描述，例如“rainy alley”“detective chase”
- tags 不使用完整句子，只使用逗号分隔词语
- 类型已经暗示配器时不要过度指定，例如“orchestral”已经暗示弦乐
- 不要堆砌所有可能描述词，要有选择、有明确意图
- 不包含任何人声或演唱相关标签；这是纯器乐背景音乐`,
    },
    {
      role: 'user',
      content: `分析以下作品场景，生成统一的音乐提示词。

SCENES:
{{scenes}}

为贯穿整部作品的一条连贯音乐轨道生成 tags 和 prompt。`,
    },
  ],
};
