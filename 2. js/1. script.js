// 1. script.js
// メインローダー: 2～7の機能別ファイルを元の順序で読み込み、元のコード構成をそのまま実行します。
(() => {
  const currentScript = document.currentScript;
  if (!currentScript) {
    console.error('1. script.js の読み込み元を特定できません');
    return;
  }
  const baseUrl = new URL('./', currentScript.src);
  const parts = [
    '2. core-storage.js',
    '3. audio-engine.js',
    '4. library.js',
    '5. player.js',
    '6. playlists.js',
    '7. ui.js'
  ];

  Promise.all(
    parts.map(name =>
      fetch(new URL(encodeURI(name), baseUrl).href).then(r => {
        if (!r.ok) throw new Error(`JSファイルの読み込みに失敗しました: ${name}`);
        return r.text();
      })
    )
  )
    .then(chunks => {
      // 各ファイルは元のscript.jsを安全な位置で分割した断片です。
      // 元と同じ順序で連結して実行することで、変数・関数のスコープと依存関係を維持します。
      const source = chunks.join('');
      new Function(source)();
    })
    .catch(err => {
      console.error(err);
      const toast = document.getElementById('toast');
      if (toast) {
        toast.textContent = 'JavaScriptの読み込みに失敗しました';
        toast.classList.add('show');
      }
    });
})();
