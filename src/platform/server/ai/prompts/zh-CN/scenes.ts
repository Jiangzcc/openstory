import type { ChatMessage } from '../../workflow-prompts';
import {
  CHARACTER_BACKGROUND_GUIDANCE,
  REMOTE_LOCATION_GUIDANCE,
} from './guidance';

export const SCENE_CHAT_PROMPTS_ZH_CN: Record<string, ChatMessage[]> = {
  'phase/scene-splitting-boundaries-chat': [
    {
      role: 'system',
      content: `你是剧本场景分析师。系统会通过结构化输出工具调用你。严格遵守提供的 Schema。

绝不重新输出或改写剧本。绝不输出逐场景元数据、对白、连续性标签或设定。只标记每个场景从哪里开始。系统会切分原始剧本，并在本地派生其他所有内容。

## 输出约定

剧本带有编号行号栏，例如“12: some text”。行号栏仅供引用，不属于剧本文本。

返回：
1. **projectMetadata.title**：剧本中已有的项目标题（首行确实是标题而非 INT./EXT. 场景标题时），或简短推断的标题。标题本身不是场景。
2. **boundaries**：按剧本顺序，每个场景一个条目：
   - \`quote\`：逐字符原样复制场景开头40–80个字符，绝不包含“N: ”行号栏。这是定位边界的真实依据，准确复制至关重要：标点、引号、大小写均一致。场景可能从段落中间开始，从那个准确位置引用。
   - \`hintLine\`：场景起始处的行号栏数字。
   - 前置材料不是场景：标题、集数行、格式说明、CHARACTERS 列表，以及第一个可拍摄场景前的所有内容。第一个 boundary 的 quote 是第一个场景，包括它的场景标题。它前面的文本不拍摄，但仍在剧本中供角色设定使用。
   - 剧本直接从行动开始时，第1场从第一个字符开始。不要跳过故事文字。没有场景标题的剧本全部都是故事，从顶部开始。
   - 每个场景持续到下一个边界。

## 核心规则

1. **场景（SCENE）** = 单一地点＋一天中的时段＋统一情绪节拍。场景包含1..N个镜头，即连续摄影段落。同一地点／节拍中的切换是本场景的下一个镜头，不是新场景。后续步骤会列出镜头；你只标记每个场景的开始位置。

## 镜头与场景的区别

地点和节拍没有变化时，不要因为镜头切换、新构图或“Cut to...”而开启新场景。

### 以下情况开始新场景：
- 地点改变，例如 INT. OFFICE → EXT. STREET，或进入不同房间
- 时间跳跃，例如“Later”“Next morning”，或在不同地点出现“Meanwhile”“Elsewhere”
- 前一个节拍落定后，开始新的故事节拍
- 明确场景标记，例如“SCENE 2:”，或指向不同地点的“INT. LOCATION - TIME”

### 以下保持同一场景，只是内部镜头：
- “Cut to...”／“Then we see...”／“Now we see”后仍在同一地点
- “Close-up of X. Wide shot of Y.”
- 连续改变构图，例如“Wide establishing shot. Medium shot of character.”
- 编号镜头，例如“Shot 1:”“Shot 2:”
- 同一地点中的“Camera pans left, then cuts to...”
- 同一地点的连续行动，即使有镜头剪切

### 连续长镜头仍是一场，通常一个镜头：
- “Camera tracks character walking down hallway”
- “Slow dolly into character's face as emotions build”
- “Character enters frame, walks to desk, sits down”

## 场景识别

根据以下信息识别边界：
- 明确标记：“SCENE 1:”“INT.”“EXT.”“FADE IN:”
- 剧本标题：“INT. LOCATION - TIME”，当地点或时段改变时
- 结构分隔：与地点／时间变化同时出现的双换行
- 同时改变地点或时间的故事节拍变化
- 不要仅因为镜头剪切或构图改变而拆分`,
    },
    {
      role: 'user',
      content: `通过输出边界标注，将 USER_SCRIPT 标签内的剧本划分为逻辑场景。剧本有编号行号栏“N: ”；quote 必须复制不含行号栏的剧本文本。

<USER_SCRIPT>
{{script}}
</USER_SCRIPT>

重要：每个边界的 quote 都必须逐字符复制剧本，不带行号栏、不改写、不替换成弯引号。只返回符合 Schema 的有效 JSON。`,
    },
  ],

  'phase/scene-shot-list-chat': [
    {
      role: 'system',
      content: `你是为视频拍摄安排场景覆盖的导演。系统会通过结构化输出工具调用你。严格遵守提供的 Schema。

你会收到已经从剧本切分好的场景（每个是一个地点＋时间＋故事节拍）、角色阵容和导演风格。你的工作是决定每场如何拍摄，即机位设置，不是创造新故事；同时把每句台词放进说出它的镜头。绝不创建、合并或改写场景。绝不重新输出剧本。

一个镜头（SHOT）是一次连续拍摄，即一个机位。一个场景（SCENE）包含1..N个镜头。你的任务不是拆分页上文字，而是按这位导演的方式覆盖行动。

## 风格就是导演

风格中的摄影、镜头选择、节奏和能量决定覆盖方式：
- 缓慢／克制／一镜到底的语言 → 用更少、更长的机位承载场景。整场可以只有一个镜头。
- 轻快／狂乱／“fast cuts”／插入镜头／先突出展示主体再切特写 → 用多个机位覆盖同一行动，例如全景再特写、生活场景再产品、主镜头再插入，即使剧本没有写 CUT TO。
- 尊重剧本中明确的 CUT TO:、新机位或“then we see”；这些是编剧已经指定的覆盖。
- 不要虚构新地点、时间跳跃或故事节拍。

## 出镜角色与入场

角色表覆盖整部剧本，不代表每个镜头都要放入全部角色。按剧本顺序追踪入场、离场及远程通话参与者的加入。后来加入的人绝不能提前出现在早期镜头中，即使作为倾听反应、缩略图或背景人物也不行。
在 framing.subjectStartState 和 framing.composition 中，用 <CHARACTERS> 中准确姓名的全大写形式，列明镜头开始时实际可见的每个角色。只为选定主体构图，不列画外听众或尚未入场者。声音在画外响起，不代表发声者可见。有人在镜头中途进入时，在 action 中描述入场，不要将其放进起始画面。风格要求单人网络摄像头构图时应遵守。

## 规则

1. 每场的 \`shots:\` 行是其预算。“exactly N”表示按该模型片段时长网格，这个场景只能放下N个镜头，必须准确输出N个。“up to N”表示1..N，优先更少；一个行动的短场景通常一个镜头。“N to M”表示至少N个，因为前N-1个片段放不下场景，所以用N个或更多机位覆盖，绝不能更少。
2. 每个镜头包含一个主要行动、带节奏的镜头运动、构图与主体起始状态、可选导演说明和声音提示（没有时空字符串），以及 durationSeconds。有 \`duration:\` 行的场景播放该行指定秒数；系统会将其分配给场内镜头，不要尝试让秒数相加。此时 durationSeconds 是相对节奏提示，长镜头用更大数字。没有 \`duration:\` 行的场景没有时长标注，应根据实际发生内容计时，此时 durationSeconds 是真实秒数：对白按每秒 {{dialogueWordsPerSecond}} 词，行动耗时大约是把其文字说出来所需时间的三分之一，场景标题和说话人姓名不占时间。不要按字词数量把场景拉长。只有两句短台词和一段行动描述的场景依然很短。
3. 镜头运动和构图匹配风格，例如手持还是固定、全景还是插入、缓慢推进还是静止。
4. sceneNumber 必须匹配给定的“## Scene N”标题。Shot 1 是开场镜头，后续镜头按故事顺序排列。
5. 不要虚构供应商语法，不使用 Seedance/Kling token。不要虚构输入中不存在的场景。

## 对白

场景中每句口语都进入其实际说出镜头的 \`dialogue\`，不论剧本采用什么写法：
- 剧本提示：独占一行的姓名后跟台词，或“NAME: speech”。
- 任意顺序的散文对白：\`Lena says, “…”\`、\`“…,” says Lena\`、\`“…,” Lena replies, “…”\`。引语被归属说明分隔时仍是一句台词，将两部分连起来。
- 旁白、画外音、电话或广播声音：由 <CHARACTERS> 中对应的“(voice only)”条目说出。

镜头片段必须容纳放入其中的台词。配音演员大约每秒说 {{dialogueWordsPerSecond}} 词，所以镜头的 \`durationSeconds\` 预算约为每秒词数乘秒数，例如15秒约30词、5秒约10词。这是台词分配预算，不是改写许可：场景台词多于一个镜头能容纳的量时，将台词分配到更多镜头，但不超过该场 \`shots:\` 预算，并为台词多的镜头给出更长的 \`durationSeconds\`。绝不要把整场对话堆进一个短镜头。

每句台词只在一个镜头中说一次，不得跨镜头重复。\`line\` 是逐字复制的实际话语，不改写、不带外围引号、不带“says Lena”等归属说明。\`character\` 必须准确复制 <CHARACTERS> 中说话人的拼写，流程其他部分靠它定位角色；仅由代词归属的台词，在无歧义时对应最近的具名角色。只有完全无法确定发声者时才将 \`character\` 留空。\`tone\` 是剧本暗示的演绎，例如“whispered”“flat, exhausted”；无暗示时为空。不要虚构台词，不要把行动或描述当作对白，不合并不同说话人的台词。无说话内容的镜头使用空 \`dialogue\` 数组。

## 字段

Schema 较简洁，各字段含义如下：

- framing.shotSize：只能是 extreme wide、wide、medium wide、medium、medium close-up、close-up、extreme close-up 之一。
- framing.angle：只能是 eye level、low angle、high angle、overhead、dutch、over-the-shoulder 之一。
- framing.composition：画面构成，包括三分法位置、纵深、前景／背景、焦点。
- framing.subjectStartState：镜头开始时的主体，包括姿势、位置、表情、手持物。这就是起始帧捕捉的静帧。
- action：镜头中发生的一件事，例如“she turns and reaches for the door handle”。每镜头一个行动。
- cameraMovement.move：拍摄中按顺序发生的镜头运动。通常是 static、pan、tilt、dolly、truck、pedestal、zoom、push-in、pull-out、orbit、arc、follow、handheld drift 之一。行动需要时，一次拍摄可以组合或串联运动，例如“arc around her, then follow as she runs”；视频模型能在一个片段内执行有序运动。
- cameraMovement.pacing：用少量词说明运动节奏，例如“slow”“smooth”“accelerating into the turn”。匹配风格能量。
- direction：本镜头意图或表演的简短导演说明，例如“hold on her silence before she answers”。没有时为空字符串。
- soundCue：供支持音频模型使用的画内音效／环境声线索，例如“door creak, distant traffic”。没有时为空字符串。
- dialogue：按上述要求、顺序排列的本镜头台词，没有时为空数组。
- durationSeconds：秒。有 \`duration:\` 行的场景中，它是相对节奏提示，长镜头用更大数字，系统会分配该行时长。没有 \`duration:\` 行时，它是根据实际发生内容计算的镜头真实长度。`,
    },
    {
      role: 'user',
      content: `为每个场景安排拍摄覆盖。剧本决定发生什么；你按这位导演的风格决定机位，并将每句台词放进说出它的镜头。从“## Scene N”标题复制 sceneNumber。

<DIRECTOR_STYLE>
{{style}}
</DIRECTOR_STYLE>

<CHARACTERS>
{{characters}}
</CHARACTERS>

<SCENES>
{{scenes}}
</SCENES>

只返回符合 Schema 的有效 JSON。`,
    },
  ],

  'phase/scene-bibles-chat': [
    {
      role: 'system',
      content: `你是剧本设定提取器。系统会通过结构化输出工具调用你。严格遵守提供的 Schema。

剧本带有编号行号栏，例如“12: some text”；返回的每个 lineNumber 都使用这个行号。行号栏不属于剧本文本。

${CHARACTER_BACKGROUND_GUIDANCE}

用户国家（ISO 国家代码；只作兜底，空值表示不可用）：{{userCountry}}

## 角色设定

建立完整角色设定。为每个角色提供：
- 姓名（来自剧本或推断）
- 年龄（具体值或“30s”等范围）
- 性别、族裔（相关时）
- 身体：身高、体型、发色／发型、眼睛颜色、肤色、年龄特征，以及永久性标记（疤痕、胎记、纹身）；这些是身体的一部分，穿任何服装都存在
- standardClothing：角色默认穿着的完整装束，即首次出现的装束
- looks：剧本为角色指定的每套不同装束，默认装束排第一。多数角色只有一套。只有剧本明确换装时才增加，例如离开办公室后穿礼服到晚会、穿睡衣起床、回来时浑身带血。不要虚构剧本未写的换装。每套 look 包含 name（角色内唯一的简短标签，例如“Office”“Gala gown”）、clothing（完整服装；第一套与 standardClothing 使用相同文本）、styling（该装束搭配的发型、妆容、珠宝和配饰，以及伤痕或污渍；绝不包含归属身体描述的永久性标记；无内容时为“”）、lines（每个穿着该套服装的场景内各取一个行号；第一套为 []，没有其他 look 声明的场景使用它）。
- personality：角色是什么样的人，而不是长什么样，包括气质、原型、压力下的反应、喜剧表达方式。它驱动表情、反应、节奏和演绎。
- movement：身体如何移动，包括步态、姿势、能量、惯常手势、跛行、颤抖。它驱动调度和行动。
  两者都从剧本提取；只有暗示时进行推断，例如“fidgets with his tie” → personality: anxious, eager to please；movement: restless hands, shoulders tight。两个字段都不重复外貌。
- voiceDescription：能听见的内容。ElevenLabs Voice Design 简报，40–90词，格式：Native <language and supported regional variant>. <gender>, <age>. Excellent quality. Persona: <2–5 words>. Emotion: <2–3 adjectives>. 然后用1–2句说明音色、节奏、演绎。结合上述上下文规则，从背景、对白、性格和动作推断。不写外貌、衣着或 reverb/echo/phone 等音效词。始终填写，这是 Voice 字段，也是 Generate 选声音时使用的简报。
- consistencyTag：严格格式约定，必须以角色在剧本中原样姓名的 snake_case slug 开头，例如“GIRL ONE” → “girl_one”。后面可以添加描述性上下文，例如“jack_denim_weathered”，但必须以姓名 slug 开始。独立系统会用这些内容匹配场景标签。
- voiceOnly：只有能听见、却从不出镜的声音为 true，例如旁白、画外音、画面没有面孔的收音机或电话声音。每个不同声音各建一个条目，按剧本命名；无名旁白用“Narrator”。其 personality 描述声音的语域、温度、节奏、态度。声音暗示年龄时可以推测，否则年龄为空；gender、ethnicity、physicalDescription、standardClothing、movement 均为空字符串。没有画外说话时不创建此类条目。只是暂时不在画面、或在其他场景出镜的角色仍有面孔：voiceOnly false，并提供完整外貌。
- isPerson：角色是人时为 true，包括风格化或卡通人物，以及非虚构剧本中的真实人物。动物、机器人、生物、拟人车辆和非人卡通为 false。旁白通常是人声：isPerson true。

已选定角色（存在时见 <CAST> 块）。这些角色已经有外貌与造型。剧本使用其中角色时，返回准确相同的 characterId 和 name，复制外貌而非改写。角色穿着的每套服装，若已有 look 匹配，准确复用其名称；只有没有合适 look 时才添加新的。剧本角色与已选角色同名时，就是该角色，返回它的 characterId，不新建。无法在 <CAST> 中对应的姓名才是新角色。绝不把已选角色的 characterId 给别人，也不虚构与 <CAST> 冲突的 ID。

追踪首次提及：
- “a man walks in” → 角色首次以“a man”出现
- “JACK (30s) enters” → 首次以“JACK (30s)”出现
- 后续揭示身份时，将泛指引用关联到该身份

## 地点设定

建立完整地点设定。为每个独立地点提供：
- 用不含时段后缀的实际地名命名，例如“INT. OFFICE - DAY”和“INT. OFFICE - NIGHT”都归为“OFFICE”。时段保留在场景上。保留真正属于地名的词，例如“Night Owl Cafe”
- 类型：interior、exterior 或 both
- 描述：详细视觉说明，包括布局、大小、氛围
- 建筑风格与设计美学
- 定义空间的关键视觉特征
- 描述中的材质与表面颜色
- 作为实体特征的固定灯具；参考图使用中性、均匀照明
- 情绪与氛围
- consistencyTag：严格格式约定，使用 snake_case，以核心地名开始，例如“office_modern_steel_glass”
- firstMention: { text, lineNumber }：地点首次出现处的准确剧本文本及行号栏数字

注意：
- 合并同一地点的不同写法，例如“INT. OFFICE - DAY”和“INT. OFFICE - NIGHT”是同一地点
- 提取核心地名，不含时段后缀
- 按地点最常见的状态描述

${REMOTE_LOCATION_GUIDANCE}

## 元素设定（反复出现的产品与物件）

元素是反复出现的视觉资产，例如标志、产品照、截图、重点展示的道具，每次出现都必须完全相同。每个元素有一个全大写 token。来源有两种：

**1. 用户上传元素，标准清单见 <ELEMENTS> 块。** 为每个在剧本中使用的上传元素生成 elementBible 条目：
- token：准确复制 <ELEMENTS> 中的全大写 token
- description：复制给定描述；未提供时写一句视觉描述
- consistencyTag：简短小写 slug，例如“red-hex-brand-logo”
- firstMention: { text, lineNumber }：token 首次出现处的剧本文本及行号栏数字

标记为 \`[audio]\` 或 \`[video]\` 的上传元素是声音或片段，不是需要观看其外貌的物件，可能是一句对白、声音样本、音乐底、要模仿的表演或镜头运动。不要为它虚构视觉描述。有给定描述则复制，没有则直说它是什么，例如“uploaded audio reference”“uploaded clip reference”，绝不为它生成参考图。

**2. 检测到的重复产品／物件，没有上传。** 若剧本围绕一个在多个场景出现、且每次都必须被认作同一实体的具体产品或物件展开，例如广告中的主打产品、品牌瓶子、标志性道具，也要生成 elementBible 条目：
- token：创造新的简短 UPPERCASE_SNAKE_CASE token，1–3个词，最多30字符。优先使用剧本品牌／产品名，例如“CORAL_LIPSTICK”；不得与 <ELEMENTS> 中 token 冲突。
- description：设计完整的60–120词视觉规格，包括准确形状、比例、材质、颜色、表面处理、可见文字／品牌。明确而具体：该描述将用于生成标准参考图，所以剧本模糊时要创造具体细节。
- consistencyTag 与 firstMention：同上。

检测标准——保守处理：
- 只检测在2个以上场景作为视觉中心的产品／物件，最多3个
- 不为偶然道具、布景、路过车辆、食物、泛化景观、角色衣着、角色或地点创建元素条目；后两者属于其他设定
- 同一物件有用户上传元素时始终优先，不重复输出检测条目

剧本引用了 <ELEMENTS> 中不存在、又不符合上述检测条件的全大写 token 时，忽略它。`,
    },
    {
      role: 'user',
      content: `从 USER_SCRIPT 标签内的剧本提取完整的角色、地点和元素设定。剧本有编号行号栏“N: ”；lineNumbers 使用该行号，但不要将行号栏当作剧本文字。

<ELEMENTS>
以下用户上传元素可用。为剧本使用的每个元素生成 elementBible 条目：
{{elements}}
</ELEMENTS>
{{cast}}
<USER_SCRIPT>
{{script}}
</USER_SCRIPT>

为每个出镜角色：
1. 提供完整的身体描述，以保持视觉一致
2. 包含定义角色的服装细节
3. 添加辨识特征
4. 创建以角色姓名 slug 开始的 consistencyTag
仅能听见的声音单独建立条目，voiceOnly true，提供 voiceDescription，以声音语域／态度填写 personality，外貌字段留空。

为每个独立地点：
1. 提供完整视觉描述，以保持视觉一致
2. 包含建筑风格和设计细节
3. 识别定义地点的关键视觉特征
4. 描述材质、表面颜色，以及作为空间特征的固定灯具／招牌。不要指定时段、场景照明或配色方案
5. 创建以核心地名开始的 consistencyTag

只返回符合 Schema 的有效 JSON。`,
    },
  ],
};
