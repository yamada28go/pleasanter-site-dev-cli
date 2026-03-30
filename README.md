# pleasanter-site-dev-cli

Pleasanter の `getsite` / `updatesitesettings` API を使って、サイト設定のバックアップと `Scripts` / `ServerScripts` 更新を行う CLI です。

対象 API:

- `POST /api/items/{siteId}/getsite`
- `POST /api/items/{siteId}/updatesitesettings`

Pleasanter のマニュアル:

- https://pleasanter.org/ja/manual/api-site-get
- https://pleasanter.org/ja/manual/api-update-sitesettings

## 前提

- Node.js 18 以上
- API キーに対象サイトの管理権限があること
- `base-url` は `https://example.com` または `https://pleasanter.net/fs` のように、Pleasanter のルートまでを指定すること

## インストール

```bash
npm install pleasanter-site-dev-cli
```

ローカル開発時:

```bash
npm install
npm run build
node dist/cli.js help
```

## コマンド

### バックアップ

```bash
pleasanter-site-dev backup \
  --base-url https://example.com \
  --site-id 12345 \
  --api-key-file ~/.config/pleasanter/api-key.txt
```

出力先を固定したい場合:

```bash
pleasanter-site-dev backup \
  --base-url https://example.com \
  --site-id 12345 \
  --api-key-file ~/.config/pleasanter/api-key.txt \
  --out ./backups/site-settings.json
```

### 更新

更新前に自動でバックアップを作成し、その後 `Scripts` / `ServerScripts` を更新します。

```bash
pleasanter-site-dev push \
  --base-url https://example.com \
  --site-id 12345 \
  --api-key-file ~/.config/pleasanter/api-key.txt \
  --config ./examples/site-settings.config.json
```

バックアップを無効にする場合:

```bash
pleasanter-site-dev push \
  --base-url https://example.com \
  --site-id 12345 \
  --api-key-file ~/.config/pleasanter/api-key.txt \
  --config ./examples/site-settings.config.json \
  --skip-backup
```

API に送る JSON を確認だけしたい場合:

```bash
pleasanter-site-dev push \
  --base-url https://example.com \
  --site-id 12345 \
  --api-key-file ~/.config/pleasanter/api-key.txt \
  --config ./examples/site-settings.config.json \
  --dry-run
```

## APIキーの渡し方

`package.json` の script や CI から呼び出す場合は、`--api-key` で値を直接渡すよりも、環境変数または `--api-key-file` / `PLEASANTER_API_KEY_FILE` を使う方が安全です。

- 推奨: `PLEASANTER_API_KEY`
- 推奨: `PLEASANTER_API_KEY_FILE`
- 互換用: `--api-key`

`--api-key-file` と `PLEASANTER_API_KEY_FILE` は、APIキーだけを書いたテキストファイルを読み込みます。末尾改行は自動で取り除きます。

```bash
export PLEASANTER_API_KEY_FILE=~/.config/pleasanter/api-key.txt
pleasanter-site-dev backup --base-url https://example.com --site-id 12345
```

`package.json` では、秘密値そのものを埋め込まずにコマンドだけを定義してください。

```json
{
  "scripts": {
    "pleasanter:push": "pleasanter-site-dev push --base-url https://example.com --site-id 12345 --config ./examples/site-settings.config.json"
  }
}
```

## 設定ファイル

設定ファイルは JSON です。`Body` を直接書くか、`BodyFile` で外部ファイルを参照できます。`BodyFile` の相対パスは設定ファイル基準で解決されます。

```json
{
  "scripts": [
    {
      "Id": 1,
      "Title": "sample script",
      "BodyFile": "./scripts/sample-script.js",
      "ScriptAll": true
    }
  ],
  "serverScripts": [
    {
      "Id": 9,
      "Title": "sample server script",
      "Name": "SampleServerScript9",
      "BodyFile": "./server-scripts/sample-server-script.csx",
      "ServerScriptWhenloadingSiteSettings": true
    }
  ]
}
```

`push` 時には `BodyFile` を読み込んで `Body` に展開し、Pleasanter の `updatesitesettings` に以下のような形で送信します。

```json
{
  "ApiVersion": 1.1,
  "ApiKey": "xxxxx",
  "Scripts": [
    {
      "Id": 1,
      "Title": "sample script",
      "Body": "console.log('sample');",
      "ScriptAll": true
    }
  ],
  "ServerScripts": [
    {
      "Id": 9,
      "Title": "sample server script",
      "Name": "SampleServerScript9",
      "Body": "context.Log('sample');",
      "ServerScriptWhenloadingSiteSettings": true
    }
  ]
}
```

## 環境変数

以下でも指定できます。

```bash
export PLEASANTER_BASE_URL=https://example.com
export PLEASANTER_SITE_ID=12345
export PLEASANTER_API_KEY=xxxxx
export PLEASANTER_API_KEY_FILE=~/.config/pleasanter/api-key.txt
export PLEASANTER_API_VERSION=1.1
```

## バックアップファイル

バックアップには以下を保存します。

- 取得した `site` 全体
- `site.SiteSettings.Scripts`
- `site.SiteSettings.ServerScripts`

出力先のデフォルトは `./backups` です。
