# YOLO 格式标注支持 — 设计文档

- 日期：2026-06-15
- 状态：已确认，待实现
- 涉及文件：`src/extension.ts`、`src/LabelMePanel.ts`、`package.json`、`media/main.js`、新增 `src/yoloDataset.ts`、新增对应测试

## 1. 背景与目标

当前扩展只支持 LabelMe 格式：每张图片对应一个 `<image>.json` 边车文件，shape 用**绝对像素**坐标 + 自由文本 label。`src/exportFormats.ts` 已有 YOLO bbox/seg 的**单向导出**能力（`buildYoloBboxLines` / `buildYoloSegLines`），但没有 YOLO 的**读取**能力，也无法以 YOLO 为工作格式进行标注与回写。

本功能新增一条完整的 YOLO 工作流：从 YOLO 的 `data.yaml` 右键进入，导入已有 `.txt` 标注、在画布上标注、并以 YOLO 格式（`.txt` + 回写 `data.yaml`）保存。

### 已确认的关键决策

1. **标签文件位置**：Ultralytics 约定 —— 图片路径里最后一个 `/images/` 段替换为 `/labels/`，扩展名换成 `.txt`。
2. **TXT 输出格式**：按形状自动 —— 矩形写 bbox 行（5 个数），polygon/sam 写分割多边形行（归一化点序列）；同一 `.txt` 文件可混合两种行。
3. **图片范围**：解析 `data.yaml` 的 `path` + `train`/`val`/`test` 字段得到图片目录，只标注数据集真正引用的图片。
4. **类别表权威来源**：`data.yaml` 的 `names`。类别在文件中的**位置即索引**。
5. **新增类别**：类别选择窗口点 OK 时若该类别不在 yaml，询问用户；确认则取末尾索引（`len(names)`）追加，并**立即写回 yaml**。

## 2. 架构概览

采用「单面板 + 格式标志」方案：继续复用现有 `LabelMePanel`（画布、导航、侧边栏、标签弹窗），只在三个接缝处按格式分支 —— **读标注 / 存标注 / 加类别**。所有 YOLO 专属逻辑放进新的纯函数模块 `src/yoloDataset.ts`，与 `exportFormats.ts` 风格一致，可独立单测。

被否决的备选：
- `YoloPanel extends LabelMePanel`：面板用私有字段 + 静态工厂，未为继承设计，重构面大、风险高。
- 在 webview 里转换、仍存 `.json`：违背「以 YOLO 保存」目标。

YAML 处理用**自写小解析器**而非引入 `js-yaml`：无新依赖；新增类别用**定向文本编辑**追加，保留原文件注释与排版。

## 3. 新增模块 `src/yoloDataset.ts`

纯函数，不做文件 IO（IO 由 `LabelMePanel` 负责），便于单测。

```ts
export interface ParsedDataYaml {
    path: string | null;          // 数据集根（可能相对 yaml 目录，也可能绝对）
    train: string[];              // 规整成数组
    val: string[];
    test: string[];
    names: string[];              // dict / list 两种写法都规整成按索引排列的数组
}

// 解析 data.yaml 文本。支持 names 的两种写法：
//   names: ['person', 'bicycle']          (list)
//   names: {0: person, 1: bicycle}        (dict)
// train/val/test 支持单值或列表；缺省字段返回空数组 / null。
export function parseDataYaml(text: string): ParsedDataYaml;

// 把 train/val/test 解析成绝对图片目录列表。
// 解析顺序：每个条目先相对 path 解析；path 本身相对 yaml 所在目录解析；绝对路径原样使用。
// v1 仅支持「目录」条目；若条目指向 .txt 清单文件，跳过并返回 warning。
export function resolveImageDirs(
    yamlPath: string,
    parsed: ParsedDataYaml
): { dirs: string[]; warnings: string[] };

// 图片绝对路径 -> 标签 .txt 绝对路径。
// 把路径里最后一个 /images/ 段换成 /labels/，扩展名换成 .txt。
// 若路径中没有 /images/ 段，回退为同目录 sidecar（同名 .txt）。
export function imageToLabelPath(imageAbsPath: string): string;

// 解析一个 .txt 的内容为 shapes（绝对像素坐标）。
//   5 个 token         -> rectangle（2 个对角点）
//   >5 个 token（class + 偶数个坐标） -> polygon
// label = names[idx]；idx 越界则用 "class_<idx>" 并记一条 warning。
export function parseYoloTxt(
    text: string, imgW: number, imgH: number, names: string[]
): { shapes: YoloShape[]; warnings: string[] };

// 由 shapes 生成一个 .txt 文本（按形状自动选择 bbox / seg 行）。
// rectangle -> bbox 行；polygon -> seg 行。复用 exportFormats 的
// shapeAabb / shapeToPolygonRing / clamp01。label 不在 classes 中则跳过 + warning。
export function buildYoloTxt(
    shapes: YoloShape[], imgW: number, imgH: number, classes: string[]
): { text: string; warnings: string[] };

// 往 yaml 文本的 names 追加一个新类别（保留 list / dict 写法），
// 若存在 nc 字段则同步 +1。返回新文本与新类别的索引（= 追加前的长度）。
export function appendClassToYaml(
    text: string, newName: string
): { text: string; index: number };
```

`YoloShape` 复用 `exportFormats.ts` 的 `ExportShape`（`{ label?, shape_type?, points }`）。

## 4. 入口（命令与右键菜单）

`package.json`：
- `contributes.commands` 新增：
  `{ "command": "labeleditor-vscode.openYoloDataset", "title": "LabelEditor: Open as YOLO Dataset" }`
- `contributes.menus.explorer/context` 新增：
  `{ "command": "labeleditor-vscode.openYoloDataset", "when": "resourceExtname =~ /\\.(ya?ml)$/i", "group": "navigation" }`

`src/extension.ts`：注册命令 → `LabelMePanel.createOrShowFromYaml(context, uri)`。

## 5. 面板改动（`src/LabelMePanel.ts`）

新增字段：
- `_format: 'labelme' | 'yolo'`（默认 `'labelme'`）
- `_yamlUri: vscode.Uri | undefined`
- `_yoloClasses: string[]`

改动点：

1. **`createOrShowFromYaml(context, yamlUri)`**（新静态工厂）
   - 读取并 `parseDataYaml`，`resolveImageDirs` 得到图片目录。
   - `_rootPath` = 数据集根（`path` 解析结果，缺省时取 yaml 所在目录）。
   - `_workspaceImages` 直接由这些目录扫描得到（不走通用 `scanWorkspaceImages` 的整树扫描），相对 `_rootPath` 存储。
   - 与现有工厂一样的去重 / reveal 逻辑（同一 yaml 已打开则 reveal）。
   - 以 YOLO 模式构造面板，标题用 yaml 所在数据集名。

2. **读标注**（`_sendImageUpdate` 和 HTML 启动时的注解加载两处）
   - `_format==='yolo'` 时：用 `imageToLabelPath` 找 `.txt`，`getImageMetadata` 取图片宽高，`parseYoloTxt` 转成 shapes 下发；`.txt` 不存在视为空（新图）。
   - `_format==='labelme'` 时：保持现状读 `.json`。

3. **存标注**（`saveAnnotation`）
   - YOLO 时：`buildYoloTxt` 生成文本，写到 `imageToLabelPath` 对应路径（必要时 `mkdir -p labels/...`）；shapes 为空则写空 `.txt`。
   - LabelMe 时：保持现状写 `.json`。

4. **新消息处理 `yoloAddClass`**
   - 入参：新类别名。
   - 读取 yaml → `appendClassToYaml` → 写回 yaml → 更新 `_yoloClasses`。
   - 回包 `{ command: 'yoloClassAdded', classes, index }` 给 webview。

5. **配置注入**：在生成 HTML 时新增两个 per-panel 常量 `annotationFormat`（`'labelme'|'yolo'`）和 `yoloClasses`（字符串数组），与 `existingData`/`workspaceImages` 同处注入。

## 6. Webview 改动（`media/main.js`）

1. **模式限制**：`annotationFormat==='yolo'` 时，隐藏 line / point / circle 三个模式按钮，并让对应快捷键失效；保留 view / sam / polygon / rectangle(bbox)。

2. **标签弹窗类别来源**：YOLO 模式下，标签弹窗以 `yoloClasses` 作为主选择来源（以 chips 呈现），同时保留 recent labels 行为。

3. **类别选择 OK 的特殊流程**（需求 3，核心）：
   - 确认时，若输入 label ∈ `yoloClasses` → 直接采用（索引即其在数组中的位置）。
   - 若不在 → 弹一个 webview 内确认框：「类别 «X» 不在 data.yaml 中，是否添加?」
     - **确认**：本地把该类别按末尾索引追加到 `yoloClasses`，向扩展发 `yoloAddClass`（扩展立即写回 yaml 并持久化），随后正常创建该 shape。
     - **取消**：保持标签弹窗打开，让用户改选已有类别（不创建 shape）。
   - 收到 `yoloClassAdded` 后用扩展回传的 `classes` 校准本地列表（以磁盘为准）。

## 7. 边界与错误处理

- `names` 缺失 / 为空：仍可打开，但首次标注必然触发「新增类别」流程。
- 图片宽高读不出：跳过该图的标注转换并提示（无法做归一化/反归一化）。
- 导入时 label 索引 ≥ 类别数：合成 `class_<idx>` 名并 warning。
- yaml 解析不出任何图片目录：错误 toast，面板不进入 YOLO 工作流。
- 标签 `.txt` 缺失：视为空标注（新图），正常进入标注。
- `train/val/test` 指向 `.txt` 清单文件（而非目录）：v1 跳过 + warning（文档已知限制）。

## 8. 测试

为 `src/yoloDataset.ts` 的每个函数写单测，沿用现有 `node:test` 配置（`tsconfig.test.json` + `node --test`）：
- `parseDataYaml`：list / dict 两种 `names`；单值与列表的 `train/val/test`；缺省字段。
- `resolveImageDirs`：相对 / 绝对路径解析；`.txt` 清单条目跳过 + warning。
- `imageToLabelPath`：含 `/images/` 的标准映射；无 `/images/` 的 sidecar 回退；Windows 反斜杠路径。
- `parseYoloTxt` / `buildYoloTxt`：bbox↔矩形、seg↔多边形 的往返；归一化/反归一化；混合行；越界索引 warning。
- `appendClassToYaml`：list 与 dict 写法各自追加并保留排版；`nc` 同步 +1；返回索引正确。

纯函数部分无需文件系统。

## 9. 非目标（YAGNI）

- 不支持 `train/val/test` 指向 `.txt` 清单文件（v1 仅目录）。
- 不支持 LabelMe ↔ YOLO 双向同步存储（一个面板只用一种格式）。
- 不在本功能内改动现有 COCO/YOLO 的「导出数据集」对话框。
- 不支持 OBB（旋转框）等扩展 YOLO 行格式。
