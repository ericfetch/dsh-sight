# dsh-sight

DeepSeek Harness 鎻掍欢锛堢ぞ鍖烘爣鍑?`dsh.bundle` 褰㈡€侊級锛?*澶氭ā鎬佸浘鐗囩洿浼犲０鏄?* + **浼氳瘽鍥剧墖娓呴櫎**銆?
- **澶氭ā鎬佸浘鐗囩洿浼?*锛氭妸 `input: ['text','image']` 鍐欒繘 `llm-pi-ai` 閰嶇疆锛堝唴缃富娴佸妯℃€佹ā鍨嬪瓧鍏?/ 璁剧疆椤甸€愭ā鍨嬪紑鍏筹級锛岃澶氭ā鎬佹ā鍨嬶紙qwen3.7-plus / kimi-k3 / glm-5.2 / gpt-5.6-* 绛夛級鐩存帴鎺ユ敹杈撳叆妗嗙矘璐寸殑鍥剧墖锛堝師鐢熷浘鐗囧唴瀹瑰潡锛屼笉鍋氭枃鏈浆鎹級銆?- **娓呴櫎浼氳瘽鍥剧墖**锛氱敤 surface replace锛坈ompaction 鍚屾鏈哄埗锛夋妸鍥剧墖浠?*妯″瀷鍙鍘嗗彶**绉婚櫎锛屼娇 `session.selectModel` 闂ㄧ鏀捐銆佸彲鍒囧洖绾枃鏈ā鍨嬶紱鐣岄潰杞綍淇濈暀鍘熷浘锛岄潪鐮村潖鎬с€佹寔涔呭寲銆?
## 缁撴瀯

| 璺緞 | 璇存槑 |
| --- | --- |
| `src/index.ts` | Host 鍗婂尯锛氭敞鍐?`/sight` loopback RPC 淇￠亾锛屽鐞?6 涓鐐癸紙status / setVision / applyDictionary / visionStatus / sessionImages / clearImages锛?|
| `src/client/index.ts` | 娴忚鍣ㄥ崐鍖猴細璁剧疆椤?+ 杈撳叆妗嗗窘鏍?+ 娓呴櫎鎸夐挳锛岀粡 `connection.rpc.call` 璋?Host |
| `src/config.ts` | 鍏变韩淇￠亾/绔偣/绫诲瀷 |
| `cordis.patch.yml` | bundle 琛ヤ竵灞?|
| `tsdown.config.ts` | 鐙珛鏋勫缓锛坣ode 鍗婂尯 + client bundle锛屾棤 monorepo 渚濊禆锛?|

## 鏋勫缓

```sh
pnpm install
pnpm build        # tsdown锛歭ib/index.js + lib/client.js
pnpm typecheck    # tsc --noEmit
```

## 瀹夎锛圖SH 鐢ㄦ埛渚э級

涓ょ鏂瑰紡浠婚€夊叾涓€锛圙itHub 瀹夎褰撳墠鍙敤锛沶pm 瀹夎闇€鍏堝彂甯冿紝瑙佷笅鏂广€屽彂甯冦€嶏級銆?
### 鏂瑰紡涓€锛欸itHub 瀹夎锛堝綋鍓嶅彲鐢級

```sh
# pnpm 鐨?github: 绠€鍐欙紙绛変环浜庡畬鏁?git 鍦板潃 git+https://github.com/ericfetch/dsh-sight.git#<sha>锛?dsh plugin --profile web add github:ericfetch/dsh-sight#33bdecfb929513684712d910c2482c96c808eb6d
```

git 瀹夎鎷夌殑鏄?*婧愮爜**锛宲npm 浼氳繍琛?`prepare`锛坱sdown锛夋瀯寤?鈥斺€?闇€瑕佹巿鏉冿細

1. 棣栨 `add` 浼氬け璐ワ紝pnpm 浼氭墦鍗颁竴涓?*绮剧‘**鐨?allowBuilds 閿紙褰㈠
   `@eric.wen/dsh-sight@https://codeload.github.com/ericfetch/dsh-sight/tar.gz/<sha>: true`锛夛紱
2. 鎶?*璇ョ簿纭敭**澶嶅埗杩涜 profile 鐨?`pnpm-workspace.yaml`锛?
   ```yaml
   allowBuilds:
     '@eric.wen/dsh-sight@https://codeload.github.com/ericfetch/dsh-sight/tar.gz/<sha>': true
   ```

3. 閲嶆柊鎵ц `add`銆?
濡傚疄鐪嬪緟杩欓」鎺堟潈锛氬畠鍏佽鍖呬唬鐮佸湪瀹夎鏃朵簬浣犵殑鏈哄櫒涓婃墽琛岋紝涓斾笉鍦?agent 鐨勬矙绠变箣鍐呫€?鍙婧愮爜鍙俊鐨勫寘鎺堟潈锛屽苟閿佸畾 commit锛坄#<sha>`锛夛紝璁╁悗缁帹閫佹棤娉曟倓鎮勬敼鍙樺疄闄呰繍琛岀殑鍐呭銆?
### 鏂瑰紡浜岋細npm 瀹夎锛堝彂甯冨悗鍙敤锛?
```sh
# 鍙戝竷鍒?npm 鍚庯紙瑙併€屽彂甯冦€嶏級锛岀洿鎺ユ寜鍖呭悕瀹夎 鈥斺€?npm 鍒嗗彂棰勬瀯寤?lib/锛屾棤闇€浠讳綍鎺堟潈
dsh plugin --profile web add @eric.wen/dsh-sight
```

### 楠岃瘉涓庨噸鍚紙涓ょ鏂瑰紡鐩稿悓锛?
```sh
dsh --profile web --dump-config   # 搴斿嚭鐜?"# == @eric.wen/dsh-sight" 琛ヤ竵灞?# 閲嶅惎 DSH Desktop 鈥斺€?鍚姩鏃舵寜 bundles 缁勫悎锛歨ost 琛屾縺娲汇€乧lient bundle 杩?__DSH_BOOT__
```

鍗歌浇锛歚dsh plugin --profile web remove @eric.wen/dsh-sight`

## 鍙戝竷

> 鈿狅笍 **npm 鍖呭悕 `dsh-sight` 宸茶浠栦汉鍗犵敤**锛坄fu3rte` 鐨勫彟涓€涓彃浠讹級銆傝鍙戝竷鍒?npm锛屽繀椤诲厛锛?> 1. 鏀瑰寘鍚嶏紙`package.json` 鐨?`name`锛夛紝渚嬪 `@eric.wen/dsh-sight` 鎴?`dsh-sight-direct` 绛夋湭琚崰鐢ㄧ殑鍚嶅瓧锛?> 2. 鏈満 `npm login`锛堥渶瑕佷綘鐨?npm 璐﹀彿锛夛紱
> 3. `npm publish`锛坄lib/` 宸查鏋勫缓锛宍prepare` 宸查厤缃紝git 瀹夎鏃惰嚜鍔ㄦ瀯寤猴級銆?>
> GitHub 浠撳簱鍚?`ericfetch/dsh-sight` 涓嶅彈褰卞搷锛圙itHub 鍖呭悕鍙法鐢ㄦ埛閲嶅锛夈€?
```sh
npm publish       # 鍙戝竷鍓嶅厛 pnpm build
```

## 璇存槑

- 銆屾敮鎸佸浘鐗囥€嶆槸鐢ㄦ埛瀵圭鐐圭殑澹版槑锛屾彃浠朵笉鍋氱鐐规帰娴嬶紱绔偣瀹為檯涓嶆敮鎸佸浘鐗囨椂鐢?provider 渚ф嫆缁濄€?- 娓呴櫎鍥剧墖鍙綔鐢ㄤ簬妯″瀷鍙鍘嗗彶锛坰urface锛夛紱鍘熷浜嬩欢浠嶇暀鍦ㄤ細璇濇棩蹇椾笌鐣岄潰杞綍涓€?- 渚濊禆鐨?`@deepseek-ai/*` 杩愯鏃剁敱 DSH 鐨勬ā鍧楄〃鎻愪緵锛坧eer 澹版槑锛夈€?
