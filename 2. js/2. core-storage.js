// core-storage.js
async function parseID3(file) {
  try {
    // jsmediatagsの読み込み確認と安全なタグ解析
    if (typeof jsmediatags === 'undefined') {
      return { title: file.name, artist: 'Unknown Artist', picture: null };
    }

    return await new Promise((resolve) => {
      jsmediatags.read(file, {
        onSuccess: (tag) => {
          const tags = tag.tags;
          let pictureUrl = null;

          if (tags.picture) {
            const { data, format } = tags.picture;
            let base64String = "";
            for (let i = 0; i < data.length; i++) {
              base64String += String.fromCharCode(data[i]);
            }
            pictureUrl = `data:${format};base64,${btoa(base64String)}`;
          }

          resolve({
            title: tags.title || file.name,
            artist: tags.artist || 'Unknown Artist',
            picture: pictureUrl
          });
        },
        onError: (error) => {
          console.warn('ID3タグ解析エラー:', error);
          resolve({ title: file.name, artist: 'Unknown Artist', picture: null });
        }
      });
    });
  } catch (err) {
    console.error('メタデータ処理失敗:', err);
    return { title: file.name, artist: 'Unknown Artist', picture: null };
  }
}
