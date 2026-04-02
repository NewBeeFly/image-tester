# 示例 JSON（门店招牌场景）

本目录提供可直接复制到页面里的片段（按你实际路径、店名修改）。

| 文件 | 用途 |
| --- | --- |
| [`case-variables-json-storefront.json`](case-variables-json-storefront.json) | 单条用例的 **`variables_json`**：`variables` 里放 `storeName`（期望值）等；`images.主图` 填**相对测试集 image_root** 的路径，且须与提示词里 `{{img:主图}}` 一致。 |
| [`suite-default-assertions-storefront.json`](suite-default-assertions-storefront.json) | 测试集的 **「默认断言 JSON」**：校验模型输出的 JSON 里 `isStorefront` 与 `storeName`（与用例变量 `storeName` 比对）。 |
| [`image-tester-metadata.json`](image-tester-metadata.json) | 复制到测试集 **`image_root` 根目录**，文件名可用 **`image-tester-metadata.json`** 或 **`metadata.json`**（二选一）。键为主图相对路径，值为 `variables` / `images` 对象；**覆盖**用例里 `variables_json` 的同名键（见主 README 合并顺序）。 |
| [`sidecar-next-to-image.json`](sidecar-next-to-image.json) | 内容示例：保存为与某张主图**同目录、同主文件名**的 `*.json`（如 `foo.png` 旁放 `foo.json`），无需在页面再贴一大段 JSON。 |

**说明**：元数据可以只写在「测试集与用例」的 **`variables_json`** 里；也可以**只在磁盘**用根清单或侧车维护，用例上留 `{}` 即可（仍须在系统里建用例并填好主图路径）。图片与 JSON 都放在 **`image_root`** 下，路径规则与用例 **`relative_image_path`** 一致，正斜杠 `/` 表示子目录。
