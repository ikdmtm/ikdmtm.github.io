# ikdmtm.github.io

作ったものを置いているページです。`main` に push すると GitHub Pages に反映されます。

## 作品の追加

1. 画像や動画を `assets/` に置きます。
2. `index.html` の `<ol class="index">` に1行足します。
3. `<main>` の中に次のブロックを足します。

```html
<section class="work" id="作品のid" style="--bg:#背景色;--fg:#文字色;--accent:#強調色">
  <div class="inner split">
    <div class="copy">
      <p class="kind">種類</p>
      <h2>作品名</h2>
      <p>説明</p>
      <p class="tech">使った技術</p>
      <a class="go" href="URL" target="_blank" rel="noopener">遊ぶ →</a>
    </div>
    <div class="shot"><img src="assets/画像.webp" alt="画像の説明" loading="lazy"></div>
  </div>
</section>
```

制作中でリンクがない作品は、`<a class="go">` の代わりに `<span class="state">制作中</span>` を使います。
