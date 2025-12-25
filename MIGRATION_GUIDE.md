# Muse TypeScript クライアント - 古型 vs Athena

## ファイル構成

```
src/
├── muse.ts           ← 古型Muse用（変更なし）
├── muse_athena.ts    ← Athena新型用（新規追加）
├── muse.spec.ts
└── lib/
    ├── athena-parser.ts        ← Athenaパケット解析
    ├── muse-interfaces.ts      ← 共通インターフェース
    ├── muse-parse.ts
    ├── muse-utils.ts
    └── ...
```

## 使い分け

### 古型Muse → `MuseClient`
```typescript
import { MuseClient } from './muse';

const client = new MuseClient();
await client.connect();
await client.start();

client.eegReadings.subscribe(reading => {
    console.log('EEG:', reading.samples);
});
```

### Athena新型 → `MuseAthenaClient`
```typescript
import { MuseAthenaClient } from './muse_athena';

const client = new MuseAthenaClient();
await client.connect();
await client.start();

client.athenaEegReadings.subscribe(reading => {
    console.log('EEG:', reading.samples);
});
```

## 主な違い

| 項目 | MuseClient | MuseAthenaClient |
|-----|-----------|-----------------|
| 対象デバイス | Gen2/Gen3など古型 | Athena（新型） |
| パケット形式 | チャネル別 | タグベース |
| EEG特性 | 5個（TP9-AUX） | 統合センサー特性 |
| ストリーム | 個別特性から | 1つの特性から |
| 予設コマンド | p20, p21, p50 | p21, p1034, p1035, p1045 |

## Athenaのストリーム

`MuseAthenaClient`は4つのObservableを提供：

```typescript
// EEG（0x12 tag, 256Hz）
client.athenaEegReadings.subscribe(reading => {
    console.log(reading.samples); // 16値
});

// IMU（0x47 tag, 52Hz）
client.athenaAccGyroReadings.subscribe(reading => {
    console.log(reading.acc);   // 3サンプル
    console.log(reading.gyro);  // 3サンプル
});

// 光学（0x34 tag, 64Hz）
client.athenaOpticalReadings.subscribe(reading => {
    console.log(reading.samples); // 12値
});

// バッテリー（0x98 tag, 0.1Hz）
client.athenaBatteryData.subscribe(data => {
    console.log(data.values); // 10値
});
```

## コマンド対応

### MuseClient
```typescript
await client.sendCommand('v1');  // バージョン
await client.sendCommand('d');   // ストリーミング開始
await client.start();            // 自動初期化
```

### MuseAthenaClient
```typescript
await client.sendCommand('v4');     // Athena用バージョン
await client.sendCommand('p1045');  // Athenaプリセット
await client.start('p1045', 'p21'); // 2段階プリセット
```

---

**重要**: 両方のクライアントを並行使用することはできません。接続するデバイスに応じて、どちらか一方を選択してください。
