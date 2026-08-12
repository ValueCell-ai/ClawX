
<p align="center">
  <img src="src/assets/logo.svg" width="128" height="128" alt="ClawX Logo" />
</p>

<h1 align="center">ClawX</h1>

<p align="center">
  <strong>OpenClaw AIエージェントのためのデスクトップインターフェース</strong>
</p>

<p align="center">
  <a href="#clawxを選ぶ理由">ClawXを選ぶ理由</a> •
  <a href="#はじめに">はじめに</a> •
  <a href="#アーキテクチャ">アーキテクチャ</a> •
  <a href="#開発">開発</a> •
  <a href="#コントリビューション">コントリビューション</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-MacOS%20%7C%20Windows%20%7C%20Linux-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/electron-40+-47848F?logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/react-19-61DAFB?logo=react" alt="React" />
  <a href="https://discord.com/invite/84Kex3GGAh" target="_blank">
  <img src="https://img.shields.io/discord/1399603591471435907?logo=discord&labelColor=%20%235462eb&logoColor=%20%23f5f5f5&color=%20%235462eb" alt="chat on Discord" />
  </a>
  <img src="https://img.shields.io/github/downloads/ValueCell-ai/ClawX/total?color=%23027DEB" alt="Downloads" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh-CN.md">简体中文</a> | 日本語 | <a href="README.ru-RU.md">Русский</a>
</p>

---

## 概要

**ClawX**は、強力なAIエージェントと日常のユーザーとの間のギャップを埋めます。[OpenClaw](https://github.com/OpenClaw)をベースに構築されており、コマンドラインによるAIオーケストレーションを、使いやすく美しいデスクトップ体験に変換します。ターミナルは必要ありません。

ワークフローの自動化、AI搭載チャネルの管理、インテリジェントなタスクのスケジューリングなど、ClawXはAIエージェントを効果的に活用するために必要なインターフェースを提供します。

ClawXにはベストプラクティスに基づくモデルプロバイダーがあらかじめ設定されており、Windowsと多言語設定をネイティブにサポートしています。高度な設定は **設定 → 詳細設定 → 開発者モード** から調整できます。

<p align="center"><strong style="font-size:1.1em; text-decoration: underline;">完全なエンタープライズ版、専用サービスサポート、またはビジネスシナリオに合わせた導入支援が必要な場合は、<a href="mailto:public@valuecell.ai">public@valuecell.ai</a> までお問い合わせください。</strong></p>

## スクリーンショット

<table>
  <tr>
    <td align="center"><img src="resources/screenshot/jp/chat.png" alt="Chat"><br><em>チャット</em></td>
    <td align="center"><img src="resources/screenshot/jp/cron.png" alt="Cron"><br><em>スケジュールタスク</em></td>
  </tr>
  <tr>
    <td align="center"><img src="resources/screenshot/jp/skills.png" alt="Skills"><br><em>スキル</em></td>
    <td align="center"><img src="resources/screenshot/jp/channels.png" alt="Channels"><br><em>チャネル</em></td>
  </tr>
  <tr>
    <td align="center"><img src="resources/screenshot/jp/models.png" alt="Models"><br><em>モデル</em></td>
    <td align="center"><img src="resources/screenshot/jp/settings.png" alt="Settings"><br><em>設定</em></td>
  </tr>
</table>

## ClawXを選ぶ理由

AIエージェントの構築にコマンドラインの習得は不要であるべきです。ClawXはシンプルな哲学のもとに設計されました：**強力な技術には、あなたの時間を尊重するインターフェースがふさわしい。** ClawXは公式の **OpenClaw** コアを直接ベースに構築されています。別途インストールする必要はなく、ランタイムをアプリケーション内に組み込むことで、シームレスな「すべて込み」の体験を提供します。上流のOpenClawと緊密に連携し、公式の最新機能、安定性の改善、エコシステムとの互換性を利用できるようにしています。

| 課題 | ClawXのソリューション |
|------|----------------------|
| 複雑なCLIセットアップ | ガイド付きセットアップウィザードによるワンクリックインストール |
| 設定ファイル | リアルタイム検証付きのビジュアル設定 |
| プロセス管理 | Gatewayライフサイクルの自動管理 |
| アプリの更新 | 起動時に更新を確認し、ダウンロードまたはインストール前に通知 |
| 複数のAIプロバイダー | 統合プロバイダー設定パネル |
| スキル/プラグインのインストール | オプションの拡張機能マーケットプレイスにも対応したローカル優先のスキル管理 |

### 機能

- **🎯 ゼロ設定バリア**：直感的なグラフィカルインターフェースでセットアップを完了できます。ターミナルコマンド、YAMLファイル、環境変数の探索は不要です。
- **💬 インテリジェントチャットインターフェース**：複数セッションのコンテキストと履歴、シンタックスハイライト付きストリーミングMarkdown、CJK対応解析、テーブル、KaTeX数式、`@agent` による直接ルーティング、インライン `/skill` カード、ワークスペース優先のセッション、Markdown・`.docx`・`.pptx`・ローカルHTMLの読み取り専用プレビューに対応します。
- **📡 マルチチャネル管理**：複数アカウント、アカウント単位のAgent紐付け、既定アカウントの切り替え、Tencent公式個人WeChatチャネルプラグインを備えた独立したAIチャネルを設定・監視できます。
- **⏰ Cronベースの自動化**：繰り返しまたは1回限りのスケジュールを定義し、スケジュール済みプロンプトにスキルを挿入し、結果を外部チャネルへ配信できます。
- **🧩 拡張可能なスキルシステム**：Gatewayに依存せずスキルをローカルで管理できます。複数のOpenClawソースからスキルを検出し、`pdf`、`xlsx`、`docx`、`pptx` の文書処理スキルも利用できます。
- **🔐 セキュアなプロバイダー統合**：OpenAI、Anthropic、Z.AI / GLMなどに接続し、認証情報をOSのネイティブキーチェーンに安全に保存できます。OAuth、カスタムプロバイダー、画像生成エンドポイント、互換性フォールバックにも対応します。
- **🌙 アダプティブテーマ**：ライト、ダーク、システム同期テーマを選択できます。
- **🚀 自動起動設定**：**設定 → 一般** で **システム起動時に自動起動** を有効にできます。
- **🔔 更新通知**：起動時に新しいバージョンを確認し、ダウンロードまたはインストールするかを選択できます。

> 機能の詳細は [docs/ja-JP/features.md](docs/ja-JP/features.md) を参照してください。

### 主なユースケース

- **🤖 パーソナルAIアシスタント**：質問への回答、メールの下書き、ドキュメントの要約、日常タスクの支援を行う汎用AIエージェントを、クリーンなデスクトップインターフェースから設定できます。
- **📊 自動モニタリング**：ニュースフィード、価格、特定のイベントを監視するスケジュールエージェントを設定し、結果を希望する通知チャネルへ届けられます。
- **💻 開発者の生産性向上**：AIを開発ワークフローに統合し、コードレビュー、ドキュメント生成、繰り返しのコーディング作業を行えます。
- **🔄 ワークフロー自動化**：複数のスキルをビジュアルな自動化パイプラインに組み合わせ、データ処理、コンテンツ変換、アクションの実行を行えます。

## はじめに

### システム要件

- **オペレーティングシステム**：macOS 11以上、Windows 10以上、またはLinux（Ubuntu 20.04以上）
- **メモリ**：最低4GB RAM（8GB推奨）
- **ストレージ**：1GBの空きディスク容量

### インストール

#### ビルド済みリリース（推奨）

[Releases](https://github.com/ValueCell-ai/ClawX/releases) ページから、お使いのプラットフォーム向けの最新リリースをダウンロードしてください。

#### ソースからビルド

```bash
# リポジトリをクローン
git clone https://github.com/ValueCell-ai/ClawX.git
cd ClawX

# プロジェクトを初期化
pnpm run init

# 開発モードで起動
pnpm dev
```

### 初回起動

ClawXを初めて起動すると、**セットアップウィザード**が次の手順を案内します。

1. **言語と地域**：使用するロケールを設定
2. **AIプロバイダー**：ブラウザまたはデバイスログインに対応したプロバイダーでは、APIキーまたはOAuthで追加
3. **スキルバンドル**：一般的なユースケース向けの事前設定スキルを選択
4. **検証**：メインインターフェースに入る前に設定をテスト

サポートされている場合、ウィザードはシステム言語を初期選択し、対応していない場合は英語にフォールバックします。

> Web検索について：ClawXはAgentとGatewayの両方のポリシーレイヤーで、OpenClawの汎用 `web_search` ツールを無効にします。Moonshot（Kimi）検索も対象です。管理対象のブラウザ自動化と `web_fetch` は引き続き利用できます。
>
> 内部ツールについて：ClawXは両方のポリシーレイヤーで、Agentに対して `gateway`、`nodes`、`create_goal`、`get_goal`、`update_goal` も無効にします。ClawXアプリケーション自身のGateway RPCに加え、メッセージング、セッションオーケストレーション、Agent検出ツールは引き続き利用できます。

### プロキシ設定

ClawXには、Electron、OpenClaw Gateway、Telegramなどのチャネルがローカルプロキシクライアント経由でインターネットにアクセスする必要がある環境向けの、組み込みプロキシ設定があります。

**設定 → Gateway → プロキシ**を開き、既定のプロキシ、バイパスルール、開発者モードでのHTTP・HTTPS・`ALL_PROXY` / SOCKSの上書きを設定します。ローカル設定の例は `http://127.0.0.1:7890` です。

> プロキシのフォールバック動作、Telegramとの同期、**OpenClaw Doctor**については [docs/ja-JP/proxy-settings.md](docs/ja-JP/proxy-settings.md) を参照してください。

## アーキテクチャ

ClawXは **Host API統一レイヤーを備えたデュアルプロセスアーキテクチャ**を採用しています。React Rendererは単一のクライアント抽象を呼び出し、Electron Mainがプロトコル選択、Gatewayのライフサイクル、ACP Chatのstdio bridgeを管理します。

- **プロセスモデル**：Electron Mainがウィンドウ、Gateway監視、システム統合、更新を管理します。OpenClaw GatewayはAIオーケストレーション、チャネル、スキル機能を提供し、Rendererはローカルエンドポイントへ直接アクセスしません。
- **設定の配信**：Gateway実行中は `config.get` / `config.set` を使い、停止中または起動中は解決済みJSON5設定を更新します。通常のプロバイダー、Agent、スキル、モデル変更ではプロセスを置き換えず、認証情報は `secrets.reload` でホットリロードされます。ハートビートが4回連続で失敗した場合は、ライフサイクルで保護された復旧を要求します。
- **ACP Chat**：Chat UIは [ACP（Agent Client Protocol）](https://agentclientprotocol.com) を介してOpenClawとやり取りし、頻繁に反復されるOpenClawの前に比較的安定したチャットプロトコル面を確保します。ACPはMainが所有するstdio bridge経由で動作し、設定リロード後の認証済み履歴リプレイ、ページ移動中のストリーミング、Mainが検証したメディア・添付ファイル・ファイルアクティビティに対応します。保護されたGateway再起動によって受理済みターンが中断された場合、パッチ済みOpenClawランタイムは復旧runを元のACP promptへ明示的に関連付け、後続のテキストとツールアクティビティを同じメモリ内ターンで継続します。その後の履歴リプレイでも、永続化されたツール境界をネイティブACP updateとして復元します。
- **設計原則**：フロントエンドの単一入口、Mainによるトランスポート管理、再接続・タイムアウト・バックオフによるグレースフルリカバリ、安全なストレージ、CORSセーフな境界を採用しています。

> プロセス図、設定の調整、ACPファイルアクティビティのセマンティクス、Gatewayのトラブルシューティングについては [docs/ja-JP/architecture.md](docs/ja-JP/architecture.md) を参照してください。

## 開発

### 前提条件

- **Node.js**：対応するメジャー系列の22.22.3以上、24.15.0以上、または25.9.0以上（Node 24 LTS推奨）
- **パッケージマネージャー**：pnpm 9以上（npmも対応）
- **Linux（Ubuntu/Debian）**：Electronの実行前に必要なシステムライブラリをインストールしてください。詳細は [docs/ja-JP/development.md](docs/ja-JP/development.md) を参照してください。

### よく使うコマンド

```bash
pnpm run init        # 依存関係をインストールし、バンドルランタイムをダウンロード
pnpm dev             # ホットリロード付きで開発モードを起動
pnpm lint            # ESLintを実行
pnpm typecheck       # TypeScriptを検証
pnpm test            # ユニットテストを実行
pnpm run test:e2e    # Electron E2Eスモークテストを実行
pnpm build           # 本番ビルドを実行
pnpm package         # 現在のプラットフォーム向けにパッケージ化（:mac / :win / :linux）
```

> プロジェクト構成、完全なコマンド一覧、E2Eの並列実行ポリシー、パフォーマンス診断、通信回帰チェック、技術スタックについては [docs/ja-JP/development.md](docs/ja-JP/development.md) を参照してください。

## コントリビューション

コミュニティからの貢献を歓迎します。バグ修正、新機能、ドキュメントの改善、翻訳など、あらゆる貢献がClawXをより良くします。

### 貢献方法

1. リポジトリを**フォーク**する
2. フィーチャーブランチを**作成**する（`git checkout -b feature/amazing-feature`）
3. 明確なメッセージで変更を**コミット**する
4. ブランチに**プッシュ**する
5. **Pull Request**を作成する

### ガイドライン

- 既存のコードスタイル（ESLint + Prettier）に従う
- 新機能にはテストを書く
- 必要に応じてドキュメントを更新する
- コミットはアトミックかつ説明的に保つ

## 謝辞

ClawXは次の優れたオープンソースプロジェクトの上に構築されています。

- [OpenClaw](https://github.com/OpenClaw) - AIエージェントランタイム
- [Electron](https://www.electronjs.org/) - クロスプラットフォームデスクトップフレームワーク
- [React](https://react.dev/) - UIコンポーネントライブラリ
- [shadcn/ui](https://ui.shadcn.com/) - 美しく設計されたコンポーネント
- [Zustand](https://github.com/pmndrs/zustand) - 軽量な状態管理

## コミュニティ

コミュニティに参加して、他のユーザーと交流し、サポートを受け、体験を共有しましょう。

| 企業WeChat | Feishuグループ | Discord |
| :---: | :---: | :---: |
| <img src="src/assets/community/wecom-qr.png" width="150" alt="WeChat QRコード" /> | <img src="src/assets/community/feishu-qr.png" width="150" alt="Feishu QRコード" /> | <img src="src/assets/community/20260212-185822.png" width="150" alt="Discord QRコード" /> |

### ClawXパートナープログラム

ClawXをより多くのお客様、特にカスタムAIエージェントや自動化のニーズを持つお客様に紹介してくださるパートナーを募集しています。

パートナーは見込みユーザーやプロジェクトとの接点づくりを担い、ClawXチームは技術サポート、カスタマイズ、統合を全面的に提供します。AIツールや自動化に関心のあるお客様と仕事をされている方は、ぜひご一緒ください。

詳細はDM、または [public@valuecell.ai](mailto:public@valuecell.ai) までお問い合わせください。

## Star History

<p align="center">
  <img src="https://api.star-history.com/svg?repos=ValueCell-ai/ClawX&type=Date" alt="Star History Chart" />
</p>

## ライセンス

ClawXは [MITライセンス](LICENSE) のもとで公開されています。本ソフトウェアは自由に使用、変更、配布できます。

<hr>

<p align="center">
  <sub>ValueCell Teamが❤️を込めて開発</sub>
</p>
