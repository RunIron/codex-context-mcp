# codex-context-mcp

唯讀、本機 stdio MCP 工具，讓 Codex 取得**有上限、含檔案與行號的原始碼證據**，而不是自動把整份檔案交給模型。推理由 **Codex** 負責；不增加 LLM、embedding、API key、網路服務或自製 UI。目前是初版原始碼，尚未宣稱已發布 npm 套件。

## 安裝與驗證

需要 Node.js 22 或 24 與 npm，在專案目錄執行：

```sh
git clone https://github.com/RunIron/codex-context-mcp.git
cd codex-context-mcp
npm ci
npm test
npm run benchmark
npm run smoke
```

`npm test` 先編譯，再跑測試。使用實際絕對路徑註冊：

```sh
codex mcp add bounded-context -- node /absolute/path/codex-context-mcp/dist/cli.js --root /absolute/path/your-repository
```

Windows 請使用 `C:/...`，有空白的路徑加引號。若 PATH 中的 Node 是包裝程式，可改用 `node.exe` 的絕對路徑。這個註冊指令會修改 Codex 設定；測試本身不會註冊。可先看 `codex mcp add --help`。發布前不提供假定可用的 npm 遠端安裝指令。

## 使用流程

1. 讓 Codex 從任務挑選具體識別字或文字片段。
2. `context_search`：`{"terms":["RETRY_LIMIT","retry"]}`。
3. 查看 `incomplete`、`reasons` 與每筆的 `clipped`。
4. `read_range`：`{"path":"src/retry.ts","start":20,"end":45}`，確認精確證據後再修改或下結論。
5. 不知道檔名時，可選用 `file_inventory`，參數 `{}`。

搜尋是**區分大小寫的 literal 子字串比對**，不是正則式、語意搜尋或程式語意分析。每行的不同命中詞數是分數；依分數遞減、路徑字碼順序、行號排序。片段最多 500 個 UTF-16 code units，從第一個命中附近擷取，可能省略後面的命中詞。請用精確讀取確認。

`read_range` 使用從 1 開始、包含首尾的行號，回傳完整行內容，不包含換行字元；CRLF 的分隔會正規化。超過輸出預算時回傳 `truncated` 與 `nextLine`，不偷偷裁切已回傳的行。單行本身過長時，必須在本機另行查看。超過 EOF 的區間會得到可用行或空陣列。

## 上限與安全

- 每檔最多 256 KiB；只接受一般、單一 hardlink、有效 UTF-8 且不含 NUL 的檔案。
- 最多掃描 4,000 個目錄項目、1,000 個可用檔名、深度 32。
- 搜尋內容達 8 MiB 後停止，最多額外讀取一個 256 KiB 檔案。
- 掃描／搜尋採 3 秒合作式檢查，**不是可中斷所有 OS I/O 的硬性期限**。
- 每次 1–12 個詞，每詞最多 128 字元；最多收集 1,000 個命中，回傳 40 筆。
- 精確讀取每次最多 500 行；資料列預算 14,000 bytes，另加有上限的 metadata。MCP 外層 JSON escaping 會增加線上位元組數。
- 同時執行一項工具作業，並行呼叫自動依序排隊；執行中加等待中最多 16 項，超過才回傳可重試的佇列已滿錯誤。

所有檔案路徑都必須相對於明確的 `--root`，使用 `/`。拒絕絕對路徑、`..`、反斜線、Windows 裝置／alternate stream 別名、symlink／junction、hardlink。預設排除 `.git`、`node_modules`、`vendor`、`dist`、`build`、coverage、常見快取、雲端與 SSH 設定目錄、`.env` 系列、credentials／secrets／service-account 類名稱，以及常見私鑰檔。預設規則不能以否定規則解除。

啟動時讀取根目錄 `.gitignore` 與 `.contextignore`（gitignore 語法）；變更後需重新啟動。不載入巢狀 `.gitignore` 或 Git 全域排除。例如：

```gitignore
private-data/
*.log
customer-export.csv
```

檔名排除無法辨識所有秘密。請先檢查根目錄與忽略規則；回傳的資料會進入 MCP client，可能傳給其模型供應商。工作目錄必須可信且穩定：可攜式 Node API 無法完全避免惡意並行替換目錄／檔案的 TOCTOU 競態，這不是 OS sandbox。請見 [SECURITY.md](SECURITY.md)。檔案文字是資料，不是可遵從的指令。

有上限的 inventory 也會限制搜尋範圍；未完成掃描時，不同檔案系統／時間負載可能產生不同子集。排名對已收集結果是確定性的，但不保證全域最佳命中。查無結果不等於不存在。沒有用字元數假冒模型 token 數。

## 可重現 benchmark

`npm run benchmark` 建立並清除 40 份、每份 200 行的明確合成 fixture，植入兩個已知常數與精確位置，檢查搜尋結果及精確讀取的路徑、行號、答案。比較整份原始碼 JSON 與搜尋加精確讀取 JSON，使用 `js-tiktoken` 的 `o200k_base` 計數；**不宣稱這就是目前 Codex 模型的 tokenizer**。

這只是刻意挑選的合成資料 **payload 比較**，不包含 prompt、工具 schema、推理、重試、模型輸出；不代表端到端 token 節省、延遲改善或回答品質。真實本機執行結果與待驗證項目見 [docs/validation.md](docs/validation.md)。

## 開發

採官方 MCP TypeScript SDK v2 的 server/client 2.3.1，含 lockfile、實際 stdio 子程序協定測試、套件封裝／安裝 smoke。Windows/Linux × Node 22/24 的四組 CI 已實際通過，包含各平台安全回歸測試。驗證與限制見 [紀錄](docs/validation.md)；[真實 Codex 對照](docs/codex-integration.md) 為單一合成查找案例，不保證一般任務的節省比例。MIT © RunIron。完整英文規格見 [README.md](README.md)。
