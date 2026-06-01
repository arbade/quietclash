# HANDOFF — sentinel (devam notu)

> Yeni bir session açtığında bu dosyayı oku. Projenin tam durumu, nasıl çalıştığı ve sıradaki adımlar burada.

## Bu proje ne?

**`sentinel`** — paralel AI coding agent'ların (Claude Code, Cursor, Codex) ürettiği, **git'in göremediği sessiz davranışsal merge çatışmalarını** yakalayan açık-kaynak CLI.

**Tek cümlelik problem:** İki agent `score` fonksiyonunu farklı satırlarda değiştirir (A: `×2`, B: `+10`). Git temiz merge eder, testler geçer, ama merged sonuç `(x*2)+10` — ne A'nın ne B'nin niyeti. Bunu yakalayan başka ürün yok (Composio bile roadmap'inde "Reconciler" diye bekletiyor).

**Hedef:** Pure-OSS, GitHub yıldızı/itibar (gelir değil).

## Buraya nasıl geldik (2 ölü fikir)

1. Token-efficiency skill istendi → saha doymuş (ccusage, RTK, token-optimizer). Reducer hook'u RTK'nın zararlı kopyasıydı, terk edildi.
2. "Teşhis + kanıt" token aracı → Anthropic'in native `/usage`'ı zaten per-component attribution yapıyor, öldü.
3. Geniş + adversaryel araştırma → tek gerçek boşluk: **paralel agent semantik merge çatışması tespiti**. Bu seçildi.

(Tam araştırma kaydı: `~/.claude/plans/iridescent-scribbling-thacker.md` ve hafıza dosyası `proof-token-project.md`.)

## Mevcut durum: v0 ÇALIŞIYOR ✅

- **24/24 test geçiyor:** `npm test` (seri çalışır — `--test-concurrency=1`).
- **Benchmark:** `node bench/eval.js` → 3 TP / 4 TN / 0 FP / 0 FN, precision=recall=1.
- **Headline:** "git'in göremediği temiz-merge edilen test-geçen çatışmaların %100'ünü yakaladı, 0 yanlış alarm."
- **Çalışan demo:** `/tmp/sd2` repo'su (silinmiş olabilir; bench fixture'ları aynı senaryoyu kurar).

### Mimari (veri akışı)
```
bin/sentinel.js              CLI (check / explain / bench)
  └─ src/check.js            orchestrator — pipeline'ı yönetir
       git/worktrees.js      ref çöz, temiz-merge teyit, 4 worktree materialize et
       git/changedSymbols.js AST diff (typescript-estree) — dokunulan semboller
       overlap/detectOverlap direct (2+ agent aynı sembol) + contract (üretici/tüketici)
       probe/synthTests.js   sembolün arity'sinden girdi tuple'ları üret
       probe/runProbe.js     sembolü 4 dünyada (base/A/B/merged) AYRI node process'te
                             çalıştır, davranış imzası yakala
       analyze/behavioralDiff classifyInput → clash türleri (lost-A/clash-both-broken vb.)
       analyze/filterFP      non-deterministik + tek-soft-input FP'leri ele (make-or-break)
       analyze/explain.js    opsiyonel Claude API (haiku) açıklama; yoksa yapısal fallback
       report/render.js      terminal + JSON çıktı
  bench/scenarios.js + eval.js   etiketli senaryolar + precision/recall/headline
```

### Öğrenilen kritik dersler (tekrar düşmemek için)
1. **Conflict fixture'ları:** iki agent'ın değiştirdiği satırlar git'in 3-satır merge context'inden uzak olmalı, yoksa git textual conflict görür. `PAD()` filler kullanıldı.
2. **Cleanup senkron olmalı** (`execFileSync`), async olursa test bittikten sonra dangling activity → unhandledRejection.
3. **Testler seri koşmalı** — paralel worktree/subprocess kaynak yarışı flaky timeout→FN üretiyor.
4. Read tool / hook ile token azaltma teknik olarak kapalıydı — o yüzden bu projeye geçtik.

## SIRADAKİ ADIMLAR (yapılacaklar)

Öncelik sırası önerisi:
1. **Contract-conflict'i davranışsal kanıtla** — şu an sadece "hint". En güçlü demo bu olur: merged worktree'de tüketici fonksiyonu çalıştırıp niyetinden saptığını göster. (`src/check.js` + `overlap` contract dalı.)
2. **Demo GIF** — README başına, yıldız için kritik.
3. **GitHub'a push** — git init + commit hazır (aşağıya bak), repo adı öneri: `agent-sentinel`.
4. **`npm publish`** — `agent-sentinel` paket adıyla.
5. v1: Python/Go dil desteği, GitHub Action, N-way (2'den fazla branch) çatışma.

## Çalıştırma komutları
```bash
cd sentinel
npm install
npm test                                              # 24/24 geçmeli
node bench/eval.js                                    # headline sayı
node bin/sentinel.js check --base <ref> --branches a,b --cwd <repo>
```

## Eski/atıl
`../proof/` dizini terk edilen token-reducer fikrinden kaldı, silinebilir.
